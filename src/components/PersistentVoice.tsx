// PersistentVoice: always-on voice layer for every screen.
// - Continuous listening via the existing DemoServices.voice (Web Speech).
// - Shows a "🎙 Listening" indicator + live transcript caption + voice on/off toggle.
// - Surfaces universal commands (repeat / back / help) and forwards everything
//   else to the per-screen onCommand.
// - Buttons remain primary; voice is purely additive. If the mic is blocked,
//   a gentle note is shown and the screen still works via taps.

import { useCallback, useEffect, useRef, useState } from "react";
import { DemoServices } from "@/lib/services";
import { cancelSpeech } from "@/lib/voice";
import { speakWarm } from "@/lib/cases";
import { interpretIntent, type IntentAction } from "@/lib/intent";

export type PersistentVoiceProps = {
  /** Pause continuous listening (e.g. while another screen owns the mic). */
  paused?: boolean;
  /** Master enable from the user's a11y mode. */
  enabledFromMode: boolean;
  /** Text to re-read when the user says "say it again". */
  speakable: string;
  /** One-line spoken hint when the user says "help". */
  helpHint?: string;
  /** Universal "back" intent. */
  onBack?: () => void;
  /** Per-screen intent handler. Return true if you handled the transcript. */
  onCommand?: (transcript: string, helpers: { confirm: (msg: string) => void }) => boolean;
  /** Current screen id passed to the AI interpreter. */
  screenId?: string;
  /** Available semantic actions for this screen — for AI fallback. */
  actions?: IntentAction[];
  /** Dispatcher for an AI-resolved action id. */
  onAction?: (id: string, helpers: { confirm: (msg: string) => void }) => void;
};

export function PersistentVoice({
  paused,
  enabledFromMode,
  speakable,
  helpHint,
  onBack,
  onCommand,
}: PersistentVoiceProps) {
  const [userOn, setUserOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [blocked, setBlocked] = useState(false);

  const shouldRunRef = useRef(false);
  const speakingRef = useRef(false);
  const lastCmdAtRef = useRef(0);
  const speakableRef = useRef(speakable);
  const onCommandRef = useRef(onCommand);
  const onBackRef = useRef(onBack);
  const helpRef = useRef(helpHint);

  useEffect(() => { speakableRef.current = speakable; }, [speakable]);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  useEffect(() => { helpRef.current = helpHint; }, [helpHint]);

  const active = enabledFromMode && userOn && !paused;

  const speakConfirm = useCallback((msg: string) => {
    setConfirmation(msg);
    speakingRef.current = true;
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    cancelSpeech();
    if (typeof window === "undefined") { speakingRef.current = false; return; }
    const synth = window.speechSynthesis;
    if (!synth) { speakingRef.current = false; return; }
    const u = new SpeechSynthesisUtterance(msg);
    u.rate = 0.95; u.pitch = 1.05;
    u.onend = () => {
      speakingRef.current = false;
      if (shouldRunRef.current) startLoop();
    };
    u.onerror = () => { speakingRef.current = false; };
    synth.speak(u);
    // auto-clear caption after a moment
    window.setTimeout(() => setConfirmation((c) => (c === msg ? "" : c)), 2400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTranscript = useCallback((raw: string) => {
    const t = (raw || "").toLowerCase().trim();
    if (!t) return;
    const now = Date.now();
    if (now - lastCmdAtRef.current < 500) return;

    // Universal: repeat
    if (/\b(say it again|read it again|read again|repeat|again|what did you say)\b/.test(t)) {
      lastCmdAtRef.current = now;
      speakConfirm("Okay — again.");
      if (speakableRef.current) window.setTimeout(() => speakWarm(speakableRef.current), 700);
      return;
    }
    // Universal: back
    if (/\b(go back|back|return|exit|cancel|never mind|nevermind)\b/.test(t)) {
      if (onBackRef.current) {
        lastCmdAtRef.current = now;
        speakConfirm("Going back.");
        onBackRef.current();
        return;
      }
    }
    // Universal: help
    if (/\b(help|what do i do|what now|i'm stuck|im stuck|hint)\b/.test(t)) {
      lastCmdAtRef.current = now;
      const h = helpRef.current || "Tap any button you see, or say what you want.";
      speakConfirm(h);
      return;
    }

    // Per-screen
    const handled = onCommandRef.current?.(t, { confirm: speakConfirm });
    if (handled) lastCmdAtRef.current = now;
  }, [speakConfirm]);

  const startLoop = useCallback(() => {
    const svc = DemoServices.voice;
    if (!svc.available()) { setBlocked(true); return; }
    if (speakingRef.current) return;
    try {
      svc.start({
        onStart: () => setListening(true),
        onEnd: () => {
          setListening(false);
          if (shouldRunRef.current && !speakingRef.current) {
            window.setTimeout(() => { if (shouldRunRef.current) startLoop(); }, 250);
          }
        },
        onError: (e) => {
          if (/not-allowed|denied|blocked/i.test(e)) setBlocked(true);
        },
        onTranscript: (t) => setTranscript(t),
        onCommand: (_c, raw) => handleTranscript(raw),
      });
    } catch { /* noop */ }
  }, [handleTranscript]);

  useEffect(() => {
    if (!active) {
      shouldRunRef.current = false;
      try { DemoServices.voice.stop(); } catch { /* noop */ }
      setListening(false);
      return;
    }
    shouldRunRef.current = true;
    startLoop();
    return () => {
      shouldRunRef.current = false;
      try { DemoServices.voice.stop(); } catch { /* noop */ }
    };
  }, [active, startLoop]);

  // When voice is enabled and not running because mode says off, hide everything.
  if (!enabledFromMode) return null;

  return (
    <div
      className="absolute left-0 right-0 top-0 z-30 pointer-events-none px-3 pt-2"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
    >
      <div
        className="pointer-events-auto flex items-center gap-2 px-3 py-1 rounded-full"
        style={{
          background: "rgba(26,26,26,0.78)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: 999,
            background: listening ? "#22c55e" : userOn ? "#f59e0b" : "#9ca3af",
            boxShadow: listening ? "0 0 0 4px rgba(34,197,94,0.25)" : "none",
            transition: "all 150ms",
          }}
        />
        <span>
          {paused ? "🎙 Screen voice" : userOn ? (listening ? "🎙 Listening" : "🎙 Voice on") : "🎙 Voice off"}
        </span>
        <button
          type="button"
          onClick={() => setUserOn((v) => !v)}
          className="ml-1 px-2 py-0.5 rounded-full"
          style={{
            background: userOn ? "#fff" : "var(--color-elder-red)",
            color: userOn ? "#1a1a1a" : "#fff",
            fontWeight: 800,
            fontSize: 11,
          }}
          aria-pressed={userOn}
          aria-label="Toggle voice"
        >
          {userOn ? "Turn off" : "Turn on"}
        </button>
      </div>
      {blocked && active && (
        <div
          className="pointer-events-auto px-3 py-1 rounded-full"
          style={{
            background: "#FFF6E5",
            color: "#7a5a1c",
            fontSize: 12,
            fontWeight: 700,
            border: "1px solid #F5DDA8",
          }}
        >
          Mic is blocked — the buttons still work.
        </div>
      )}
      {(transcript || confirmation) && (
        <div
          className="pointer-events-auto px-3 py-1 rounded-2xl text-center"
          style={{
            background: "rgba(255,255,255,0.95)",
            color: "#1a1a1a",
            fontSize: 13,
            fontWeight: 600,
            maxWidth: "92%",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          {confirmation || `"${transcript}"`}
        </div>
      )}
    </div>
  );
}
