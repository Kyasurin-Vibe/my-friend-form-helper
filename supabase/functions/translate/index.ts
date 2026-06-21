const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-4-5";
const LANG: Record<string, string> = { es:"Spanish", zh:"Chinese", vi:"Vietnamese", tl:"Tagalog" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { text, language } = await req.json();
    if (!text || !language || language === "en" || !LANG[language]) return Response.json({ text: text ?? "" }, { headers: CORS });
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return Response.json({ text }, { headers: CORS });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300,
        system: `Translate the user's text to ${LANG[language]}. Warm, plain, for an elderly person. Return ONLY the translation — no quotes, no notes.`,
        messages: [{ role: "user", content: String(text) }],
      }),
    });
    if (!res.ok) return Response.json({ text }, { headers: CORS });
    const payload = await res.json();
    return Response.json({ text: payload?.content?.[0]?.text?.trim() || text }, { headers: CORS });
  } catch { return Response.json({ text: "" }, { headers: CORS }); }
});
