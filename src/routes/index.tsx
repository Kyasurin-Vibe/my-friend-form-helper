import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, createContext, useContext } from "react";
import { Mascot } from "@/components/Mascot";
import { LiveMagnifier } from "@/components/LiveMagnifier";
import { VoiceBar } from "@/components/VoiceBar";
import { useSpeech } from "@/lib/useSpeech";
import {
  analyzeDocument,
  cropToBounds,
  detectDocumentBounds,
  sendToCenter,
  speakWarm,
  type AnalysisResult,
  type DocumentBounds,
  type SendResult,
} from "@/lib/cases";
import { getResources, getAccountablePartner } from "@/lib/resources";
import { cancelSpeech, startRecording, transcribeAudio, type VoiceAction } from "@/lib/voice";
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
  | "choose"
  | "sent";

export type Recipient =
  | { kind: "center" }
  | { kind: "trusted"; name: string; relationship: string };


const CaptionsContext = createContext<boolean>(true);
const VoiceOnContext = createContext<boolean>(true);

function isValidBounds(b: DocumentBounds | null | undefined): boolean {
  if (!b) return false;
  const { x, y, width, height } = b;
  return (
    Number.isFinite(x) && Number.isFinite(y) &&
    Number.isFinite(width) && Number.isFinite(height) &&
    width > 0.05 && height > 0.05 &&
    x >= 0 && y >= 0 && x + width <= 1.0001 && y + height <= 1.0001
  );
}

