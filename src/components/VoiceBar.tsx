// VoiceBar: persistent "Read again" + tap-to-talk mic for any screen.
// Cancels TTS the moment the user taps the mic or any action button.
// When `actions` is provided, the spoken phrase is sent to an AI interpreter
// that picks the matching on-screen button. Falls back to the simple intent
// classifier for screens that only need confirm/cancel/repeat.

import { useRef, useState } from "react";
import {
  cancelSpeech,
  classifyIntent,
  interpretCommand,
  startRecording,
  transcribeAudio,
  type VoiceAction,
  type VoiceIntent,
} from "@/lib/voice";
import { speakWarm } from "@/lib/cases";
import { useT } from "@/lib/i18n";

type Props = {
  speakableText: string;
  voiceOn: boolean;
  /** Legacy: confirm/cancel/repeat mapping for simple screens. */
  onIntent?: (intent: VoiceIntent) => void;
  /** Preferred: real buttons on this screen + a handler that runs one of them. */
  actions?: VoiceAction[];
  onAction?: (actionId: string) => void;
  /** when true, hide the mic (e.g. no decision on this screen) */
  hideMic?: boolean;
};

export function VoiceBar({
  speakableText,
  voiceOn,
  onIntent,
  actions,
  onAction,
  hideMic,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState<string>("");
  const stopRef = useRef<null | (() => Promise<Blob | null>)>(null);
  const lblReadAgain = useT("read_again");
  const lblHoldToTalk = useT("hold_to_talk");
  const lblListening = useT("listening");

  const reSpeak = () => {
    cancelSpeech();
    if (voiceOn && speakableText) speakWarm(speakableText);
  };

  const startMic = async () => {
    if (recording || working) return;
    cancelSpeech();
    setHint("");
    try {
      const ctrl = await startRecording(4000);
      stopRef.current = ctrl.stop;
      setRecording(true);
    } catch {
      setHint("I can't hear the microphone — please use the buttons.");
      if (voiceOn) speakWarm("I can't hear the microphone — please use the buttons.");
    }
  };

  const stopMic = async () => {
    if (!stopRef.current) return;
    setRecording(false);
    setWorking(true);
    try {
      const blob = await stopRef.current();
      stopRef.current = null;
      if (!blob) {
        setHint("I didn't catch that — you can tap the button.");
        if (voiceOn) speakWarm("I didn't catch that — you can tap the button.");
        return;
      }
      const transcript = await transcribeAudio(blob);

      // Preferred path: real on-screen buttons interpreted by AI.
      if (actions && actions.length && onAction) {
        if (!transcript) {
          setHint("I didn't catch that — you can tap the button.");
          if (voiceOn) speakWarm("I didn't catch that — you can tap the button.");
          return;
        }
        const result = await interpretCommand(transcript, actions);
        if (result.actionId === "repeat") {
          reSpeak();
          return;
        }
        if (result.actionId && result.actionId !== "none") {
          const picked = actions.find((a) => a.id === result.actionId);
          setHint(picked ? `I heard "${transcript}" — ${picked.label}.` : "");
          onAction(result.actionId);
          return;
        }
        setHint(`I heard "${transcript}" — you can tap the button you want.`);
        if (voiceOn) speakWarm("I didn't catch which one you meant — you can tap the button.");
        return;
      }

      // Legacy intent fallback.
      const intent = classifyIntent(transcript);
      if (intent === "repeat") {
        reSpeak();
      } else if (intent === "unknown") {
        setHint(
          transcript
            ? `I heard "${transcript}" — you can tap the button.`
            : "I didn't catch that — you can tap the button.",
        );
        if (voiceOn) speakWarm("I didn't catch that — you can tap the button.");
      } else {
        onIntent?.(intent);
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="px-1 pt-2 pb-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reSpeak}
          className="flex-1 font-bold active:scale-[0.97]"
          style={{
            background: "#fff",
            color: "var(--color-elder-primary)",
            border: "2px solid var(--color-elder-sky)",
            borderRadius: 16,
            padding: "12px 14px",
            fontSize: 16,
            minHeight: 52,
          }}
        >
          {lblReadAgain}
        </button>
        {!hideMic && (
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); startMic(); }}
            onPointerUp={(e) => { e.preventDefault(); stopMic(); }}
            onPointerLeave={() => { if (recording) stopMic(); }}
            onClick={(e) => e.preventDefault()}
            className="font-bold active:scale-[0.97]"
            style={{
              background: recording ? "var(--color-elder-red)" : "#fff",
              color: recording ? "#fff" : "var(--color-elder-ink)",
              border: `2px solid ${recording ? "var(--color-elder-red)" : "#e7ddd0"}`,
              borderRadius: 16,
              padding: "12px 16px",
              fontSize: 16,
              minHeight: 52,
              minWidth: 96,
            }}
            aria-label="Hold to talk"
          >
            {working ? "…" : recording ? lblListening : lblHoldToTalk}
          </button>
        )}
      </div>
      {hint && (
        <p
          className="text-center mt-2"
          style={{ fontSize: 13, color: "#8a7d6f", fontStyle: "italic" }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
