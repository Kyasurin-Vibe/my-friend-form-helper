import { useEffect, useRef, useState } from "react";
import { DemoServices, type VoiceCommand } from "@/lib/services";

type Props = {
  onConfirm: (image?: string) => void;
  onCancel: () => void;
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

const ADJACENT_OFFSETS = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
];

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

export function LiveMagnifier({ onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoRef = useRef({ zoom: 1.25, brightness: 1, contrast: 1 });
  const confirmedRef = useRef(false);
  const speakingRef = useRef(false);
  const shouldListenRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1.25);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [guidance, setGuidance] = useState<Guidance>("init");
  const [detectionBox, setDetectionBox] = useState<DetectionBox | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [heard, setHeard] = useState("");

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

  useEffect(() => {
    if (!ready) return;
    const video = videoRef.current;
    if (!video) return;

    const width = 128;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let detectedStreak = 0;
    const id = window.setInterval(() => {
      if (confirmedRef.current || !video.videoWidth) return;
      try {
        ctx.drawImage(video, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const lum = new Float32Array(width * height);
        const paperMask = new Uint8Array(width * height);
        let lumSum = 0;
        let paperCount = 0;

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const y = 0.299 * r + 0.587 * g + 0.114 * b;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const skinTone = r > 95 && g > 45 && b > 30 && r > g && r > b && r - b > 20 && sat > 0.12;

          lum[p] = y;
          lumSum += y;
          if (y > 145 && sat < 0.2 && !skinTone) {
            paperMask[p] = 1;
            paperCount++;
          }
        }

        const meanLum = lumSum / (width * height);
        const paperFrac = paperCount / (width * height);
        let edgeSum = 0;
        let edgeN = 0;
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const p = y * width + x;
            edgeSum +=
              Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + width] - lum[p - width]);
            edgeN++;
          }
        }
        const sharp = edgeSum / edgeN;

        const visited = new Uint8Array(width * height);
        const queue = new Uint16Array(width * height);
        let best = { count: 0, minX: width, maxX: -1, minY: height, maxY: -1 };

        for (let start = 0; start < paperMask.length; start++) {
          if (!paperMask[start] || visited[start]) continue;
          let head = 0;
          let tail = 0;
          let count = 0;
          let minX = width;
          let maxX = -1;
          let minY = height;
          let maxY = -1;
          queue[tail++] = start;
          visited[start] = 1;

          while (head < tail) {
            const p = queue[head++];
            const x = p % width;
            const y = Math.floor(p / width);
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            for (const { dx, dy } of ADJACENT_OFFSETS) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const n = ny * width + nx;
              if (visited[n] || !paperMask[n]) continue;
              visited[n] = 1;
              queue[tail++] = n;
            }
          }

          if (count > best.count) best = { count, minX, maxX, minY, maxY };
        }

        const boxW = Math.max(0, best.maxX - best.minX + 1);
        const boxH = Math.max(0, best.maxY - best.minY + 1);
        const boxArea = boxW * boxH;
        const bandX = Math.max(2, Math.floor(boxW * 0.12));
        const bandY = Math.max(2, Math.floor(boxH * 0.12));
        let topPaper = 0;
        let bottomPaper = 0;
        let leftPaper = 0;
        let rightPaper = 0;

        if (boxArea > 0) {
          for (let y = best.minY; y <= best.maxY; y++) {
            for (let x = best.minX; x <= best.maxX; x++) {
              if (!paperMask[y * width + x]) continue;
              if (y < best.minY + bandY) topPaper++;
              if (y > best.maxY - bandY) bottomPaper++;
              if (x < best.minX + bandX) leftPaper++;
              if (x > best.maxX - bandX) rightPaper++;
            }
          }
        }

        const boxAreaFrac = boxArea / (width * height);
        const boxDensity = boxArea > 0 ? best.count / boxArea : 0;
        const topFill = boxW * bandY > 0 ? topPaper / (boxW * bandY) : 0;
        const bottomFill = boxW * bandY > 0 ? bottomPaper / (boxW * bandY) : 0;
        const leftFill = boxH * bandX > 0 ? leftPaper / (boxH * bandX) : 0;
        const rightFill = boxH * bandX > 0 ? rightPaper / (boxH * bandX) : 0;
        const edgeFill = (topFill + bottomFill + leftFill + rightFill) / 4;
        const rectangularEnough =
          [topFill, bottomFill, leftFill, rightFill].filter((v) => v >= 0.34).length >= 3 &&
          edgeFill >= 0.44;
        const aspect = boxH > 0 ? boxW / boxH : 0;
        const hasDocumentRegion =
          meanLum >= 75 &&
          paperFrac >= 0.3 &&
          boxAreaFrac >= 0.38 &&
          boxDensity >= 0.62 &&
          rectangularEnough &&
          aspect >= 0.48 &&
          aspect <= 1.9;

        let next: Guidance;
        if (meanLum < 70 || !hasDocumentRegion) next = "init";
        else if (paperFrac < 0.45 || boxAreaFrac < 0.48) next = "corners";
        else if (sharp < 5.5) next = "blurry";
        else next = "detected";

        setDetectionBox(
          hasDocumentRegion
            ? {
                x: clamp(best.minX / width, 0.04, 0.86),
                y: clamp(best.minY / height, 0.04, 0.86),
                w: clamp(boxW / width, 0.12, 0.92),
                h: clamp(boxH / height, 0.12, 0.92),
              }
            : null,
        );

        if (next === "detected") {
          detectedStreak++;
          if (detectedStreak < 2) next = "hold-still";
        } else {
          detectedStreak = 0;
        }

        setGuidance((prev) => (prev === next ? prev : next));

        const targetBrightness = clamp(165 / Math.max(60, meanLum), 0.9, 1.45);
        const targetContrast = clamp(1 + (8 - Math.min(sharp, 8)) * 0.04, 1, 1.35);
        const targetZoom =
          hasDocumentRegion && boxAreaFrac >= 0.5 ? 1.85 : hasDocumentRegion ? 1.6 : 1.15;
        const current = autoRef.current;
        current.brightness += (targetBrightness - current.brightness) * 0.18;
        current.contrast += (targetContrast - current.contrast) * 0.18;
        current.zoom += (targetZoom - current.zoom) * 0.18;

        setBrightness((value) =>
          Math.abs(value - current.brightness) > 0.03 ? +current.brightness.toFixed(2) : value,
        );
        setContrast((value) =>
          Math.abs(value - current.contrast) > 0.03 ? +current.contrast.toFixed(2) : value,
        );
        setZoom((value) =>
          Math.abs(value - current.zoom) > 0.04 ? +current.zoom.toFixed(2) : value,
        );
      } catch {
        // Keep scanning; transient frame read failures are common on camera startup.
      }
    }, 450);

    return () => window.clearInterval(id);
  }, [ready]);

  useEffect(() => {
    if (guidance === "init" || guidance === "hold-still") return;
    const text =
      guidance === "detected"
        ? "Looks clear. Capturing now."
        : guidance === "blurry"
          ? "The picture is too blurry. Please try again."
          : GUIDANCE_TEXT[guidance];
    speakingRef.current = true;
    try {
      DemoServices.voice.stop();
    } catch {
      // no-op
    }
    speak(text, () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidance]);

  useEffect(() => {
    if (guidance !== "detected") {
      setCountdown(0);
      return;
    }
    if (confirmedRef.current) return;

    setCountdown(3);
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

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidance]);

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
    const scale = Math.min(1, 1280 / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, width, height);
    try {
      return canvas.toDataURL("image/jpeg", 0.85);
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
      case "unknown":
        break;
    }
  }

  function readDocAloud() {
    speakingRef.current = true;
    try {
      DemoServices.voice.stop();
    } catch {
      // no-op
    }
    speak("Point the camera at your paper. I'll capture it when it looks clear.", () => {
      speakingRef.current = false;
      if (shouldListenRef.current) startVoice();
    });
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

      <div
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
                transition: "filter 0.15s, transform 0.15s",
              }}
            />
            {detectionBox && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${detectionBox.x * 100}%`,
                  top: `${detectionBox.y * 100}%`,
                  width: `${detectionBox.w * 100}%`,
                  height: `${detectionBox.h * 100}%`,
                  border: `5px solid ${guidance === "detected" ? "#22c55e" : "#fbbf24"}`,
                  borderRadius: 12,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.18)",
                  transition: "all 0.18s ease-out",
                }}
              />
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
                  border: `4px solid ${countdown <= 2 ? "#fbbf24" : "#22c55e"}`,
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

      <div className="px-4 pt-3 flex justify-center">
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
          aria-label={voiceArmed ? "Turn voice control off" : "Turn voice control on"}
          style={{
            background: voiceArmed ? (listening ? "#16a34a" : "var(--color-elder-primary)") : "#fff",
            color: voiceArmed ? "#fff" : "var(--color-elder-ink)",
            border: "2px solid var(--color-elder-primary)",
            borderRadius: 999,
            padding: "10px 18px",
            fontWeight: 800,
            fontSize: 15,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            boxShadow: voiceArmed && listening ? "0 0 0 6px rgba(34,197,94,0.18)" : "none",
            transition: "all 0.2s",
          }}
        >
          <span style={{ fontSize: 18 }}>🎙</span>
          {voiceArmed ? (listening ? "Listening… say \u201Cyes\u201D to capture" : "Voice on") : "Tap for voice control"}
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
