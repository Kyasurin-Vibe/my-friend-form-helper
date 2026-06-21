// Mobile browsers (iOS Safari/Chrome) block audio until a user gesture.
// Call unlockAudio() inside a tap/click handler ONCE per session — it:
//   1. creates/resumes a shared AudioContext
//   2. plays a tiny silent buffer through it
//   3. speaks an empty SpeechSynthesisUtterance
// After this, later Deepgram <audio> playback and speechSynthesis.speak()
// will work reliably for the rest of the session.

let unlocked = false;
let sharedCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!sharedCtx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      sharedCtx = new Ctor();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

export function isAudioUnlocked() {
  return unlocked;
}

/**
 * MUST be called synchronously inside a user-gesture handler (tap/click).
 * Safe to call repeatedly — only does work the first time.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;

  // 1) AudioContext: create + resume + play a 1-frame silent buffer
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => { /* noop */ });
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      try { src.start(0); } catch { /* noop */ }
    }
  } catch { /* noop */ }

  // 2) speechSynthesis: speak an empty utterance to prime the queue
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch { /* noop */ }

  // 3) HTMLAudioElement: play a tiny silent data-uri to prime the element pool
  try {
    const a = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=",
    );
    a.volume = 0;
    void a.play().catch(() => { /* noop */ });
  } catch { /* noop */ }
}

export async function playBlobWithUnlockedAudio(blob: Blob): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) throw new Error("AudioContext not available");

  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  await new Promise<void>((resolve, reject) => {
    try {
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      src.start(0);
    } catch (error) {
      reject(error);
    }
  });
}
