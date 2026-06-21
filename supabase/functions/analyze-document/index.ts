const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-5";

const SYSTEM = `You are a senior-friendly legal-intake document scanner for a community legal aid program.
You receive ONE photo and MUST call the "report_document" tool exactly once. Never reply with free text.

Rules:
- You are NOT a lawyer. Never say a document is legally valid, complete, filed, or accepted.
- Use cautious wording: "looks like", "appears", "may be blank".
- Identify VISIBLE blank/incomplete fields only (e.g. "signature area appears blank").
- If the photo is blurry/dark/cropped/unreadable, set readable=false.
- documentBounds: the TIGHT bounding box of the PAPER itself within the image, as fractions
  0..1 (x,y = top-left corner of the paper; width,height = its size). EXCLUDE hands, table,
  ceiling, and background — wrap the paper edges as tightly as possible. If you cannot see a
  clear document, return x:0, y:0, width:1, height:1.
- resourceCategory: classify what KIND of help this document relates to, ONE of:
  "legal", "benefits", "housing", "healthcare", "immigration", "general", or "none".
  Use "none" if it is NOT something a person needs help with (an ad, flyer, poster, or
  unrelated photo). Base it on what the document actually is.
- elderMessage: ONE short warm sentence (max 22 words), no legal jargon.`;

const TOOL = {
  name: "report_document",
  description: "Return a structured description of the photographed document.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "readable", "documentType", "documentName", "confidence",
      "plainEnglishSummary", "possibleMissingFields", "elderMessage", "documentBounds",
      "resourceCategory",
    ],
    properties: {
      readable: { type: "boolean" },
      documentType: { type: "string", description: 'e.g. "FL-142" or "unknown".' },
      documentName: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      plainEnglishSummary: { type: "string" },
      possibleMissingFields: { type: "array", items: { type: "string" } },
      elderMessage: { type: "string" },
      documentBounds: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y", "width", "height"],
        properties: {
          x: { type: "number", description: "left edge of paper, 0..1" },
          y: { type: "number", description: "top edge of paper, 0..1" },
          width: { type: "number", description: "paper width, 0..1" },
          height: { type: "number", description: "paper height, 0..1" },
        },
      },
      resourceCategory: {
        type: "string",
        enum: ["legal", "benefits", "housing", "healthcare", "immigration", "general", "none"],
      },
    },
  },
} as const;

function parseDataUrl(dataUrl: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Validate Claude's bounds; reject garbage (full frame, zero-size, out of range).
function sanitizeBounds(b: any): { x: number; y: number; width: number; height: number; confidence: number } | null {
  if (!b || typeof b !== "object") return null;
  let x = Number(b.x), y = Number(b.y), w = Number(b.width), h = Number(b.height);
  if ([x, y, w, h].some((v) => !Number.isFinite(v))) return null;
  x = clamp01(x); y = clamp01(y);
  w = clamp01(w); h = clamp01(h);
  if (w <= 0.05 || h <= 0.05) return null;            // too small → ignore
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  // If it's basically the whole frame, treat as "no crop".
  if (x <= 0.02 && y <= 0.02 && w >= 0.96 && h >= 0.96) return null;
  return { x, y, width: w, height: h, confidence: 1 };
}

function decide(a: { readable: boolean; confidence: number; possibleMissingFields: string[] }):
  "retake" | "confirm_send" | "human_review" {
  if (!a.readable) return "retake";
  if ((a.possibleMissingFields?.length ?? 0) > 0 || a.confidence < 0.75) return "human_review";
  return "confirm_send";
}

function fallback(readable = false) {
  return {
    readable,
    documentType: "unknown",
    documentName: "Unknown document",
    confidence: readable ? 0.4 : 0.2,
    plainEnglishSummary: readable
      ? "The system could not analyze this document right now."
      : "The image is not clear enough to read.",
    possibleMissingFields: [] as string[],
    recommendedAction: (readable ? "human_review" : "retake") as "human_review" | "retake",
    elderMessage: readable
      ? "I couldn't check this clearly. I can send it to the Legal Aid Center for a person to review."
      : "This picture is too blurry. Please move closer, keep all four corners inside the frame, and try again.",
    documentBounds: null as null,
    resourceCategory: "general",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return Response.json({ error: "image (base64 data URL) required" }, { status: 400, headers: CORS });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return Response.json(fallback(false), { headers: CORS });

    const parsed = parseDataUrl(image);
    if (!parsed) return Response.json({ error: "image must be a data URL" }, { status: 400, headers: CORS });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "report_document" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: parsed.media_type, data: parsed.data } },
            { type: "text", text: "Look at this photo and report what you see, including a tight documentBounds box around the paper." },
          ],
        }],
      }),
    });

    if (!res.ok) {
      console.error("Claude error", res.status, await res.text());
      return Response.json(fallback(false), { headers: CORS });
    }

    const payload = await res.json();
    const block = Array.isArray(payload?.content)
      ? payload.content.find((b: any) => b.type === "tool_use" && b.name === "report_document")
      : null;
    const ai = block?.input;
    if (!ai || typeof ai !== "object") return Response.json(fallback(false), { headers: CORS });

    const possibleMissingFields = Array.isArray(ai.possibleMissingFields) ? ai.possibleMissingFields : [];
    const confidence = Number(ai.confidence) || 0;
    const readable = !!ai.readable;

    return Response.json({
      readable,
      documentType: String(ai.documentType || "unknown"),
      documentName: String(ai.documentName || "Unknown document"),
      confidence,
      plainEnglishSummary: String(ai.plainEnglishSummary || ""),
      possibleMissingFields,
      recommendedAction: decide({ readable, confidence, possibleMissingFields }),
      elderMessage: String(ai.elderMessage || ""),
      documentBounds: sanitizeBounds(ai.documentBounds),
      resourceCategory: typeof ai.resourceCategory === "string" ? ai.resourceCategory : "general",
    }, { headers: CORS });
  } catch (e) {
    console.error("analyze-document fatal", e);
    return Response.json(fallback(false), { headers: CORS });
  }
});
