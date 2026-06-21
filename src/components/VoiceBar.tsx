// VoiceBar: persistent "Read again" + tap-to-talk mic for any screen.
// Cancels TTS the moment the user taps the mic or any action button.

import { useRef, useState } from "react";
import {
  cancelSpeech,
  classifyIntent,
  startRecording,
  transcribeAudio,
  type VoiceIntent,
} from "@/lib/voice";
import { speakWarm } from "@/lib/cases";

type Props = {
  speakableText: string;
  voiceOn: boolean;
  onIntent?: (intent: VoiceIntent) => void;
  /** when true, hide the mic (e.g. no decision on this screen) */
  hideMic?: boolean;
};

export function VoiceBar({ speakableText, voiceOn, onIntent, hideMic }: Props) {
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState<string>("");
  const stopRef = useRef<null | (() => Promise<Blob | null>)>(null);

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
          🔊 Read this again
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
            {working ? "…" : recording ? "● Listening" : "🎙 Hold to talk"}
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
