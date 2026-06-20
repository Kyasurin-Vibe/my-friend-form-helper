import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/Mascot";
import { useSpeech } from "@/lib/useSpeech";
import { addCase, buildCase, clearCases, type Branch } from "@/lib/handoff";
import { playWarning, playSuccess } from "@/lib/chime";

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

type Step = 1 | 2 | 3 | 4 | 5 | 6;
export type A11yMode = "voice" | "text" | "both";

function ElderApp() {
  const [step, setStep] = useState<Step>(1);
  const [branch, setBranch] = useState<Branch>("missing");
  const [a11yMode, setA11yMode] = useState<A11yMode>("both");
  const [started, setStarted] = useState(false);
  const speech = useSpeech();
  const navigate = useNavigate();

  const voiceOn = a11yMode !== "text";
  const showCaptions = a11yMode !== "voice";

  useEffect(() => {
    speech.setEnabled(voiceOn);
  }, [voiceOn, speech]);

  // Speak on step change (after user has tapped once)
  useEffect(() => {
    if (!started) return;
    const lines: Record<Step, string> = {
      1: "Hi, I'm My Friend. Put your paper in the box, and I'll take a look.",
      2: "That was a little blurry. Hold steady, and let's try again.",
      3: "I can see this clearly now. This is your FL-142 — your list of assets. I can see your name and your assets.",
      4:
        branch === "missing"
          ? "I checked your form. I'm not sure this one is ready. There's no signature and no date. Do you want to fix it yourself, or should I send it to a person?"
          : "I checked your form. This looks complete.",
      5:
        branch === "missing"
          ? "I won't guess on something this important. I've sent it to your legal aid center so a real person can check it for you."
          : "It looks complete. I've sent it to your legal aid center so a person can confirm it before you file.",
      6: "My Friend gives accountable help.",
    };
    speech.speak(lines[step]);
    if (step === 5) {
      addCase(buildCase(branch));
    }
  }, [step, branch, started]); // eslint-disable-line

  const restart = () => {
    setStep(1);
    setStarted(false);
    clearCases();
    speech.cancel();
  };

  const start = (mode: A11yMode) => {
    setA11yMode(mode);
    setStarted(true);
    if (mode !== "text") {
      // tiny delay so setEnabled effect commits
      setTimeout(() => {
        speech.speak(
          "Hi, I'm My Friend. Put your paper in the box, and I'll take a look."
        );
      }, 50);
    }
  };


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
      <PresenterBar
        step={step}
        setStep={setStep}
        branch={branch}
        setBranch={setBranch}
        a11yMode={a11yMode}
        setA11yMode={setA11yMode}
        restart={restart}
      />

      {/* Phone frame */}
      <div
        className="relative mt-3"
        style={{
          width: 400,
          maxWidth: "96vw",
          height: 820,
          maxHeight: "calc(100dvh - 120px)",
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
          {!started ? (
            <StartGate onStart={start} />
          ) : (
            <ScreenRouter
              step={step}
              setStep={setStep}
              branch={branch}
              speech={speech}
              showCaptions={showCaptions}
              onGoCenter={() => navigate({ to: "/center" })}
            />
          )}
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

function PresenterBar({
  step,
  setStep,
  branch,
  setBranch,
  a11yMode,
  setA11yMode,
  restart,
}: {
  step: Step;
  setStep: (s: Step) => void;
  branch: Branch;
  setBranch: (b: Branch) => void;
  a11yMode: A11yMode;
  setA11yMode: (m: A11yMode) => void;
  restart: () => void;
}) {
  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-semibold border transition"
      style={{
        background: active ? "var(--color-elder-primary)" : "#fff",
        color: active ? "#fff" : "var(--color-elder-ink)",
        borderColor: active ? "var(--color-elder-primary)" : "#e7ddd0",
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      className="flex flex-wrap gap-2 items-center justify-center rounded-full px-3 py-2 text-xs"
      style={{
        background: "#fff",
        border: "1px solid #e7ddd0",
        fontFamily: "var(--font-center)",
        color: "#6b5d52",
      }}
    >
      <b className="px-1">Presenter</b>
      {[1, 2, 3, 4, 5, 6].map((n) =>
        chip(`Step ${n}`, step === n, () => setStep(n as Step))
      )}
      <span className="mx-1 opacity-40">|</span>
      <b>Branch</b>
      {chip("① Missing", branch === "missing", () => setBranch("missing"))}
      {chip("② Complete", branch === "complete", () => setBranch("complete"))}
      <span className="mx-1 opacity-40">|</span>
      <b>Mode</b>
      {chip("🔊 Voice", a11yMode === "voice", () => setA11yMode("voice"))}
      {chip("📝 Text", a11yMode === "text", () => setA11yMode("text"))}
      {chip("🔊📝 Both", a11yMode === "both", () => setA11yMode("both"))}
      <button
        onClick={restart}
        className="px-3 py-1.5 rounded-full text-xs font-semibold"
        style={{ background: "#faf6f0", border: "1px solid #e7ddd0" }}
      >
        ↻ Restart
      </button>
    </div>
  );
}

const CaptionsCtx = ({ children, value }: { children: React.ReactNode; value: boolean }) => (
  <CaptionsContext.Provider value={value}>{children}</CaptionsContext.Provider>
);
import { createContext, useContext } from "react";
const CaptionsContext = createContext<boolean>(true);

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

function ScreenRouter({
  step,
  setStep,
  branch,
  speech,
  showCaptions,
  onGoCenter,
}: {
  step: Step;
  setStep: (s: Step) => void;
  branch: Branch;
  speech: ReturnType<typeof useSpeech>;
  showCaptions: boolean;
  onGoCenter: () => void;
}) {
  const next = (n: Step) => setStep(n);
  return (
    <CaptionsCtx value={showCaptions}>
      {(() => {
        switch (step) {
          case 1:
            return <Screen1 onNext={() => next(2)} speech={speech} />;
          case 2:
            return <Screen2 onNext={() => next(3)} speech={speech} />;
          case 3:
            return <Screen3 onNext={() => next(4)} speech={speech} />;
          case 4:
            return (
              <Screen4
                branch={branch}
                onSendToCenter={() => next(5)}
                onFixSelf={() => setStep(1)}
                speech={speech}
              />
            );
          case 5:
            return <Screen5 branch={branch} onGoCenter={onGoCenter} speech={speech} />;
          case 6:
            return <Screen6 />;
        }
      })()}
    </CaptionsCtx>
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
            fontSize: 26,
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
        if ("vibrate" in navigator) navigator.vibrate(35);
        onClick();
      }}
      className={`w-full font-extrabold transition active:scale-[0.96] ${danger ? "animate-button-pop-red" : "animate-button-pop"}`}
      style={{
        background: danger ? "var(--color-elder-red)" : primary ? "var(--color-elder-primary)" : "#fff",
        color: primary || danger ? "#fff" : "var(--color-elder-primary)",
        border: primary || danger ? "none" : "2px solid var(--color-elder-sky)",
        borderRadius: 26,
        padding: "26px",
        fontSize: 26,
        minHeight: 88,
        boxShadow: primary || danger ? "0 14px 30px rgba(0,0,0,0.18)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function VoiceControls({
  speech,
}: {
  speech: ReturnType<typeof useSpeech>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-2 mb-2">
      <button
        onClick={() => speech.repeat()}
        className="font-bold"
        style={{
          background: "#fff",
          border: "2px solid var(--color-elder-sky)",
          borderRadius: 16,
          padding: "14px",
          fontSize: 17,
          color: "var(--color-elder-primary)",
        }}
      >
        🔊 Say it again
      </button>
      <button
        onClick={() =>
          speech.speak(
            "Tap the big blue button at the bottom to keep going. I'll help you each step."
          )
        }
        className="font-bold"
        style={{
          background: "#fff",
          border: "2px solid var(--color-elder-sky)",
          borderRadius: 16,
          padding: "14px",
          fontSize: 17,
          color: "var(--color-elder-primary)",
        }}
      >
        ❓ What do I do?
      </button>
    </div>
  );
}

// ===== Screens =====

function Screen1({
  onNext,
  speech,
}: {
  onNext: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  return (
    <div className="flex-1 flex flex-col p-6">
      <h2
        className="text-center font-extrabold"
        style={{ fontSize: 28, color: "var(--color-elder-ink)" }}
      >
        My Friend
      </h2>
      <p className="text-center" style={{ color: "#6b5d52", fontSize: 16 }}>
        Let's take a photo of your paper.
      </p>
      <MascotHeader speech={speech} small />
      <Viewfinder variant="empty" />
      <p
        className="text-center font-bold mb-3"
        style={{ fontSize: 24, color: "var(--color-elder-ink)" }}
      >
        Put your paper in the box.
      </p>
      <VoiceControls speech={speech} />
      <BigButton variant="danger" onClick={onNext}>📷 Take the photo</BigButton>
    </div>
  );
}

function Screen2({
  onNext,
  speech,
}: {
  onNext: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  useEffect(() => {
    playWarning();
    speech.speak("A few tips: hold still, add more light, and keep the corners in the box.");
  }, []); // eslint-disable-line
  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} face="x" />
      <Viewfinder variant="blurry" />
      <div
        className="rounded-2xl p-3 mb-2"
        style={{ background: "#FFF6E5", border: "1px solid #F5DDA8" }}
      >
        <p className="font-bold mb-1" style={{ fontSize: 18 }}>
          A few tips:
        </p>
        <ul className="space-y-1" style={{ fontSize: 17 }}>
          <li>✋ Hold still</li>
          <li>💡 More light</li>
          <li>🟦 Keep the corners in the box</li>
        </ul>
      </div>
      <VoiceControls speech={speech} />
      <BigButton variant="danger" onClick={onNext}>Try again</BigButton>
    </div>
  );
}

function Screen3({
  onNext,
  speech,
}: {
  onNext: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  useEffect(() => { playSuccess(); }, []);
  const readDoc = () => {
    speech.speak(
      "This looks like a Schedule of Assets and Debts, form F L one forty two. I see your name, the case number, your assets, and your debts. There is also a place for your signature and the date at the bottom.",
    );
  };
  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} small face="smile" />
      <Viewfinder variant="clear" />
      <p
        className="text-center font-bold mb-2"
        style={{ fontSize: 22, color: "var(--color-elder-ink)" }}
      >
        I can read this clearly.
      </p>
      <p
        className="text-center mb-3"
        style={{ fontSize: 17, color: "#6b6256" }}
      >
        This looks like <strong>FL-142 — Schedule of Assets and Debts</strong>. I made the text larger so it's easier to see.
      </p>
      <VoiceControls speech={speech} />
      <BigButton variant="ghost" onClick={readDoc}>
        🔊 Read the paper to me
      </BigButton>
      <BigButton variant="danger" onClick={onNext}>Check my form</BigButton>
    </div>
  );
}

function Screen4({
  branch,
  onSendToCenter,
  onFixSelf,
  speech,
}: {
  branch: Branch;
  onSendToCenter: () => void;
  onFixSelf: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  useEffect(() => {
    if (branch === "missing") playWarning();
  }, [branch]);
  const rows =
    branch === "missing"
      ? [
          { ok: true, label: "Name" },
          { ok: true, label: "Assets" },
          { ok: true, label: "Debts" },
          { ok: false, label: "Signature" },
          { ok: false, label: "Date" },
        ]
      : [
          { ok: true, label: "Name" },
          { ok: true, label: "Assets" },
          { ok: true, label: "Debts" },
          { ok: true, label: "Signature" },
          { ok: true, label: "Date" },
        ];
  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <MascotHeader speech={speech} small face="surprised" />
      <div
        className="rounded-3xl p-4 mt-3 mb-3"
        style={{
          background: "#fff",
          border: "1px solid #EFE6D6",
          boxShadow: "0 8px 24px rgba(36,31,26,0.06)",
        }}
      >
        <p className="font-bold mb-2" style={{ fontSize: 20 }}>
          Here's what I found:
        </p>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex items-center gap-3"
              style={{ fontSize: 22, fontWeight: 600 }}
            >
              <span
                aria-hidden
                className="inline-flex items-center justify-center"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: r.ok ? "#E6F3EE" : "#FBEBD8",
                  color: r.ok
                    ? "var(--color-elder-teal)"
                    : "var(--color-elder-amber)",
                  fontWeight: 800,
                }}
              >
                {r.ok ? "✓" : "!"}
              </span>
              <span style={{ color: r.ok ? "var(--color-elder-ink)" : "#7a5a1c" }}>
                {r.label}
              </span>
              <span
                className="ml-auto text-xs font-bold uppercase tracking-wide"
                style={{
                  color: r.ok
                    ? "var(--color-elder-teal)"
                    : "var(--color-elder-amber)",
                }}
              >
                {r.ok ? "found" : "missing"}
              </span>
            </li>
          ))}
        </ul>
        <p
          className="mt-3 font-semibold"
          style={{
            fontSize: 18,
            color: branch === "missing" ? "#7a5a1c" : "var(--color-elder-teal)",
          }}
        >
          {branch === "missing"
            ? "I'm not sure this one is ready."
            : "This looks complete."}
        </p>
      </div>
      <VoiceControls speech={speech} />
      {branch === "missing" ? (
        <div className="space-y-2">
          <BigButton
            variant="ghost"
            onClick={() => {
              speech.speak("Okay, I'll wait here. Fix it on your paper, then tap to scan again.");
              onFixSelf();
            }}
          >
            ✍️ I'll fix it myself
          </BigButton>
          <BigButton variant="danger" onClick={onSendToCenter}>
            🤝 I don't know — send to a person
          </BigButton>
        </div>
      ) : (
        <BigButton onClick={onSendToCenter}>What happens now?</BigButton>
      )}
    </div>
  );
}

