import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, createContext, useContext } from "react";
import { Mascot } from "@/components/Mascot";
import { LiveMagnifier } from "@/components/LiveMagnifier";
import { VoiceBar } from "@/components/VoiceBar";
import { useSpeech } from "@/lib/useSpeech";
import {
  analyzeDocument,
  sendToCenter,
  speakWarm,
  type AnalysisResult,
  type SendResult,
} from "@/lib/cases";
import { cancelSpeech, type VoiceIntent } from "@/lib/voice";
import { playWarning } from "@/lib/chime";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "My Friend — Gentle help with your paperwork" },
      {
        name: "description",
        content:
          "A warm, voice-first companion that helps elderly users handle legal paperwork — with a real person always in the loop.",
      },
      { property: "og:title", content: "My Friend" },
      {
        property: "og:description",
        content: "Voice-first, camera-first help. A real person always confirms.",
      },
    ],
  }),
  component: ElderApp,
});

export type A11yMode = "voice" | "text" | "both";
type Phase =
  | "start"
  | "find"
  | "magnifier"
  | "preview"
  | "analyzing"
  | "retake"
  | "review"
  | "sent";

const CaptionsContext = createContext<boolean>(true);
const VoiceOnContext = createContext<boolean>(true);

function ElderApp() {
  const [a11yMode, setA11yMode] = useState<A11yMode>("both");
  const [phase, setPhase] = useState<Phase>("find");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | undefined>(undefined);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const speech = useSpeech();
  const navigate = useNavigate();

  const voiceOn = a11yMode !== "text";
  const showCaptions = a11yMode !== "voice";

  useEffect(() => {
    speech.setEnabled(voiceOn);
  }, [voiceOn, speech]);

  // Auto-speak the whole screen on entry (real data for dynamic ones).
  useEffect(() => {
    if (!voiceOn) return;
    const text = speakableForPhase(phase, { analysis, sendResult, analyzeError });
    if (text) speakWarm(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, analysis, sendResult, voiceOn]);


  const restart = () => {
    setPhase("find");
    setAnalysis(null);
    setSendResult(null);
    setCapturedImage(undefined);
    setAnalyzeError(null);
    speech.cancel();
  };

  function handleCapture(image?: string) {
    setCapturedImage(image);
    if (!image) {
      // Camera failed — go straight to human review path.
      setAnalysis(null);
      setPhase("review");
      return;
    }
    // NEW: show the post-capture preview screen before sending to Claude.
    setPhase("preview");
  }

  async function handleAnalyze(image: string) {
    setPhase("analyzing");
    setAnalyzeError(null);
    const startedAt = Date.now();
    const minDisplay = 1200;
    try {
      const result = await analyzeDocument(image);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDisplay) {
        await new Promise((r) => setTimeout(r, minDisplay - elapsed));
      }
      const looksLikeDoc =
        result.readable &&
        result.documentType &&
        result.documentType.toLowerCase() !== "unknown" &&
        (result.confidence ?? 0) >= 0.35;
      if (!looksLikeDoc) {
        setAnalysis(null);
        speakWarm("I don't see a document yet — point at your paper.");
        setPhase("magnifier");
        return;
      }
      setAnalysis(result);
      if (result.recommendedAction === "retake") {
        setPhase("retake");
        return;
      }
      setPhase("review");
    } catch (e) {
      console.error("analyze failed", e);
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDisplay) {
        await new Promise((r) => setTimeout(r, minDisplay - elapsed));
      }
      setAnalyzeError(e instanceof Error ? e.message : "Could not analyze right now.");
      setAnalysis(null);
      setPhase("review");
    }
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    try {
      const result = await sendToCenter({
        image: capturedImage,
        analysis:
          analysis ?? {
            readable: false,
            documentType: "unknown",
            documentName: "Unknown document",
            confidence: 0,
            plainEnglishSummary: "User submitted without successful automated analysis.",
            possibleMissingFields: ["Automated analysis unavailable"],
            recommendedAction: "human_review",
            elderMessage: "Sent for human review.",
          },
      });
      setSendResult(result);
      setPhase("sent");
    } catch (e) {
      console.error("send failed", e);
      setAnalyzeError(e instanceof Error ? e.message : "Could not send right now.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="min-h-dvh w-full flex flex-col items-center px-4 py-6"
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, #FFE7D6 0%, #FBF7F0 55%, #F2E9DA 100%)",
        fontFamily: "var(--font-elder)",
        color: "var(--color-elder-ink)",
      }}
    >
      {/* Phone frame */}
      <div
        className="relative"
        style={{
          width: 400,
          maxWidth: "96vw",
          height: 820,
          maxHeight: "calc(100dvh - 80px)",
          background: "#1a1a1a",
          borderRadius: 52,
          padding: 14,
          boxShadow: "0 30px 80px rgba(36,31,26,0.25)",
        }}
      >
        <div
          className="w-full h-full overflow-y-auto relative flex flex-col"
          style={{
            background: "var(--color-elder-bg)",
            borderRadius: 40,
          }}
        >
          <CaptionsContext.Provider value={showCaptions}>
           <VoiceOnContext.Provider value={voiceOn}>
            {phase === "start" ? (
              <StartGate
                onStart={(mode) => {
                  setA11yMode(mode);
                  setPhase("find");
                }}
              />
            ) : phase === "find" ? (
              <FindDocGate onOpenMagnifier={() => setPhase("magnifier")} />
            ) : phase === "magnifier" ? (
              <LiveMagnifier
                onCancel={() => setPhase("find")}
                onConfirm={(img) => handleCapture(img)}
              />
            ) : phase === "preview" ? (
              <PreviewScreen
                image={capturedImage}
                onConfirm={() => capturedImage && handleAnalyze(capturedImage)}
                onRetake={() => setPhase("magnifier")}
              />
            ) : phase === "analyzing" ? (
              <AnalyzingScreen />
            ) : phase === "retake" ? (
              <RetakeScreen
                analysis={analysis}
                onRetry={() => setPhase("magnifier")}
                onSendAnyway={handleSend}
                sending={sending}
                speech={speech}
              />
            ) : phase === "review" ? (
              <ReviewScreen
                analysis={analysis}
                sending={sending}
                analyzeError={analyzeError}
                onSend={handleSend}
                onRetake={() => setPhase("magnifier")}
                speech={speech}
              />
            ) : (
              <SentScreen
                sendResult={sendResult}
                analysis={analysis}
                speech={speech}
                onGoCenter={() => navigate({ to: "/center" })}
                onRestart={restart}
              />
            )}
           </VoiceOnContext.Provider>
          </CaptionsContext.Provider>

        </div>
      </div>

      <Link
        to="/center"
        className="mt-4 text-sm underline"
        style={{ color: "var(--color-elder-primary)", fontFamily: "var(--font-center)" }}
      >
        Open staff dashboard →
      </Link>
    </div>
  );
}

