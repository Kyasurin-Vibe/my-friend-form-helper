// Lazy-load OpenCV.js + jscanify from CDN. Returns null if anything fails so
// the caller can fall back to the existing pipeline. ADDITIVE only.

type CvPoint = { x: number; y: number };
export type PaperCorners = {
  topLeftCorner: CvPoint;
  topRightCorner: CvPoint;
  bottomLeftCorner: CvPoint;
  bottomRightCorner: CvPoint;
};

type JscanifyInstance = {
  findPaperContour: (img: unknown) => unknown;
  getCornerPoints: (contour: unknown, img?: unknown) => PaperCorners;
  extractPaper: (
    source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
    width: number,
    height: number,
    cornerPoints?: PaperCorners,
  ) => HTMLCanvasElement;
};

declare global {
  interface Window {
    cv?: any;
    jscanify?: any;
    __mfJscanifyReady?: Promise<JscanifyInstance | null>;
  }
}

const OPENCV_URL = "https://docs.opencv.org/4.8.0/opencv.js";
const JSCANIFY_URL = "https://cdn.jsdelivr.net/npm/jscanify@1.2.0/src/jscanify.min.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-mf-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.mfSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script failed: " + src));
    document.head.appendChild(s);
  });
}

function waitForCv(timeoutMs = 12000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const cv = window.cv;
      if (cv && (cv.Mat || (cv.then && false))) {
        // 4.8.0 exposes cv.Mat synchronously once runtime is ready
        if (cv.Mat) return resolve(cv);
      }
      if (cv && typeof cv.onRuntimeInitialized === "function") {
        // already wired
      } else if (cv && !cv.Mat) {
        cv.onRuntimeInitialized = () => resolve(cv);
      }
      if (Date.now() - start > timeoutMs) return reject(new Error("opencv timeout"));
      setTimeout(check, 150);
    };
    check();
  });
}

export function loadJscanify(): Promise<JscanifyInstance | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.__mfJscanifyReady) return window.__mfJscanifyReady;
  window.__mfJscanifyReady = (async () => {
    try {
      await loadScript(OPENCV_URL);
      await waitForCv();
      await loadScript(JSCANIFY_URL);
      const Ctor = window.jscanify;
      if (!Ctor) return null;
      const inst: JscanifyInstance = new Ctor();
      return inst;
    } catch (e) {
      console.warn("jscanify load failed", e);
      return null;
    }
  })();
  return window.__mfJscanifyReady;
}

// Extract a deskewed paper crop from a video frame. Returns a JPEG data URL
// or null if anything fails (caller should fall back to raw frame).
export function extractPaperDataUrl(
  jscan: JscanifyInstance,
  video: HTMLVideoElement,
  maxWidth = 1280,
): string | null {
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const src = document.createElement("canvas");
    src.width = vw;
    src.height = vh;
    const sctx = src.getContext("2d");
    if (!sctx) return null;
    sctx.drawImage(video, 0, 0, vw, vh);

    const cv = window.cv;
    const mat = cv.imread(src);
    let corners: PaperCorners | null = null;
    try {
      const contour = jscan.findPaperContour(mat);
      if (contour) corners = jscan.getCornerPoints(contour, mat);
    } finally {
      mat.delete?.();
    }
    if (!corners) return null;

    // Output size: keep aspect of detected paper.
    const w = Math.hypot(
      corners.topRightCorner.x - corners.topLeftCorner.x,
      corners.topRightCorner.y - corners.topLeftCorner.y,
    );
    const h = Math.hypot(
      corners.bottomLeftCorner.x - corners.topLeftCorner.x,
      corners.bottomLeftCorner.y - corners.topLeftCorner.y,
    );
    const scale = Math.min(1, maxWidth / Math.max(w, 1));
    const outW = Math.max(200, Math.round(w * scale));
    const outH = Math.max(200, Math.round(h * scale));

    const out = jscan.extractPaper(src, outW, outH, corners);
    return out.toDataURL("image/jpeg", 0.9);
  } catch (e) {
    console.warn("extractPaper failed", e);
    return null;
  }
}

// Find paper corners in the current frame, normalized 0..1, for overlay.
export function findPaperCornersNormalized(
  jscan: JscanifyInstance,
  video: HTMLVideoElement,
): PaperCorners | null {
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const tmp = document.createElement("canvas");
    // Small for speed
    const targetW = 320;
    const scale = targetW / vw;
    tmp.width = targetW;
    tmp.height = Math.round(vh * scale);
    const tctx = tmp.getContext("2d");
    if (!tctx) return null;
    tctx.drawImage(video, 0, 0, tmp.width, tmp.height);
    const cv = window.cv;
    const mat = cv.imread(tmp);
    let corners: PaperCorners | null = null;
    try {
      const contour = jscan.findPaperContour(mat);
      if (contour) corners = jscan.getCornerPoints(contour, mat);
    } finally {
      mat.delete?.();
    }
    if (!corners) return null;
    const norm = (p: CvPoint): CvPoint => ({ x: p.x / tmp.width, y: p.y / tmp.height });
    return {
      topLeftCorner: norm(corners.topLeftCorner),
      topRightCorner: norm(corners.topRightCorner),
      bottomLeftCorner: norm(corners.bottomLeftCorner),
      bottomRightCorner: norm(corners.bottomRightCorner),
    };
  } catch {
    return null;
  }
}
