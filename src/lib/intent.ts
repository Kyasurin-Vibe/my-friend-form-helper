// Client helper for the interpret-intent edge function.
import { supabase } from "@/integrations/supabase/client";
import { getLang } from "@/lib/i18n";

export type IntentAction = { id: string; description: string };

export type IntentResult = {
  action: string;
  confidence: number;
  spokenResponse: string;
};

export async function interpretIntent(
  transcript: string,
  screen: string,
  actions: IntentAction[],
): Promise<IntentResult> {
  try {
    const { data, error } = await supabase.functions.invoke("interpret-intent", {
      body: { transcript, screen, actions, language: getLang() },
    });
    if (error || !data) return { action: "none", confidence: 0, spokenResponse: "" };
    return {
      action: typeof data.action === "string" ? data.action : "none",
      confidence: Number(data.confidence) || 0,
      spokenResponse:
        typeof data.spokenResponse === "string" ? data.spokenResponse : "",
    };
  } catch {
    return { action: "none", confidence: 0, spokenResponse: "" };
  }
}