function StartGate({ onStart }: { onStart: (mode: A11yMode) => void }) {
  const choose = (mode: A11yMode) => {
    if ("vibrate" in navigator) navigator.vibrate(40);
    onStart(mode);
  };
  const choice = (label: string, sub: string, mode: A11yMode) => (
    <button
      onClick={() => choose(mode)}
      className="w-full font-extrabold transition active:scale-[0.96] animate-button-pop text-left"
      style={{
        background: "#fff",
        color: "var(--color-elder-ink)",
        border: "3px solid var(--color-elder-sky)",
        borderRadius: 22,
        padding: "18px 20px",
        fontSize: 22,
        minHeight: 78,
        boxShadow: "0 6px 18px rgba(47,111,176,0.12)",
      }}
    >
      <div>{label}</div>
      <div style={{ fontSize: 14, color: "#6b5d52", fontWeight: 600, marginTop: 2 }}>
        {sub}
      </div>
    </button>
  );
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <Mascot mode="idle" size={150} />
      <h1 className="mt-3 font-extrabold" style={{ fontSize: 32, color: "var(--color-elder-ink)" }}>
        My Friend
      </h1>
      <p className="mt-1 mb-5" style={{ fontSize: 17, color: "#6b5d52" }}>
        How would you like me to help?
      </p>
      <div className="w-full space-y-3">
        {choice("🔊  Talk to me", "I'll read everything out loud.", "voice")}
        {choice("📝  Show me words", "I'll show big captions, no sound.", "text")}
        {choice("🔊📝  Both", "Voice and captions together.", "both")}
      </div>
    </div>
  );
}

