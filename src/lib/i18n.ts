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
  not_a_form:       { en: "This doesn't look like a form you need help with. If you'd still like a person to look at it, I can send it.", es: "Esto no parece un formulario con el que necesite ayuda. Si aun así quiere que una persona lo revise, puedo enviarlo.", zh: "这看起来不像是需要帮助的表格。如果您仍希望有人查看,我可以发送。", vi: "Đây có vẻ không phải là biểu mẫu bạn cần trợ giúp. Nếu bạn vẫn muốn có người xem qua, tôi có thể gửi đi.", tl: "Hindi ito mukhang form na kailangan mo ng tulong. Kung gusto mo pa ring may taong tumingin dito, maaari ko itong ipadala." },
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

  // Review / Sent / Retake / Choose screens
  couldnt_read:     { en: "I couldn't read it clearly.", es: "No pude leerlo con claridad.", zh: "我没能看清楚。", vi: "Tôi không đọc rõ được.", tl: "Hindi ko ito malinaw na nabasa." },
  rather_not_guess: { en: "I'd rather not guess. You can try again, or send it for a person to look at.", es: "Prefiero no adivinar. Puede intentarlo de nuevo o enviarlo a una persona.", zh: "我不想猜。您可以再试一次,或交给真人看。", vi: "Tôi không đoán mò. Bạn có thể thử lại, hoặc gửi cho một người xem.", tl: "Ayoko nang manghula. Pwede mong subukan ulit, o ipadala sa isang tao." },
  note_label:       { en: "Note", es: "Nota", zh: "注", vi: "Lưu ý", tl: "Tala" },
  more_light:       { en: "💡 More light", es: "💡 Más luz", zh: "💡 多些光线", vi: "💡 Cần thêm ánh sáng", tl: "💡 Mas maraming ilaw" },
  hold_still_emoji: { en: "✋ Hold still", es: "✋ Quédese quieto", zh: "✋ 请保持不动", vi: "✋ Giữ yên", tl: "✋ Huwag gumalaw" },
  corners_in_box:   { en: "🟦 Keep the corners in the box", es: "🟦 Mantenga las esquinas dentro del recuadro", zh: "🟦 让四角保持在框内", vi: "🟦 Giữ các góc trong khung", tl: "🟦 Panatilihin ang mga sulok sa loob ng kahon" },
  document_label:   { en: "Document", es: "Documento", zh: "文件", vi: "Tài liệu", tl: "Dokumento" },
  attention_spots:  { en: "I see some spots that may need attention:", es: "Veo algunos puntos que pueden necesitar atención:", zh: "我看到一些可能需要注意的地方:", vi: "Tôi thấy một vài chỗ có thể cần chú ý:", tl: "May ilang lugar akong nakita na maaaring kailangang bantayan:" },
  nothing_missing:  { en: "✓ Nothing obviously missing. A person will still confirm before anything is filed.", es: "✓ No falta nada obvio. Una persona lo confirmará antes de presentarlo.", zh: "✓ 没有明显缺失。提交前仍由真人确认。", vi: "✓ Không thiếu rõ ràng điều gì. Một người sẽ xác nhận trước khi nộp.", tl: "✓ Walang halatang kulang. May taong magkukumpirma bago isumite." },
  tracking_number:  { en: "Tracking number", es: "Número de seguimiento", zh: "追踪编号", vi: "Số theo dõi", tl: "Numero ng pagsubaybay" },
  delivered_to:     { en: "📨 Delivered to", es: "📨 Entregado a", zh: "📨 已发送至", vi: "📨 Đã gửi đến", tl: "📨 Naipadala sa" },
  what_i_did:       { en: "What I did", es: "Lo que hice", zh: "我做了什么", vi: "Tôi đã làm gì", tl: "Ang ginawa ko" },
  will_check:       { en: "I won't guess on something this important. A real person will check it for you.", es: "No voy a adivinar en algo tan importante. Una persona real lo revisará por usted.", zh: "这么重要的事我不会去猜。真人会替您查看。", vi: "Tôi sẽ không đoán mò chuyện quan trọng như vậy. Một người thật sẽ kiểm tra cho bạn.", tl: "Hindi ako manghuhula sa ganito kahalaga. May totoong tao ang magtitingin para sa iyo." },
  will_confirm:     { en: "A person will confirm it before anything is filed.", es: "Una persona lo confirmará antes de presentarlo.", zh: "提交前会由真人确认。", vi: "Một người sẽ xác nhận trước khi nộp.", tl: "May taong magkukumpirma bago isumite." },
  nothing_more:     { en: "You don't have to do anything else right now.", es: "No tiene que hacer nada más ahora.", zh: "您现在不需要再做什么。", vi: "Bạn không cần làm gì thêm lúc này.", tl: "Wala ka nang kailangang gawin ngayon." },
  start_over:       { en: "↻ Start over", es: "↻ Empezar de nuevo", zh: "↻ 重新开始", vi: "↻ Bắt đầu lại", tl: "↻ Magsimula muli" },
  see_center:       { en: "See the center's side →", es: "Ver el lado del centro →", zh: "查看中心端 →", vi: "Xem phía trung tâm →", tl: "Tingnan ang panig ng sentro →" },
  who_send:         { en: "Who should I send this to?", es: "¿A quién debo enviárselo?", zh: "我应该把这个发给谁?", vi: "Tôi nên gửi cái này cho ai?", tl: "Kanino ko ito dapat ipadala?" },
  pick_trust:       { en: "Pick the person YOU trust. You're in charge.", es: "Elija la persona en QUIEN confía. Usted manda.", zh: "选择您信任的人。您说了算。", vi: "Chọn người BẠN tin tưởng. Bạn quyết định.", tl: "Piliin ang taong PINAGKAKATIWALAAN mo. Ikaw ang masusunod." },
  recommended_inst: { en: "Recommended. An accountable institution.", es: "Recomendado. Una institución responsable.", zh: "推荐选项。负责任的机构。", vi: "Được khuyến nghị. Một tổ chức có trách nhiệm.", tl: "Inirerekomenda. Isang responsableng institusyon." },
  send_trusted:     { en: "👪 Send to my trusted person", es: "👪 Enviar a mi persona de confianza", zh: "👪 发给我信任的人", vi: "👪 Gửi cho người tôi tin tưởng", tl: "👪 Ipadala sa pinagkakatiwalaan ko" },
  trusted_hint:     { en: "Someone YOU pick — your own attorney or a family member you trust.", es: "Alguien que USTED elija — su propio abogado o un familiar de confianza.", zh: "由您来挑选 — 您的律师或您信任的家人。", vi: "Người BẠN chọn — luật sư của bạn hoặc người thân bạn tin.", tl: "Isang taong IKAW ang pumili — sarili mong abogado o pamilyang pinagkakatiwalaan." },
  mic_or_type:      { en: "Tap the microphone and say it, or type it.", es: "Toque el micrófono y dígalo, o escríbalo.", zh: "点击麦克风说出来,或者输入。", vi: "Nhấn micrô và nói, hoặc gõ vào.", tl: "Pindutin ang mikropono at sabihin, o i-type." },
  email_or_phone:   { en: "Their email or phone", es: "Su correo o teléfono", zh: "他们的邮箱或电话", vi: "Email hoặc điện thoại của họ", tl: "Email o telepono nila" },
  camera_only_device: { en: "The magnifier uses your camera only on this device.", es: "La lupa usa su cámara solo en este dispositivo.", zh: "放大镜只在本设备上使用相机。", vi: "Kính lúp chỉ dùng máy ảnh trên thiết bị này.", tl: "Ang magnifier ay gumagamit ng camera mo sa device na ito lamang." },

  // Greetings, magnifier intro, scan flow, voice feedback
  greeting_home:    { en: "Hi, I'm My Friend. How can I help?", es: "Hola, soy Mi Amigo. ¿Cómo puedo ayudar?", zh: "你好,我是你的朋友。需要帮什么?", vi: "Chào bạn, tôi là Người Bạn. Tôi giúp gì được?", tl: "Kumusta, ako si Kaibigan. Paano kita matutulungan?" },
  magnifier_intro:  { en: "I'll make things bigger and clearer. Say bigger, smaller, or brighter.", es: "Haré las cosas más grandes y claras. Diga más grande, más pequeño o más brillante.", zh: "我会帮你放大、变清楚。说「放大」「缩小」或「更亮」。", vi: "Tôi sẽ làm to và rõ hơn. Hãy nói lớn hơn, nhỏ hơn, hoặc sáng hơn.", tl: "Palalakihin at lilinawin ko. Sabihin mong palakihin, paliitin, o mas maliwanag." },
  fit_paper:        { en: "Fit your paper inside the frame", es: "Coloque su papel dentro del marco", zh: "把纸放进框里", vi: "Đặt giấy vào trong khung", tl: "Ilagay ang papel sa loob ng frame" },
  send_q:           { en: "Send this to a person?", es: "¿Enviar esto a una persona?", zh: "把这个发给一个人吗?", vi: "Gửi cái này cho một người nhé?", tl: "Ipadala ito sa isang tao?" },
  yes_send:         { en: "Yes, send it", es: "Sí, enviarlo", zh: "好,发送", vi: "Được, gửi đi", tl: "Oo, ipadala" },
  no_keep:          { en: "No, keep looking", es: "No, seguir mirando", zh: "先不,继续看", vi: "Không, xem tiếp", tl: "Hindi, magpatuloy" },
  good_day:         { en: "Alright, have a good day.", es: "Muy bien, que tenga buen día.", zh: "好的,祝你今天愉快。", vi: "Được rồi, chúc bạn một ngày tốt lành.", tl: "Sige, magandang araw sa iyo." },
  didnt_catch:      { en: "Sorry, I didn't catch that — you can tap a button.", es: "Perdón, no entendí — puede tocar un botón.", zh: "抱歉,我没听清——你可以点一个按钮。", vi: "Xin lỗi, tôi không nghe rõ — bạn có thể chạm vào nút.", tl: "Pasensya, hindi ko narinig — pwede kang pumindot ng button." },
  pause:            { en: "Pause", es: "Pausa", zh: "暂停", vi: "Tạm dừng", tl: "I-pause" },
  continue:         { en: "Continue", es: "Continuar", zh: "继续", vi: "Tiếp tục", tl: "Magpatuloy" },
  next:             { en: "Next", es: "Siguiente", zh: "下一句", vi: "Tiếp theo", tl: "Susunod" },

  scan_hint:        { en: 'Fit your paper inside the frame. Say "yes" or tap the red button when ready.', es: 'Coloque su papel dentro del marco. Diga "sí" o toque el botón rojo cuando esté listo.', zh: '把纸放进框里。准备好了就说「好」或点红色按钮。', vi: 'Đặt giấy vào khung. Khi sẵn sàng, nói "có" hoặc chạm nút đỏ.', tl: 'Ilagay ang papel sa frame. Sabihin mong "oo" o pindutin ang pulang button kapag handa na.' },
  photo_captured:   { en: "Photo captured on this device", es: "Foto capturada en este dispositivo", zh: "已在本设备拍下照片", vi: "Ảnh đã chụp trên thiết bị này", tl: "Nakuha ang larawan sa device na ito" },
  no_missing_short: { en: "No obvious missing fields", es: "Sin campos faltantes evidentes", zh: "没有明显缺失的字段", vi: "Không có trường nào thiếu rõ ràng", tl: "Walang halatang nawawalang field" },
  sent_to:          { en: "Sent to", es: "Enviado a", zh: "已发送至", vi: "Đã gửi đến", tl: "Naipadala kay" },
  identified_as:    { en: "Identified as", es: "Identificado como", zh: "识别为", vi: "Đã nhận dạng là", tl: "Natukoy bilang" },
  flagged_spots_one:{ en: "Flagged 1 spot for human review", es: "1 punto marcado para revisión humana", zh: "标记 1 处供人工审核", vi: "Đánh dấu 1 chỗ để người xem xét", tl: "Minarkahan ang 1 lugar para sa pagsusuri ng tao" },
  flagged_spots_n:  { en: "Flagged {n} spots for human review", es: "{n} puntos marcados para revisión humana", zh: "标记 {n} 处供人工审核", vi: "Đánh dấu {n} chỗ để người xem xét", tl: "Minarkahan ang {n} lugar para sa pagsusuri ng tao" },

  partner_social_worker:      { en: "Social Worker", es: "Trabajador Social", zh: "社工", vi: "Nhân viên xã hội", tl: "Social Worker" },
  partner_legal_aid:          { en: "Legal Aid Center", es: "Centro de Ayuda Legal", zh: "法律援助中心", vi: "Trung tâm Trợ giúp Pháp lý", tl: "Legal Aid Center" },
  partner_housing:            { en: "Housing Advocate", es: "Defensor de Vivienda", zh: "住房权益顾问", vi: "Người hỗ trợ nhà ở", tl: "Tagapagtaguyod sa Pabahay" },
  partner_health:             { en: "Community Health Worker", es: "Trabajador de Salud Comunitaria", zh: "社区健康工作者", vi: "Nhân viên y tế cộng đồng", tl: "Manggagawa sa Kalusugan ng Komunidad" },
  partner_immigration:        { en: "Immigration Legal Aid", es: "Ayuda Legal de Inmigración", zh: "移民法律援助", vi: "Trợ giúp Pháp lý Di trú", tl: "Legal na Tulong sa Imigrasyon" },
  partner_benefits:           { en: "Benefits Caseworker", es: "Trabajador de Beneficios", zh: "福利申办员", vi: "Nhân viên Phúc lợi", tl: "Caseworker ng Benepisyo" },

  partner_connect_social_worker: { en: "Connect me with a Social Worker", es: "Conécteme con un Trabajador Social", zh: "帮我联系一位社工", vi: "Kết nối tôi với một Nhân viên xã hội", tl: "Ikonekta mo ako sa isang Social Worker" },
  partner_connect_legal_aid:     { en: "Connect me with the Legal Aid Center", es: "Conécteme con el Centro de Ayuda Legal", zh: "帮我联系法律援助中心", vi: "Kết nối tôi với Trung tâm Trợ giúp Pháp lý", tl: "Ikonekta mo ako sa Legal Aid Center" },
  partner_connect_housing:       { en: "Connect me with a Housing Advocate", es: "Conécteme con un Defensor de Vivienda", zh: "帮我联系住房权益顾问", vi: "Kết nối tôi với Người hỗ trợ nhà ở", tl: "Ikonekta mo ako sa Tagapagtaguyod sa Pabahay" },
  partner_connect_health:        { en: "Connect me with a Community Health Worker", es: "Conécteme con un Trabajador de Salud Comunitaria", zh: "帮我联系社区健康工作者", vi: "Kết nối tôi với Nhân viên y tế cộng đồng", tl: "Ikonekta mo ako sa Manggagawa sa Kalusugan" },
  partner_connect_immigration:   { en: "Connect me with Immigration Legal Aid", es: "Conécteme con Ayuda Legal de Inmigración", zh: "帮我联系移民法律援助", vi: "Kết nối tôi với Trợ giúp Pháp lý Di trú", tl: "Ikonekta mo ako sa Legal na Tulong sa Imigrasyon" },
  partner_connect_benefits:      { en: "Connect me with a Benefits Caseworker", es: "Conécteme con un Trabajador de Beneficios", zh: "帮我联系福利申办员", vi: "Kết nối tôi với một Nhân viên Phúc lợi", tl: "Ikonekta mo ako sa Caseworker ng Benepisyo" },

  // LiveMagnifier scanner UI
  scanner_title:    { en: "📷 Scanner", es: "📷 Escáner", zh: "📷 扫描", vi: "📷 Máy quét", tl: "📷 Scanner" },
  mic_off_short:    { en: "🎙 off", es: "🎙 apagado", zh: "🎙 关", vi: "🎙 tắt", tl: "🎙 naka-off" },
  voice_label_on:   { en: "🎙 Voice ON", es: "🎙 Voz ACTIVADA", zh: "🎙 语音 开", vi: "🎙 Giọng nói BẬT", tl: "🎙 Boses NAKA-ON" },
  voice_label_off:  { en: "🎙 Voice OFF", es: "🎙 Voz APAGADA", zh: "🎙 语音 关", vi: "🎙 Giọng nói TẮT", tl: "🎙 Boses NAKA-OFF" },
  camera_unavailable:{ en: "I can't open the camera.", es: "No puedo abrir la cámara.", zh: "我打不开相机。", vi: "Tôi không mở được máy ảnh.", tl: "Hindi ko mabuksan ang camera." },
  allow_camera:     { en: "Please allow camera access in your browser.", es: "Permita el acceso a la cámara en su navegador.", zh: "请在浏览器中允许使用相机。", vi: "Vui lòng cho phép truy cập máy ảnh trong trình duyệt.", tl: "Pakipayagan ang access sa camera sa iyong browser." },
  enable_voice:     { en: "🎙 Tap to enable voice", es: "🎙 Toque para activar la voz", zh: "🎙 点击开启语音", vi: "🎙 Nhấn để bật giọng nói", tl: "🎙 Pindutin para i-on ang boses" },
  capture_now_btn:  { en: "📸 Capture now", es: "📸 Capturar ahora", zh: "📸 现在拍照", vi: "📸 Chụp ngay", tl: "📸 Kunan ngayon" },
  hint_too_dark:    { en: "💡 Too dark — move to better light", es: "💡 Demasiado oscuro — busque mejor luz", zh: "💡 太暗了 — 换到光线更好的地方", vi: "💡 Quá tối — di chuyển đến nơi sáng hơn", tl: "💡 Masyadong madilim — lumipat sa mas maliwanag" },
  hint_empty:       { en: "📄 Fit your paper inside the frame", es: "📄 Coloque su papel dentro del marco", zh: "📄 把纸放进框里", vi: "📄 Đặt giấy vào khung", tl: "📄 Ilagay ang papel sa frame" },
  hint_face:        { en: "🙂 That looks like a face, not a document", es: "🙂 Eso parece una cara, no un documento", zh: "🙂 那看起来像脸,不是文件", vi: "🙂 Cái đó trông giống khuôn mặt, không phải tài liệu", tl: "🙂 Mukhang mukha iyan, hindi dokumento" },
  hint_closer:      { en: "↕ Move a little closer", es: "↕ Acérquese un poco", zh: "↕ 再靠近一点", vi: "↕ Lại gần hơn một chút", tl: "↕ Lumapit nang kaunti" },
  hint_hold:        { en: "✋ Hold still", es: "✋ Quédese quieto", zh: "✋ 请保持不动", vi: "✋ Giữ yên", tl: "✋ Huwag gumalaw" },
  hint_checking:    { en: "🔍 Checking your document…", es: "🔍 Revisando su documento…", zh: "🔍 正在检查您的文件…", vi: "🔍 Đang kiểm tra tài liệu của bạn…", tl: "🔍 Sinusuri ang iyong dokumento…" },
  hint_unreadable:  { en: "🔎 Move closer and hold still", es: "🔎 Acérquese y quédese quieto", zh: "🔎 靠近一点并保持不动", vi: "🔎 Lại gần hơn và giữ yên", tl: "🔎 Lumapit at huwag gumalaw" },
  hint_say_yes:     { en: '📸 Say "yes" or tap Capture when ready', es: '📸 Diga "sí" o toque Capturar cuando esté listo', zh: '📸 准备好就说「好」或点拍照', vi: '📸 Khi sẵn sàng, nói "có" hoặc chạm Chụp', tl: '📸 Sabihin mong "oo" o pindutin ang Kunan kapag handa na' },

  home_btn:         { en: "🏠 Home", es: "🏠 Inicio", zh: "🏠 主页", vi: "🏠 Trang chủ", tl: "🏠 Home" },
};

export function t(key: string, lang: Lang = _lang): string {
  const entry = DICT[key];
  const english = entry?.en ?? key;
  if (lang === "en") return english;
  // Pure static lookup. If a translation is missing, fall back to English —
  // never call the AI/translate API at runtime for UI strings.
  return entry?.[lang] ?? english;
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


