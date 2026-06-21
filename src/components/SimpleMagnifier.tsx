import { useCallback, useEffect, useRef, useState } from "react";
import { DemoServices } from "@/lib/services";

type Props = {
  onBack: () => void;
  onQuestion: () => void;
};

function speak(text: string, onDone?: () => void) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) { onDone?.(); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.05;
  u.onend = () => onDone?.();
  u.onerror = () => onDone?.();
  synth.speak(u);
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;
const BRIGHT_MIN = 0.6;
const BRIGHT_MAX = 2.2;
const BRIGHT_STEP = 0.2;

/**
 * Pure seeing aid. Opens camera. Voice + buttons control zoom + brightness.
 * No capture, no AI.
 */
export function SimpleMagnifier({ onBack, onQuestion }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const introSpokenRef = useRef(false);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const lastCmdAtRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(1);

  const zoomRef = useRef(zoom);
  const brightRef = useRef(brightness);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { brightRef.current = brightness; }, [brightness]);

  // Camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("This device doesn't support the camera.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Camera unavailable");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const speakConfirm = useCallback((text: string) => {
    speakingRef.current = true;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    speak(text, () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doBigger = useCallback(() => {
    const next = Math.min(ZOOM_MAX, +(zoomRef.current + ZOOM_STEP).toFixed(2));
    if (next === zoomRef.current) { speakConfirm("That's as big as it goes."); return; }
    setZoom(next);
    speakConfirm("Okay — bigger.");
  }, [speakConfirm]);

  const doSmaller = useCallback(() => {
    const next = Math.max(ZOOM_MIN, +(zoomRef.current - ZOOM_STEP).toFixed(2));
    if (next === zoomRef.current) { speakConfirm("That's the smallest."); return; }
    setZoom(next);
    speakConfirm("Smaller.");
  }, [speakConfirm]);

  const doBrighter = useCallback(() => {
    const next = Math.min(BRIGHT_MAX, +(brightRef.current + BRIGHT_STEP).toFixed(2));
    if (next === brightRef.current) { speakConfirm("That's as bright as it goes."); return; }
    setBrightness(next);
    speakConfirm("Brighter now.");
  }, [speakConfirm]);

  const doDimmer = useCallback(() => {
    const next = Math.max(BRIGHT_MIN, +(brightRef.current - BRIGHT_STEP).toFixed(2));
    if (next === brightRef.current) { speakConfirm("That's the dimmest."); return; }
    setBrightness(next);
    speakConfirm("Dimmer.");
  }, [speakConfirm]);

  // Intro + start listening
  useEffect(() => {
    if (!ready || introSpokenRef.current) return;
    introSpokenRef.current = true;
    speakingRef.current = true;
    speak(
      "I'll make things bigger and clearer. If it's hard to see, just say 'bigger', 'smaller', or 'brighter'.",
      () => {
        speakingRef.current = false;
        if (shouldListenRef.current) startVoice();
      },
    );
    shouldListenRef.current = true;
    startVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      try { DemoServices.voice.stop(); } catch { /* noop */ }
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    };
  }, []);

  function startVoice() {
    const service = DemoServices.voice;
    if (!service.available()) return;
    if (speakingRef.current) return;
    try {
      service.start({
        onStart: () => { /* listening */ },
        onEnd: () => {
          if (shouldListenRef.current && !speakingRef.current) {
            window.setTimeout(() => startVoice(), 250);
          }
        },
        onError: () => { /* swallow */ },
        onTranscript: () => undefined,
        onCommand: (_cmd, raw) => {
          const t = (raw || "").toLowerCase().trim();
          if (!t) return;
          // de-dupe rapid duplicate fires
          const now = Date.now();
          if (now - lastCmdAtRef.current < 400) return;

          // Navigation intents first
          if (/\b(question|document|scan|paper|form|read|help me read)\b/.test(t)) {
            lastCmdAtRef.current = now;
            shouldListenRef.current = false;
            try { service.stop(); } catch { /* noop */ }
            onQuestion();
            return;
          }
          if (/\b(go back|back to home|home|exit|cancel|quit|done|return)\b/.test(t)) {
            lastCmdAtRef.current = now;
            shouldListenRef.current = false;
            try { service.stop(); } catch { /* noop */ }
            onBack();
            return;
          }

          // Brightness intents
          if (/\b(too bright|dimmer|darker|less light|too light)\b/.test(t)) {
            lastCmdAtRef.current = now;
            doDimmer();
            return;
          }
          if (/\b(bright|brighter|too dark|more light|lighter|can't see it|cant see it|still can't see|still cant see)\b/.test(t)) {
            lastCmdAtRef.current = now;
            doBrighter();
            return;
          }

          // Zoom intents
          if (/\b(smaller|too big|zoom out|further|farther|back out|less)\b/.test(t)) {
            lastCmdAtRef.current = now;
            doSmaller();
            return;
          }
          if (/\b(bigger|larger|zoom in|closer|enlarge|magnify|more|can't see|cant see|hard to see)\b/.test(t)) {
            lastCmdAtRef.current = now;
            doBigger();
            return;
          }
        },
      });
    } catch { /* noop */ }
  }

  const btn = (label: string, onClick: () => void, big = false) => (
    <button
      onClick={onClick}
      className="flex-1 font-extrabold active:scale-[0.95]"
      style={{
        background: "rgba(255,255,255,0.95)",
        color: "#111",
        border: "none",
        borderRadius: 20,
        padding: big ? "20px 0" : "16px 0",
        fontSize: big ? 32 : 20,
        minHeight: big ? 84 : 64,
        boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
      }}
      aria-label={label}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col" style={{ background: "#000" }}>
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            transform: `scale(${zoom.toFixed(2)})`,
            transformOrigin: "50% 50%",
            filter: `brightness(${brightness.toFixed(2)}) contrast(1.15) saturate(1.05)`,
            transition: "transform 220ms ease-out, filter 220ms ease-out",
          }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-lg">
            {error ?? "Starting camera…"}
          </div>
        )}
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-white text-sm"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          🔍 {zoom.toFixed(1)}× · ☀ {Math.round(brightness * 100)}%
        </div>

        {/* Floating control row on top of camera */}
        <div className="absolute bottom-3 left-3 right-3 flex gap-2">
          {btn("➖", doSmaller, true)}
          {btn("➕", doBigger, true)}
          {btn("🔅", doDimmer, true)}
          {btn("🔆", doBrighter, true)}
        </div>
      </div>

      <div className="p-4 space-y-3" style={{ background: "#1a1a1a" }}>
        <button
          onClick={onQuestion}
          className="w-full font-extrabold active:scale-[0.96] animate-button-pop-red"
          style={{
            background: "var(--color-elder-red)",
            color: "#fff",
            border: "none",
            borderRadius: 24,
            padding: "22px",
            fontSize: 22,
            minHeight: 80,
            boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
          }}
        >
          ❓ I have a question
        </button>
        <button
          onClick={onBack}
          className="w-full font-extrabold active:scale-[0.96]"
          style={{
            background: "#fff",
            color: "#1a1a1a",
            border: "none",
            borderRadius: 24,
            padding: "20px",
            fontSize: 20,
            minHeight: 72,
          }}
        >
          ↩ Back to home
        </button>
      </div>
    </div>
  );
}