function FindDocGate({ onOpenMagnifier }: { onOpenMagnifier: () => void }) {
  const voiceOn = useContext(VoiceOnContext);
  const handleIntent = (i: VoiceIntent) => {
    if (i === "confirm") onOpenMagnifier();
  };
  return (
    <div className="flex-1 flex flex-col items-center p-6 text-center">
      <div className="flex-1 flex flex-col items-center justify-center">
        <Mascot mode="idle" size={130} />
        <h2 className="mt-3 font-extrabold" style={{ fontSize: 28, color: "var(--color-elder-ink)" }}>
          Ready to find your document?
        </h2>
        <p className="mt-2 mb-5" style={{ fontSize: 17, color: "#6b5d52" }}>
          I'll open the magnifier so you can see clearly first. Nothing is uploaded yet.
        </p>
        <button
          onClick={() => { cancelSpeech(); onOpenMagnifier(); }}
          className="w-full font-extrabold animate-button-pop-red active:scale-[0.96]"
          style={{
            background: "var(--color-elder-red)",
            color: "#fff",
            border: "none",
            borderRadius: 26,
            padding: "24px",
            fontSize: 24,
            minHeight: 88,
            boxShadow: "0 14px 30px rgba(0,0,0,0.18)",
          }}
        >
          🔍 Open Magnifier
        </button>
        <p className="mt-4" style={{ fontSize: 13, color: "#8a7d6f" }}>
          The magnifier uses your camera only on this device.
        </p>
      </div>
      <VoiceBar
        speakableText={speakableForPhase("find", { analysis: null, sendResult: null, analyzeError: null })}
        voiceOn={voiceOn}
        onIntent={handleIntent}
      />
    </div>
  );
}


function AnalyzingScreen() {
  const voiceOn = useContext(VoiceOnContext);
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <Mascot mode="speaking" size={150} />
      <h2 className="mt-4 font-extrabold" style={{ fontSize: 26, color: "var(--color-elder-ink)" }}>
        Reading your document… one moment
      </h2>
      <div
        className="mt-6"
        aria-label="Reading document"
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "6px solid var(--color-elder-sky)",
          borderTopColor: "var(--color-elder-primary)",
          animation: "spin 0.9s linear infinite",
        }}
      />
      <div className="sr-only" role="status">
        Reading your document… one moment
      </div>
      <div className="w-full max-w-sm mt-6">
        <VoiceBar
          speakableText={speakableForPhase("analyzing", { analysis: null, sendResult: null, analyzeError: null })}
          voiceOn={voiceOn}
          hideMic
        />
      </div>
    </div>
  );
}


function RetakeScreen({
  analysis,
  onRetry,
  onSendAnyway,
  sending,
  speech,
}: {
  analysis: AnalysisResult | null;
  onRetry: () => void;
  onSendAnyway: () => void;
  sending: boolean;
  speech: ReturnType<typeof useSpeech>;
}) {
  useEffect(() => {
    playWarning();
  }, []);
  const voiceOn = useContext(VoiceOnContext);
  const handleIntent = (i: VoiceIntent) => {
    if (i === "confirm") onSendAnyway();
    else if (i === "cancel") onRetry();
  };
  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} face="x" />
      <div
        className="rounded-2xl p-4 my-3"
        style={{ background: "#FFF6E5", border: "1px solid #F5DDA8" }}
      >
        <p className="font-bold mb-1" style={{ fontSize: 20, color: "#7a5a1c" }}>
          I couldn't read it clearly.
        </p>
        {analysis?.elderMessage && (
          <p className="mb-2" style={{ fontSize: 16, color: "#6b5d52" }}>
            {analysis.elderMessage}
          </p>
        )}
        <ul className="space-y-1" style={{ fontSize: 17 }}>
          <li>✋ Hold still</li>
          <li>💡 More light</li>
          <li>🟦 Keep the corners in the box</li>
        </ul>
      </div>
      <div className="space-y-2 mt-auto">
        <BigButton variant="danger" onClick={onRetry}>📷 Try again</BigButton>
        <BigButton variant="ghost" onClick={onSendAnyway}>
          {sending ? "Sending…" : "🤝 Send for human review"}
        </BigButton>
        <VoiceBar
          speakableText={speakableForPhase("retake", { analysis, sendResult: null, analyzeError: null })}
          voiceOn={voiceOn}
          onIntent={handleIntent}
        />
      </div>
    </div>
  );
}


