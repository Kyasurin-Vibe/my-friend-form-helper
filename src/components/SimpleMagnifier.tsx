import { useCallback, useEffect, useRef, useState } from "react";
import { speakWarm } from "@/lib/cases";
import { getLang, t, useT } from "@/lib/i18n";
import { useVoiceLoop } from "@/lib/voice-loop";

type Props = {
  onBack: () => void;
  onQuestion: () => void;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;
const BRIGHT_MIN = 0.6;
const BRIGHT_MAX = 2.2;
const BRIGHT_STEP = 0.2;

/**
 * Pure seeing aid. Camera + zoom + brightness. No capture, no AI.
 * Voice is handled entirely by the global PersistentVoice via useVoiceLoop —
 * this component implements no voice loop of its own.
 */
export function SimpleMagnifier({ onBack, onQuestion }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const introSpokenRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(1);

  const lblStarting = useT("starting_camera");
  const lblQuestion = useT("i_have_question");
  const lblBackHome = useT("back_home");

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
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
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
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, []);

  // Spoken intro in the chosen language (static i18n key, no AI).
  useEffect(() => {
    if (!ready || introSpokenRef.current) return;
    introSpokenRef.current = true;
    void speakWarm(t("magnifier_intro"), { skipTranslate: true });
  }, [ready]);

  const doBigger = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  }, []);
  const doSmaller = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  }, []);
  const doBrighter = useCallback(() => {
    setBrightness((b) => Math.min(BRIGHT_MAX, +(b + BRIGHT_STEP).toFixed(2)));
  }, []);
  const doDimmer = useCallback(() => {
    setBrightness((b) => Math.max(BRIGHT_MIN, +(b - BRIGHT_STEP).toFixed(2)));
  }, []);

  // Register voice actions with the shared loop. STT + interpret-intent + TTS
  // are owned by the global PersistentVoice.
  useVoiceLoop({
    screen: "magnifier",
    language: getLang(),
    enabled: true,
    actions: {
      bigger: doBigger,
      smaller: doSmaller,
      brighter: doBrighter,
      dimmer: doDimmer,
      scan: onQuestion,
      back: onBack,
      home: onBack,
    },
  });

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
            {error ?? lblStarting}
          </div>
        )}
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-white text-sm"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          🔍 {zoom.toFixed(1)}× · ☀ {Math.round(brightness * 100)}%
        </div>

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
          ❓ {lblQuestion}
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
          ↩ {lblBackHome}
        </button>
      </div>
    </div>
  );
}
