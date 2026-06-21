import { useEffect, useRef, useState } from "react";
import { DemoServices, type VoiceCommand } from "@/lib/services";

type Props = {
  onConfirm: (image?: string) => void;
  onCancel: () => void;
};

type Guidance =
  | "init"
  | "loading-cv"
  | "no-doc"
  | "not-face"
  | "not-object"
  | "move-closer"
  | "hold-still"
  | "corners"
  | "blurry"
  | "detected";

type Corners = {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
};

const GUIDANCE_TEXT: Record<Guidance, string> = {
  init: "Point the camera at your paper.",
  "loading-cv": "Getting ready…",
  "no-doc": "I don't see a document. Point the camera at your paper.",
  "not-face": "I see a face — please point the camera at your paper.",
  "not-object": "That doesn't look like a document — point the camera at your paper.",
  "move-closer": "Move a little closer.",
  "hold-still": "Hold still…",
  corners: "Put all four corners inside the frame.",
  blurry: "The picture is too blurry. Please try again.",
  detected: "Looks clear. Capturing automatically…",
};

// CDN sources (MIT-licensed)
const OPENCV_URL = "https://docs.opencv.org/4.8.0/opencv.js";
const JSCANIFY_URL = "https://cdn.jsdelivr.net/gh/puffinsoft/jscanify@master/src/jscanify.min.js";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

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

