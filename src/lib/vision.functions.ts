import { createServerFn } from "@tanstack/react-start";

export type VisionResult = {
  code: string;
  title: string;
  confidence: number;
  readable: boolean;
  fields: { name: string; present: boolean }[];
  notes?: string;
};

const SYSTEM = `You are a legal-document vision assistant for a senior-friendly social-justice intake app.
Look at the photo and identify which California family-law / self-help legal form it is, whether the image is readable, and which key fields are filled in.
Always respond with STRICT JSON matching this TypeScript type:
{
  "code": string,        // e.g. "FL-142", "FL-150", "DV-100", or "UNKNOWN"
  "title": string,       // human title of the form, or "Unknown document"
  "confidence": number,  // 0..1
  "readable": boolean,   // false if image is blurry / cropped / too dark
  "fields": { "name": string, "present": boolean }[],
  "notes": string        // one short sentence for the reviewer
}
No prose, no markdown — JSON only.`;

export const analyzeDocumentImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const o = input as { imageDataUrl?: string };
    if (!o?.imageDataUrl || typeof o.imageDataUrl !== "string") {
      throw new Error("imageDataUrl required");
    }
    return { imageDataUrl: o.imageDataUrl };
  })
  .handler(async ({ data }): Promise<VisionResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Identify this document and return JSON only." },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Rate limit — please try again shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Plans & credits.");
      throw new Error(`Vision request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";

    let parsed: Partial<VisionResult> = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
      }
    }

    return {
      code: String(parsed.code ?? "UNKNOWN"),
      title: String(parsed.title ?? "Unknown document"),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      readable: parsed.readable !== false,
      fields: Array.isArray(parsed.fields) ? parsed.fields.map((f) => ({
        name: String(f?.name ?? ""),
        present: !!f?.present,
      })) : [],
      notes: parsed.notes ? String(parsed.notes) : undefined,
    };
  });
