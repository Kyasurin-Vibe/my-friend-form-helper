import { useEffect, useRef, useState, useCallback } from "react";

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const enabledRef = useRef(true);
  const lastTextRef = useRef("");

  const cancel = useCallback(() => {
    if (typeof window === "undefined") return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    lastTextRef.current = text;
    setCaption(text);
    if (typeof window === "undefined") return;
    if (!enabledRef.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.05;
    u.volume = 1;
    const voices = synth.getVoices();
    const pref =
      voices.find((v) => /Samantha|Karen|Google US English|Jenny|Aria/i.test(v.name)) ||
      voices.find((v) => v.lang?.startsWith("en"));
    if (pref) u.voice = pref;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }, []);

  const repeat = useCallback(() => {
    if (lastTextRef.current) speak(lastTextRef.current);
  }, [speak]);

  const setEnabled = useCallback((v: boolean) => {
    enabledRef.current = v;
    if (!v) cancel();
  }, [cancel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Warm up voices list
    window.speechSynthesis?.getVoices();
    const onVoices = () => window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", onVoices);
    return () => {
      window.speechSynthesis?.removeEventListener?.("voiceschanged", onVoices);
      window.speechSynthesis?.cancel();
    };
  }, []);

  return { speak, repeat, cancel, speaking, caption, setEnabled };
}
