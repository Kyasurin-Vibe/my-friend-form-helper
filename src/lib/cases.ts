// Supabase-backed cases store + edge-function calls for analyze and send.
// Replaces the old localStorage shim in handoff.ts.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Branch = "missing" | "complete";

export type AnalysisResult = {
  readable: boolean;
  documentType: string;
  documentName: string;
  confidence: number;
  plainEnglishSummary: string;
  possibleMissingFields: string[];
  recommendedAction: "retake" | "confirm_send" | "human_review";
  elderMessage: string;
};

export type SendResult = {
  trackingId: string;
  status: "sent_to_center" | "needs_review";
  centerName: string;
  elderMessage: string;
};

export type CaseRow = {
  id: string;
  tracking_id: string;
  doc_type: string | null;
  doc_name: string | null;
  status: string;
  ai_summary: string | null;
  possible_missing_fields: string[];
  confidence: number | null;
  image_url: string | null;
  initials: string | null;
  audit_trail: { time: string; text: string }[];
  created_at: string;
};

export const CENTER_NAME = "Legal Aid Center";

export async function analyzeDocument(imageDataUrl: string, userGoal?: string): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke("analyze-document", {
    body: { image: imageDataUrl, userGoal },
  });
  if (error) throw error;
  return data as AnalysisResult;
}

export async function sendToCenter(opts: {
  image?: string;
  analysis: AnalysisResult;
  initials?: string;
}): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke("send-to-center", { body: opts });
  if (error) throw error;
  return data as SendResult;
}

// Live cases query + realtime subscription for the staff dashboard.
export function useCases(): CaseRow[] {
  const [cases, setCases] = useState<CaseRow[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) {
        console.error("load cases", error);
        return;
      }
      setCases((data ?? []) as unknown as CaseRow[]);
    };
    load();

    const channel = supabase
      .channel("cases-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases" },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return cases;
}

// Speak a line via Deepgram (warm voice), with browser fallback if it fails or is slow.
export async function speakWarm(text: string, opts?: { timeoutMs?: number }): Promise<void> {
  if (typeof window === "undefined" || !text) return;
  const timeoutMs = opts?.timeoutMs ?? 1500;
  const w = window as unknown as { __mfTtsAudio?: HTMLAudioElement };
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  try { w.__mfTtsAudio?.pause(); } catch { /* noop */ }
  w.__mfTtsAudio = undefined;

  const fallback = () => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 1.05;
      window.speechSynthesis.speak(u);
    } catch { /* noop */ }
  };

  try {
    const fetchPromise = supabase.functions.invoke("tts", {
      body: { text },
      // @ts-expect-error supabase-js supports responseType: 'blob' at runtime
      responseType: "blob",
    });
    const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error("tts_timeout") }), timeoutMs),
    );
    const { data, error } = (await Promise.race([fetchPromise, timeout])) as {
      data: Blob | null;
      error: unknown;
    };
    if (error || !data || !(data instanceof Blob) || data.size < 200) {
      fallback();
      return;
    }
    const url = URL.createObjectURL(data);
    const audio = new Audio(url);
    w.__mfTtsAudio = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => { URL.revokeObjectURL(url); fallback(); };
    await audio.play();
  } catch {
    fallback();
  }
}

