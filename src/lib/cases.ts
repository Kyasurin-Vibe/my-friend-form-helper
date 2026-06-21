// Supabase-backed cases store + edge-function calls for analyze and send.
// Replaces the old localStorage shim in handoff.ts.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLang, getBCP47, getTTSVoice, ttsSupportsDeepgram } from "@/lib/i18n";


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
  resourceCategory?: string;
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
    body: { image: imageDataUrl, userGoal, language: getLang() },
  });
  if (error) throw error;
  return data as AnalysisResult;
}

export type DetectBoundsResult = {
  documentPresent: boolean;
  readable: boolean;
  confidence: number;
  documentBounds: { x: number; y: number; width: number; height: number } | null;
};

async function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
}

export async function downscaleDataUrl(dataUrl: string, targetWidth = 320, quality = 0.55): Promise<string> {
  if (typeof window === "undefined") return dataUrl;
  const img = await loadImg(dataUrl);
  const scale = Math.min(1, targetWidth / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

export async function detectDocumentBounds(fullFrameDataUrl: string): Promise<DetectBoundsResult | null> {
  try {
    const small = await downscaleDataUrl(fullFrameDataUrl, 320, 0.55);
    const { data, error } = await supabase.functions.invoke("detect-document", { body: { image: small } });
    if (error || !data) return null;
    return data as DetectBoundsResult;
  } catch (e) {
    console.warn("detectDocumentBounds failed", e);
    return null;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normalizeBounds(b: DocumentBounds): DocumentBounds | null {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const width = Math.max(0, Math.min(1 - x, b.width));
  const height = Math.max(0, Math.min(1 - y, b.height));
  if (width <= 0 || height <= 0) return null;
  return { ...b, x, y, width, height };
}

async function tightenToPaperPixels(
  img: HTMLImageElement,
  bounds: DocumentBounds,
): Promise<DocumentBounds | null> {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return null;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const sampleW = 520;
  const scale = Math.min(1, sampleW / iw);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const sx0 = Math.max(0, Math.floor(normalized.x * w));
  const sy0 = Math.max(0, Math.floor(normalized.y * h));
  const sx1 = Math.min(w, Math.ceil((normalized.x + normalized.width) * w));
  const sy1 = Math.min(h, Math.ceil((normalized.y + normalized.height) * h));
  const sw = sx1 - sx0;
  const sh = sy1 - sy0;
  if (sw < 12 || sh < 12) return null;
  const data = ctx.getImageData(sx0, sy0, sw, sh).data;
  const colCounts = new Uint16Array(sw);
  const rowCounts = new Uint16Array(sh);
  let paperish = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const idx = (y * sw + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = (r + g + b) / 3;
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const saturation = max === 0 ? 0 : (max - min) / max;
      const looksLikePaper = brightness > 132 && saturation < 0.38;
      if (looksLikePaper) {
        paperish++;
        colCounts[x]++;
        rowCounts[y]++;
      }
    }
  }
  if (paperish / (sw * sh) < 0.16) return null;
  const colThreshold = Math.max(2, Math.round(sh * 0.045));
  const rowThreshold = Math.max(2, Math.round(sw * 0.045));
  let x0 = 0;
  let x1 = sw - 1;
  let y0 = 0;
  let y1 = sh - 1;
  while (x0 < x1 && colCounts[x0] < colThreshold) x0++;
  while (x1 > x0 && colCounts[x1] < colThreshold) x1--;
  while (y0 < y1 && rowCounts[y0] < rowThreshold) y0++;
  while (y1 > y0 && rowCounts[y1] < rowThreshold) y1--;
  const tightW = x1 - x0 + 1;
  const tightH = y1 - y0 + 1;
  if (tightW < sw * 0.45 || tightH < sh * 0.45) return null;
  return normalizeBounds({
    x: (sx0 + x0) / w,
    y: (sy0 + y0) / h,
    width: tightW / w,
    height: tightH / h,
    confidence: Math.max(0.45, bounds.confidence),
  });
}

/**
 * Crop a captured image to the AI-returned bounds with a small padding.
 * Refines the box by sampling paper-like pixels inside Claude's bounds.
 * Returns the original data URL if bounds are null or cropping fails.
 */
export async function cropToBounds(
  imageDataUrl: string,
  bounds: DocumentBounds | null,
  paddingFrac = 0.012,
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
    const refined = await tightenToPaperPixels(img, bounds);
    const cropBounds = refined ?? bounds;
    const x0 = Math.max(0, cropBounds.x - paddingFrac);
    const y0 = Math.max(0, cropBounds.y - paddingFrac);
    const x1 = Math.min(1, cropBounds.x + cropBounds.width + paddingFrac);
    const y1 = Math.min(1, cropBounds.y + cropBounds.height + paddingFrac);
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


export type SendRecipient =
  | { kind: "center"; partnerName?: string }
  | { kind: "trusted"; name: string; relationship: string; email?: string };

export async function sendToCenter(opts: {
  originalImage?: string;
  processedImage?: string;
  analysis: AnalysisResult;
  initials?: string;
  recipient?: SendRecipient;
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