function Screen5({
  branch,
  onGoCenter,
  speech,
}: {
  branch: Branch;
  onGoCenter: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
  const log =
    branch === "missing"
      ? [
          ["2:14", "Scanned FL-142"],
          ["2:14", "Read: name, assets, debts"],
          ["2:14", "Missing: signature, date"],
          ["2:14", "Flagged: human review"],
          ["2:15", "Sent to legal aid center"],
        ]
      : [
          ["2:14", "Scanned FL-142"],
          ["2:14", "Read: name, assets, debts"],
          ["2:14", "All required fields present"],
          ["2:14", "Flagged: human review"],
          ["2:15", "Sent to legal aid center"],
        ];
  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <MascotHeader speech={speech} small face={branch === "missing" ? "x" : "smile"} />
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
          <span
            className="font-extrabold"
            style={{ fontSize: 22, letterSpacing: 0.5 }}
          >
            MF-2048
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
          📨 Delivered — waiting for a staff member
        </div>
        <p
          className="mt-3 font-semibold"
          style={{ fontSize: 18, color: "var(--color-elder-ink)" }}
        >
          {branch === "missing"
            ? "I won't guess on something this important. A real person will check it for you."
            : "A person will confirm it before you file."}
        </p>
        <div className="mt-3">
          <p className="text-xs uppercase font-bold tracking-wide" style={{ color: "#6b5d52" }}>
            What I did
          </p>
          <ul className="mt-1 space-y-1">
            {log.map(([t, s]) => (
              <li key={t + s} className="flex gap-3 text-[15px]">
                <span style={{ color: "#6b5d52", minWidth: 40 }}>{t}</span>
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
      <VoiceControls speech={speech} />
      <BigButton onClick={onGoCenter}>See the center's side →</BigButton>
    </div>
  );
}

function Screen6() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center p-8"
      style={{ background: "#1a1a1a", color: "#fff" }}
    >
      <p
        className="font-bold animate-fade-up"
        style={{ fontSize: 28, color: "#cfd8e6" }}
      >
        Generic AI gives answers.
      </p>
      <p
        className="font-extrabold mt-4 animate-fade-up"
        style={{ fontSize: 36, color: "#fff", animationDelay: "0.4s" }}
      >
        My Friend gives{" "}
        <span style={{ color: "var(--color-elder-coral)" }}>accountable</span> help.
      </p>
      <p
        className="mt-10 max-w-[300px] animate-fade-up"
        style={{ fontSize: 15, color: "#9aa4b2", animationDelay: "1s" }}
      >
        Equality hands everyone the same form. Equity gives them the help they actually
        need to use it.
      </p>
    </div>
  );
}

// ===== Viewfinder =====

function Viewfinder({ variant }: { variant: "empty" | "blurry" | "clear" }) {
  return (
    <div
      className="relative my-3 rounded-2xl overflow-hidden flex items-center justify-center"
      style={{
        height: 260,
        background:
          "linear-gradient(160deg, #2a2a2a 0%, #3d3d3d 60%, #2a2a2a 100%)",
      }}
    >
      {/* dashed frame */}
      <div
        className="absolute"
        style={{
          inset: 22,
          border: "3px dashed rgba(255,255,255,0.85)",
          borderRadius: 14,
        }}
      />
      {/* big green checkmark fills screen when frame is aligned (clear) */}
      {variant === "clear" && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: "rgba(34,197,94,0.18)", zIndex: 10 }}
          aria-hidden
        >
          <span
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "#22c55e",
              color: "white",
              fontSize: 72,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 12px 40px rgba(34,197,94,0.35)",
            }}
          >
            ✓
          </span>
        </div>
      )}
      {variant !== "empty" && <DocPaper blurry={variant === "blurry"} />}
      {variant === "empty" && (
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14 }}>
          Camera preview
        </p>
      )}
    </div>
  );
}

function DocPaper({ blurry }: { blurry: boolean }) {
  return (
    <div
      className="relative"
      style={{
        width: "75%",
        height: "82%",
        background: "#fdfaf3",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        padding: "14px 16px",
        filter: blurry ? "blur(3.5px)" : "none",
        transition: "filter 0.4s",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "#241F1A",
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        FL-142 — SCHEDULE OF ASSETS AND DEBTS
      </div>
      {[
        "Petitioner: Rosa M. ____________",
        "Assets:",
        " • Bank account .............. $4,210",
        " • 2008 sedan ................ $3,500",
        " • Household items ........... $1,200",
        "Debts:",
        " • Credit card ............... $1,840",
        " • Medical .................... $620",
        "",
        "Signature: ____________________",
        "Date: ________________________",
      ].map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: 8.5,
            lineHeight: 1.45,
            color: "#3a322b",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          {line || "\u00A0"}
        </div>
      ))}
    </div>
  );
}
