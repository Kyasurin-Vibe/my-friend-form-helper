import { useEffect, useRef, useState } from "react";
import {
  DemoServices,
  type DetectedDoc,
  type VoiceCommand,
} from "@/lib/services";

type Props = {
  onConfirm: (detected?: DetectedDoc) => void;
  onCancel: () => void;
  onHandoff: () => void;
};

type Guidance = "init" | "move-closer" | "hold-still" | "corners" | "blurry" | "detected";

const GUIDANCE_TEXT: Record<Guidance, string> = {
  init: "Point the camera at your paper.",
  "move-closer": "Move a little closer.",
  "hold-still": "Hold still…",
  corners: "Put all four corners inside the frame.",
  blurry: "The picture is too blurry. Please try again.",
  detected: "Looks clear. Tap the red button to capture and check it.",
};

// Lightweight TTS helper local to this screen, so it composes with the
// outer useSpeech without fighting it for the queue.
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

export function LiveMagnifier({ onConfirm, onCancel, onHandoff }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1.4);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [highContrast, setHighContrast] = useState(false);
  const [guidance, setGuidance] = useState<Guidance>("init");
  const [detected, setDetected] = useState<DetectedDoc | null>(null);
  const [countdown, setCountdown] = useState(0); // seconds remaining
  const [listening, setListening] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string>("");
  const confirmedRef = useRef(false);
  const detectedRef = useRef<DetectedDoc | null>(null);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);
  useEffect(() => { detectedRef.current = detected; }, [detected]);

  // === Camera + mic permission ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("This device doesn't support the camera.");
          return;
        }
        // Ask for camera AND mic in one prompt so voice works after.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // Stop the audio track right away — Web Speech opens its own.
        stream.getAudioTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        setVoiceArmed(true); // mic was just granted via user gesture
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Camera unavailable";
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // === Local-only guidance cycle. NO AI calls happen in the magnifier. ===
  // Recognition runs only after the user taps "Capture & analyze" (handled in parent).
  useEffect(() => {
    if (!ready) return;
    const seq: Guidance[] = ["move-closer", "hold-still", "corners", "hold-still", "detected"];
    let i = 0;
    const id = window.setInterval(() => {
      setGuidance(seq[Math.min(i, seq.length - 1)]);
      i++;
      if (i >= seq.length) window.clearInterval(id);
    }, 1500);
    return () => window.clearInterval(id);
  }, [ready]);


  // === Speak guidance prompts (and pause mic while TTS plays) ===
  useEffect(() => {
    if (guidance === "init" || guidance === "hold-still") return;
    const text =
      guidance === "detected"
        ? "When the page is clear, tap the red button to capture and check it."
        : guidance === "blurry"
          ? "The picture is too blurry. Please try again."
          : GUIDANCE_TEXT[guidance];
    speakingRef.current = true;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    speak(text, () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
  }, [guidance, detected]);

  // === Indicative countdown (visual only — does NOT auto-confirm) ===
  useEffect(() => {
    if (guidance !== "detected" || !detected) return;
    setCountdown(8);
    const id = window.setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [guidance, detected]);

  // === Voice recognition: start when armed, auto-restart on end ===
  function startVoice() {
    const svc = DemoServices.voice;
    if (!svc.available()) {
      setVoiceError("Voice not supported in this browser. Use the buttons.");
      return;
    }
    if (speakingRef.current) return; // wait until TTS done
    try {
      svc.start({
        onStart: () => { setListening(true); setVoiceError(null); },
        onEnd: () => {
          setListening(false);
          // Chrome auto-ends every ~10s; restart if still wanted
          if (shouldListenRef.current && !speakingRef.current) {
            setTimeout(() => startVoice(), 250);
          }
        },
        onError: (err) => {
          setListening(false);
          if (err === "not-allowed" || err === "service-not-allowed") {
            setVoiceError("Mic blocked. Allow microphone in your browser.");
            shouldListenRef.current = false;
          } else if (err !== "no-speech" && err !== "aborted") {
            setVoiceError(err);
          }
        },
        onTranscript: (t) => setHeard(t),
        onCommand: (cmd) => handleVoiceCommand(cmd),
      });
    } catch (e: any) {
      setVoiceError(e?.message || "could not start mic");
    }
  }

  useEffect(() => {
    if (!voiceArmed) return;
    shouldListenRef.current = true;
    startVoice();
    return () => {
      shouldListenRef.current = false;
      try { DemoServices.voice.stop(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceArmed]);

  function handleVoiceCommand(cmd: VoiceCommand) {
    switch (cmd) {
      case "yes": {
        const d = detectedRef.current;
        if (d && !confirmedRef.current) {
          confirmedRef.current = true;
          shouldListenRef.current = false;
          try { DemoServices.voice.stop(); } catch {}
          // Defer so we don't setState during a render in parent
          setTimeout(() => onConfirm(d), 0);
        }
        break;
      }
      case "no":
        setDetected(null);
        setCountdown(0);
        setGuidance("corners");
        break;
      case "zoom":
        setZoom((z) => Math.min(3, +(z + 0.3).toFixed(2)));
        break;
      case "brighter":
        setBrightness((b) => Math.min(1.6, +(b + 0.15).toFixed(2)));
        break;
      case "contrast":
        setContrast((c) => Math.min(1.8, +(c + 0.15).toFixed(2)));
        break;
      case "read":
        readDocAloud();
        break;
    }
  }

  function readDocAloud() {
    speakingRef.current = true;
    try { DemoServices.voice.stop(); } catch {}
    speak(
      "Schedule of Assets and Debts, form F L one forty two. I see sections for property, accounts, debts, signature, and date.",
      () => {
        speakingRef.current = false;
        if (shouldListenRef.current) startVoice();
      },
    );
  }

  const filter = [
    `brightness(${brightness})`,
    `contrast(${highContrast ? contrast * 1.6 : contrast})`,
    highContrast ? "grayscale(1)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex-1 flex flex-col" style={{ background: "var(--color-elder-bg)" }}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <button
          onClick={onCancel}
          className="font-bold"
          style={{
            background: "#fff",
            border: "2px solid var(--color-elder-sky)",
            color: "var(--color-elder-primary)",
            borderRadius: 14,
            padding: "8px 14px",
            fontSize: 15,
          }}
        >
          ← Back
        </button>
        <span className="font-extrabold" style={{ fontSize: 18, color: "var(--color-elder-ink)" }}>
          🔍 Magnifier
        </span>
        <span
          title={listening ? "Listening" : "Mic off"}
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: listening ? "#16a34a" : "#8a7d6f",
            minWidth: 64,
            textAlign: "right",
          }}
        >
          {listening ? "🎙 Listening" : "🎙 off"}
        </span>
      </div>

      {/* Camera stage */}
      <div
        className="mx-4 rounded-2xl overflow-hidden relative"
        style={{
          background: "#111",
          height: 320,
          boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
        }}
      >
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6" style={{ color: "#fff" }}>
            <p className="font-extrabold" style={{ fontSize: 20 }}>I can't open the camera.</p>
            <p className="mt-2" style={{ fontSize: 15, color: "#cbd2da" }}>{error}</p>
            <p className="mt-2" style={{ fontSize: 14, color: "#9aa4b2" }}>
              Please allow camera access in your browser, or tap "I already found it".
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center",
                filter,
                transition: "filter 0.15s, transform 0.15s",
              }}
            />
            {/* Document frame guide */}
            <div
              className="absolute pointer-events-none"
              style={{
                inset: 24,
                border: `4px ${guidance === "detected" ? "solid" : "dashed"} ${
                  guidance === "detected" ? "#22c55e" : "rgba(255,255,255,0.9)"
                }`,
                borderRadius: 14,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.15)",
                transition: "border-color 0.2s",
              }}
            />
            {/* Corner ticks */}
            {[
              { top: 18, left: 18 },
              { top: 18, right: 18 },
              { bottom: 18, left: 18 },
              { bottom: 18, right: 18 },
            ].map((pos, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  ...pos,
                  width: 22,
                  height: 22,
                  borderColor: guidance === "detected" ? "#22c55e" : "#fff",
                  borderStyle: "solid",
                  borderWidth: 0,
                  borderTopWidth: pos.top !== undefined ? 4 : 0,
                  borderBottomWidth: pos.bottom !== undefined ? 4 : 0,
                  borderLeftWidth: pos.left !== undefined ? 4 : 0,
                  borderRightWidth: pos.right !== undefined ? 4 : 0,
                }}
              />
            ))}
            {/* Countdown ring overlay */}
            {countdown > 0 && (
              <div
                className="absolute"
                style={{
                  top: 12,
                  right: 12,
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 24,
                  border: `4px solid ${countdown <= 2 ? "#fbbf24" : "#22c55e"}`,
                  transition: "border-color 0.3s",
                }}
              >
                {countdown}
              </div>
            )}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: "#fff" }}>
                Starting camera…
              </div>
            )}
          </>
        )}
      </div>

      {/* Guidance caption */}
      <div className="px-4 pt-3">
        <p
          key={guidance}
          className="text-center font-bold animate-fade-up"
          style={{
            fontSize: 20,
            color: guidance === "detected" ? "var(--color-elder-teal)" : "var(--color-elder-ink)",
            minHeight: 56,
          }}
        >
          {GUIDANCE_TEXT[guidance]}
        </p>
        {heard && listening && (
          <p
            className="text-center"
            style={{ fontSize: 13, color: "#6b5d52", fontStyle: "italic", minHeight: 18 }}
          >
            "{heard}"
          </p>
        )}
        {voiceError && (
          <div className="text-center mt-1">
            <p style={{ fontSize: 13, color: "#b91c1c", fontWeight: 700 }}>{voiceError}</p>
            <button
              onClick={() => { shouldListenRef.current = true; setVoiceArmed(true); setVoiceError(null); startVoice(); }}
              style={{
                marginTop: 6, background: "var(--color-elder-primary)", color: "#fff",
                border: 0, borderRadius: 12, padding: "8px 14px", fontWeight: 800, fontSize: 14,
              }}
            >
              🎙 Tap to enable voice
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 mt-1 space-y-2">
        <SliderRow
          label="🔍 Zoom"
          value={zoom}
          min={1}
          max={3}
          step={0.1}
          onChange={setZoom}
          display={`${zoom.toFixed(1)}×`}
        />
        <SliderRow
          label="☀️ Brightness"
          value={brightness}
          min={0.6}
          max={1.6}
          step={0.05}
          onChange={setBrightness}
          display={`${Math.round(brightness * 100)}%`}
        />
        <SliderRow
          label="🌗 Contrast"
          value={contrast}
          min={0.6}
          max={1.8}
          step={0.05}
          onChange={setContrast}
          display={`${Math.round(contrast * 100)}%`}
        />
        <button
          onClick={() => setHighContrast((v) => !v)}
          className="w-full font-bold"
          style={{
            background: highContrast ? "var(--color-elder-ink)" : "#fff",
            color: highContrast ? "#fff" : "var(--color-elder-ink)",
            border: "2px solid var(--color-elder-ink)",
            borderRadius: 14,
            padding: "10px",
            fontSize: 16,
          }}
        >
          {highContrast ? "✓ High contrast on" : "High contrast"}
        </button>
      </div>

      {/* Actions */}
      <div className="px-4 pt-3 pb-5 space-y-2">
        <button
          onClick={readDocAloud}
          className="w-full font-extrabold"
          style={{
            background: "#fff",
            color: "var(--color-elder-primary)",
            border: "2px solid var(--color-elder-sky)",
            borderRadius: 22,
            padding: "18px",
            fontSize: 22,
            minHeight: 70,
          }}
        >
          🔊 Read this
        </button>
        <button
          onClick={() => {
            confirmedRef.current = true;
            onConfirm(detected ?? undefined);
          }}
          disabled={!!error}
          className="w-full font-extrabold animate-button-pop-red"
          style={{
            background: "var(--color-elder-red)",
            color: "#fff",
            borderRadius: 22,
            padding: "20px",
            fontSize: 22,
            minHeight: 78,
            boxShadow: "0 14px 30px rgba(0,0,0,0.18)",
            opacity: error ? 0.5 : 1,
          }}
        >
          ✓ Yes, this is the file
        </button>
        <button
          onClick={onHandoff}
          className="w-full font-bold"
          style={{
            background: "#fff",
            color: "var(--color-elder-ink)",
            border: "2px solid #e7ddd0",
            borderRadius: 18,
            padding: "14px",
            fontSize: 17,
          }}
        >
          🤝 Not sure — send to a person
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  display: string;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-2xl"
      style={{ background: "#fff", border: "1px solid #e7ddd0" }}
    >
      <span className="font-bold" style={{ fontSize: 15, minWidth: 110, color: "var(--color-elder-ink)" }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--color-elder-primary)", height: 32 }}
      />
      <span className="font-bold" style={{ fontSize: 14, minWidth: 48, textAlign: "right", color: "#6b5d52" }}>
        {display}
      </span>
    </div>
  );
}
