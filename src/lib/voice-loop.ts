// Shared voice loop registry.
//
// Per-screen components call `useVoiceLoop({ screen, language, enabled,
// actions })` to declare their semantic actions. The global PersistentVoice
// already runs the STT loop and calls interpret-intent (Claude). When a
// registration is active, PersistentVoice uses these actions + screen id
// instead of the props the page route passes.
//
// This keeps screens free of any voice code of their own.

import { useEffect, useSyncExternalStore } from "react";

export type VoiceAction = () => void;

export type VoiceLoopRegistration = {
  screen: string;
  language: string;
  enabled: boolean;
  /** id -> handler. The id is also sent to Claude as the action id. */
  actions: Record<string, VoiceAction>;
  /** Optional human descriptions (id -> sentence) sent to Claude. */
  descriptions?: Record<string, string>;
};

// Built-in descriptions for the common ids the magnifier/scanner use.
// Anything not listed falls back to a generic description from the id.
const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  bigger: "Make things bigger / zoom in / closer / enlarge / magnify because the user can't see well",
  smaller: "Make things smaller / zoom out / further back",
  brighter: "Make the image brighter / lighter / add more light because it's too dark",
  dimmer: "Make the image dimmer / darker / less bright because it's too bright",
  scan: "Switch to the document scanner because the user has a paper / form / letter / document question",
  capture: "Take the picture now / capture / snap the photo (the user said yes / ready / now / go)",
  retake: "Retake / try again / new photo because the picture is bad",
  back: "Go back to the previous screen",
  home: "Go to the home / main menu screen",
};

function describe(id: string, override?: string): string {
  if (override) return override;
  return DEFAULT_DESCRIPTIONS[id] ?? `Do "${id}"`;
}

let current: VoiceLoopRegistration | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setVoiceLoop(reg: VoiceLoopRegistration | null) {
  current = reg;
  emit();
}

export function clearVoiceLoopIf(reg: VoiceLoopRegistration) {
  if (current === reg) {
    current = null;
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): VoiceLoopRegistration | null {
  return current;
}

/** PersistentVoice (or any other consumer) reads the active registration. */
export function useActiveVoiceLoop(): VoiceLoopRegistration | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Build the `actions` array shape that interpret-intent expects. */
export function actionDescriptors(reg: VoiceLoopRegistration): { id: string; description: string }[] {
  return Object.keys(reg.actions).map((id) => ({
    id,
    description: describe(id, reg.descriptions?.[id]),
  }));
}

/**
 * Declare the voice actions for the screen currently mounted.
 * STT + interpret-intent + TTS are handled by the global PersistentVoice —
 * the screen contributes only its action map.
 */
export function useVoiceLoop(opts: {
  screen: string;
  language: string;
  enabled?: boolean;
  actions: Record<string, VoiceAction>;
  descriptions?: Record<string, string>;
}): void {
  const { screen, language, enabled = true, actions, descriptions } = opts;
  // Re-register whenever the action map identity or language changes.
  useEffect(() => {
    const reg: VoiceLoopRegistration = { screen, language, enabled, actions, descriptions };
    setVoiceLoop(reg);
    return () => clearVoiceLoopIf(reg);
  }, [screen, language, enabled, actions, descriptions]);
}
