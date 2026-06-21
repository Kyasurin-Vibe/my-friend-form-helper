// Insert a case row into public.cases, optionally upload the image to Storage.
// Generates a unique tracking ID. Never blocks on storage failure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CENTER_NAME = "Legal Aid Center";

type Analysis = {
  readable: boolean;
  documentType?: string;
  documentName?: string;
  confidence?: number;
  plainEnglishSummary?: string;
  possibleMissingFields?: string[];
  recommendedAction?: "retake" | "confirm_send" | "human_review";
  elderMessage?: string;
};

function genTrackingId() {
  // MF- + timestamp tail + random — collision-resistant across demo runs.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const { image, analysis, initials } = (await req.json()) as {
      image?: string;
      analysis: Analysis;
      initials?: string;
    };

    if (!analysis || typeof analysis !== "object") {
      return Response.json({ error: "analysis required" }, { status: 400, headers: CORS });
    }

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
    if ((analysis.possibleMissingFields?.length ?? 0) > 0) {
      audit.push({
        time: stamp(),
        text: `Visible missing-looking fields flagged: ${analysis.possibleMissingFields!.join("; ")}.`,
      });
    } else {
      audit.push({ time: stamp(), text: "No visible missing fields flagged." });
    }

    // Try storage upload — never block on failure.
    let imageUrl: string | null = null;
    if (image && typeof image === "string") {
      const parsed = parseDataUrl(image);
      if (parsed) {
        const path = `${trackingId}.${parsed.ext}`;
        const { error: upErr } = await supabase.storage
          .from("case-images")
          .upload(path, parsed.bytes, {
            contentType: `image/${parsed.ext === "jpg" ? "jpeg" : parsed.ext}`,
            upsert: true,
          });
        if (upErr) {
          console.warn("storage upload failed:", upErr.message);
          audit.push({ time: stamp(), text: `storage_failed: ${upErr.message}` });
        } else {
          const { data: signed } = await supabase.storage
            .from("case-images")
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          imageUrl = signed?.signedUrl ?? null;
          audit.push({ time: stamp(), text: "Image uploaded to secure storage." });
        }
      }
    }

    audit.push({
      time: stamp(),
      text:
        status === "sent_to_center"
          ? `Sent to ${CENTER_NAME} for confirmation.`
          : `Routed to ${CENTER_NAME} for human review.`,
    });

    const { error: insErr } = await supabase.from("cases").insert({
      tracking_id: trackingId,
      doc_type: analysis.documentType ?? "unknown",
      doc_name: analysis.documentName ?? "Unknown document",
      status,
      ai_summary: analysis.plainEnglishSummary ?? "",
      possible_missing_fields: analysis.possibleMissingFields ?? [],
      confidence: analysis.confidence ?? null,
      image_url: imageUrl,
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
        centerName: CENTER_NAME,
        elderMessage: `I sent this to the ${CENTER_NAME}. Your tracking number is ${trackingId}.`,
      },
      { headers: CORS },
    );
  } catch (e) {
    console.error("send-to-center fatal", e);
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
