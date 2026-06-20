import { useEffect, useRef, useState } from "react";

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
  onHandoff: () => void;
};

type Guidance = "init" | "move-closer" | "hold-still" | "corners" | "detected";

const GUIDANCE_TEXT: Record<Guidance, string> = {
  init: "Point the camera at your paper.",
  "move-closer": "Move a little closer.",
  "hold-still": "Hold still…",
  corners: "Put all four corners inside the frame.",
  detected: "This looks like FL-142. Is this the file you are looking for?",
};

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("This device doesn't support the camera.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
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

  // Friendly fake guidance cycle so the senior user feels coached.
  useEffect(() => {
    if (!ready) return;
    const seq: Guidance[] = ["move-closer", "hold-still", "corners", "hold-still", "detected"];
    let i = 0;
    const id = window.setInterval(() => {
      setGuidance(seq[i % seq.length]);
      i++;
      if (seq[(i - 1) % seq.length] === "detected") window.clearInterval(id);
    }, 1800);
    return () => window.clearInterval(id);
  }, [ready]);

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
        <span style={{ width: 64 }} />
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
              Please allow camera access in your browser, or tap “I already found it”.
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
          onClick={() => {
            if ("speechSynthesis" in window) {
              const u = new SpeechSynthesisUtterance(
                "Schedule of Assets and Debts, form F L one forty two. I see sections for property, accounts, debts, signature, and date.",
              );
              u.rate = 0.95;
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(u);
            }
          }}
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
          onClick={onConfirm}
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
