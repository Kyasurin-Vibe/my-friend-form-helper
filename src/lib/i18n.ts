// Minimal i18n + language singleton. Used by STT/TTS, edge fns, and UI.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
export type Lang = "en" | "es" | "zh" | "vi" | "tl";

export const LANG_LABELS: Record<Lang, { native: string; question: string }> = {
  en: { native: "English", question: "What language do you speak?" },
  es: { native: "Español", question: "¿Qué idioma habla?" },
  zh: { native: "中文", question: "您说什么语言?" },
  vi: { native: "Tiếng Việt", question: "Bạn nói ngôn ngữ nào?" },
  tl: { native: "Tagalog", question: "Anong wika ang gusto mo?" },
};

const BCP: Record<Lang, string> = {
  en: "en-US",
  es: "es-ES",
  zh: "zh-CN",
  vi: "vi-VN",
  tl: "fil-PH",
};

const TTS_VOICE: Record<Lang, string> = {
  en: "aura-asteria-en",
  es: "aura-asteria-en", // Aura v1 is English-only; non-en falls back to browser TTS.
  zh: "aura-asteria-en",
  vi: "aura-asteria-en",
  tl: "aura-asteria-en",
};

// Always default to English on load. The user must explicitly pick a
// language on the first screen; we never restore a previously stored
// language on reload (avoids half-applied UI/voice state).
let _lang: Lang = "en";
try { if (typeof localStorage !== "undefined") localStorage.removeItem("mf_lang"); } catch { /* noop */ }
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang { return _lang; }
export function setLang(l: Lang) {
  _lang = l;
  try { localStorage.setItem("mf_lang", l); } catch { /* noop */ }
  listeners.forEach((fn) => fn(l));
}
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getBCP47(l: Lang = _lang): string { return BCP[l] || "en-US"; }
export function getTTSVoice(l: Lang = _lang): string { return TTS_VOICE[l] || "aura-asteria-en"; }
// Aura v1 currently only supports English well; for other langs let the
// browser handle TTS in the matching language voice.
export function ttsSupportsDeepgram(l: Lang = _lang): boolean { return l === "en"; }

// Tiny dictionary. en/es/zh translated; vi/tl fall back to English text but
// VOICE still uses their language (BCP-47 above).
const DICT: Record<string, Partial<Record<Lang, string>>> = {
  "home.title":     { en: "My Friend",        es: "Mi Amigo",          zh: "我的朋友" },
  "home.subtitle":  { en: "How can I help you today?", es: "¿Cómo puedo ayudarle hoy?", zh: "今天我能帮您什么?" },
  "home.see":       { en: "🔍 Help me see this", es: "🔍 Ayúdame a ver esto", zh: "🔍 帮我看清楚" },
  "home.see.sub":   { en: "Open the magnifier — just look, no upload.", es: "Abrir la lupa — solo mire, no se sube nada.", zh: "打开放大镜 — 只看,不上传。" },
  "home.scan":      { en: "❓ I have a question about a document", es: "❓ Tengo una pregunta sobre un documento", zh: "❓ 我对一份文件有疑问" },
  "home.scan.sub":  { en: "Scan it and I'll read it out and find help.", es: "Escanéelo y se lo leeré y buscaré ayuda.", zh: "扫描它,我会读给您听并找到帮助。" },
  "common.back":    { en: "← Go back", es: "← Volver", zh: "← 返回" },
  "common.done":    { en: "👋 No thanks — I'm done", es: "👋 No gracias — terminé", zh: "👋 不用了 — 我好了" },
  "common.holdStill": { en: "Hold still", es: "Quédese quieto", zh: "请保持不动" },
  "common.clearEnough": { en: "Is this clear enough?", es: "¿Está suficientemente claro?", zh: "这样够清楚吗?" },
  "common.connect": { en: "Connect me with a person", es: "Conécteme con una persona", zh: "帮我联系一个人" },
  "lang.change":    { en: "🌐 Language", es: "🌐 Idioma", zh: "🌐 语言", vi: "🌐 Ngôn ngữ", tl: "🌐 Wika" },
};

