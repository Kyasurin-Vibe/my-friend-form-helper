// Minimal i18n + language singleton. Used by STT/TTS, edge fns, and UI.
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

let _lang: Lang = (typeof localStorage !== "undefined" && (localStorage.getItem("mf_lang") as Lang)) || "en";
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
  if (!entry) return key;
  return entry[lang] ?? entry.en ?? key;
}