function ReviewScreen({
  analysis,
  sending,
  analyzeError,
  onSend,
  onRetake,
  speech,
}: {
  analysis: AnalysisResult | null;
  sending: boolean;
  analyzeError: string | null;
  onSend: () => void;
  onRetake: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  const missing = analysis?.possibleMissingFields ?? [];
  const voiceOn = useContext(VoiceOnContext);
  const handleIntent = (i: VoiceIntent) => {
    if (i === "confirm") onSend();
    else if (i === "cancel") onRetake();
  };
  useEffect(() => {
    if (missing.length > 0) playWarning();
  }, [missing.length]);


  // No analysis available — show honest fallback, do NOT fake check rows.
  if (!analysis) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-y-auto">
        <MascotHeader speech={speech} small face="surprised" />
        <div
          className="rounded-3xl p-4 mt-3 mb-3"
          style={{ background: "#fff", border: "1px solid #EFE6D6" }}
        >
          <p className="font-extrabold mb-2" style={{ fontSize: 20, color: "var(--color-elder-ink)" }}>
            I couldn't read it clearly.
          </p>
          <p style={{ fontSize: 16, color: "#6b5d52" }}>
            I'd rather not guess. You can try again, or send it for a person at the Legal Aid Center to look at.
          </p>
          {analyzeError && (
            <p className="mt-2 text-sm" style={{ color: "#b91c1c" }}>
              (Note: {analyzeError})
            </p>
          )}
        </div>
        <div className="space-y-2 mt-auto">
          <BigButton variant="ghost" onClick={onRetake}>📷 Retake</BigButton>
          <BigButton variant="danger" onClick={onSend}>
            {sending ? "Sending…" : "🤝 Send for review"}
          </BigButton>
          <VoiceBar
            speakableText={speakableForPhase("review", { analysis: null, sendResult: null, analyzeError })}
            voiceOn={voiceOn}
            onIntent={handleIntent}
          />
        </div>

      </div>
    );
  }

  const docTitle = analysis.documentName || analysis.documentType || "Document";

  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <MascotHeader speech={speech} small face={missing.length ? "surprised" : "smile"} />
      <div
        className="rounded-3xl p-4 mt-3 mb-3"
        style={{
          background: "#fff",
          border: "1px solid #EFE6D6",
          boxShadow: "0 8px 24px rgba(36,31,26,0.06)",
        }}
      >
        <p className="text-xs uppercase font-bold tracking-wide mb-1" style={{ color: "#6b5d52" }}>
          Document
        </p>
        <p className="font-extrabold mb-3" style={{ fontSize: 19, color: "var(--color-elder-ink)" }}>
          {docTitle}
        </p>
        {analysis.plainEnglishSummary && (
          <p className="mb-3" style={{ fontSize: 16, color: "#6b5d52" }}>
            {analysis.plainEnglishSummary}
          </p>
        )}
        {missing.length > 0 ? (
          <>
            <p className="font-bold mb-2" style={{ fontSize: 18, color: "#7a5a1c" }}>
              I see some spots that may need attention:
            </p>
            <ul className="space-y-2">
              {missing.map((m, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3"
                  style={{ fontSize: 18, fontWeight: 600 }}
                >
                  <span
                    aria-hidden
                    className="inline-flex items-center justify-center shrink-0"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 10,
                      background: "#FBEBD8",
                      color: "var(--color-elder-amber)",
                      fontWeight: 800,
                    }}
                  >!</span>
                  <span style={{ color: "#7a5a1c" }}>{m}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="font-semibold" style={{ fontSize: 18, color: "var(--color-elder-teal)" }}>
            ✓ Nothing obviously missing. A person will still confirm before anything is filed.
          </p>
        )}
      </div>
      <div className="space-y-2 mt-auto">
        <BigButton variant="ghost" onClick={onRetake}>📷 Retake</BigButton>
        <BigButton variant="danger" onClick={onSend}>
          {sending ? "Sending…" : "🤝 Send it"}
        </BigButton>
        <VoiceBar
          speakableText={speakableForPhase("review", { analysis, sendResult: null, analyzeError: null })}
          voiceOn={voiceOn}
          onIntent={handleIntent}
        />
      </div>

    </div>
  );
}

