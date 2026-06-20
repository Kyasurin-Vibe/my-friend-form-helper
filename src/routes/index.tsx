import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/Mascot";
import { useSpeech } from "@/lib/useSpeech";
import { addCase, buildCase, clearCases, type Branch } from "@/lib/handoff";

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

function ElderApp() {
  const [step, setStep] = useState<Step>(1);
  const [branch, setBranch] = useState<Branch>("missing");
  const [voiceOn, setVoiceOn] = useState(true);
  const [started, setStarted] = useState(false);
  const speech = useSpeech();
  const navigate = useNavigate();

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
          ? "I checked your form. I'm not sure this one is ready. There's no signature and no date."
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

  const start = () => {
    setStarted(true);
    speech.speak(
      "Hi, I'm My Friend. Put your paper in the box, and I'll take a look."
    );
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
        voiceOn={voiceOn}
        setVoiceOn={setVoiceOn}
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
          className="w-full h-full overflow-hidden relative flex flex-col"
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
  voiceOn,
  setVoiceOn,
  restart,
}: {
  step: Step;
  setStep: (s: Step) => void;
  branch: Branch;
  setBranch: (b: Branch) => void;
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
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
      {chip(voiceOn ? "🔊 Voice on" : "🔇 Voice off", voiceOn, () =>
        setVoiceOn(!voiceOn)
      )}
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

function StartGate({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <Mascot mode="idle" size={180} />
      <h1
        className="mt-4 font-extrabold"
        style={{ fontSize: 36, color: "var(--color-elder-ink)" }}
      >
        My Friend
      </h1>
      <p className="mt-1" style={{ fontSize: 18, color: "#6b5d52" }}>
        Gentle help with your paperwork.
      </p>
      <button
        onClick={onStart}
        className="mt-10 w-full font-extrabold transition active:scale-[0.99]"
        style={{
          background: "var(--color-elder-primary)",
          color: "#fff",
          borderRadius: 22,
          padding: "22px",
          fontSize: 22,
          minHeight: 72,
          boxShadow: "0 10px 24px rgba(47,111,176,0.28)",
        }}
      >
        👆 Tap to begin
      </button>
      <p className="mt-3 text-sm" style={{ color: "#6b5d52" }}>
        Sound will turn on.
      </p>
    </div>
  );
}

function ScreenRouter({
  step,
  setStep,
  branch,
  speech,
  onGoCenter,
}: {
  step: Step;
  setStep: (s: Step) => void;
  branch: Branch;
  speech: ReturnType<typeof useSpeech>;
  onGoCenter: () => void;
}) {
  const next = (n: Step) => setStep(n);
  switch (step) {
    case 1:
      return <Screen1 onNext={() => next(2)} speech={speech} />;
    case 2:
      return <Screen2 onNext={() => next(3)} speech={speech} />;
    case 3:
      return <Screen3 onNext={() => next(4)} speech={speech} />;
    case 4:
      return <Screen4 branch={branch} onNext={() => next(5)} speech={speech} />;
    case 5:
      return <Screen5 branch={branch} onGoCenter={onGoCenter} speech={speech} />;
    case 6:
      return <Screen6 />;
  }
}

// ===== Shared building blocks =====

function MascotHeader({
  speech,
  small,
}: {
  speech: ReturnType<typeof useSpeech>;
  small?: boolean;
}) {
  const mode = speech.speaking ? "speaking" : "idle";
  const size = small ? 96 : speech.speaking ? 220 : 130;
  return (
    <div className="flex flex-col items-center pt-5">
      <Mascot mode={mode} size={size} />
      {speech.speaking && speech.caption && (
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
  variant?: "primary" | "ghost";
}) {
  const primary = variant === "primary";
  return (
    <button
      onClick={onClick}
      className="w-full font-extrabold transition active:scale-[0.99]"
      style={{
        background: primary ? "var(--color-elder-primary)" : "#fff",
        color: primary ? "#fff" : "var(--color-elder-primary)",
        border: primary ? "none" : "2px solid var(--color-elder-sky)",
        borderRadius: 22,
        padding: "22px",
        fontSize: 22,
        minHeight: 72,
        boxShadow: primary ? "0 10px 24px rgba(47,111,176,0.28)" : "none",
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
      <BigButton onClick={onNext}>📷 Take the photo</BigButton>
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
  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} />
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
      <BigButton onClick={onNext}>Try again</BigButton>
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
  return (
    <div className="flex-1 flex flex-col p-6">
      <MascotHeader speech={speech} small />
      <Viewfinder variant="clear" />
      <p
        className="text-center font-bold mb-3"
        style={{ fontSize: 22, color: "var(--color-elder-ink)" }}
      >
        I can read this clearly.
      </p>
      <VoiceControls speech={speech} />
      <BigButton onClick={onNext}>Check my form</BigButton>
    </div>
  );
}

function Screen4({
  branch,
  onNext,
  speech,
}: {
  branch: Branch;
  onNext: () => void;
  speech: ReturnType<typeof useSpeech>;
}) {
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
      <MascotHeader speech={speech} small />
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
      <BigButton onClick={onNext}>What happens now?</BigButton>
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
      <MascotHeader speech={speech} small />
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
      {/* corner marks */}
      {[
        { top: 12, left: 12, borders: "border-t-4 border-l-4" },
        { top: 12, right: 12, borders: "border-t-4 border-r-4" },
        { bottom: 12, left: 12, borders: "border-b-4 border-l-4" },
        { bottom: 12, right: 12, borders: "border-b-4 border-r-4" },
      ].map((c, i) => (
        <span
          key={i}
          className={`absolute ${c.borders}`}
          style={{
            ...c,
            width: 22,
            height: 22,
            borderColor: "var(--color-elder-coral)",
            borderRadius: 4,
          }}
        />
      ))}
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
