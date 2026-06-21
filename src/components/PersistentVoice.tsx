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
import { getBCP47 } from "@/lib/i18n";

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
  /** Universal "I'm done / no thank you" intent — warm exit to home. */
  onDone?: () => void;
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
  onDone,
  onCommand,
  screenId,
  actions,
  onAction,
}: PersistentVoiceProps) {
  const [userOn, setUserOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [blocked, setBlocked] = useState(false);

  const shouldRunRef = useRef(false);
  const speakingRef = useRef(false);
  const lastCmdAtRef = useRef(0);
  const speakableRef = useRef(speakable);
  const onCommandRef = useRef(onCommand);
  const onBackRef = useRef(onBack);
  const onDoneRef = useRef(onDone);
  const helpRef = useRef(helpHint);
  const screenRef = useRef(screenId);
  const actionsRef = useRef(actions);
  const onActionRef = useRef(onAction);
  const interpretingRef = useRef(false);

  useEffect(() => { speakableRef.current = speakable; }, [speakable]);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { helpRef.current = helpHint; }, [helpHint]);
  useEffect(() => { screenRef.current = screenId; }, [screenId]);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  useEffect(() => { onActionRef.current = onAction; }, [onAction]);

  // Voice is active on EVERY screen whenever the user keeps it on.
  // `paused` is accepted for compatibility but does not stop listening — the
  // big tap buttons still own each screen and voice runs alongside.
  void paused;
  const active = enabledFromMode && userOn;

  const cancelAllTTS = useCallback(() => {
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    cancelSpeech();
    if (typeof window !== "undefined") {
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
      try {
        const w = window as unknown as { __mfTtsAudio?: HTMLAudioElement };
        const a = w.__mfTtsAudio;
        if (a && !a.paused) { a.pause(); a.currentTime = 0; }
      } catch { /* noop */ }
    }
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const speakConfirm = useCallback((msg: string) => {
    setConfirmation(msg);
    speakingRef.current = true;
    setSpeaking(true);
    // Pause the mic while we talk so it doesn't hear our own voice.
    try { DemoServices.voice.stop(); } catch { /* noop */ }
    cancelSpeech();
    if (typeof window === "undefined") { speakingRef.current = false; setSpeaking(false); return; }
    const synth = window.speechSynthesis;
    if (!synth) { speakingRef.current = false; setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(msg);
    u.rate = 0.95; u.pitch = 1.05;
    try { u.lang = getBCP47(); } catch { /* noop */ }
    u.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
      // Resume listening the MOMENT TTS ends.
      if (shouldRunRef.current) window.setTimeout(() => { if (shouldRunRef.current) startLoop(); }, 150);
    };
    u.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
      if (shouldRunRef.current) window.setTimeout(() => { if (shouldRunRef.current) startLoop(); }, 150);
    };
    synth.speak(u);
    window.setTimeout(() => setConfirmation((c) => (c === msg ? "" : c)), 2400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTTSPlaying = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    try {
      if (window.speechSynthesis?.speaking) return true;
      const w = window as unknown as { __mfTtsAudio?: HTMLAudioElement };
      const a = w.__mfTtsAudio;
      if (a && !a.paused && !a.ended) return true;
    } catch { /* noop */ }
    return speakingRef.current;
  }, []);

  const handleTranscript = useCallback((raw: string) => {
    const t = (raw || "").toLowerCase().trim();
    if (!t) return;
    // Drop transcripts captured while our own TTS is talking — the mic was
    // hearing the app's voice, not the user.
    if (isTTSPlaying()) { setTranscript(""); return; }
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
    // Universal: done / no thank you / I'm okay → warm farewell to home
    if (
      /\b(no thank you|no thanks|no thank's|i'm done|im done|i am done|that's all|thats all|that is all|i'm okay|im okay|i'm ok|im ok|i am ok|go home|all done|we'?re done|done now|nothing else|no more|finish|finished|good bye|goodbye|bye)\b/.test(t)
    ) {
      if (onDoneRef.current) {
        lastCmdAtRef.current = now;
        speakConfirm("Alright, have a good day.");
        window.setTimeout(() => { onDoneRef.current?.(); }, 1200);
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

    // Per-screen fast local match
    const handled = onCommandRef.current?.(t, { confirm: speakConfirm });
    if (handled) { lastCmdAtRef.current = now; return; }

    // AI-interpreted fallback for natural phrasing.
    // Always include a "done" action so polite/indirect exits like "I think
    // I'm good now" still route to the warm farewell.
    const scr = screenRef.current;
    const baseActs = actionsRef.current ?? [];
    const dispatch = onActionRef.current;
    const acts: IntentAction[] = onDoneRef.current
      ? [
          ...baseActs,
          { id: "__done__", description: "The user politely wants to stop and exit — any 'no thank you', 'I'm okay', 'I'm done', 'that's all', 'go home' style phrasing" },
        ]
      : baseActs;
    if (!scr || acts.length === 0 || (!dispatch && !onDoneRef.current)) return;
    if (interpretingRef.current) return;
    interpretingRef.current = true;
    lastCmdAtRef.current = now;
    void interpretIntent(t, scr, acts)
      .then(({ action, confidence }) => {
        if (action === "__done__" && confidence >= 0.5 && onDoneRef.current) {
          speakConfirm("Alright, have a good day.");
          window.setTimeout(() => { onDoneRef.current?.(); }, 1200);
        } else if (action && action !== "none" && action !== "__done__" && confidence >= 0.5 && dispatch) {
          dispatch(action, { confirm: speakConfirm });
        } else {
          speakConfirm("Sorry, I didn't catch that — you can tap a button.");
        }
      })
      .finally(() => { interpretingRef.current = false; });
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
        onTranscript: (t) => {
          if (isTTSPlaying()) { setTranscript(""); return; }
          setTranscript(t);
        },
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

  // When our own TTS just finished, flush the recognition session — its
  // buffer is full of our own voice. Restart cleanly so the next user word
  // is the first thing it hears.
  useEffect(() => {
    if (!active) return;
    let wasPlaying = false;
    const iv = window.setInterval(() => {
      const playing = isTTSPlaying();
      if (wasPlaying && !playing && shouldRunRef.current) {
        try { DemoServices.voice.stop(); } catch { /* noop */ }
        setTranscript("");
        window.setTimeout(() => { if (shouldRunRef.current) startLoop(); }, 200);
      }
      wasPlaying = playing;
    }, 250);
    return () => window.clearInterval(iv);
  }, [active, startLoop, isTTSPlaying]);

  // Barge-in via TAP: any pointer interaction while the app is talking
  // cancels TTS immediately and resumes listening — never make the user wait.
  useEffect(() => {
    if (!active) return;
    const onPointer = () => {
      if (!speakingRef.current && !isTTSPlaying()) return;
      cancelAllTTS();
      setConfirmation("");
      if (shouldRunRef.current) window.setTimeout(() => { if (shouldRunRef.current) startLoop(); }, 120);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [active, cancelAllTTS, isTTSPlaying, startLoop]);

  // When voice is enabled and not running because mode says off, hide everything.
  if (!enabledFromMode) return null;

  const statusLabel = !userOn
    ? "🎙 Voice off"
    : speaking
      ? "🔊 Speaking…"
      : listening
        ? "🎙 Listening"
        : "🎙 Voice on";
  const dotColor = !userOn ? "#9ca3af" : speaking ? "#3b82f6" : listening ? "#22c55e" : "#f59e0b";
  const dotGlow = speaking
    ? "0 0 0 4px rgba(59,130,246,0.25)"
    : listening
      ? "0 0 0 4px rgba(34,197,94,0.25)"
      : "none";

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
            background: dotColor,
            boxShadow: dotGlow,
            transition: "all 150ms",
          }}
        />
        <span>{statusLabel}</span>
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
