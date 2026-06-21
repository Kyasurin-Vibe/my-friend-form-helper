// Claude vision: identify document, flag visible blank/incomplete fields.
// Senior-friendly intake. AI only describes what it sees — rules (in app) decide action.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-5";

const SYSTEM = `You are a senior-friendly legal-intake document scanner for a community legal aid program.
You receive ONE photo of a document and must produce a STRUCTURED JSON response by calling the
"report_document" tool. Never reply with free text — always call the tool exactly once.

Rules:
- You are NOT a lawyer. Do not say a document is legally valid, complete, filed, or accepted.
- Use cautious wording inside text fields: "looks like", "appears", "may be blank".
- Identify VISIBLE blank / incomplete / missing-looking spots only (e.g. "signature area appears blank",
  "date area appears blank", "name line appears empty"). If the page looks fine, return an empty list.
- If the photo is blurry, dark, cropped, glare-covered, or the document text is unreadable,
  set "readable" to false and explain plainly.
- elderMessage must be ONE short sentence, warm, no legal jargon, max 22 words,
  suitable for an 80-year-old user listening on a phone.
- plainEnglishSummary is for a reviewer: one sentence describing what the document appears to be.`;

const TOOL = {
  name: "report_document",
  description: "Return a structured description of the photographed document.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "readable",
      "documentType",
      "documentName",
      "confidence",
      "plainEnglishSummary",
      "possibleMissingFields",
      "elderMessage",
    ],
    properties: {
      readable: { type: "boolean" },
      documentType: { type: "string", description: 'Short code, e.g. "FL-142" or "unknown".' },
      documentName: { type: "string", description: "Human title of the document." },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      plainEnglishSummary: { type: "string" },
      possibleMissingFields: {
        type: "array",
        items: { type: "string" },
        description: "Short phrases like 'signature area appears blank'. Empty if none.",
      },
      elderMessage: { type: "string", description: "ONE short sentence read aloud to the elder." },
    },
  },
} as const;

function parseDataUrl(dataUrl: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

function fallback(readable = false) {
  return readable
    ? {
        readable: true,
        documentType: "unknown",
        documentName: "Unknown document",
        confidence: 0.4,
        plainEnglishSummary: "The system could not analyze this document right now.",
        possibleMissingFields: [] as string[],
        recommendedAction: "human_review" as const,
        elderMessage: "I couldn't check this clearly. I can send it to the Legal Aid Center for a person to review.",
      }
    : {
        readable: false,
        documentType: "unknown",
        documentName: "Unknown document",
        confidence: 0.2,
        plainEnglishSummary: "The image is not clear enough to read.",
        possibleMissingFields: [] as string[],
        recommendedAction: "retake" as const,
        elderMessage: "This picture is too blurry. Please move closer, keep all four corners inside the frame, and try again.",
      };
}

function decide(a: {
  readable: boolean;
  confidence: number;
  possibleMissingFields: string[];
}): "retake" | "confirm_send" | "human_review" {
  if (!a.readable) return "retake";
  if ((a.possibleMissingFields?.length ?? 0) > 0 || a.confidence < 0.75) return "human_review";
  return "confirm_send";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { image, userGoal } = await req.json();
    if (!image || typeof image !== "string") {
      return Response.json({ error: "image (base64 data URL) required" }, { status: 400, headers: CORS });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.warn("ANTHROPIC_API_KEY missing — returning fallback");
      const r = fallback(false);
      return Response.json(r, { headers: CORS });
    }

    const parsed = parseDataUrl(image);
    if (!parsed) {
      return Response.json({ error: "image must be a data URL" }, { status: 400, headers: CORS });
    }

    const userText = userGoal
      ? `The user said their goal is: "${userGoal}". Look at this photo and report what you see.`
      : "Look at this photo and report what you see.";

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: parsed.media_type, data: parsed.data } },
              { type: "text", text: userText },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Claude error", claudeRes.status, errText);
      const r = fallback(false);
      return Response.json({ ...r, _error: `claude_${claudeRes.status}` }, { headers: CORS });
    }

    const payload = await claudeRes.json();
    const block = Array.isArray(payload?.content)
      ? payload.content.find((b: any) => b.type === "tool_use" && b.name === "report_document")
      : null;
    const ai = block?.input;

    if (!ai || typeof ai !== "object") {
      console.error("Claude returned no tool_use block", payload);
      const r = fallback(false);
      return Response.json(r, { headers: CORS });
    }

    const recommendedAction = decide({
      readable: !!ai.readable,
      confidence: Number(ai.confidence) || 0,
      possibleMissingFields: Array.isArray(ai.possibleMissingFields) ? ai.possibleMissingFields : [],
    });

    return Response.json(
      {
        readable: !!ai.readable,
        documentType: String(ai.documentType || "unknown"),
        documentName: String(ai.documentName || "Unknown document"),
        confidence: Number(ai.confidence) || 0,
        plainEnglishSummary: String(ai.plainEnglishSummary || ""),
        possibleMissingFields: Array.isArray(ai.possibleMissingFields) ? ai.possibleMissingFields : [],
        recommendedAction,
        elderMessage: String(ai.elderMessage || ""),
      },
      { headers: CORS },
    );
  } catch (e) {
    console.error("analyze-document fatal", e);
    return Response.json(fallback(false), { headers: CORS });
  }
});