// Load a <script> once. Returns a Promise that resolves when loaded.
const scriptPromises = new Map<string, Promise<void>>();
function loadScript(url: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const existing = scriptPromises.get(url);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${url}`));
    document.head.appendChild(s);
  });
  scriptPromises.set(url, p);
  return p;
}

// Wait for window.cv to be runtime-ready (OpenCV.js loads async).
function waitForCv(timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cv = (window as any).cv;
      if (cv && (cv.Mat || (cv.then && typeof cv.then === "function"))) {
        if (cv.Mat) return resolve(cv);
        // OpenCV.js exposes a "thenable" until runtime is ready
        cv.then((ready: unknown) => resolve(ready)).catch(reject);
        return;
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error("OpenCV.js load timeout"));
      setTimeout(tick, 120);
    };
    tick();
  });
}

export function LiveMagnifier({ onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoRef = useRef({ zoom: 1.25, brightness: 1, contrast: 1 });
  const confirmedRef = useRef(false);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cvRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const lastCornersRef = useRef<Corners | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [cvFailed, setCvFailed] = useState(false);
  const [zoom, setZoom] = useState(1.25);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [guidance, setGuidance] = useState<Guidance>("loading-cv");
  const [corners, setCorners] = useState<Corners | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [heard, setHeard] = useState("");

  // Load OpenCV.js + jscanify
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadScript(OPENCV_URL);
        const cv = await waitForCv();
        if (cancelled) return;
        cvRef.current = cv;
        await loadScript(JSCANIFY_URL);
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const JScanify = (window as any).jscanify;
        if (JScanify) {
          scannerRef.current = new JScanify();
          setCvReady(true);
        } else {
          setCvFailed(true);
        }
      } catch (e) {
        console.warn("OpenCV/jscanify load failed", e);
        setCvFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Detection loop
  useEffect(() => {
    if (!ready) return;
    const video = videoRef.current;
    if (!video) return;

    // Small canvas for cheap pixel stats (skin/object/empty)
    const sW = 128;
    const sH = 96;
    const small = document.createElement("canvas");
    small.width = sW;
    small.height = sH;
    const sctx = small.getContext("2d", { willReadFrequently: true });

    // Larger canvas for jscanify (needs reasonable resolution to find contours)
    const dW = 480;
    const dH = 360;
    const detect = document.createElement("canvas");
    detect.width = dW;
    detect.height = dH;
    const dctx = detect.getContext("2d", { willReadFrequently: true });
    if (!sctx || !dctx) return;

    let detectedStreak = 0;
    let emptyStreak = 0;

    const id = window.setInterval(() => {
      if (confirmedRef.current || !video.videoWidth) return;
      try {
        // --- Pixel stats on small canvas (lum/skin/paper-ish) ---
        sctx.drawImage(video, 0, 0, sW, sH);
        const data = sctx.getImageData(0, 0, sW, sH).data;
        const lum = new Float32Array(sW * sH);
        let lumSum = 0;
        let skinCount = 0;
        let paperishCount = 0;
        let otherCount = 0;
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const y = 0.299 * r + 0.587 * g + 0.114 * b;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const skinTone =
            r > 95 && g > 45 && b > 30 && r > g && r > b && r - b > 20 && sat > 0.12;
          lum[p] = y;
          lumSum += y;
          if (skinTone) skinCount++;
          else if (y > 145 && sat < 0.2) paperishCount++;
          else if (y > 90) otherCount++;
        }
        const meanLum = lumSum / (sW * sH);
        const skinFrac = skinCount / (sW * sH);
        const paperFrac = paperishCount / (sW * sH);
        const otherFrac = otherCount / (sW * sH);
        let edgeSum = 0;
        let edgeN = 0;
        for (let y = 1; y < sH - 1; y++) {
          for (let x = 1; x < sW - 1; x++) {
            const p = y * sW + x;
            edgeSum +=
              Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + sW] - lum[p - sW]);
            edgeN++;
          }
        }
        const sharp = edgeSum / edgeN;

        // --- jscanify contour detection ---
        let cornersNorm: Corners | null = null;
        let contourAreaFrac = 0;
        const scanner = scannerRef.current;
        const cv = cvRef.current;
        if (scanner && cv) {
          try {
            dctx.drawImage(video, 0, 0, dW, dH);
            const src = cv.imread(detect);
            try {
              const contour = scanner.findPaperContour(src);
              if (contour && !contour.isDeleted?.()) {
                const cp = scanner.getCornerPoints(contour);
                if (
                  cp &&
                  cp.topLeftCorner &&
                  cp.topRightCorner &&
                  cp.bottomRightCorner &&
                  cp.bottomLeftCorner
                ) {
                  const tl = cp.topLeftCorner;
                  const tr = cp.topRightCorner;
                  const br = cp.bottomRightCorner;
                  const bl = cp.bottomLeftCorner;
                  // Shoelace area
                  const area =
                    Math.abs(
                      tl.x * tr.y - tr.x * tl.y +
                        tr.x * br.y - br.x * tr.y +
                        br.x * bl.y - bl.x * br.y +
                        bl.x * tl.y - tl.x * bl.y,
                    ) / 2;
                  contourAreaFrac = area / (dW * dH);
                  if (contourAreaFrac > 0.08) {
                    cornersNorm = {
                      tl: { x: tl.x / dW, y: tl.y / dH },
                      tr: { x: tr.x / dW, y: tr.y / dH },
                      br: { x: br.x / dW, y: br.y / dH },
                      bl: { x: bl.x / dW, y: bl.y / dH },
                    };
                  }
                }
                contour.delete?.();
              }
            } finally {
              src.delete?.();
            }
          } catch {
            // OpenCV transient errors — ignore this frame
          }
        }

        // --- Classify guidance ---
        let next: Guidance;
        const haveValidPaper =
          cornersNorm !== null &&
          contourAreaFrac >= 0.18 &&
          meanLum >= 70;

        if (!haveValidPaper) {
          emptyStreak++;
          if (!cvReady && !cvFailed) {
            next = "loading-cv";
          } else if (emptyStreak >= 4) {
            if (skinFrac > 0.06) next = "not-face";
            else if (cornersNorm && contourAreaFrac < 0.18) next = "move-closer";
            else if (otherFrac > 0.1) next = "not-object";
            else if (meanLum < 70) next = "no-doc";
            else next = "no-doc";
          } else {
            next = "init";
          }
        } else {
          emptyStreak = 0;
          if (sharp < 5.5) next = "blurry";
          else next = "detected";
        }

        // Stability: require 2 consecutive "detected" frames (~0.9s)
        if (next === "detected") {
          detectedStreak++;
          if (detectedStreak < 2) next = "hold-still";
        } else {
          detectedStreak = 0;
        }

        setCorners(cornersNorm);
        if (cornersNorm) lastCornersRef.current = cornersNorm;
        setGuidance((prev) => (prev === next ? prev : next));

        // Smooth auto-zoom/brightness/contrast (cv fallback uses paperFrac)
        const targetBrightness = clamp(165 / Math.max(60, meanLum), 0.9, 1.45);
        const targetContrast = clamp(1 + (8 - Math.min(sharp, 8)) * 0.04, 1, 1.35);
        const focusFrac = contourAreaFrac > 0 ? contourAreaFrac : paperFrac;
        const targetZoom = haveValidPaper && focusFrac >= 0.5
          ? 1.85
          : haveValidPaper
            ? 1.6
            : 1.15;
        const cur = autoRef.current;
        cur.brightness += (targetBrightness - cur.brightness) * 0.18;
        cur.contrast += (targetContrast - cur.contrast) * 0.18;
        cur.zoom += (targetZoom - cur.zoom) * 0.18;

        setBrightness((v) =>
          Math.abs(v - cur.brightness) > 0.03 ? +cur.brightness.toFixed(2) : v,
        );
        setContrast((v) =>
          Math.abs(v - cur.contrast) > 0.03 ? +cur.contrast.toFixed(2) : v,
        );
        setZoom((v) => (Math.abs(v - cur.zoom) > 0.04 ? +cur.zoom.toFixed(2) : v));
      } catch {
        // ignore frame errors
      }
    }, 450);

    return () => window.clearInterval(id);
  }, [ready, cvReady, cvFailed]);

  // Speak guidance changes
  useEffect(() => {
    if (guidance === "init" || guidance === "hold-still" || guidance === "loading-cv") return;
    const text =
      guidance === "detected"
        ? "Looks clear. Capturing now."
        : GUIDANCE_TEXT[guidance];
    speakingRef.current = true;
    try {
      DemoServices.voice.stop();
    } catch {
      /* no-op */
    }
    speak(text, () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidance]);

  // Auto-capture countdown
  useEffect(() => {
    if (guidance !== "detected") {
      setCountdown(0);
      return;
    }
    if (confirmedRef.current) return;
    setCountdown(2);
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          window.clearInterval(id);
          doCapture();
          return 0;
        }
        return c - 1;
      });
    }, 700);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidance]);

  // Voice arm
  useEffect(() => {
    if (!voiceArmed) return;
    shouldListenRef.current = true;
    startVoice();
    return () => {
      shouldListenRef.current = false;
      try {
        DemoServices.voice.stop();
      } catch {
        /* no-op */
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

  // Capture: prefer jscanify extractPaper for a deskewed crop; fallback to raw frame.
  function captureFrame(): string | undefined {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return undefined;
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const scanner = scannerRef.current;
    const cv = cvRef.current;
    const useScanner = scanner && cv && lastCornersRef.current;

    // Always draw full frame to a working canvas
    const work = document.createElement("canvas");
    const scale = Math.min(1, 1280 / vW);
    work.width = Math.round(vW * scale);
    work.height = Math.round(vH * scale);
    const wctx = work.getContext("2d");
    if (!wctx) return undefined;
    wctx.drawImage(video, 0, 0, work.width, work.height);

    if (useScanner) {
      try {
        // Run jscanify on the full frame to get precise corners at capture time
        const src = cv.imread(work);
        try {
          const contour = scanner.findPaperContour(src);
          if (contour && !contour.isDeleted?.()) {
            // Estimate output size from corner spread
            const cp = scanner.getCornerPoints(contour);
            const wTop = Math.hypot(
              cp.topRightCorner.x - cp.topLeftCorner.x,
              cp.topRightCorner.y - cp.topLeftCorner.y,
            );
            const wBot = Math.hypot(
              cp.bottomRightCorner.x - cp.bottomLeftCorner.x,
              cp.bottomRightCorner.y - cp.bottomLeftCorner.y,
            );
            const hL = Math.hypot(
              cp.bottomLeftCorner.x - cp.topLeftCorner.x,
              cp.bottomLeftCorner.y - cp.topLeftCorner.y,
            );
            const hR = Math.hypot(
              cp.bottomRightCorner.x - cp.topRightCorner.x,
              cp.bottomRightCorner.y - cp.topRightCorner.y,
            );
            const outW = Math.round(Math.max(wTop, wBot));
            const outH = Math.round(Math.max(hL, hR));
            if (outW > 50 && outH > 50) {
              const extracted: HTMLCanvasElement = scanner.extractPaper(work, outW, outH);
              contour.delete?.();
              src.delete?.();
              return extracted.toDataURL("image/jpeg", 0.9);
            }
            contour.delete?.();
          }
        } finally {
          src.delete?.();
        }
      } catch (e) {
        console.warn("extractPaper failed, falling back to raw frame", e);
      }
    }

    try {
      return work.toDataURL("image/jpeg", 0.88);
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
      /* no-op */
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
        setCorners(null);
        lastCornersRef.current = null;
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
      case "unknown":
        break;
    }
  }

  function readDocAloud() {
    speakingRef.current = true;
    try {
      DemoServices.voice.stop();
    } catch {
      /* no-op */
    }
    speak("Point the camera at your paper. I'll capture it when it looks clear.", () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
  }

  const filter = `brightness(${brightness}) contrast(${contrast})`;
  const outlineColor = guidance === "detected" ? "#22c55e" : "#fbbf24";
  const polygonPoints = corners
    ? [corners.tl, corners.tr, corners.br, corners.bl]
        .map((c) => `${(c.x * 100).toFixed(2)},${(c.y * 100).toFixed(2)}`)
        .join(" ")
    : "";

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
          📄 Scanner
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
        ref={overlayRef}
        className="mx-4 rounded-2xl overflow-hidden relative"
        style={{
          background: "#111",
          height: 320,
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
              className="absolute inset-0 w-full h-full object-fill"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center",
                filter,
                transition: "filter 0.2s, transform 0.4s ease-out",
              }}
            />
            {corners && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polygon
                  points={polygonPoints}
                  fill="rgba(34,197,94,0.10)"
                  stroke={outlineColor}
                  strokeWidth="0.9"
                  strokeLinejoin="round"
                  style={{ transition: "stroke 0.2s" }}
                />
              </svg>
            )}
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
                  border: `4px solid ${countdown <= 1 ? "#fbbf24" : "#22c55e"}`,
                  transition: "border-color 0.3s",
                }}
              >
                {countdown}
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
            {ready && !cvReady && !cvFailed && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ background: "rgba(0,0,0,0.45)", color: "#fff" }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    border: "5px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    animation: "spin 0.9s linear infinite",
                  }}
                />
                <p className="mt-3 font-bold" style={{ fontSize: 16 }}>
                  Getting ready…
                </p>
              </div>
            )}
          </>
        )}
      </div>

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

      <div className="px-4 pt-3 pb-2 mt-auto">
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
        <p
          className="text-center mt-2"
          style={{ fontSize: 11, color: "#9a8d7f", lineHeight: 1.4 }}
        >
          Document detection: jscanify (MIT) + OpenCV.js
          {cvFailed && " — running in fallback mode"}
        </p>
      </div>
    </div>
  );
}
