import { useEffect, useRef, useState } from "react";
import type { DocumentBounds } from "@/lib/cases";
import { speakWarm } from "@/lib/cases";
import { supabase } from "@/integrations/supabase/client";
import { getLang, t, onLangChange } from "@/lib/i18n";
import { useVoiceLoop } from "@/lib/voice-loop";


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
  const [autoCapture] = useState(true);
  const [hint, setHint] = useState<Hint>("starting");
  const [, _bumpLang] = useState(0);
  useEffect(() => onLangChange(() => _bumpLang((n) => n + 1)), []);
  const [aiStatus, setAiStatus] = useState<"idle" | "checking" | "no_doc" | "unreadable" | "ready" | "unavailable">("idle");
  const [, setOverlayBox] = useState<DocumentBounds | null>(null);
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
    void speakWarm(t("scan_hint"), { skipTranslate: true });
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

  // Hint debounce — voice prompts are spoken by the global PersistentVoice.
  useEffect(() => {
    if (!ready) return;
    if (hint === lastSpokenHintRef.current) return;
    lastSpokenHintRef.current = hint;
  }, [hint, ready]);

  // ===== Claude polling (~1.5s) for auto-capture decisions =====
  useEffect(() => {
    if (!ready) return;
    const video = videoRef.current;
    if (!video) return;

    // Small downscaled frame for the model
    const W = 320;
    const small = document.createElement("canvas");
    const sctx = small.getContext("2d");
    if (!sctx) return;

    async function poll() {
      if (confirmedRef.current || !video || !video.videoWidth) return;
      if (inFlightRef.current) return;
      if (!autoCapture) return;
      if (countdown > 0) return;

      // Local pre-check: skip obviously black/empty frames
      if (meanLumRef.current > 0 && meanLumRef.current < 45) return;

      const now = performance.now();
      if (now - lastPollAtRef.current < 1400) return;
      lastPollAtRef.current = now;

      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sw = W;
        const sh = Math.round((vh / vw) * W);
        small.width = sw;
        small.height = sh;
        sctx!.drawImage(video, 0, 0, sw, sh);
        const dataUrl = small.toDataURL("image/jpeg", 0.5);

        inFlightRef.current = true;
        setAiStatus((prev) => (prev === "ready" ? prev : "checking"));

        const { data, error } = await supabase.functions.invoke("detect-document", {
          body: { image: dataUrl },
        });
        if (confirmedRef.current) return;
        if (error || !data) {
          aiUnavailableRef.current = true;
          setAiStatus("unavailable");
          consecutiveReadyRef.current = 0;
          return;
        }
        aiUnavailableRef.current = false;
        const present = !!data.documentPresent;
        const readable = !!data.readable;
        const conf = Number(data.confidence) || 0;

        if (present && readable && conf >= 0.65) {
          consecutiveReadyRef.current += 1;
          setAiStatus("ready");
          // Capture is NEVER auto-triggered — user must say "yes" or tap Capture.
        } else {
          consecutiveReadyRef.current = 0;
          if (!present) setAiStatus("no_doc");
          else setAiStatus("unreadable");
        }
      } catch (e) {
        aiUnavailableRef.current = true;
        setAiStatus("unavailable");
        consecutiveReadyRef.current = 0;
      } finally {
        inFlightRef.current = false;
      }
    }

    const id = window.setInterval(poll, 500); // checks scheduling; actual call gated by lastPollAtRef
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoCapture, countdown]);

  // Override visible hint with AI status when we have a meaningful signal
  useEffect(() => {
    if (!autoCapture) return;
    if (meanLumRef.current > 0 && meanLumRef.current < 65) return; // tooDark wins
    if (aiStatus === "checking") setHint("aiChecking");
    else if (aiStatus === "no_doc") setHint("aiNoDoc");
    else if (aiStatus === "unreadable") setHint("aiUnreadable");
    else if (aiStatus === "ready") setHint("aiReady");
    else if (aiStatus === "unavailable") setHint("aiUnavailable");
  }, [aiStatus, autoCapture]);

  function startCountdown() {
    if (confirmedRef.current || countdown > 0) return;
    setCountdown(3);
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { window.clearInterval(id); doCapture(); return 0; }
        return c - 1;
      });
    }, 1000);
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
    const result = captureAndCrop();
    window.setTimeout(() => onConfirm(result), 0);
  }

  // Voice — single shared loop. STT + interpret-intent + TTS owned by PersistentVoice.
  useVoiceLoop({
    screen: "scanner",
    language: getLang(),
    enabled: true,
    actions: {
      capture: doCapture,
      retake: () => { setCountdown(0); consecutiveReadyRef.current = 0; },
      back: onCancel,
      home: onCancel,
    },
  });
  // Suppress unused-variable warning for the countdown helper kept for future wiring.
  void startCountdown;

  const hintText: Record<Hint, string> = {
    starting: t("starting_camera"),
    tooDark: t("hint_too_dark"),
    empty: t("hint_empty"),
    possibleFace: t("hint_face"),
    moveCloser: t("hint_closer"),
    holdStill: t("hint_hold"),
    documentDetected: t("hint_hold"),
    aiChecking: t("hint_checking"),
    aiNoDoc: t("hint_empty"),
    aiUnreadable: t("hint_unreadable"),
    aiReady: t("hint_hold"),
    aiUnavailable: t("hint_say_yes"),
  };
  const hintColor: Record<Hint, string> = {
    starting: "#6b5d52",
    tooDark: "#b45309",
    empty: "#6b5d52",
    possibleFace: "#b45309",
    moveCloser: "#2563eb",
    holdStill: "#2563eb",
    documentDetected: "#16a34a",
    aiChecking: "#6b5d52",
    aiNoDoc: "#6b5d52",
    aiUnreadable: "#2563eb",
    aiReady: "#16a34a",
    aiUnavailable: "#6b5d52",
  };


  return (
    <div className="flex-1 flex flex-col" style={{ background: "var(--color-elder-bg)" }}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <button onClick={onCancel} className="font-bold" style={{
          background: "#fff", border: "2px solid var(--color-elder-sky)",
          color: "var(--color-elder-primary)", borderRadius: 14, padding: "8px 14px", fontSize: 15,
        }}>{t("back")}</button>
        <span className="font-extrabold" style={{ fontSize: 18, color: "var(--color-elder-ink)" }}>{t("scanner_title")}</span>
        <span style={{ minWidth: 64 }} aria-hidden />
      </div>

      <div className="mx-4 rounded-2xl overflow-hidden relative" style={{
        background: "#111", height: 360, boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
      }}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6" style={{ color: "#fff" }}>
            <p className="font-extrabold" style={{ fontSize: 20 }}>{t("camera_unavailable")}</p>
            <p className="mt-2" style={{ fontSize: 15, color: "#cbd2da" }}>{error}</p>
            <p className="mt-2" style={{ fontSize: 14, color: "#9aa4b2" }}>{t("allow_camera")}</p>
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
            {/* Live document outline removed — static guide frame above is the only guide */}
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
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: "#fff" }}>{t("starting_camera")}</div>
            )}
          </>
        )}
      </div>

      <div className="px-4 pt-3">
        <p className="text-center font-bold" style={{
          fontSize: 18, color: hintColor[hint], minHeight: 26, transition: "color 200ms",
        }}>{hintText[hint]}</p>
        <p className="text-center" style={{ fontSize: 14, color: "#6b5d52", minHeight: 20 }}>
          {t("scan_hint")}
        </p>
      </div>


      <div className="px-4 pt-3 pb-5 mt-auto">
        <button onClick={doCapture} disabled={!!error}
          className="w-full font-extrabold animate-button-pop-red"
          style={{
            background: "var(--color-elder-red)", color: "#fff", borderRadius: 22,
            padding: "20px", fontSize: 22, minHeight: 78,
            boxShadow: "0 14px 30px rgba(0,0,0,0.18)", opacity: error ? 0.5 : 1,
          }}>{t("capture_now_btn")}</button>
      </div>
    </div>
  );
}
