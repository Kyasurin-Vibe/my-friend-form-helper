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

// Full dictionary for fixed UI strings in all 5 supported languages.
// Pre-translated so language switch is instant (no API roundtrip).
const DICT: Record<string, Partial<Record<Lang, string>>> = {
  // Legacy keys kept for back-compat
  "home.title":     { en: "My Friend", es: "Mi Amigo", zh: "我的朋友", vi: "Bạn Của Tôi", tl: "Aking Kaibigan" },
  "home.subtitle":  { en: "How can I help you today?", es: "¿Cómo puedo ayudarle hoy?", zh: "今天我能帮您什么?", vi: "Hôm nay tôi có thể giúp gì cho bạn?", tl: "Paano kita matutulungan ngayon?" },
  "home.see":       { en: "🔍 Help me see this", es: "🔍 Ayúdame a ver esto", zh: "🔍 帮我看清楚", vi: "🔍 Giúp tôi nhìn thấy cái này", tl: "🔍 Tulungan mo akong makita ito" },
  "home.see.sub":   { en: "Open the magnifier — just look, no upload.", es: "Abrir la lupa — solo mire, no se sube nada.", zh: "打开放大镜 — 只看,不上传。", vi: "Mở kính lúp — chỉ xem, không tải lên.", tl: "Buksan ang magnifier — tingnan lang, walang upload." },
  "home.scan":      { en: "❓ I have a question about a document", es: "❓ Tengo una pregunta sobre un documento", zh: "❓ 我对一份文件有疑问", vi: "❓ Tôi có câu hỏi về một tài liệu", tl: "❓ May tanong ako tungkol sa isang dokumento" },
  "home.scan.sub":  { en: "Scan it and I'll read it out and find help.", es: "Escanéelo y se lo leeré y buscaré ayuda.", zh: "扫描它,我会读给您听并找到帮助。", vi: "Quét nó và tôi sẽ đọc to và tìm trợ giúp.", tl: "I-scan ito at babasahin ko ito at maghahanap ng tulong." },
  "common.back":    { en: "← Go back", es: "← Volver", zh: "← 返回", vi: "← Quay lại", tl: "← Bumalik" },
  "common.done":    { en: "👋 No thanks — I'm done", es: "👋 No gracias — terminé", zh: "👋 不用了 — 我好了", vi: "👋 Không, cảm ơn — tôi xong rồi", tl: "👋 Hindi na — tapos na ako" },
  "common.holdStill": { en: "Hold still", es: "Quédese quieto", zh: "请保持不动", vi: "Giữ yên", tl: "Manatiling nakatigil" },
  "common.clearEnough": { en: "Is this clear enough?", es: "¿Está suficientemente claro?", zh: "这样够清楚吗?", vi: "Đã đủ rõ chưa?", tl: "Sapat na ba ang linaw nito?" },
  "common.connect": { en: "Connect me with a person", es: "Conécteme con una persona", zh: "帮我联系一个人", vi: "Kết nối tôi với một người", tl: "Ikonekta mo ako sa isang tao" },
  "lang.change":    { en: "🌐 Language", es: "🌐 Idioma", zh: "🌐 语言", vi: "🌐 Ngôn ngữ", tl: "🌐 Wika" },

  // ===== Canonical UI keys =====
  app_name:         { en: "My Friend", es: "Mi Amigo", zh: "我的朋友", vi: "Bạn Của Tôi", tl: "Aking Kaibigan" },
  home_question:    { en: "How can I help you?", es: "¿Cómo puedo ayudarle?", zh: "我能帮您什么?", vi: "Tôi có thể giúp gì cho bạn?", tl: "Paano kita matutulungan?" },
  choice_see:       { en: "🔍 Help me see this", es: "🔍 Ayúdame a ver esto", zh: "🔍 帮我看清楚", vi: "🔍 Giúp tôi nhìn thấy cái này", tl: "🔍 Tulungan mo akong makita ito" },
  choice_question:  { en: "❓ I have a question about a document", es: "❓ Tengo una pregunta sobre un documento", zh: "❓ 我对一份文件有疑问", vi: "❓ Tôi có câu hỏi về một tài liệu", tl: "❓ May tanong ako tungkol sa isang dokumento" },
  bigger:           { en: "Bigger", es: "Más grande", zh: "放大", vi: "Lớn hơn", tl: "Mas malaki" },
  smaller:          { en: "Smaller", es: "Más pequeño", zh: "缩小", vi: "Nhỏ hơn", tl: "Mas maliit" },
  brighter:         { en: "Brighter", es: "Más brillante", zh: "更亮", vi: "Sáng hơn", tl: "Mas maliwanag" },
  dimmer:           { en: "Dimmer", es: "Más tenue", zh: "更暗", vi: "Tối hơn", tl: "Mas malabo" },
  back_home:        { en: "Back to home", es: "Volver al inicio", zh: "返回主页", vi: "Về trang chủ", tl: "Bumalik sa home" },
  hold_still:       { en: "Hold still", es: "Quédese quieto", zh: "请保持不动", vi: "Giữ yên", tl: "Manatiling nakatigil" },
  capture_now:      { en: "Capture now", es: "Capturar ahora", zh: "现在拍照", vi: "Chụp ngay", tl: "Kunan ngayon" },
  clear_enough:     { en: "Is this clear enough?", es: "¿Está suficientemente claro?", zh: "这样够清楚吗?", vi: "Đã đủ rõ chưa?", tl: "Sapat na ba ang linaw nito?" },
  yes_use:          { en: "✅ Yes, use this", es: "✅ Sí, usar esto", zh: "✅ 是,就用这个", vi: "✅ Có, dùng cái này", tl: "✅ Oo, gamitin ito" },
  retake:           { en: "🔄 Retake", es: "🔄 Volver a tomar", zh: "🔄 重新拍摄", vi: "🔄 Chụp lại", tl: "🔄 Kunan muli" },
  read_again:       { en: "🔊 Read this again", es: "🔊 Léelo otra vez", zh: "🔊 再读一遍", vi: "🔊 Đọc lại lần nữa", tl: "🔊 Basahin muli ito" },
  hold_to_talk:     { en: "🎙 Hold to talk", es: "🎙 Mantenga para hablar", zh: "🎙 按住说话", vi: "🎙 Nhấn giữ để nói", tl: "🎙 Pindutin para magsalita" },
  help_available:   { en: "Here's help available for you", es: "Aquí hay ayuda disponible para usted", zh: "这里有可以帮您的资源", vi: "Đây là sự trợ giúp dành cho bạn", tl: "Narito ang tulong na makukuha mo" },
  connect_person:   { en: "🤝 Connect me with a person", es: "🤝 Conécteme con una persona", zh: "🤝 帮我联系一个人", vi: "🤝 Kết nối tôi với một người", tl: "🤝 Ikonekta mo ako sa isang tao" },
  no_thanks:        { en: "👋 No thanks — I'm done", es: "👋 No gracias — terminé", zh: "👋 不用了 — 我好了", vi: "👋 Không, cảm ơn — tôi xong rồi", tl: "👋 Hindi na — tapos na ako" },
  who_trust:        { en: "Who do you trust with this?", es: "¿En quién confía para esto?", zh: "您信任谁来处理这件事?", vi: "Bạn tin tưởng ai cho việc này?", tl: "Sino ang pinagkakatiwalaan mo dito?" },
  their_name:       { en: "Their name", es: "Su nombre", zh: "他的名字", vi: "Tên của họ", tl: "Pangalan nila" },
  how_know:         { en: "How do you know them?", es: "¿Cómo los conoce?", zh: "您怎么认识他们的?", vi: "Bạn biết họ như thế nào?", tl: "Paano mo sila kilala?" },
  send_person:      { en: "📨 Send to this person", es: "📨 Enviar a esta persona", zh: "📨 发送给这个人", vi: "📨 Gửi cho người này", tl: "📨 Ipadala sa taong ito" },
  back:             { en: "← Back", es: "← Atrás", zh: "← 返回", vi: "← Quay lại", tl: "← Bumalik" },
  listening:        { en: "● Listening", es: "● Escuchando", zh: "● 正在听", vi: "● Đang nghe", tl: "● Nakikinig" },
  voice_off:        { en: "🎙 Voice off", es: "🎙 Voz apagada", zh: "🎙 语音关闭", vi: "🎙 Tắt giọng nói", tl: "🎙 Boses naka-off" },
  voice_on:         { en: "🎙 Voice on", es: "🎙 Voz activada", zh: "🎙 语音开启", vi: "🎙 Bật giọng nói", tl: "🎙 Boses naka-on" },
  speaking:         { en: "🔊 Speaking…", es: "🔊 Hablando…", zh: "🔊 正在说…", vi: "🔊 Đang nói…", tl: "🔊 Nagsasalita…" },
  turn_on:          { en: "Turn on", es: "Encender", zh: "打开", vi: "Bật", tl: "I-on" },
  turn_off:         { en: "Turn off", es: "Apagar", zh: "关闭", vi: "Tắt", tl: "I-off" },
  say_again:        { en: "Say it again", es: "Dígalo de nuevo", zh: "再说一次", vi: "Nói lại lần nữa", tl: "Sabihin muli" },

  // Extra commonly-visible strings
  open_scanner:     { en: "🔍 Open Scanner", es: "🔍 Abrir escáner", zh: "🔍 打开扫描", vi: "🔍 Mở máy quét", tl: "🔍 Buksan ang Scanner" },
  question_friend:  { en: "Have a question, my friend?", es: "¿Tiene una pregunta, amigo?", zh: "有什么问题吗,我的朋友?", vi: "Bạn có câu hỏi không, người bạn của tôi?", tl: "May tanong ka ba, kaibigan?" },
  open_camera_hint: { en: "I will open your camera, so I can help you.", es: "Abriré su cámara para poder ayudarle.", zh: "我会打开您的相机来帮助您。", vi: "Tôi sẽ mở máy ảnh của bạn để có thể giúp bạn.", tl: "Bubuksan ko ang iyong camera para matulungan kita." },
  i_have_question:  { en: "I have a question", es: "Tengo una pregunta", zh: "我有问题", vi: "Tôi có câu hỏi", tl: "May tanong ako" },
  starting_camera:  { en: "Starting camera…", es: "Iniciando cámara…", zh: "正在启动相机…", vi: "Đang khởi động máy ảnh…", tl: "Nagsisimula ang camera…" },
  reading_doc:      { en: "Reading your document… one moment", es: "Leyendo su documento… un momento", zh: "正在读取您的文件…请稍候", vi: "Đang đọc tài liệu của bạn… một chút thôi", tl: "Binabasa ang iyong dokumento… sandali lang" },
  mic_blocked:      { en: "Mic is blocked — the buttons still work.", es: "El micrófono está bloqueado — los botones aún funcionan.", zh: "麦克风被阻止 — 按钮仍然可以使用。", vi: "Micrô bị chặn — các nút vẫn hoạt động.", tl: "Naka-block ang mic — gumagana pa rin ang mga button." },
  staff_dashboard:  { en: "Open staff dashboard →", es: "Abrir panel del personal →", zh: "打开员工面板 →", vi: "Mở bảng điều khiển nhân viên →", tl: "Buksan ang staff dashboard →" },
  sending:          { en: "Sending…", es: "Enviando…", zh: "正在发送…", vi: "Đang gửi…", tl: "Ipinapadala…" },
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

/** React hook: returns t(key) and re-renders when language or async cache updates. */
export function useT(key: string): string {
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    const offL = onLangChange(() => { if (alive) bump((n) => n + 1); });
    const offT = onTranslate(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; offL(); offT(); };
  }, []);
  return t(key);
}