export function t(key: string, lang: Lang = _lang): string {
  const entry = DICT[key];
  const english = entry?.en ?? key;
  if (lang === "en") return english;
  // Prefer a hand-authored translation in the dictionary.
  const dict = entry?.[lang];
  if (dict) return dict;
  // Fall back to the translate cache; kick off a one-time async fetch
  // if missing. Listeners re-render when the translation arrives.
  const cached = cache.get(cacheKey(english, lang));
  if (cached) return cached;
  if (english) {
    // Fire and forget — translateAsync handles dedup + cache + notify.
    void translateAsync(english, lang);
  }
  return english;
}

export function onTranslate(fn: () => void): () => void {
  translateListeners.add(fn);
  return () => { translateListeners.delete(fn); };
}

// =====================================================================
// Free-form translation with cache. Used for fixed app strings so that
// EVERY spoken line and visible label appears in the chosen language.
// Cache key: `${lang}:${text}`. Persisted to localStorage to avoid repeat
// Claude calls across reloads.
// =====================================================================
const CACHE_KEY = "mf_translate_cache_v1";
const cache: Map<string, string> = (() => {
  try {
    if (typeof localStorage === "undefined") return new Map();
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch { return new Map(); }
})();
const inflight = new Map<string, Promise<string>>();
const translateListeners = new Set<() => void>();

function persistCache() {
  try {
    if (typeof localStorage === "undefined") return;
    const obj: Record<string, string> = {};
    cache.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch { /* noop */ }
}

function cacheKey(text: string, lang: Lang) { return `${lang}:${text}`; }

// AI content sentinel. AI-generated content (elderMessage, summaries,
// resource lines) is ALREADY in the selected language — wrap such segments
// with aiText() when embedding them inside otherwise-English UI copy.
// speakWarm will skip translation for these segments.
export const AI_OPEN = "\u0001AI\u0001";
export const AI_CLOSE = "\u0001/AI\u0001";
export function aiText(s: string | null | undefined): string {
  if (!s) return "";
  return `${AI_OPEN}${s}${AI_CLOSE}`;
}
export function stripAiMarkers(s: string): string {
  if (!s) return s;
  return s.split(AI_OPEN).join("").split(AI_CLOSE).join("");
}
export function splitAiSegments(s: string): { ai: boolean; text: string }[] {
  if (!s) return [];
  const out: { ai: boolean; text: string }[] = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf(AI_OPEN, i);
    if (open === -1) { if (i < s.length) out.push({ ai: false, text: s.slice(i) }); break; }
    if (open > i) out.push({ ai: false, text: s.slice(i, open) });
    const close = s.indexOf(AI_CLOSE, open + AI_OPEN.length);
    if (close === -1) { out.push({ ai: true, text: s.slice(open + AI_OPEN.length) }); break; }
    out.push({ ai: true, text: s.slice(open + AI_OPEN.length, close) });
    i = close + AI_CLOSE.length;
  }
  return out;
}

/** Synchronous lookup — returns cached translation or original text. */
export function translateSync(text: string, lang: Lang = _lang): string {
  if (!text || lang === "en") return text;
  return cache.get(cacheKey(text, lang)) ?? text;
}

/** Async — returns translated text. Caches forever. Falls back to original on error. */
export async function translateAsync(text: string, lang: Lang = _lang): Promise<string> {
  if (!text || lang === "en") return text;
  const k = cacheKey(text, lang);
  const hit = cache.get(k);
  if (hit) return hit;
  const existing = inflight.get(k);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("translate", {
        body: { text, language: lang },
      });
      const out = (data && typeof (data as { text?: string }).text === "string")
        ? (data as { text: string }).text
        : text;
      if (!error && out && out !== text) {
        cache.set(k, out);
        persistCache();
        translateListeners.forEach((fn) => fn());
      }
      return out || text;
    } catch {
      return text;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/** React hook: returns translated text. Triggers async fetch if not cached. */
export function useTranslated(text: string): string {
  const [, bump] = useState(0);
  const lang = _lang;
  useEffect(() => {
    let alive = true;
    const offLang = onLangChange(() => { if (alive) bump((n) => n + 1); });
    const onCache = () => { if (alive) bump((n) => n + 1); };
    translateListeners.add(onCache);
    if (text && lang !== "en" && !cache.has(cacheKey(text, lang))) {
      translateAsync(text, lang).then(() => { /* listener will bump */ });
    }
    return () => { alive = false; offLang(); translateListeners.delete(onCache); };
  }, [text, lang]);
  return translateSync(text, lang);
}

