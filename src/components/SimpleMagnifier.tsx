import { useEffect, useRef, useState } from "react";
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

/**
 * Pure seeing aid. Opens camera, gently auto-zooms / auto-brightens
 * onto whatever the user points at. No capture, no AI, no sliders.
 */
export function SimpleMagnifier({ onBack, onQuestion }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const introSpokenRef = useRef(false);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);

  const smoothBoxRef = useRef<{ x: number; y: number; w: number; h: number; c: number } | null>(null);
  const smoothBrightnessRef = useRef(1);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, ox: 50, oy: 50 });
  const [brightness, setBrightness] = useState(1);

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

  // Intro
  useEffect(() => {
    if (!ready || introSpokenRef.current) return;
    introSpokenRef.current = true;
    speakingRef.current = true;
    speak(
      "Magnifier. Point your camera at anything you'd like to see bigger. Say 'back' to return, or 'I have a question' to scan a document.",
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

  // Per-frame analysis for auto-zoom + auto-brighten
  useEffect(() => {
    if (!ready) return;
    const video = videoRef.current;
    if (!video) return;
    const W = 64, H = 48;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const id = window.setInterval(() => {
      if (!video.videoWidth) return;
      try {
        ctx.drawImage(video, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;
        let lumSum = 0;
        let minX = W, minY = H, maxX = -1, maxY = -1;
        let interestCount = 0;
        // Pass: find brightest contiguous region (paper/text-like)
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const Y = 0.299 * r + 0.587 * g + 0.114 * b;
            lumSum += Y;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx - mn;
            // "interesting" = brightish or text-edge candidate
            if (Y > 110 && sat < 60) {
              interestCount++;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        const total = W * H;
        const meanLum = lumSum / total;
        const frac = interestCount / total;

        // Brightness boost when dark — gentle, capped
        const targetB = meanLum > 0
          ? Math.max(1, Math.min(1.6, 160 / Math.max(50, meanLum)))
          : 1;
        smoothBrightnessRef.current = smoothBrightnessRef.current * 0.85 + targetB * 0.15;
        setBrightness(smoothBrightnessRef.current);

        // Box
        let raw: { x: number; y: number; w: number; h: number; c: number } | null = null;
        if (maxX >= minX && frac > 0.06) {
          raw = {
            x: minX / W,
            y: minY / H,
            w: Math.max(1, maxX - minX + 1) / W,
            h: Math.max(1, maxY - minY + 1) / H,
            c: Math.min(1, frac * 2),
          };
        }
        const prev = smoothBoxRef.current;
        let smooth = prev;
        if (raw && prev) {
          const a = 0.25;
          smooth = {
            x: prev.x * (1 - a) + raw.x * a,
            y: prev.y * (1 - a) + raw.y * a,
            w: prev.w * (1 - a) + raw.w * a,
            h: prev.h * (1 - a) + raw.h * a,
            c: prev.c * (1 - a) + raw.c * a,
          };
        } else if (raw) {
          smooth = raw;
        } else if (prev) {
          smooth = { ...prev, c: prev.c * 0.8 };
          if (smooth.c < 0.05) smooth = null;
        }
        smoothBoxRef.current = smooth;

        // Gentle auto-zoom (cap 1.8x). Center on detected region.
        if (smooth && smooth.c > 0.15) {
          const target = Math.max(1, Math.min(1.8, 0.7 / Math.max(smooth.w, smooth.h)));
          const cx = (smooth.x + smooth.w / 2) * 100;
          const cy = (smooth.y + smooth.h / 2) * 100;
          setZoom((p) => ({
            scale: p.scale * 0.88 + target * 0.12,
            ox: p.ox * 0.88 + cx * 0.12,
            oy: p.oy * 0.88 + cy * 0.12,
          }));
        } else {
          setZoom((p) => ({
            scale: p.scale * 0.9 + 1.15 * 0.1,
            ox: p.ox * 0.9 + 50 * 0.1,
            oy: p.oy * 0.9 + 50 * 0.1,
          }));
        }
      } catch { /* transient */ }
    }, 200);
    return () => window.clearInterval(id);
  }, [ready]);

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
          const t = (raw || "").toLowerCase();
          if (/\b(question|document|help|scan|paper|form|read)\b/.test(t)) {
            shouldListenRef.current = false;
            try { service.stop(); } catch { /* noop */ }
            onQuestion();
          } else if (/\b(back|home|exit|cancel|stop|done|return)\b/.test(t)) {
            shouldListenRef.current = false;
            try { service.stop(); } catch { /* noop */ }
            onBack();
          }
        },
      });
    } catch { /* noop */ }
  }

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
            transform: `scale(${zoom.scale})`,
            transformOrigin: `${zoom.ox}% ${zoom.oy}%`,
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
          🔍 Magnifier
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
