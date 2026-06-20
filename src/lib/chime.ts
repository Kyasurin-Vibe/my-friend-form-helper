// Tiny Web Audio chime helpers — no assets needed.
let ctx: AudioContext | null = null;
function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.18) {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function playWarning() {
  // two descending "uh-oh" tones
  tone(660, 0, 0.22, 0.22);
  tone(440, 0.18, 0.32, 0.22);
  if ("vibrate" in navigator) navigator.vibrate([60, 40, 60]);
}

export function playSuccess() {
  tone(660, 0, 0.14, 0.18);
  tone(880, 0.1, 0.2, 0.18);
}
