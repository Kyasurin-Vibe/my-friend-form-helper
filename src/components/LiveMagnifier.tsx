import { useEffect, useRef, useState } from "react";
import { DemoServices, type VoiceCommand } from "@/lib/services";

type Props = {
  onConfirm: (image?: string) => void;
  onCancel: () => void;
};

function speak(text: string, onDone?: () => void) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) {
    onDone?.();
    return;
  }
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.onend = () => onDone?.();
  utterance.onerror = () => onDone?.();
  synth.speak(utterance);
}

export function LiveMagnifier({ onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const confirmedRef = useRef(false);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const autoStableRef = useRef(0);
  const introSpokenRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [autoCapture, setAutoCapture] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [heard, setHeard] = useState("");

  // Open camera
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
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
        setVoiceArmed(true);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Camera unavailable");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Speak intro once camera is ready
  useEffect(() => {
    if (!ready || introSpokenRef.current) return;
    introSpokenRef.current = true;
    speakingRef.current = true;
    speak(
      "Point the camera at your paper. Fit it inside the frame. I'll capture it when it looks clear, or tap the red button.",
      () => {
        speakingRef.current = false;
        if (shouldListenRef.current) startVoice();
      },
    );
  }, [ready]);

  // Lightweight auto-capture: tiny sharpness-only check, ~1 Hz.
  useEffect(() => {
    if (!ready || !autoCapture) return;
    const video = videoRef.current;
    if (!video) return;

    const w = 64;
    const h = 48;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const id = window.setInterval(() => {
      if (confirmedRef.current || countdown > 0 || !video.videoWidth) return;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let lumSum = 0;
        const lum = new Float32Array(w * h);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          lum[p] = y;
          lumSum += y;
        }
        const meanLum = lumSum / (w * h);
        let edgeSum = 0;
        let edgeN = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            edgeSum +=
              Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + w] - lum[p - w]);
            edgeN++;
          }
        }
        const sharp = edgeSum / edgeN;
        const stable = meanLum > 80 && sharp > 5.5;
        if (stable) {
          autoStableRef.current++;
          if (autoStableRef.current >= 3) {
            autoStableRef.current = 0;
            startCountdown();
          }
        } else {
          autoStableRef.current = 0;
        }
      } catch {
        // transient
      }
    }, 700);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoCapture, countdown]);

  function startCountdown() {
    if (confirmedRef.current || countdown > 0) return;
    setCountdown(3);
    speakingRef.current = true;
    try {
      DemoServices.voice.stop();
    } catch {
      // no-op
    }
    speak("Hold still… 3, 2, 1", () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
    const id = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(id);
          doCapture();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }

  // Voice listener
  useEffect(() => {
    if (!voiceArmed) return;
    shouldListenRef.current = true;
    startVoice();
    return () => {
      shouldListenRef.current = false;
      try {
        DemoServices.voice.stop();
      } catch {
        // no-op
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceArmed]);

  function startVoice() {
    const service = DemoServices.voice;
    if (!service.available()) {
      setVoiceError("Voice not supported in this browser. Use the buttons.");
      return;
    }
    if (speakingRef.current) return;

    try {
      service.start({
        onStart: () => {
          setListening(true);
          setVoiceError(null);
        },
        onEnd: () => {
          setListening(false);
          if (shouldListenRef.current && !speakingRef.current) {
            window.setTimeout(() => startVoice(), 250);
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
        onTranscript: (transcript) => setHeard(transcript),
        onCommand: (cmd) => handleVoiceCommand(cmd),
      });
    } catch (e: unknown) {
      setVoiceError(e instanceof Error ? e.message : "could not start mic");
    }
  }

  function captureFrame(): string | undefined {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return undefined;
    const scale = Math.min(1, 1600 / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, width, height);
    try {
      return canvas.toDataURL("image/jpeg", 0.9);
    } catch {
      return undefined;
    }
  }

  function doCapture() {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    shouldListenRef.current = false;
    try {
      DemoServices.voice.stop();
    } catch {
      // no-op
    }
    const frame = captureFrame();
    window.setTimeout(() => onConfirm(frame), 0);
  }

  function handleVoiceCommand(cmd: VoiceCommand) {
    switch (cmd) {
      case "yes":
        doCapture();
        break;
      case "no":
        setCountdown(0);
        autoStableRef.current = 0;
        break;
      case "read":
        speakingRef.current = true;
        try {
          DemoServices.voice.stop();
        } catch {
          // no-op
        }
        speak("Point the camera at your paper. Fit all four corners inside the frame.", () => {
          speakingRef.current = false;
          if (shouldListenRef.current) startVoice();
        });
        break;
      case "unknown":
      case "zoom":
      case "brighter":
      case "contrast":
        break;
    }
  }

  // A4 portrait ratio = 1 : 1.4142
  const guideWidthPct = 78;
  const guideAspect = 1.4142;

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
          📷 Scanner
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

      <div
        className="mx-4 rounded-2xl overflow-hidden relative"
        style={{
          background: "#111",
          height: 360,
          boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
        }}
      >
        {error ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center p-6"
            style={{ color: "#fff" }}
          >
            <p className="font-extrabold" style={{ fontSize: 20 }}>
              I can't open the camera.
            </p>
            <p className="mt-2" style={{ fontSize: 15, color: "#cbd2da" }}>
              {error}
            </p>
            <p className="mt-2" style={{ fontSize: 14, color: "#9aa4b2" }}>
              Please allow camera access in your browser.
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* A4 portrait guide frame */}
            <div
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                left: "50%",
                top: "50%",
                width: `${guideWidthPct}%`,
                aspectRatio: `1 / ${guideAspect}`,
                transform: "translate(-50%, -50%)",
                border: "3px dashed rgba(255,255,255,0.85)",
                borderRadius: 12,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
              }}
            >
              {/* Corner ticks */}
              {[
                { top: -4, left: -4, borderTop: 4, borderLeft: 4 },
                { top: -4, right: -4, borderTop: 4, borderRight: 4 },
                { bottom: -4, left: -4, borderBottom: 4, borderLeft: 4 },
                { bottom: -4, right: -4, borderBottom: 4, borderRight: 4 },
              ].map((s, i) => (
                <span
                  key={i}
                  style={{
                    position: "absolute",
                    width: 28,
                    height: 28,
                    borderColor: "#fff",
                    borderStyle: "solid",
                    borderWidth: 0,
                    ...s,
                  }}
                />
              ))}
            </div>
            {countdown > 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ background: "rgba(0,0,0,0.35)" }}
              >
                <div
                  key={countdown}
                  style={{
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 200,
                    lineHeight: 1,
                    textShadow: "0 8px 30px rgba(0,0,0,0.6)",
                    animation: "countdown-pop 0.6s ease-out",
                  }}
                >
                  {countdown}
                </div>
              </div>
            )}
            {!ready && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ color: "#fff" }}
              >
                Starting camera…
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-4 pt-3">
        <p
          className="text-center font-bold"
          style={{
            fontSize: 18,
            color: "var(--color-elder-ink)",
            minHeight: 48,
          }}
        >
          Fit your paper inside the frame. {autoCapture ? "I'll capture automatically." : "Tap the red button when ready."}
        </p>
        {heard && listening && (
          <p
            className="text-center"
            style={{ fontSize: 13, color: "#6b5d52", fontStyle: "italic", minHeight: 18 }}
          >
            &quot;{heard}&quot;
          </p>
        )}
        {voiceError && (
          <div className="text-center mt-1">
            <p style={{ fontSize: 13, color: "#b91c1c", fontWeight: 700 }}>{voiceError}</p>
            <button
              onClick={() => {
                shouldListenRef.current = true;
                setVoiceArmed(true);
                setVoiceError(null);
                startVoice();
              }}
              style={{
                marginTop: 6,
                background: "var(--color-elder-primary)",
                color: "#fff",
                border: 0,
                borderRadius: 12,
                padding: "8px 14px",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              🎙 Tap to enable voice
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pt-2 flex justify-center gap-2 flex-wrap">
        <button
          onClick={() => {
            setAutoCapture((v) => !v);
            autoStableRef.current = 0;
          }}
          aria-pressed={autoCapture}
          style={{
            background: autoCapture ? "var(--color-elder-teal)" : "#fff",
            color: autoCapture ? "#fff" : "var(--color-elder-ink)",
            border: "2px solid var(--color-elder-teal)",
            borderRadius: 999,
            padding: "8px 14px",
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          ⏱ Auto-capture {autoCapture ? "ON" : "OFF"}
        </button>
        <button
          onClick={() => {
            if (voiceArmed) {
              shouldListenRef.current = false;
              try { DemoServices.voice.stop(); } catch { /* no-op */ }
              setVoiceArmed(false);
              setListening(false);
            } else {
              setVoiceError(null);
              setVoiceArmed(true);
            }
          }}
          aria-pressed={voiceArmed}
          style={{
            background: voiceArmed ? (listening ? "#16a34a" : "var(--color-elder-primary)") : "#fff",
            color: voiceArmed ? "#fff" : "var(--color-elder-ink)",
            border: "2px solid var(--color-elder-primary)",
            borderRadius: 999,
            padding: "8px 14px",
            fontWeight: 800,
            fontSize: 14,
            boxShadow: voiceArmed && listening ? "0 0 0 6px rgba(34,197,94,0.18)" : "none",
            transition: "all 0.2s",
          }}
        >
          🎙 Voice {voiceArmed ? "ON" : "OFF"}
        </button>
      </div>

      <div className="px-4 pt-3 pb-5 mt-auto">
        <button
          onClick={doCapture}
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
          📸 Capture now
        </button>
      </div>
    </div>
  );
}
