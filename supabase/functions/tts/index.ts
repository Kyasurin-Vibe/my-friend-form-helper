// ElevenLabs TTS (multilingual). Returns audio/mpeg bytes.
// Frontend falls back to browser speechSynthesis if this fails or times out.
// Uses eleven_multilingual_v2 so a single warm voice speaks all supported
// languages (English, Spanish, Chinese, Vietnamese, Tagalog) naturally.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sarah — calm, warm, friendly female voice. Good for elderly users.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  try {
    const { text, voice } = (await req.json()) as {
      text?: string;
      voice?: string;
      language?: string;
    };
    if (!text || typeof text !== "string") {
      return Response.json({ error: "text required" }, { status: 400, headers: CORS });
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "elevenlabs_not_configured" }, { status: 503, headers: CORS });
    }

    const voiceId = voice || DEFAULT_VOICE_ID;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.8,
          style: 0.25,
          use_speaker_boost: true,
          speed: 0.95,
        },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("elevenlabs error", r.status, errText);
      return Response.json({ error: `elevenlabs_${r.status}` }, { status: 502, headers: CORS });
    }

    const audio = await r.arrayBuffer();
    return new Response(audio, {
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error("tts fatal", e);
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
