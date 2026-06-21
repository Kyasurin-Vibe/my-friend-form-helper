// Supabase-backed cases store + edge-function calls for analyze and send.
// Replaces the old localStorage shim in handoff.ts.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Branch = "missing" | "complete";

export type DocumentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

export type AnalysisResult = {
  readable: boolean;
  documentType: string;
  documentName: string;
  confidence: number;
  plainEnglishSummary: string;
  possibleMissingFields: string[];
  recommendedAction: "retake" | "confirm_send" | "human_review";
  elderMessage: string;
  documentBounds: DocumentBounds | null;
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
  original_image_url: string | null;
  processed_image_url: string | null;
  document_bounds: DocumentBounds | null;
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

/**
 * Crop a captured image to the AI-returned bounds with ~3% padding.
 * Returns the original data URL if bounds are null or cropping fails.
 */
export async function cropToBounds(
  imageDataUrl: string,
  bounds: DocumentBounds | null,
  paddingFrac = 0.03,
): Promise<string> {
  if (!bounds) return imageDataUrl;
  if (typeof window === "undefined") return imageDataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imageDataUrl;
    });
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const x0 = Math.max(0, bounds.x - paddingFrac);
    const y0 = Math.max(0, bounds.y - paddingFrac);
    const x1 = Math.min(1, bounds.x + bounds.width + paddingFrac);
    const y1 = Math.min(1, bounds.y + bounds.height + paddingFrac);
    const sx = Math.round(x0 * iw);
    const sy = Math.round(y0 * ih);
    const sw = Math.max(1, Math.round((x1 - x0) * iw));
    const sh = Math.max(1, Math.round((y1 - y0) * ih));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return imageDataUrl;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch (e) {
    console.warn("cropToBounds failed", e);
    return imageDataUrl;
  }
}

export async function sendToCenter(opts: {
  originalImage?: string;
  processedImage?: string;
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

