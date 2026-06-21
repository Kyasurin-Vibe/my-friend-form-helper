import { useEffect, useRef, useState } from "react";
import { DemoServices, type VoiceCommand } from "@/lib/services";
import type { DocumentBounds } from "@/lib/cases";
import { supabase } from "@/integrations/supabase/client";


type CaptureResult = {
  processed: string; // cropped to detected (or guide) bounds
  original: string;  // full frame
  bounds: DocumentBounds | null;
};

type Props = {
  onConfirm: (result?: CaptureResult) => void;
  onCancel: () => void;
};

type Hint =
  | "starting"
  | "tooDark"
  | "empty"
  | "possibleFace"
  | "moveCloser"
  | "holdStill"
  | "documentDetected"
  | "aiChecking"
  | "aiNoDoc"
  | "aiUnreadable"
  | "aiReady"
  | "aiUnavailable";


function speak(text: string, onDone?: () => void) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) { onDone?.(); return; }
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.onend = () => onDone?.();
  utterance.onerror = () => onDone?.();
  synth.speak(utterance);
}

const GUIDE_WIDTH_PCT = 78;
const GUIDE_ASPECT = 1.4142; // A4 portrait

// A4 portrait centered fallback box in normalized coords (relative to full frame)
function fallbackGuideBounds(videoW: number, videoH: number): DocumentBounds {
  const frameAspect = videoW / videoH;
  // Make a centered A4 portrait box that fits inside the frame.
  // Target width ~ 78% of frame width, but limit by height.
  let bw = 0.78;
  let bh = bw * (videoW / videoH) * GUIDE_ASPECT; // bh in normalized height units
  if (bh > 0.92) {
    bh = 0.92;
    bw = (bh * videoH) / (GUIDE_ASPECT * videoW);
  }
  // unused
  void frameAspect;
  return {
    x: (1 - bw) / 2,
    y: (1 - bh) / 2,
    width: bw,
    height: bh,
    confidence: 0.2,
  };
}

