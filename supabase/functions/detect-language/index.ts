const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAP: Record<string, string> = {
  en: "en",
  es: "es",
  zh: "zh",
  "zh-CN": "zh",
  "zh-TW": "zh",
  vi: "vi",
  tl: "tl",
  fil: "tl",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { audio } = await req.json(); // base64, no "data:" prefix
    const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!audio || !apiKey) {
      return Response.json(
        { language: null, transcript: "" },
        { headers: CORS }
      );
    }

    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?detect_language=true&model=nova-2&smart_format=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "audio/webm",
        },
        body: bytes,
      }
    );

    if (!res.ok) {
      console.error("Deepgram", res.status, await res.text());
      return Response.json(
        { language: null, transcript: "" },
        { headers: CORS }
      );
    }

    const data = await res.json();
    const ch = data?.results?.channels?.[0];
    const detected = ch?.detected_language ?? null;

    return Response.json(
      {
        language: MAP[detected] ?? null,
        transcript: ch?.alternatives?.[0]?.transcript ?? "",
        raw: detected,
      },
      { headers: CORS }
    );
  } catch (e) {
    console.error("detect-language", e);
    return Response.json(
      { language: null, transcript: "" },
      { headers: CORS }
    );
  }
});
