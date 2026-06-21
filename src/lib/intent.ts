// Client helper for the interpret-intent edge function.
import { supabase } from "@/integrations/supabase/client";

export type IntentAction = { id: string; description: string };

export async function interpretIntent(
  transcript: string,
  screen: string,
  actions: IntentAction[],
): Promise<{ action: string; confidence: number }> {
  try {
    const { data, error } = await supabase.functions.invoke("interpret-intent", {
      body: { transcript, screen, actions },
    });
    if (error || !data) return { action: "none", confidence: 0 };
    return {
      action: typeof data.action === "string" ? data.action : "none",
      confidence: Number(data.confidence) || 0,
    };
  } catch {
    return { action: "none", confidence: 0 };
  }
}
