// Deepgram speech-to-text. Receives raw audio bytes (Content-Type set by caller),
// returns { transcript: string }. DEEPGRAM_API_KEY is read from secrets only.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!apiKey)
      return Response.json(
        { error: "deepgram_not_configured" },
        { status: 503, headers: CORS },
      );

    const contentType = req.headers.get("content-type") || "audio/webm";
    const audio = await req.arrayBuffer();
    if (!audio.byteLength)
      return Response.json({ error: "empty_audio" }, { status: 400, headers: CORS });

    const url0 = new URL(req.url);
    const langParam = (url0.searchParams.get("language") || "en").toLowerCase();
    const LANG_MAP: Record<string, string> = { en: "en", es: "es", zh: "zh-CN", vi: "vi", tl: "tl" };
    const dgLang = LANG_MAP[langParam] || "en";
    // Use nova-2 for English; nova-2-general for others.
    const model = dgLang === "en" ? "nova-2" : "nova-2-general";
    const url =
      `https://api.deepgram.com/v1/listen?model=${model}&smart_format=true&punctuate=true&language=${encodeURIComponent(dgLang)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
      body: audio,
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("deepgram stt error", r.status, errText);
      return Response.json(
        { error: `deepgram_${r.status}` },
        { status: 502, headers: CORS },
      );
    }

    const json = await r.json();
    const transcript: string =
      json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    return Response.json({ transcript }, { headers: CORS });
  } catch (e) {
    console.error("transcribe fatal", e);
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
