// Interpret a short voice transcript against the buttons currently visible on
// the user's screen and return which action (if any) the user wants to take.
// Uses Claude with a strict tool call so output is always structured.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-5";

type Action = { id: string; label: string; description?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { transcript, actions } = (await req.json()) as {
      transcript?: string;
      actions?: Action[];
    };
    const t = (transcript || "").trim();
    const acts = Array.isArray(actions) ? actions.filter(a => a && a.id && a.label) : [];
    if (!t || acts.length === 0) {
      return Response.json({ actionId: null, reason: "empty" }, { headers: CORS });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return Response.json({ actionId: null, reason: "no_key" }, { headers: CORS });
    }

    const ids = acts.map(a => a.id);
    const tool = {
      name: "pick_action",
      description:
        "Pick the single button on screen that best matches what the elderly user said. " +
        "If nothing matches clearly, return actionId='none'.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["actionId", "confidence"],
        properties: {
          actionId: { type: "string", enum: [...ids, "none", "repeat"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    };

    const buttonList = acts
      .map(a => `- id="${a.id}" label="${a.label}"${a.description ? ` (${a.description})` : ""}`)
      .join("\n");

    const system = `You map an elderly user's spoken phrase to ONE button on a mobile screen.
You MUST call the pick_action tool exactly once. Never reply with free text.
Rules:
- Be generous: paraphrases, multiple languages, "yes/no", "go ahead", "do it", "send it", "the red one", "the big button", "talk to a person", "try again", "go back" should all map to the closest visible button.
- If the user just wants you to repeat what was said, return actionId="repeat".
- If truly nothing matches, return actionId="none".
- Prefer the primary/affirmative button when the user is clearly agreeing.`;

    const userMsg = `Buttons currently on screen:\n${buttonList}\n\nUser said: "${t}"\n\nWhich button do they want?`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: "pick_action" },
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("anthropic interpret error", res.status, errText);
      return Response.json({ actionId: null, reason: `anthropic_${res.status}` }, { headers: CORS });
    }

    const data = await res.json();
    const toolUse = (data?.content || []).find((c: any) => c.type === "tool_use");
    const input = toolUse?.input || {};
    const pickedId = String(input.actionId || "none");
    const confidence = Number(input.confidence ?? 0);

    const finalId = pickedId === "none" || pickedId === "repeat"
      ? pickedId
      : (ids.includes(pickedId) ? pickedId : "none");

    return Response.json({ actionId: finalId, confidence, transcript: t }, { headers: CORS });
  } catch (e) {
    console.error("interpret-command fatal", e);
    return Response.json({ actionId: null, reason: "fatal" }, { headers: CORS });
  }
});