function SentScreen({
  sendResult,
  analysis,
  speech,
  onGoCenter,
  onRestart,
}: {
  sendResult: SendResult | null;
  analysis: AnalysisResult | null;
  speech: ReturnType<typeof useSpeech>;
  onGoCenter: () => void;
  onRestart: () => void;
}) {
  const voiceOn = useContext(VoiceOnContext);
  const trackingId = sendResult?.trackingId ?? "—";
  const centerName = sendResult?.centerName ?? "Legal Aid Center";
  const isReview = (sendResult?.status ?? "needs_review") === "needs_review";
  const missingCount = analysis?.possibleMissingFields.length ?? 0;
  const handleIntent = (i: VoiceIntent) => {
    if (i === "confirm") onGoCenter();
    else if (i === "cancel") onRestart();
  };

  const log = [
    "Photo captured on this device",
    `Identified as ${analysis?.documentName ?? analysis?.documentType ?? "unknown document"}`,
    isReview
      ? `Flagged ${missingCount} spot(s) for human review`
      : "No obvious missing fields",
    `Sent to ${centerName}`,
  ];

  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <MascotHeader speech={speech} small face={isReview ? "x" : "smile"} />
      <div
        className="rounded-3xl p-4 mt-3"
        style={{
          background: "#fff",
          border: "1px solid #EFE6D6",
          boxShadow: "0 8px 24px rgba(36,31,26,0.06)",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm" style={{ color: "#6b5d52" }}>
            Tracking number
          </span>
          <span className="font-extrabold" style={{ fontSize: 22, letterSpacing: 0.5 }}>
            {trackingId}
          </span>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-2 rounded-full font-bold"
          style={{
            background: "#E6F3EE",
            color: "var(--color-elder-teal)",
            fontSize: 16,
          }}
        >
          📨 Delivered to {centerName}
        </div>
        <p className="mt-3 font-semibold" style={{ fontSize: 18, color: "var(--color-elder-ink)" }}>
          {isReview
            ? "I won't guess on something this important. A real person will check it for you."
            : "A person will confirm it before anything is filed."}
        </p>
        <div className="mt-3">
          <p className="text-xs uppercase font-bold tracking-wide" style={{ color: "#6b5d52" }}>
            What I did
          </p>
          <ul className="mt-1 space-y-1">
            {log.map((s, i) => (
              <li key={i} className="flex gap-3 text-[15px]">
                <span style={{ color: "#6b5d52", minWidth: 16 }}>{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p
        className="text-center mt-4 mb-3 font-semibold"
        style={{ fontSize: 20, color: "var(--color-elder-ink)" }}
      >
        You don't have to do anything else right now.
      </p>
      <div className="space-y-2 mt-auto">
        <BigButton variant="ghost" onClick={onRestart}>↻ Start over</BigButton>
        <BigButton variant="danger" onClick={onGoCenter}>See the center's side →</BigButton>
        <VoiceBar
          speakableText={speakableForPhase("sent", { analysis, sendResult, analyzeError: null })}
          voiceOn={voiceOn}
          onIntent={handleIntent}
        />
      </div>

    </div>
  );
}

// ===== Shared building blocks =====

function MascotHeader({
  speech,
  small,
  face,
}: {
  speech: ReturnType<typeof useSpeech>;
  small?: boolean;
  face?: "smile" | "x" | "surprised";
}) {
  const mode = speech.speaking ? "speaking" : "idle";
  const size = small ? 96 : speech.speaking ? 220 : 130;
  const showCaptions = useContext(CaptionsContext);
  const showCap = (showCaptions || speech.speaking) && !!speech.caption;
  return (
    <div className="flex flex-col items-center pt-5">
      <Mascot mode={mode} face={face} size={size} />
      {showCap && (
        <p
          key={speech.caption}
          className="mt-3 px-2 text-center font-semibold animate-fade-up"
          style={{
            fontSize: 22,
            lineHeight: 1.35,
            color: "var(--color-elder-ink)",
          }}
        >
          {speech.caption}
        </p>
      )}
    </div>
  );
}

function BigButton({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "ghost" | "danger";
}) {
  const primary = variant === "primary";
  const danger = variant === "danger";
  return (
    <button
      onClick={() => {
        cancelSpeech();
        if ("vibrate" in navigator) navigator.vibrate(35);
        onClick();
      }}

      className={`w-full font-extrabold transition active:scale-[0.96] ${danger ? "animate-button-pop-red" : "animate-button-pop"}`}
      style={{
        background: danger ? "var(--color-elder-red)" : primary ? "var(--color-elder-primary)" : "#fff",
        color: primary || danger ? "#fff" : "var(--color-elder-primary)",
        border: primary || danger ? "none" : "2px solid var(--color-elder-sky)",
        borderRadius: 26,
        padding: "22px",
        fontSize: 22,
        minHeight: 78,
        boxShadow: primary || danger ? "0 14px 30px rgba(0,0,0,0.18)" : "none",
      }}
    >
      {children}
    </button>
  );
}

// ===== speakableText per screen — covers ALL visible meaningful text =====
function speakableForPhase(
  phase: Phase,
  ctx: {
    analysis: AnalysisResult | null;
    sendResult: SendResult | null;
    analyzeError: string | null;
  },
): string {
  switch (phase) {
    case "start":
      return "My Friend. How would you like me to help? Tap Talk to me to hear everything out loud. Tap Show me words for big captions with no sound. Tap Both for voice and captions together.";
    case "find":
      return "Ready to find your document? I'll open the magnifier so you can see clearly first. Nothing is uploaded yet. Tap the red Open Magnifier button when you're ready, or say yes.";
    case "magnifier":
      return "Point the camera at your paper. Keep the corners inside the frame. I'll capture it when it looks clear.";
    case "analyzing":
      return "Let me read this for you. Reading your document. One moment.";
    case "retake": {
      const why = ctx.analysis?.elderMessage
        ? `${ctx.analysis.elderMessage} `
        : "";
      return `I couldn't read it clearly. ${why}Try holding still, with more light, and keep the corners in the box. Tap Try again to take another photo, or say no. Or tap Send for human review to let a real person look at it, or say yes.`;
    }
    case "review": {
      if (!ctx.analysis) {
        const err = ctx.analyzeError ? ` Note: ${ctx.analyzeError}.` : "";
        return `I couldn't read it clearly. I'd rather not guess.${err} Tap Retake to try again, or say no. Tap Send for review to send it to a person at the Legal Aid Center, or say yes.`;
      }
      const a = ctx.analysis;
      const title = a.documentName || a.documentType || "a document";
      const summary = a.plainEnglishSummary ? ` ${a.plainEnglishSummary}` : "";
      const missing = a.possibleMissingFields ?? [];
      const missingPart =
        missing.length > 0
          ? ` I see some spots that may need attention: ${missing.join("; ")}.`
          : " Nothing obviously missing. A person will still confirm before anything is filed.";
      return `This looks like ${title}.${summary}${missingPart} Tap Retake to take another photo, or say no. Tap Send it to send to the Legal Aid Center, or say yes.`;
    }
    case "sent": {
      const r = ctx.sendResult;
      const id = r?.trackingId ?? "pending";
      const center = r?.centerName ?? "Legal Aid Center";
      const isReview = (r?.status ?? "needs_review") === "needs_review";
      const closing = isReview
        ? "I won't guess on something this important. A real person will check it for you."
        : "A person will confirm it before anything is filed.";
      return `All done. Your tracking number is ${id}. Delivered to ${center}. ${closing} You don't have to do anything else right now. Tap Start over to begin again, or say no. Tap See the center's side to view the staff dashboard, or say yes.`;
    }
  }
}
