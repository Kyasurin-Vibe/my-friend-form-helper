import { useEffect, useRef, useState } from "react";
import {
  DemoServices,
  type VoiceCommand,
} from "@/lib/services";

type Props = {
  onConfirm: (image?: string) => void;
  onCancel: () => void;
  onHandoff: () => void;
};

type Guidance = "init" | "move-closer" | "hold-still" | "corners" | "blurry" | "detected";
type DetectionBox = { x: number; y: number; w: number; h: number };

const GUIDANCE_TEXT: Record<Guidance, string> = {
  init: "Point the camera at your paper.",
  "move-closer": "Move a little closer.",
  "hold-still": "Hold still…",
  corners: "Put all four corners inside the frame.",
  blurry: "The picture is too blurry. Please try again.",
  detected: "Looks clear. Capturing automatically…",
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

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
  // Auto-driven — no manual controls. Smoothed via EMA in the analysis loop.
  const [zoom, setZoom] = useState(1.25);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const autoRef = useRef({ zoom: 1.25, brightness: 1, contrast: 1 });
  const [guidance, setGuidance] = useState<Guidance>("init");
  const [detectionBox, setDetectionBox] = useState<DetectionBox | null>(null);
  const [countdown, setCountdown] = useState(0); // seconds remaining
  const [listening, setListening] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string>("");
  const confirmedRef = useRef(false);
  const detectionBoxRef = useRef<DetectionBox | null>(null);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);
  useEffect(() => { detectionBoxRef.current = detectionBox; }, [detectionBox]);

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

  // === Real frame analysis: only auto-capture when a paper-like, sharp,
  // bright, low-saturation region fills enough of the frame. Faces / hands / room must NOT trigger. ===
  useEffect(() => {
    if (!ready) return;
    const v = videoRef.current;
    if (!v) return;
    const W = 128, H = 96;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!ctx) return;
    let detectedStreak = 0;
    const id = window.setInterval(() => {
      if (confirmedRef.current) return;
      if (!v.videoWidth) return;
      try {
        ctx.drawImage(v, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;
        const lum = new Float32Array(W * H);
        const paperMask = new Uint8Array(W * H);
        let lumSum = 0, paperCount = 0;
        const rowCounts = new Uint16Array(H);
        const colCounts = new Uint16Array(W);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const y = 0.299 * r + 0.587 * g + 0.114 * b;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          lum[p] = y;
          lumSum += y;
          const skinTone = r > 95 && g > 45 && b > 30 && r > g && r > b && r - b > 20 && sat > 0.12;
          // Paper-like: bright AND low color saturation, explicitly excluding skin-tone blobs.
          if (y > 145 && sat < 0.2 && !skinTone) {
            paperMask[p] = 1;
            paperCount++;
            rowCounts[Math.floor(p / W)]++;
            colCounts[p % W]++;
          }
        }
        const meanLum = lumSum / (W * H);
        const paperFrac = paperCount / (W * H);
        // Sharpness: average gradient magnitude (rough Laplacian proxy)
        let edgeSum = 0, edgeN = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const p = y * W + x;
            const dx = lum[p + 1] - lum[p - 1];
            const dy = lum[p + W] - lum[p - W];
            edgeSum += Math.abs(dx) + Math.abs(dy);
            edgeN++;
          }
        }
        const sharp = edgeSum / edgeN;

        const visited = new Uint8Array(W * H);
        const queue = new Uint16Array(W * H);
        let best = { count: 0, minX: W, maxX: -1, minY: H, maxY: -1 };
        for (let start = 0; start < paperMask.length; start++) {
          if (!paperMask[start] || visited[start]) continue;
          let head = 0, tail = 0, count = 0;
          let minX = W, maxX = -1, minY = H, maxY = -1;
          queue[tail++] = start;
          visited[start] = 1;
          while (head < tail) {
            const p = queue[head++];
            count++;
            const x = p % W;
            const y = Math.floor(p / W);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            const neighbors = [p - 1, p + 1, p - W, p + W];
            for (const n of neighbors) {
              if (n < 0 || n >= paperMask.length || visited[n] || !paperMask[n]) continue;
              if ((n === p - 1 && x === 0) || (n === p + 1 && x === W - 1)) continue;
              visited[n] = 1;
              queue[tail++] = n;
            }
          }
          if (count > best.count) best = { count, minX, maxX, minY, maxY };
        }

        const minX = best.minX, maxX = best.maxX, minY = best.minY, maxY = best.maxY;
        const boxW = Math.max(0, maxX - minX + 1);
        const boxH = Math.max(0, maxY - minY + 1);
        const boxArea = boxW * boxH;
        const boxPaper = best.count;
        const boxAreaFrac = boxArea / (W * H);
        const boxDensity = boxArea > 0 ? boxPaper / boxArea : 0;
        const aspect = boxH > 0 ? boxW / boxH : 0;
        const hasDocumentRegion =
          meanLum >= 75 &&
          paperFrac >= 0.3 &&
          boxAreaFrac >= 0.38 &&
          boxDensity >= 0.48 &&
          aspect >= 0.48 &&
          aspect <= 1.9;

        let next: Guidance;
        if (meanLum < 70 || !hasDocumentRegion) next = "init"; // no document-like region (face/room/hand)
        else if (paperFrac < 0.45 || boxAreaFrac < 0.48) next = "corners"; // partial paper — frame it
        else if (sharp < 5.5) next = "blurry";
        else next = "detected";

        setDetectionBox(
          hasDocumentRegion
            ? {
                x: clamp(minX / W, 0.04, 0.86),
                y: clamp(minY / H, 0.04, 0.86),
                w: clamp(boxW / W, 0.12, 0.92),
                h: clamp(boxH / H, 0.12, 0.92),
              }
            : null,
        );

        // Require 2 consecutive paper+sharp frames before triggering capture
        if (next === "detected") {
          detectedStreak++;
          if (detectedStreak < 2) next = "hold-still";
        } else {
          detectedStreak = 0;
        }

        setGuidance((prev) => (prev === next ? prev : next));

        // === Auto-enhance (EMA-smoothed, subtle, no flicker) ===
        // Target brightness: lift dark frames, leave bright ones alone.
        const targetBrightness = Math.max(0.9, Math.min(1.45, 165 / Math.max(60, meanLum)));
        // Target contrast: bump a touch when the frame is flat (low edges).
        const targetContrast = Math.max(1, Math.min(1.35, 1 + (8 - Math.min(sharp, 8)) * 0.04));
        // Target zoom: tighter once a document fills the frame.
        const targetZoom =
          hasDocumentRegion && boxAreaFrac >= 0.5 ? 1.85 : hasDocumentRegion ? 1.6 : 1.15;

        const a = 0.18; // EMA alpha — slow enough to avoid flicker
        const cur = autoRef.current;
        cur.brightness = cur.brightness + (targetBrightness - cur.brightness) * a;
        cur.contrast = cur.contrast + (targetContrast - cur.contrast) * a;
        cur.zoom = cur.zoom + (targetZoom - cur.zoom) * a;

        // Only commit when change is meaningful — keeps DOM stable.
        setBrightness((b) => (Math.abs(b - cur.brightness) > 0.03 ? +cur.brightness.toFixed(2) : b));
        setContrast((c) => (Math.abs(c - cur.contrast) > 0.03 ? +cur.contrast.toFixed(2) : c));
        setZoom((z) => (Math.abs(z - cur.zoom) > 0.04 ? +cur.zoom.toFixed(2) : z));
      } catch { /* noop */ }
    }, 450);
    return () => window.clearInterval(id);
  }, [ready]);


  // === Speak guidance prompts (and pause mic while TTS plays) ===
  useEffect(() => {
    if (guidance === "init" || guidance === "hold-still") return;
    const text =
      guidance === "detected"
        ? "Looks clear. Capturing now."
        : guidance === "blurry"
          ? "The picture is too blurry. Please try again."
          : GUIDANCE_TEXT[guidance];
    speakingRef.current = true;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    speak(text, () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
  }, [guidance]);

  // === Auto-capture countdown when document looks clear ===
  useEffect(() => {
    if (guidance !== "detected") {
      setCountdown(0);
      return;
    }
    if (confirmedRef.current) return;
    setCountdown(3);
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          window.clearInterval(id);
          doCapture();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidance]);

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

  function captureFrame(): string | undefined {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return undefined;
    const maxW = 1280;
    const scale = Math.min(1, maxW / v.videoWidth);
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(v, 0, 0, w, h);
    try { return c.toDataURL("image/jpeg", 0.85); } catch { return undefined; }
  }

  function doCapture() {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    shouldListenRef.current = false;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    const frame = captureFrame();
    setTimeout(() => onConfirm(frame), 0);
  }

  function handleVoiceCommand(cmd: VoiceCommand) {
    switch (cmd) {
      case "yes": {
        doCapture();
        break;
      }
      case "no":
        setDetectionBox(null);
        setCountdown(0);
        setGuidance("corners");
        break;
      case "zoom":
        autoRef.current.zoom = Math.min(2.6, autoRef.current.zoom + 0.3);
        setZoom(+autoRef.current.zoom.toFixed(2));
        break;
      case "brighter":
        autoRef.current.brightness = Math.min(1.7, autoRef.current.brightness + 0.15);
        setBrightness(+autoRef.current.brightness.toFixed(2));
        break;
      case "contrast":
        autoRef.current.contrast = Math.min(1.7, autoRef.current.contrast + 0.15);
        setContrast(+autoRef.current.contrast.toFixed(2));
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
      "Hold the paper steady inside the box. When it looks clear, I'll capture it and read it for you.",
      () => {
        speakingRef.current = false;
        if (shouldListenRef.current) startVoice();
      },
    );
  }

  const filter = `brightness(${brightness}) contrast(${contrast})`;

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

      {/* Single fallback action — the app drives, the user follows. */}
      <div className="px-4 pt-4 pb-5 mt-auto space-y-2">
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
        <button
          onClick={onHandoff}
          className="w-full font-bold"
          style={{
            background: "#fff",
            color: "var(--color-elder-ink)",
            border: "2px solid #e7ddd0",
            borderRadius: 18,
            padding: "12px",
            fontSize: 15,
          }}
        >
          🤝 Not sure — send to a person
        </button>
      </div>
    </div>
  );
}