export function LiveMagnifier({ onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const confirmedRef = useRef(false);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const introSpokenRef = useRef(false);

  // Detection state (in refs so the analysis loop doesn't trigger re-renders)
  const smoothBoxRef = useRef<DocumentBounds | null>(null);
  const smoothBrightnessRef = useRef(1);
  const lastSpokenHintRef = useRef<Hint | null>(null);
  const meanLumRef = useRef(0);
  const sharpRef = useRef(0);

  // Claude polling state
  const inFlightRef = useRef(false);
  const consecutiveReadyRef = useRef(0);
  const lastPollAtRef = useRef(0);
  const aiUnavailableRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [autoCapture, setAutoCapture] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [heard, setHeard] = useState("");
  const [hint, setHint] = useState<Hint>("starting");
  const [aiStatus, setAiStatus] = useState<"idle" | "checking" | "no_doc" | "unreadable" | "ready" | "unavailable">("idle");
  const [overlayBox, setOverlayBox] = useState<DocumentBounds | null>(null);
  const [zoom, setZoom] = useState<{ scale: number; ox: number; oy: number }>({ scale: 1, ox: 50, oy: 50 });
  const [brightnessFilter, setBrightnessFilter] = useState(1);


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
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stream.getAudioTracks().forEach((t) => t.stop());
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

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

  // ===== Lightweight per-frame analysis: 64x48 downsample, ~5 Hz =====
  useEffect(() => {
    if (!ready) return;
    const video = videoRef.current;
    if (!video) return;

    const W = 64, H = 48;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const id = window.setInterval(() => {
      if (confirmedRef.current || !video.videoWidth) return;
      try {
        ctx.drawImage(video, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;

        // Per-pixel stats
        let lumSum = 0;
        let paperCount = 0;
        let skinCount = 0;
        let minX = W, minY = H, maxX = -1, maxY = -1;
        const lum = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const Y = 0.299 * r + 0.587 * g + 0.114 * b;
            lum[y * W + x] = Y;
            lumSum += Y;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx - mn;
            const isPaper = Y > 140 && sat < 38;
            if (isPaper) {
              paperCount++;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
            // Crude skin heuristic
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && sat > 15 && sat < 90) {
              skinCount++;
            }
          }
        }
        const total = W * H;
        const meanLum = lumSum / total;
        const paperFrac = paperCount / total;
        const skinFrac = skinCount / total;

        // Edge / sharpness (skipped per pixel inside the loop above to keep it cheap)
        let edgeSum = 0, edgeN = 0;
        for (let y = 1; y < H - 1; y += 2) {
          for (let x = 1; x < W - 1; x += 2) {
            const p = y * W + x;
            edgeSum += Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + W] - lum[p - W]);
            edgeN++;
          }
        }
        const sharp = edgeSum / Math.max(1, edgeN);

        // Smooth brightness filter
        const targetBrightness = meanLum > 0
          ? Math.max(1, Math.min(1.7, 165 / Math.max(40, meanLum)))
          : 1;
        smoothBrightnessRef.current = smoothBrightnessRef.current * 0.8 + targetBrightness * 0.2;
        setBrightnessFilter(smoothBrightnessRef.current);

        // Decide current bounding box (normalized)
        let raw: DocumentBounds | null = null;
        const hasBox = maxX >= minX && paperFrac > 0.08;
        if (hasBox) {
          raw = {
            x: minX / W,
            y: minY / H,
            width: Math.max(1, maxX - minX + 1) / W,
            height: Math.max(1, maxY - minY + 1) / H,
            confidence: Math.min(1, paperFrac * 2),
          };
        }

        // EMA smoothing
        const prev = smoothBoxRef.current;
        let smooth: DocumentBounds | null = null;
        if (raw && prev) {
          const a = 0.3;
          smooth = {
            x: prev.x * (1 - a) + raw.x * a,
            y: prev.y * (1 - a) + raw.y * a,
            width: prev.width * (1 - a) + raw.width * a,
            height: prev.height * (1 - a) + raw.height * a,
            confidence: prev.confidence * (1 - a) + raw.confidence * a,
          };
        } else if (raw) {
          smooth = raw;
        } else if (prev) {
          // fade out gradually
          smooth = { ...prev, confidence: prev.confidence * 0.7 };
          if (smooth.confidence < 0.05) smooth = null;
        }
        smoothBoxRef.current = smooth;
        setOverlayBox(smooth);

        // Auto-zoom-follow
        if (smooth && smooth.confidence > 0.15) {
          const targetScale = Math.max(1, Math.min(1.5, 0.78 / Math.max(smooth.width, smooth.height / GUIDE_ASPECT)));
          const cx = (smooth.x + smooth.width / 2) * 100;
          const cy = (smooth.y + smooth.height / 2) * 100;
          setZoom((prevZ) => ({
            scale: prevZ.scale * 0.85 + targetScale * 0.15,
            ox: prevZ.ox * 0.85 + cx * 0.15,
            oy: prevZ.oy * 0.85 + cy * 0.15,
          }));
        } else {
          setZoom((prevZ) => ({
            scale: prevZ.scale * 0.9 + 1 * 0.1,
            ox: prevZ.ox * 0.9 + 50 * 0.1,
            oy: prevZ.oy * 0.9 + 50 * 0.1,
          }));
        }

        // Cache for AI pre-check / fallback hints
        meanLumRef.current = meanLum;
        sharpRef.current = sharp;

        // Local hint (visual feedback only; AUTO-CAPTURE is driven by Claude polling).
        let nextHint: Hint = "starting";
        if (meanLum < 65) nextHint = "tooDark";
        else if (skinFrac > 0.22 && paperFrac < 0.18) nextHint = "possibleFace";
        else if (!smooth || smooth.confidence < 0.18) nextHint = "empty";
        else if (smooth.width * smooth.height < 0.18) nextHint = "moveCloser";
        else if (sharp < 5.5) nextHint = "holdStill";
        else nextHint = "documentDetected";
        setHint(nextHint);

      } catch {
        // transient
      }
    }, 200);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoCapture, countdown]);

  // Speak hints (throttled to changes, not every frame)
  useEffect(() => {
    if (!ready || speakingRef.current) return;
    if (hint === lastSpokenHintRef.current) return;
    const messages: Partial<Record<Hint, string>> = {
      tooDark: "Too dark. Move to better light.",
      possibleFace: "That looks like a face, not a document.",
      empty: "I don't see paper yet.",
      moveCloser: "Move a little closer.",
      holdStill: "Hold still.",
      documentDetected: "Document detected.",
    };
    const msg = messages[hint];
    if (msg) {
      lastSpokenHintRef.current = hint;
      // Keep TTS short and don't spam — small delay debounce via ref above.
    }
  }, [hint, ready]);

  function startCountdown() {
    if (confirmedRef.current || countdown > 0) return;
    setCountdown(3);
    speakingRef.current = true;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    speak("Hold still… 3, 2, 1", () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { window.clearInterval(id); doCapture(); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  // Voice
  useEffect(() => {
    if (!voiceArmed) return;
    shouldListenRef.current = true;
    startVoice();
    return () => {
      shouldListenRef.current = false;
      try { DemoServices.voice.stop(); } catch { /* noop */ }
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
        onStart: () => { setListening(true); setVoiceError(null); },
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
        onTranscript: (t) => setHeard(t),
        onCommand: (cmd) => handleVoiceCommand(cmd),
      });
    } catch (e: unknown) {
      setVoiceError(e instanceof Error ? e.message : "could not start mic");
    }
  }

  function captureAndCrop(): CaptureResult | undefined {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return undefined;

    // Full frame at reasonable resolution
    const scale = Math.min(1, 1600 / video.videoWidth);
    const fw = Math.round(video.videoWidth * scale);
    const fh = Math.round(video.videoHeight * scale);
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = fw; fullCanvas.height = fh;
    const fctx = fullCanvas.getContext("2d");
    if (!fctx) return undefined;
    fctx.drawImage(video, 0, 0, fw, fh);
    const original = fullCanvas.toDataURL("image/jpeg", 0.9);

    // Choose bounds: detected smooth box, else centered A4 fallback
    const detected = smoothBoxRef.current;
    const useDetected = detected && detected.confidence > 0.2 && detected.width * detected.height > 0.12;
    const bounds = useDetected ? detected : fallbackGuideBounds(fw, fh);

    // Apply ~3% padding, clamp
    const pad = 0.03;
    const x0 = Math.max(0, bounds.x - pad);
    const y0 = Math.max(0, bounds.y - pad);
    const x1 = Math.min(1, bounds.x + bounds.width + pad);
    const y1 = Math.min(1, bounds.y + bounds.height + pad);
    const sx = Math.round(x0 * fw);
    const sy = Math.round(y0 * fh);
    const sw = Math.max(1, Math.round((x1 - x0) * fw));
    const sh = Math.max(1, Math.round((y1 - y0) * fh));

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = sw; cropCanvas.height = sh;
    const cctx = cropCanvas.getContext("2d");
    if (!cctx) return { processed: original, original, bounds: useDetected ? detected : null };
    cctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const processed = cropCanvas.toDataURL("image/jpeg", 0.9);

    return { processed, original, bounds: useDetected ? detected : null };
  }

  function doCapture() {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    shouldListenRef.current = false;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    const result = captureAndCrop();
    window.setTimeout(() => onConfirm(result), 0);
  }

  function handleVoiceCommand(cmd: VoiceCommand) {
    switch (cmd) {
      case "yes": doCapture(); break;
      case "no":
        setCountdown(0);
        consecutiveReadyRef.current = 0;
        break;

      case "read":
        speakingRef.current = true;
        try { DemoServices.voice.stop(); } catch { /* noop */ }
        speak("Point the camera at your paper. Fit all four corners inside the frame.", () => {
          speakingRef.current = false;
          if (shouldListenRef.current) startVoice();
        });
        break;
      default: break;
    }
  }

  const hintText: Record<Hint, string> = {
    starting: "Starting camera…",
    tooDark: "💡 Too dark — move to better light",
    empty: "📄 Show me your paper",
    possibleFace: "🙂 That looks like a face, not a document",
    moveCloser: "↕ Move a little closer",
    holdStill: "✋ Hold still…",
    documentDetected: "✅ Document detected — hold still",
  };
  const hintColor: Record<Hint, string> = {
    starting: "#6b5d52",
    tooDark: "#b45309",
    empty: "#6b5d52",
    possibleFace: "#b45309",
    moveCloser: "#2563eb",
    holdStill: "#2563eb",
    documentDetected: "#16a34a",
  };

  return (
    <div className="flex-1 flex flex-col" style={{ background: "var(--color-elder-bg)" }}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <button onClick={onCancel} className="font-bold" style={{
          background: "#fff", border: "2px solid var(--color-elder-sky)",
          color: "var(--color-elder-primary)", borderRadius: 14, padding: "8px 14px", fontSize: 15,
        }}>← Back</button>
        <span className="font-extrabold" style={{ fontSize: 18, color: "var(--color-elder-ink)" }}>📷 Scanner</span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: listening ? "#16a34a" : "#8a7d6f",
          minWidth: 64, textAlign: "right",
        }}>{listening ? "🎙 Listening" : "🎙 off"}</span>
      </div>

      <div className="mx-4 rounded-2xl overflow-hidden relative" style={{
        background: "#111", height: 360, boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
      }}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6" style={{ color: "#fff" }}>
            <p className="font-extrabold" style={{ fontSize: 20 }}>I can't open the camera.</p>
            <p className="mt-2" style={{ fontSize: 15, color: "#cbd2da" }}>{error}</p>
            <p className="mt-2" style={{ fontSize: 14, color: "#9aa4b2" }}>Please allow camera access in your browser.</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef} muted playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                transform: `scale(${zoom.scale})`,
                transformOrigin: `${zoom.ox}% ${zoom.oy}%`,
                filter: `brightness(${brightnessFilter})`,
                transition: "transform 280ms ease-out, filter 400ms ease-out",
              }}
            />
            {/* A4 portrait guide frame */}
            <div aria-hidden className="absolute pointer-events-none" style={{
              left: "50%", top: "50%",
              width: `${GUIDE_WIDTH_PCT}%`,
              aspectRatio: `1 / ${GUIDE_ASPECT}`,
              transform: "translate(-50%, -50%)",
              border: "3px dashed rgba(255,255,255,0.6)",
              borderRadius: 12,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)",
            }} />
            {/* Live detected document outline */}
            {overlayBox && overlayBox.confidence > 0.15 && (
              <div aria-hidden className="absolute pointer-events-none" style={{
                left: `${overlayBox.x * 100}%`,
                top: `${overlayBox.y * 100}%`,
                width: `${overlayBox.width * 100}%`,
                height: `${overlayBox.height * 100}%`,
                border: `3px solid ${hint === "documentDetected" ? "#22c55e" : "#fbbf24"}`,
                borderRadius: 10,
                boxShadow: hint === "documentDetected"
                  ? "0 0 0 3px rgba(34,197,94,0.25)"
                  : "0 0 0 3px rgba(251,191,36,0.2)",
                transition: "all 180ms ease-out",
              }} />
            )}
            {countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ background: "rgba(0,0,0,0.35)" }}>
                <div key={countdown} style={{
                  color: "#fff", fontWeight: 900, fontSize: 200, lineHeight: 1,
                  textShadow: "0 8px 30px rgba(0,0,0,0.6)",
                  animation: "countdown-pop 0.6s ease-out",
                }}>{countdown}</div>
              </div>
            )}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: "#fff" }}>Starting camera…</div>
            )}
          </>
        )}
      </div>

      <div className="px-4 pt-3">
        <p className="text-center font-bold" style={{
          fontSize: 18, color: hintColor[hint], minHeight: 26, transition: "color 200ms",
        }}>{hintText[hint]}</p>
        <p className="text-center" style={{ fontSize: 14, color: "#6b5d52", minHeight: 20 }}>
          Fit your paper inside the frame. {autoCapture ? "I'll capture automatically." : "Tap the red button when ready."}
        </p>
        {heard && listening && (
          <p className="text-center" style={{ fontSize: 13, color: "#6b5d52", fontStyle: "italic", minHeight: 18 }}>
            &quot;{heard}&quot;
          </p>
        )}
        {voiceError && (
          <div className="text-center mt-1">
            <p style={{ fontSize: 13, color: "#b91c1c", fontWeight: 700 }}>{voiceError}</p>
            <button onClick={() => {
              shouldListenRef.current = true; setVoiceArmed(true); setVoiceError(null); startVoice();
            }} style={{
              marginTop: 6, background: "var(--color-elder-primary)", color: "#fff", border: 0,
              borderRadius: 12, padding: "8px 14px", fontWeight: 800, fontSize: 14,
            }}>🎙 Tap to enable voice</button>
          </div>
        )}
      </div>

      <div className="px-4 pt-2 flex justify-center gap-2 flex-wrap">
        <button onClick={() => {
          setAutoCapture((v) => !v);
          consecutiveReadyRef.current = 0;
        }} aria-pressed={autoCapture} style={{

          background: autoCapture ? "var(--color-elder-teal)" : "#fff",
          color: autoCapture ? "#fff" : "var(--color-elder-ink)",
          border: "2px solid var(--color-elder-teal)",
          borderRadius: 999, padding: "8px 14px", fontWeight: 800, fontSize: 14,
        }}>⏱ Auto-capture {autoCapture ? "ON" : "OFF"}</button>
        <button onClick={() => {
          if (voiceArmed) {
            shouldListenRef.current = false;
            try { DemoServices.voice.stop(); } catch { /* noop */ }
            setVoiceArmed(false); setListening(false);
          } else {
            setVoiceError(null); setVoiceArmed(true);
          }
        }} aria-pressed={voiceArmed} style={{
          background: voiceArmed ? (listening ? "#16a34a" : "var(--color-elder-primary)") : "#fff",
          color: voiceArmed ? "#fff" : "var(--color-elder-ink)",
          border: "2px solid var(--color-elder-primary)",
          borderRadius: 999, padding: "8px 14px", fontWeight: 800, fontSize: 14,
          boxShadow: voiceArmed && listening ? "0 0 0 6px rgba(34,197,94,0.18)" : "none",
          transition: "all 0.2s",
        }}>🎙 Voice {voiceArmed ? "ON" : "OFF"}</button>
      </div>

      <div className="px-4 pt-3 pb-5 mt-auto">
        <button onClick={doCapture} disabled={!!error}
          className="w-full font-extrabold animate-button-pop-red"
          style={{
            background: "var(--color-elder-red)", color: "#fff", borderRadius: 22,
            padding: "20px", fontSize: 22, minHeight: 78,
            boxShadow: "0 14px 30px rgba(0,0,0,0.18)", opacity: error ? 0.5 : 1,
          }}>📸 Capture now</button>
      </div>
    </div>
  );
}
