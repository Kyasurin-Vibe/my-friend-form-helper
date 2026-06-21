// Deepgram Aura TTS. Returns audio/mp3 bytes. Frontend falls back to speechSynthesis
// if this fails or DEEPGRAM_API_KEY is not configured.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { text, voice, language } = (await req.json()) as { text?: string; voice?: string; language?: string };
    if (!text || typeof text !== "string") {
      return Response.json({ error: "text required" }, { status: 400, headers: CORS });
    }
    const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "deepgram_not_configured" }, { status: 503, headers: CORS });
    }

    // Aura v1 supports English voices only. For other languages, return 503
    // so the client falls back to browser speechSynthesis in the right lang.
    const lang = (language || "en").toLowerCase();
    if (lang !== "en") {
      return Response.json({ error: "language_not_supported" }, { status: 503, headers: CORS });
    }
    const model = voice || "aura-asteria-en";
    const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mp3`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify({ text }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("deepgram error", r.status, errText);
      return Response.json({ error: `deepgram_${r.status}` }, { status: 502, headers: CORS });
    }

    const audio = await r.arrayBuffer();
    return new Response(audio, {
      headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    console.error("tts fatal", e);
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