function ElderApp() {
  const [a11yMode, setA11yMode] = useState<A11yMode>("both");
  const [phase, setPhase] = useState<Phase>("find");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | undefined>(undefined);
  const [processedImage, setProcessedImage] = useState<string | undefined>(undefined);
  const [capturedBounds, setCapturedBounds] = useState<DocumentBounds | null>(null);
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
    setProcessedImage(undefined);
    setCapturedBounds(null);
    setAnalyzeError(null);
    speech.cancel();
  };

  async function handleCapture(result?: { processed: string; original: string; bounds: DocumentBounds | null }) {
    if (!result) {
      setCapturedImage(undefined);
      setProcessedImage(undefined);
      setCapturedBounds(null);
      setAnalysis(null);
      setPhase("review");
      return;
    }
    // Step 1: store the full-res frame. Show "Reading…" screen.
    setCapturedImage(result.original);
    setProcessedImage(undefined);
    setCapturedBounds(result.bounds);
    setAnalysis(null);
    setAnalyzeError(null);
    setPhase("analyzing");

    const startedAt = Date.now();
    const minDisplay = 700;
    // Tight centered A4-ish crop — never the full raw frame.
    const centeredFallback: DocumentBounds = {
      x: 0.14, y: 0.06, width: 0.72, height: 0.88, confidence: 0,
    };

    // Run BOTH in parallel:
    //  - detect-document (downscaled, fast) → reliable bounds for the preview crop
    //  - analyze-document (full-res) → recognition for the review screen
    const detectPromise = detectDocumentBounds(result.original);
    const analyzePromise = analyzeDocument(result.original).catch((e) => {
      console.error("analyze failed", e);
      setAnalyzeError(e instanceof Error ? e.message : "Could not analyze right now.");
      return null;
    });

    const detectRes = await detectPromise;
    const detectBounds =
      detectRes &&
      detectRes.documentPresent &&
      detectRes.confidence >= 0.55 &&
      detectRes.documentBounds &&
      isValidBounds({ ...detectRes.documentBounds, confidence: detectRes.confidence })
        ? { ...detectRes.documentBounds, confidence: detectRes.confidence }
        : null;

    // Prefer dedicated detector bounds, then local bounds from scanner, then centered fallback.
    // NEVER fall back to the raw frame.
    const cropBounds: DocumentBounds =
      detectBounds ??
      (isValidBounds(result.bounds) ? result.bounds! : centeredFallback);

    let cropped: string;
    try {
      cropped = await cropToBounds(result.original, cropBounds, 0.012);
    } catch {
      cropped = result.processed ?? result.original;
    }
    setProcessedImage(cropped);

    // Wait for analyze (parallel) to finish before showing preview so review screen is ready.
    const analysisResult = await analyzePromise;
    if (analysisResult) setAnalysis(analysisResult);

    // If Claude analyze returned even tighter bounds, refine the preview crop.
    const claudeBounds = analysisResult?.documentBounds ?? null;
    if (isValidBounds(claudeBounds)) {
      try {
        const refined = await cropToBounds(result.original, claudeBounds!, 0.012);
        setProcessedImage(refined);
      } catch { /* keep prior cropped */ }
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < minDisplay) {
      await new Promise((r) => setTimeout(r, minDisplay - elapsed));
    }

    // Step 4: show cropped preview for explicit user confirmation.
    setPhase("preview");
  }

  function confirmPreview() {
    // User confirmed the cropped preview. Analysis is already done — go to review.
    // send-to-center is NEVER called without explicit confirmation on the review screen.
    if (analyzeError || !analysis) {
      setPhase("review");
      return;
    }
    if (analysis.recommendedAction === "retake") {
      setPhase("retake");
      return;
    }
    setPhase("review");
  }




  async function handleSend(recipient: Recipient) {
    if (sending) return;
    setSending(true);
    try {
      const partner = getAccountablePartner(analysis?.resourceCategory);
      const enrichedRecipient =
        recipient.kind === "center"
          ? { kind: "center" as const, partnerName: partner.name }
          : recipient;
      const result = await sendToCenter({
        originalImage: capturedImage,
        processedImage: processedImage ?? capturedImage,
        recipient: enrichedRecipient,
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
            documentBounds: null,
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
                image={processedImage}
                speech={speech}
                onUse={confirmPreview}
                onRetake={() => setPhase("magnifier")}
              />

            ) : phase === "analyzing" ? (
              <AnalyzingScreen />
            ) : phase === "retake" ? (
              <RetakeScreen
                analysis={analysis}
                onRetry={() => setPhase("magnifier")}
                onSendAnyway={() => setPhase("choose")}
                sending={sending}
                speech={speech}
              />

            ) : phase === "review" ? (
              <ReviewScreen
                analysis={analysis}
                sending={sending}
                analyzeError={analyzeError}
                onSend={() => setPhase("choose")}
                onRetake={() => setPhase("magnifier")}
                speech={speech}
              />
            ) : phase === "choose" ? (
              <ChooseRecipientScreen
                sending={sending}
                analysis={analysis}
                onBack={() => setPhase(analysis ? "review" : "retake")}
                onPick={(r) => handleSend(r)}
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
        actions={[
          { id: "open", label: "Open Magnifier", description: "Start the camera to find the document" },
        ]}
        onAction={(id) => { if (id === "open") onOpenMagnifier(); }}
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
  const partner = getAccountablePartner(analysis?.resourceCategory);
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
          {sending ? "Sending…" : "🤝 Connect me with a person"}
        </BigButton>
        <VoiceBar
          speakableText={speakableForPhase("retake", { analysis, sendResult: null, analyzeError: null })}
          voiceOn={voiceOn}
          actions={[
            { id: "retry", label: "Try again", description: "Retake the photo" },
            { id: "send", label: "Connect me with a person", description: `Send the photo to a real human (a ${partner.name})` },
          ]}
          onAction={(id) => {
            if (id === "retry") onRetry();
            else if (id === "send") onSendAnyway();
          }}
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
  const partner = getAccountablePartner(analysis?.resourceCategory);
  const reviewActions: VoiceAction[] = [
    { id: "retake", label: "Retake", description: "Take the photo again" },
    { id: "connect", label: "Connect me with a person", description: `Send the document to a real human (a ${partner.name})` },
  ];
  const onReviewAction = (id: string) => {
    if (id === "retake") onRetake();
    else if (id === "connect") onSend();
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
            I'd rather not guess. You can try again, or send it for a person to look at.
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
            {sending ? "Sending…" : "🤝 Connect me with a person"}
          </BigButton>
          <VoiceBar
            speakableText={speakableForPhase("review", { analysis: null, sendResult: null, analyzeError })}
            voiceOn={voiceOn}
            actions={reviewActions}
            onAction={onReviewAction}
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
      <div
        className="rounded-3xl p-4 mb-3"
        style={{
          background: "#fff",
          border: "1px solid #EFE6D6",
          boxShadow: "0 8px 24px rgba(36,31,26,0.06)",
        }}
      >
        <p
          className="text-xs uppercase font-bold tracking-wide mb-2"
          style={{ color: "#6b5d52" }}
        >
          Here&apos;s help available for you
        </p>
        {(() => {
          const resources = getResources(analysis.resourceCategory);
          if (resources.length === 0) {
            return (
              <p style={{ fontSize: 16, color: "#6b5d52" }}>
                This doesn&apos;t look like a form you need help with. If you&apos;d still like a person to look at it, I can send it.
              </p>
            );
          }
          return (
            <div className="space-y-3">
              {resources.map((r, i) => (
                <div
                  key={i}
                  className="rounded-2xl p-3"
                  style={{
                    background: "#FDFBF7",
                    border: "1px solid #EFE6D6",
                  }}
                >
                  <p
                    className="font-extrabold"
                    style={{ fontSize: 18, color: "var(--color-elder-ink)" }}
                  >
                    {r.name}
                  </p>
                  <p className="mt-1" style={{ fontSize: 16, color: "#6b5d52" }}>
                    {r.helpsWith}
                  </p>
                  {r.contact && (
                    <p
                      className="mt-1 font-semibold"
                      style={{ fontSize: 15, color: "var(--color-elder-primary)" }}
                    >
                      {r.contact}
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      <div className="space-y-2 mt-auto">
        <BigButton variant="ghost" onClick={onRetake}>
          📷 Retake
        </BigButton>
        <BigButton variant="danger" onClick={onSend}>
          {sending ? "Sending…" : "🤝 Connect me with a person"}
        </BigButton>
        <VoiceBar
          speakableText={speakableForPhase("review", {
            analysis,
            sendResult: null,
            analyzeError: null,
          })}
          voiceOn={voiceOn}
          actions={reviewActions}
          onAction={onReviewAction}
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
  const centerName = sendResult?.centerName ?? getAccountablePartner(analysis?.resourceCategory).name;
  const isReview = (sendResult?.status ?? "needs_review") === "needs_review";
  const missingCount = analysis?.possibleMissingFields.length ?? 0;
  // (voice actions wired below)


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
          actions={[
            { id: "restart", label: "Start over", description: "Scan another document from the beginning" },
            { id: "center", label: "See the center's side", description: "Open the staff dashboard view" },
          ]}
          onAction={(id) => {
            if (id === "restart") onRestart();
            else if (id === "center") onGoCenter();
          }}
        />

      </div>

    </div>
  );
}

// ===== Shared building blocks =====

function ChooseRecipientScreen({
  sending,
  analysis,
  onBack,
  onPick,
  speech,
}: {
  sending: boolean;
  analysis: AnalysisResult | null;
  onBack: () => void;
  onPick: (r: Recipient) => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  const voiceOn = useContext(VoiceOnContext);
  const [mode, setMode] = useState<"pick" | "trusted">("pick");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const partner = getAccountablePartner(analysis?.resourceCategory);

  if (mode === "pick") {
    return (
      <div className="flex-1 flex flex-col p-6">
        <MascotHeader speech={speech} small face="smile" />
        <h2
          className="text-center font-extrabold mt-2 mb-1"
          style={{ fontSize: 24, color: "var(--color-elder-ink)" }}
        >
          Who should I send this to?
        </h2>
        <p
          className="text-center mb-4"
          style={{ fontSize: 16, color: "#6b5d52" }}
        >
          Pick the person YOU trust. You're in charge.
        </p>
        <div className="space-y-3 mt-auto">
          <BigButton variant="danger" onClick={() => onPick({ kind: "center" })}>
            {sending ? "Sending…" : `🤝 ${partner.label}`}
          </BigButton>
          <p
            className="text-center"
            style={{ fontSize: 13, color: "#8a7d6f", marginTop: -4 }}
          >
            Recommended. An accountable institution.
          </p>
          <BigButton variant="ghost" onClick={() => setMode("trusted")}>
            👪 Send to my trusted person
          </BigButton>
          <p
            className="text-center"
            style={{ fontSize: 13, color: "#8a7d6f", marginTop: -4 }}
          >
            Someone YOU pick — your own attorney or a family member you trust.
          </p>
          <BigButton variant="ghost" onClick={onBack}>← Go back</BigButton>
          <VoiceBar
            speakableText={speakableForPhase("choose", { analysis, sendResult: null, analyzeError: null })}
            voiceOn={voiceOn}
            actions={[
              { id: "center", label: partner.label, description: `Send the document to a ${partner.name} (the recommended, accountable option)` },
              { id: "trusted", label: "Send to my trusted person", description: "Open the form to enter a trusted contact the user picks themselves" },
              { id: "back", label: "Go back", description: "Return to the previous screen" },
            ]}
            onAction={(id) => {
              if (id === "center") onPick({ kind: "center" });
              else if (id === "trusted") setMode("trusted");
              else if (id === "back") onBack();
            }}
          />
        </div>
      </div>
    );
  }

  const canSend = name.trim().length > 0 && !sending;
  return (
    <TrustedPersonForm
      sending={sending}
      name={name}
      relationship={relationship}
      onChangeName={setName}
      onChangeRelationship={setRelationship}
      onBack={() => setMode("pick")}
      onSend={() =>
        canSend && onPick({ kind: "trusted", name: name.trim(), relationship: relationship.trim() })
      }
      canSend={canSend}
      speech={speech}
    />
  );
}

function TrustedPersonForm({
  sending,
  name,
  relationship,
  onChangeName,
  onChangeRelationship,
  onBack,
  onSend,
  canSend,
  speech,
}: {
  sending: boolean;
  name: string;
  relationship: string;
  onChangeName: (v: string) => void;
  onChangeRelationship: (v: string) => void;
  onBack: () => void;
  onSend: () => void;
  canSend: boolean;
  speech: ReturnType<typeof useSpeech>;
}) {
  const voiceOn = useContext(VoiceOnContext);
  useEffect(() => {
    if (voiceOn) {
      speakWarm(
        "Who do you trust with this? Tap the microphone and say their name, then tell me how you know them.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} small face="smile" />
      <h2
        className="text-center font-extrabold mt-2 mb-1"
        style={{ fontSize: 24, color: "var(--color-elder-ink)" }}
      >
        Who do you trust with this?
      </h2>
      <p
        className="text-center mb-4"
        style={{ fontSize: 15, color: "#6b5d52" }}
      >
        Tap the microphone and say it, or type it.
      </p>
      <label
        className="font-bold"
        style={{ fontSize: 16, color: "var(--color-elder-ink)" }}
      >
        Their name
      </label>
      <VoiceField
        value={name}
        onChange={onChangeName}
        placeholder="e.g. Jane Smith"
        ariaLabel="Their name"
      />
      <label
        className="font-bold mt-3"
        style={{ fontSize: 16, color: "var(--color-elder-ink)" }}
      >
        How do you know them?
      </label>
      <VoiceField
        value={relationship}
        onChange={onChangeRelationship}
        placeholder="e.g. my attorney, my daughter, my pastor"
        ariaLabel="How do you know them"
      />
      <div className="space-y-2 mt-auto pt-4">
        <BigButton variant="danger" onClick={onSend}>
          {sending ? "Sending…" : `📨 Send to ${name.trim() || "this person"}`}
        </BigButton>
        <BigButton variant="ghost" onClick={onBack}>← Back</BigButton>
      </div>
    </div>
  );
}

function VoiceField({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const stopRef = useRef<null | (() => Promise<Blob | null>)>(null);

  const start = async () => {
    if (recording || working) return;
    cancelSpeech();
    try {
      const ctrl = await startRecording(6000);
      stopRef.current = ctrl.stop;
      setRecording(true);
    } catch {
      /* mic blocked — typing still works */
    }
  };
  const stop = async () => {
    if (!stopRef.current) return;
    setRecording(false);
    setWorking(true);
    try {
      const blob = await stopRef.current();
      stopRef.current = null;
      if (!blob) return;
      const transcript = (await transcribeAudio(blob)).trim();
      if (transcript) {
        const cleaned = transcript.replace(/[.。!?！？]+$/g, "").trim();
        onChange(cleaned);
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mt-1">
      <div className="flex gap-2 items-stretch">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={recording ? "🎙 Listening…" : placeholder}
          autoComplete="off"
          aria-label={ariaLabel}
          className="flex-1"
          style={{
            fontSize: 20,
            padding: "14px 16px",
            borderRadius: 14,
            border: `2px solid ${recording ? "var(--color-elder-red)" : "#e7ddd0"}`,
            background: "#fff",
            color: "var(--color-elder-ink)",
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); start(); }}
          onPointerUp={(e) => { e.preventDefault(); stop(); }}
          onPointerLeave={() => { if (recording) stop(); }}
          onClick={(e) => e.preventDefault()}
          aria-label={`Hold to speak ${ariaLabel}`}
          className="font-bold active:scale-[0.97] shrink-0"
          style={{
            background: recording ? "var(--color-elder-red)" : "#fff",
            color: recording ? "#fff" : "var(--color-elder-ink)",
            border: `2px solid ${recording ? "var(--color-elder-red)" : "#e7ddd0"}`,
            borderRadius: 14,
            padding: "0 18px",
            fontSize: 22,
            minHeight: 56,
            minWidth: 72,
          }}
        >
          {working ? "…" : recording ? "●" : "🎙"}
        </button>
      </div>
      {recording && (
        <p
          className="mt-1"
          style={{ fontSize: 13, color: "var(--color-elder-red)", fontWeight: 700 }}
        >
          🎙 Listening… release when done.
        </p>
      )}
    </div>
  );
}



function PreviewScreen({
  image,
  speech,
  onUse,
  onRetake,
}: {
  image: string | undefined;
  speech: ReturnType<typeof useSpeech>;
  onUse: () => void;
  onRetake: () => void;
}) {
  const voiceOn = useContext(VoiceOnContext);

  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} small face="smile" />
      <h2
        className="text-center font-extrabold mt-2 mb-3"
        style={{ fontSize: 24, color: "var(--color-elder-ink)" }}
      >
        Is this clear enough?
      </h2>
      <div
        className="rounded-2xl overflow-hidden mb-4"
        style={{
          background: "#111",
          boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
          maxHeight: 340,
        }}
      >
        {image ? (
          <img
            src={image}
            alt="Captured document"
            className="w-full h-full object-contain"
            style={{ maxHeight: 340 }}
          />
        ) : (
          <div className="p-10 text-center text-white">No image captured.</div>
        )}
      </div>
      <div className="space-y-2 mt-auto">
        <BigButton variant="danger" onClick={onUse}>✅ Yes, use this</BigButton>
        <BigButton variant="ghost" onClick={onRetake}>🔄 Retake</BigButton>
        <VoiceBar
          speakableText={speakableForPhase("preview", { analysis: null, sendResult: null, analyzeError: null })}
          voiceOn={voiceOn}
          actions={[
            { id: "use", label: "Yes, use this", description: "Accept this photo and analyze it" },
            { id: "retake", label: "Retake", description: "Take a new photo" },
          ]}
          onAction={(id) => {
            if (id === "use") onUse();
            else if (id === "retake") onRetake();
          }}
        />

      </div>
    </div>
  );
}



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
    case "preview":
      return "Is this clear enough? Tap Yes use this and I'll read it for you, or say yes. Tap Retake to take another photo, or say no.";

    case "analyzing":
      return "Let me read this for you. Reading your document. One moment.";

    case "retake": {
      const why = ctx.analysis?.elderMessage
        ? `${ctx.analysis.elderMessage} `
        : "";
      const partnerName = getAccountablePartner(ctx.analysis?.resourceCategory).name;
      return `I couldn't read it clearly. ${why}Try holding still, with more light, and keep the corners in the box. Tap Try again to take another photo, or say no. Or tap Connect me with a person to let a ${partnerName} look at it, or say yes.`;
    }
    case "review": {
      if (!ctx.analysis) {
        const err = ctx.analyzeError ? ` Note: ${ctx.analyzeError}.` : "";
        return `I couldn't read it clearly. I'd rather not guess.${err} Tap Retake to try again, or say no. Tap Connect me with a person to send it to a real person, or say yes.`;
      }
      const a = ctx.analysis;
      const title = a.documentName || a.documentType || "a document";
      const summary = a.plainEnglishSummary ? ` ${a.plainEnglishSummary}` : "";
      const missing = a.possibleMissingFields ?? [];
      const missingPart =
        missing.length > 0
          ? ` I see some spots that may need attention: ${missing.join("; ")}.`
          : " Nothing obviously missing. A person will still confirm before anything is filed.";
      const resources = getResources(a.resourceCategory);
      const resourcesIntro = resources.length > 0
        ? ` Here are some places that can help you with this: ${resources.slice(0, 2).map(r => r.name + (r.contact ? ` — ${r.contact}` : "")).join(". ")}.`
        : " This doesn't look like a form you need help with. If you'd still like a person to look at it, I can send it.";
      const partnerName = getAccountablePartner(a.resourceCategory).name;
      return `This looks like ${title}.${summary}${missingPart}${resourcesIntro} Tap Retake to take another photo, or say no. Tap Connect me with a person to send to a ${partnerName}, or say yes.`;
    }
    case "choose": {
      const partner = getAccountablePartner(ctx.analysis?.resourceCategory);
      return `Who should I send this to? Tap ${partner.label} to send it to a real person at an accountable institution, or say yes. Tap Send to my trusted person to send it to someone you pick yourself, like your own attorney or a trusted family member, or say trusted person. Tap Go back to return.`;
    }

    case "sent": {
      const r = ctx.sendResult;
      const id = r?.trackingId ?? "pending";
      const center = r?.centerName ?? getAccountablePartner(ctx.analysis?.resourceCategory).name;
      const isReview = (r?.status ?? "needs_review") === "needs_review";
      const closing = isReview
        ? "I won't guess on something this important. A real person will check it for you."
        : "A person will confirm it before anything is filed.";
      return `All done. Your tracking number is ${id}. Delivered to ${center}. ${closing} You don't have to do anything else right now. Tap Start over to begin again, or say no. Tap See the center's side to view the staff dashboard, or say yes.`;
    }
  }
}
