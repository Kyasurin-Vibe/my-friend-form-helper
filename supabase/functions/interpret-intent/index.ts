const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-4-5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { transcript, screen, actions } = await req.json();
    if (!transcript || !Array.isArray(actions) || actions.length === 0) {
      return Response.json({ action: "none", confidence: 0 }, { headers: CORS });
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return Response.json({ action: "none", confidence: 0 }, { headers: CORS });

    const list = actions.map((a: any) => `- ${a.id}: ${a.description}`).join("\n");
    const system =
      `You map an elderly user's spoken words to ONE app action. They are on the "${screen}" ` +
      `screen. Available actions:\n${list}\n\nReturn JSON ONLY: ` +
      `{"action":"<one action id, or 'none'>","confidence":0..1}. Pick "none" if nothing ` +
      `clearly matches. Understand natural, indirect phrasing — e.g. "help me see this" / ` +
      `"I can't read this" → a magnify/see action; "I have a question about my paper" → the ` +
      `scan/question action; "send it" / "connect me" → the connect/send action.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 60,
        system,
        messages: [{ role: "user", content: `The user said: "${transcript}". Which action? JSON only.` }],
      }),
    });
    if (!res.ok) return Response.json({ action: "none", confidence: 0 }, { headers: CORS });
    const payload = await res.json();
    const text = payload?.content?.[0]?.text ?? "{}";
    let parsed: any = { action: "none", confidence: 0 };
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text); } catch { /* keep default */ }
    const valid = actions.some((a: any) => a.id === parsed.action);
    return Response.json(
      { action: valid ? parsed.action : "none", confidence: Number(parsed.confidence) || 0 },
      { headers: CORS },
    );
  } catch {
    return Response.json({ action: "none", confidence: 0 }, { headers: CORS });
  }
});
