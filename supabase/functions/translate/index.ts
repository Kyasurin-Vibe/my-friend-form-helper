// Translate arbitrary short text via Claude. Used for fixed app lines (greetings,
// "Hold still", button labels) so the whole UX is in the chosen language.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-4-5";
const LANG: Record<string, string> = {
  es: "Spanish",
  zh: "Chinese (Simplified)",
  vi: "Vietnamese",
  tl: "Tagalog",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let originalText = "";
  try {
    const body = await req.json();
    const text = String(body?.text ?? "");
    const language = String(body?.language ?? "");
    originalText = text;
    if (!text || !language || language === "en" || !LANG[language]) {
      return Response.json({ text }, { headers: CORS });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return Response.json({ text }, { headers: CORS });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system:
          `Translate the user's text to ${LANG[language]}. Warm, plain, for an elderly person. ` +
          `Preserve any leading emoji or punctuation. Return ONLY the translation — no quotes, no notes, no extra words.`,
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!res.ok) return Response.json({ text }, { headers: CORS });
    const payload = await res.json();
    const out = payload?.content?.[0]?.text?.trim();
    return Response.json({ text: out || text }, { headers: CORS });
  } catch {
    return Response.json({ text: originalText }, { headers: CORS });
  }
});
