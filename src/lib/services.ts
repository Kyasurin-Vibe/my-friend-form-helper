// Clean service abstractions for My Friend.
// Real APIs can be wired later (Deepgram for STT, Claude/OpenAI/Gemini for vision).
// For the hackathon, Demo / Web Speech fallbacks keep the flow working without keys.

// ============ Voice Recognition ============

export type VoiceCommand =
  | "yes"
  | "no"
  | "zoom"
  | "brighter"
  | "contrast"
  | "read"
  | "unknown";

export type VoiceCallbacks = {
  onCommand?: (cmd: VoiceCommand, transcript: string) => void;
  onTranscript?: (transcript: string) => void;
  onError?: (err: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

export interface VoiceRecognitionService {
  start(cb: VoiceCallbacks): void;
  stop(): void;
  available(): boolean;
  name: string;
}

export function classifyCommand(raw: string): VoiceCommand {
  const t = raw.toLowerCase().trim();
  if (!t) return "unknown";
  if (/\b(yes|yeah|yea|yep|yup|ya|uh huh|mhm|correct|right|that's it|sure|ok|okay|okey|alright|all right|fine|please|capture|snap|take it|take the picture|take the photo|do it|go|go ahead|ready|scan|now)\b/.test(t)) return "yes";
  if (/\b(no|nope|nah|wrong|not this|keep looking|wait|stop|cancel)\b/.test(t)) return "no";
  if (/\b(zoom|bigger|larger|closer|zoom in)\b/.test(t)) return "zoom";
  if (/\b(bright|brighter|lighter|light)\b/.test(t)) return "brighter";
  if (/\b(contrast|sharper|sharpen)\b/.test(t)) return "contrast";
  if (/\b(read|read this|read it|speak|say it)\b/.test(t)) return "read";
  return "unknown";
}

// Browser Web Speech API implementation.
export function createWebSpeechService(): VoiceRecognitionService {
  let rec: any = null;
  let running = false;

  const getCtor = () => {
    if (typeof window === "undefined") return null;
    const w = window as any;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  };

  return {
    name: "web-speech",
    available() {
      return !!getCtor();
    },
    start(cb) {
      const Ctor = getCtor();
      if (!Ctor) {
        cb.onError?.("Speech recognition not supported");
        return;
      }
      if (running) return;
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      // Use the active app language so the mic actually understands the user.
      try {
        // Lazy import to avoid SSR cycles.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getBCP47 } = require("@/lib/i18n") as typeof import("@/lib/i18n");
        rec.lang = getBCP47();
      } catch { rec.lang = "en-US"; }
      rec.onstart = () => {
        running = true;
        cb.onStart?.();
      };
      rec.onerror = (e: any) => cb.onError?.(e?.error || "recognition error");
      rec.onend = () => {
        running = false;
        cb.onEnd?.();
      };
      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const transcript = r[0]?.transcript ?? "";
          cb.onTranscript?.(transcript);
          if (r.isFinal) {
            const cmd = classifyCommand(transcript);
            cb.onCommand?.(cmd, transcript);
          }
        }
      };
      try {
        rec.start();
      } catch (err: any) {
        cb.onError?.(err?.message || "could not start");
      }
    },

    stop() {
      try {
        rec?.stop();
      } catch {}
      running = false;
    },
  };
}

// Deepgram placeholder. Wire up later via a server function that
// proxies a websocket / audio chunks; the shape stays the same.
export function createDeepgramService(_apiKey?: string): VoiceRecognitionService {
  return {
    name: "deepgram",
    available() {
      return false; // flip to true once a server proxy is implemented
    },
    start(cb) {
      cb.onError?.("Deepgram not configured yet — using browser fallback.");
    },
    stop() {},
  };
}

// Demo / mock — useful when neither Deepgram nor Web Speech is available.
export function createMockVoiceService(): VoiceRecognitionService {
  return {
    name: "mock",
    available() {
      return true;
    },
    start(cb) {
      cb.onStart?.();
      // Stay silent — UI still works via tap buttons.
    },
    stop() {},
  };
}

// Picks the best service in order of preference.
export function pickVoiceService(opts?: { deepgramKey?: string }): VoiceRecognitionService {
  const dg = createDeepgramService(opts?.deepgramKey);
  if (dg.available()) return dg;
  const ws = createWebSpeechService();
  if (ws.available()) return ws;
  return createMockVoiceService();
}

// ============ Vision Service ============

export type DetectedDoc = {
  code: string; // e.g. "FL-142"
  title: string;
  confidence: number; // 0..1
  fields: { name: string; present: boolean }[];
};

export interface VisionService {
  // Real impl accepts a data URL (jpeg/png) captured from the video frame.
  detect(frame?: string | Blob): Promise<DetectedDoc>;
  name: string;
}

export function createMockVisionService(): VisionService {
  return {
    name: "mock",
    async detect() {
      await new Promise((r) => setTimeout(r, 600));
      return {
        code: "FL-142",
        title: "Schedule of Assets and Debts",
        confidence: 0.86,
        fields: [
          { name: "Name", present: true },
          { name: "Case number", present: true },
          { name: "Assets", present: true },
          { name: "Debts", present: true },
          { name: "Signature", present: false },
          { name: "Date", present: false },
        ],
      };
    },
  };
}

// Vision now goes through the analyze-document edge function (Claude) only.
// This export is kept as a no-op shim for any legacy importer; it falls back
// to the mock so it can never silently call a non-existent Gemini path.
export function createLovableVisionService(): VisionService {
  return {
    name: "mock-shim",
    async detect() {
      return createMockVisionService().detect();
    },
  };
}


// ============ Upload Service ============

export type UploadResult = {
  trackingId: string;
  destination: string;
  uploadedAt: string;
  reviewRequired: boolean;
};

export interface UploadService {
  upload(opts: {
    file?: Blob;
    docCode: string;
    needsHumanReview: boolean;
  }): Promise<UploadResult>;
  name: string;
}

export function createMockUploadService(): UploadService {
  return {
    name: "mock",
    async upload({ needsHumanReview }) {
      await new Promise((r) => setTimeout(r, 400));
      return {
        trackingId: `MF-${2048 + Math.floor(Math.random() * 9)}`,
        destination: "East Bay Justice Center",
        uploadedAt: new Date().toISOString(),
        reviewRequired: needsHumanReview,
      };
    },
  };
}

// ============ Demo Mock Service ============
// Bundles defaults so the app always works offline.

export const DemoServices = {
  voice: pickVoiceService(),
  vision: createLovableVisionService(),
  upload: createMockUploadService(),
};

