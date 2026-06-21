const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-5";

const LANG: Record<string, string> = {
  en: "English",
  es: "Spanish",
  zh: "Chinese",
  vi: "Vietnamese",
  tl: "Tagalog",
};

type VoiceAction = {
  id: string;
  description: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const { transcript, language, screen, actions } = await req.json();

    if (!transcript || !Array.isArray(actions) || actions.length === 0) {
      return Response.json(
        { action: "none", confidence: 0, spokenResponse: "" },
        { headers: CORS },
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return Response.json(
        { action: "none", confidence: 0, spokenResponse: "" },
        { headers: CORS },
      );
    }

    const langName = LANG[language] ?? "English";

    const safeActions: VoiceAction[] = actions
      .filter((a: any) => typeof a?.id === "string" && typeof a?.description === "string")
      .map((a: any) => ({
        id: a.id,
        description: a.description,
      }));

    if (safeActions.length === 0) {
      return Response.json(
        { action: "none", confidence: 0, spokenResponse: "" },
        { headers: CORS },
      );
    }

    const actionList = safeActions
      .map((a) => `- ${a.id}: ${a.description}`)
      .join("\n");

    const system =
      `Map an elderly user's spoken words to ONE app action.\n` +
      `Screen: "${screen ?? "unknown"}".\n\n` +
      `Available actions:\n${actionList}\n\n` +
      `Return JSON ONLY in this exact shape:\n` +
      `{"action":"<one action id or 'none'>","confidence":0..1,"spokenResponse":"<one short warm sentence in ${langName}, or empty>"}\n\n` +
      `Rules:\n` +
      `- Understand natural, indirect phrasing in any language.\n` +
      `- Choose only one action.\n` +
      `- Pick "none" if nothing clearly matches.\n` +
      `- spokenResponse must be written in ${langName}.\n` +
      `- spokenResponse should be short, warm, and suitable for an older adult.\n` +
      `- Do not include markdown or extra text.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 140,
        system,
        messages: [
          {
            role: "user",
            content: `The user said: "${transcript}". Return JSON only.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      return Response.json(
        { action: "none", confidence: 0, spokenResponse: "" },
        { headers: CORS },
      );
    }

    const payload = await res.json();
    const text = payload?.content?.[0]?.text ?? "{}";

    let parsed: any = {
      action: "none",
      confidence: 0,
      spokenResponse: "",
    };

    try {
      const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
      parsed = JSON.parse(jsonText);
    } catch {
      // keep default
    }

    const validAction = safeActions.some((a) => a.id === parsed.action);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

    return Response.json(
      {
        action: validAction ? parsed.action : "none",
        confidence,
        spokenResponse:
          typeof parsed.spokenResponse === "string" ? parsed.spokenResponse : "",
      },
      { headers: CORS },
    );
  } catch {
    return Response.json(
      { action: "none", confidence: 0, spokenResponse: "" },
      { headers: CORS },
    );
  }
});
