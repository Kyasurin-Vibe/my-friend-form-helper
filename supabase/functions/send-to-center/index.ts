// Insert a case row into public.cases. Uploads ORIGINAL (full frame) and
// PROCESSED (cropped) images separately for audit + dashboard preview.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_CENTER_NAME = "Legal Aid Center";

type Bounds = { x: number; y: number; width: number; height: number; confidence: number };
type Analysis = {
  readable: boolean;
  documentType?: string;
  documentName?: string;
  confidence?: number;
  plainEnglishSummary?: string;
  possibleMissingFields?: string[];
  recommendedAction?: "retake" | "confirm_send" | "human_review";
  elderMessage?: string;
  documentBounds?: Bounds | null;
  resourceCategory?: string;
};

function genTrackingId() {
  const t = Date.now().toString(36).slice(-4).toUpperCase();
  const r = Math.floor(Math.random() * 36 ** 3).toString(36).toUpperCase().padStart(3, "0");
  return `MF-${t}${r}`;
}

function parseDataUrl(dataUrl: string): { ext: string; bytes: Uint8Array } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ext, bytes };
}

async function uploadImage(
  supabase: ReturnType<typeof createClient>,
  trackingId: string,
  suffix: string,
  dataUrl: string,
): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const path = `${trackingId}-${suffix}.${parsed.ext}`;
  const { error: upErr } = await supabase.storage
    .from("case-images")
    .upload(path, parsed.bytes, {
      contentType: `image/${parsed.ext === "jpg" ? "jpeg" : parsed.ext}`,
      upsert: true,
    });
  if (upErr) {
    console.warn(`storage upload failed (${suffix}):`, upErr.message);
    return null;
  }
  const { data: signed } = await supabase.storage
    .from("case-images")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return signed?.signedUrl ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const body = (await req.json()) as {
      image?: string; // legacy fallback (single image)
      originalImage?: string;
      processedImage?: string;
      analysis: Analysis;
      initials?: string;
      recipient?:
        | { kind: "center"; partnerName?: string }
        | { kind: "trusted"; name?: string; relationship?: string };
    };
    const { analysis, initials } = body;
    const originalImage = body.originalImage ?? body.image;
    const processedImage = body.processedImage ?? body.image;

    if (!analysis || typeof analysis !== "object") {
      return Response.json({ error: "analysis required" }, { status: 400, headers: CORS });
    }

    // Resolve recipient — default to the institutional accountable partner for the doc category.
    const rawRecipient = body.recipient;
    let recipientKind: "center" | "trusted" = "center";
    let trustedName = "";
    let trustedRel = "";
    let centerName = DEFAULT_CENTER_NAME;
    if (rawRecipient && rawRecipient.kind === "trusted") {
      const n = String(rawRecipient.name ?? "").trim();
      const r = String(rawRecipient.relationship ?? "").trim();
      if (n && r) {
        recipientKind = "trusted";
        trustedName = n.slice(0, 80);
        trustedRel = r.slice(0, 80);
      }
    } else if (rawRecipient && rawRecipient.kind === "center") {
      const pn = String(rawRecipient.partnerName ?? "").trim();
      if (pn) centerName = pn.slice(0, 80);
    }
    const recipientLabel =
      recipientKind === "trusted"
        ? `trusted contact (${trustedName} — ${trustedRel})`
        : centerName;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const trackingId = genTrackingId();
    const status =
      analysis.recommendedAction === "confirm_send" ? "sent_to_center" : "needs_review";

    const audit: { time: string; text: string }[] = [];
    const stamp = () => new Date().toISOString();
    audit.push({ time: stamp(), text: "Image captured on elder device." });
    audit.push({
      time: stamp(),
      text: `Claude analyzed document — type: ${analysis.documentType ?? "unknown"}, confidence: ${(analysis.confidence ?? 0).toFixed(2)}.`,
    });
    const needCategory = (analysis.resourceCategory ?? "general").toString();
    audit.push({ time: stamp(), text: `Need identified: ${needCategory}.` });
    if (analysis.plainEnglishSummary) {
      audit.push({ time: stamp(), text: `Plain-English summary: ${analysis.plainEnglishSummary}` });
    }
    if (analysis.documentBounds) {
      const b = analysis.documentBounds;
      audit.push({
        time: stamp(),
        text: `Claude returned document bounds x=${b.x.toFixed(2)}, y=${b.y.toFixed(2)}, w=${b.width.toFixed(2)}, h=${b.height.toFixed(2)} (conf ${b.confidence.toFixed(2)}). Cropped with 3% padding.`,
      });
    } else {
      audit.push({ time: stamp(), text: "No clear document bounds — using full frame." });
    }
    if ((analysis.possibleMissingFields?.length ?? 0) > 0) {
      audit.push({
        time: stamp(),
        text: `Visible missing-looking fields flagged: ${analysis.possibleMissingFields!.join("; ")}.`,
      });
    } else {
      audit.push({ time: stamp(), text: "No visible missing fields flagged." });
    }

    let originalUrl: string | null = null;
    let processedUrl: string | null = null;
    if (originalImage) originalUrl = await uploadImage(supabase, trackingId, "original", originalImage);
    if (processedImage) processedUrl = await uploadImage(supabase, trackingId, "processed", processedImage);
    if (originalUrl) audit.push({ time: stamp(), text: "Original image uploaded to secure storage." });
    if (processedUrl) audit.push({ time: stamp(), text: "Cropped image uploaded to secure storage." });

    audit.push({
      time: stamp(),
      text:
        recipientKind === "trusted"
          ? `Elder chose to send to a trusted contact they picked themselves: ${trustedName} (${trustedRel}). NOT auto-filled.`
          : `Elder chose to send to ${centerName} (default, institutional accountable partner for need: ${needCategory}).`,
    });
    audit.push({
      time: stamp(),
      text: `Sent to: ${recipientLabel}.`,
    });

    const { error: insErr } = await supabase.from("cases").insert({
      tracking_id: trackingId,
      doc_type: analysis.documentType ?? "unknown",
      doc_name: analysis.documentName ?? "Unknown document",
      status,
      ai_summary: analysis.plainEnglishSummary ?? "",
      possible_missing_fields: analysis.possibleMissingFields ?? [],
      confidence: analysis.confidence ?? null,
      image_url: processedUrl ?? originalUrl, // legacy field — points to cropped preview
      original_image_url: originalUrl,
      processed_image_url: processedUrl,
      document_bounds: analysis.documentBounds ?? null,
      initials: initials ?? null,
      audit_trail: audit,
    });

    if (insErr) {
      console.error("insert cases failed", insErr);
      return Response.json({ error: insErr.message }, { status: 500, headers: CORS });
    }

    return Response.json(
      {
        trackingId,
        status,
        centerName: recipientLabel,
        elderMessage:
          recipientKind === "trusted"
            ? `I sent this to ${trustedName} (${trustedRel}). Your tracking number is ${trackingId}.`
            : `I sent this to the ${centerName}. Your tracking number is ${trackingId}.`,
      },
      { headers: CORS },
    );

  } catch (e) {
    console.error("send-to-center fatal", e);
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
