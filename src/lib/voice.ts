// Voice layer: TTS cancel + tap-to-talk STT via Deepgram (transcribe edge fn) +
// constrained intent mapping. The frontend never sees DEEPGRAM_API_KEY.

import { supabase } from "@/integrations/supabase/client";

export type VoiceIntent = "confirm" | "cancel" | "repeat" | "unknown";

export function classifyIntent(raw: string): VoiceIntent {
  const t = (raw || "").toLowerCase().trim();
  if (!t) return "unknown";
  if (/\b(yes|yeah|yep|yup|sure|send( it)?|okay|ok|go ahead|do it|confirm|next|scan|ready|open|start|go|capture|snap|take it)\b/.test(t))
    return "confirm";
  if (/\b(no|nope|not yet|wait|stop|cancel|back|keep looking|retake|try again)\b/.test(t))
    return "cancel";
  if (/\b(read( it)?( again)?|again|repeat|say (that|it) again|what (is|does) (this|it)( say)?)\b/.test(t))
    return "repeat";
  return "unknown";
}

// Cancel ANY current speech (Deepgram audio + speechSynthesis).
export function cancelSpeech() {
  if (typeof window === "undefined") return;
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  try {
    const w = window as unknown as { __mfTtsAudio?: HTMLAudioElement };
    w.__mfTtsAudio?.pause();
    w.__mfTtsAudio = undefined;
  } catch { /* noop */ }
}

// Record a short clip from the mic and return the audio blob (or null).
// Caller calls stop() to end recording early. Auto-stops at maxMs.
export async function startRecording(maxMs = 4000): Promise<{
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone not supported");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
    (t) => (window as any).MediaRecorder?.isTypeSupported?.(t),
  ) || "";
  const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  rec.start();

  let cancelled = false;
  const cleanup = () => stream.getTracks().forEach((t) => t.stop());

  const stopPromise = new Promise<Blob | null>((resolve) => {
    rec.onstop = () => {
      cleanup();
      if (cancelled) return resolve(null);
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      resolve(blob.size > 200 ? blob : null);
    };
  });

  const timer = window.setTimeout(() => {
    if (rec.state !== "inactive") rec.stop();
  }, maxMs);

  return {
    stop: async () => {
      window.clearTimeout(timer);
      if (rec.state !== "inactive") rec.stop();
      return stopPromise;
    },
    cancel: () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (rec.state !== "inactive") rec.stop();
      cleanup();
    },
  };
}

// Send audio to the transcribe edge function. ~2s timeout for snappy UX.
export async function transcribeAudio(blob: Blob, timeoutMs = 2500): Promise<string> {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm", apikey: key, Authorization: `Bearer ${key}` },
      body: blob,
      signal: ctrl.signal,
    });
    if (!r.ok) return "";
    const j = await r.json().catch(() => ({}));
    return (j?.transcript as string) || "";
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

// AI-backed command interpreter. Given a transcript and the buttons currently
// on screen, ask the edge function which button (if any) the user meant.
// Returns "repeat" when the user wants the prompt read again, "none" when
// nothing matched clearly, or one of the supplied action ids.
export type VoiceAction = { id: string; label: string; description?: string };
export type InterpretResult = {
  actionId: string | "none" | "repeat" | null;
  transcript: string;
  confidence: number;
};

export async function interpretCommand(
  transcript: string,
  actions: VoiceAction[],
  timeoutMs = 4000,
): Promise<InterpretResult> {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/interpret-command`;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ transcript, actions }),
      signal: ctrl.signal,
    });
    if (!r.ok) return { actionId: null, transcript, confidence: 0 };
    const j = await r.json().catch(() => ({}));
    return {
      actionId: (j?.actionId as string) ?? null,
      transcript: (j?.transcript as string) ?? transcript,
      confidence: Number(j?.confidence ?? 0),
    };
  } catch {
    return { actionId: null, transcript, confidence: 0 };
  } finally {
    clearTimeout(t);
  }
}

