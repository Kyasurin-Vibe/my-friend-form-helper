// Lightweight Claude vision check: is there a readable document in view?
// Used by the live scanner for auto-capture decisions. NO storage. NO OCR.
// Returns: { documentPresent, readable, confidence } only.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELS = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
];

const SYSTEM = `You are a fast document presence + bounds detector for a phone camera scanner.
You receive ONE small low-res frame. Decide ONLY these things:
- documentPresent: true if a paper document (form, letter, certificate, invoice, ID, etc.) is clearly visible in the frame.
- readable: true if the document text/structure looks sharp enough to read (not blurry, not glare-covered, not too dark, not heavily cropped).
- confidence: 0..1, your confidence in BOTH judgments together.
- documentBounds: tight bounding box of the paper document, NORMALIZED 0..1 to image dims (x,y top-left). Include only the document — not hands, not ceiling, not background. If you cannot clearly see a single document, set documentBounds to null.
Reply by calling the "report_presence" tool exactly once. No prose.`;

const TOOL = {
  name: "report_presence",
  description: "Report whether a readable document is in the frame, and its bounds.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["documentPresent", "readable", "confidence", "documentBounds"],
    properties: {
      documentPresent: { type: "boolean" },
      readable: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      documentBounds: {
        type: ["object", "null"],
        required: ["x", "y", "width", "height"],
        additionalProperties: false,
        properties: {
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
          width: { type: "number", minimum: 0, maximum: 1 },
          height: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

function parseDataUrl(dataUrl: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

const TIMEOUT_MS = 1900;

async function callClaude(apiKey: string, model: string, parsed: { media_type: string; data: string }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "report_presence" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: parsed.media_type, data: parsed.data } },
              { type: "text", text: "Is a readable paper document filling this frame?" },
            ],
          },
        ],
      }),
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return Response.json({ error: "image required" }, { status: 400, headers: CORS });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return Response.json({ documentPresent: false, readable: false, confidence: 0, _error: "no_key" }, { headers: CORS });
    }
    const parsed = parseDataUrl(image);
    if (!parsed) {
      return Response.json({ error: "image must be data URL" }, { status: 400, headers: CORS });
    }

    let lastErr = "";
    for (const model of MODELS) {
      try {
        const res = await callClaude(apiKey, model, parsed);
        if (!res.ok) {
          lastErr = `${model}_${res.status}`;
          // 404 / not_found_error → try next model
          if (res.status === 404 || res.status === 400) continue;
          // other errors: bail out with non-blocking response
          return Response.json({ documentPresent: false, readable: false, confidence: 0, _error: lastErr }, { headers: CORS });
        }
        const payload = await res.json();
        const block = Array.isArray(payload?.content)
          ? payload.content.find((b: any) => b.type === "tool_use" && b.name === "report_presence")
          : null;
        const ai = block?.input;
        if (!ai || typeof ai !== "object") {
          return Response.json({ documentPresent: false, readable: false, confidence: 0, _error: "no_tool_use" }, { headers: CORS });
        }
        const b = ai.documentBounds;
        const bounds = b && typeof b === "object"
          && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y))
          && Number.isFinite(Number(b.width)) && Number.isFinite(Number(b.height))
          ? {
              x: Math.max(0, Math.min(1, Number(b.x))),
              y: Math.max(0, Math.min(1, Number(b.y))),
              width: Math.max(0, Math.min(1, Number(b.width))),
              height: Math.max(0, Math.min(1, Number(b.height))),
            }
          : null;
        return Response.json(
          {
            documentPresent: !!ai.documentPresent,
            readable: !!ai.readable,
            confidence: Math.max(0, Math.min(1, Number(ai.confidence) || 0)),
            documentBounds: bounds,
          },
          { headers: CORS },
        );
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "err";
        continue;
      }
    }
    return Response.json({ documentPresent: false, readable: false, confidence: 0, _error: lastErr || "no_model" }, { headers: CORS });
  } catch (e) {
    console.error("detect-document fatal", e);
    return Response.json({ documentPresent: false, readable: false, confidence: 0 }, { headers: CORS });
  }
});
