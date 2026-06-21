import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCases, CENTER_NAME, type CaseRow } from "@/lib/cases";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/center")({
  head: () => ({
    meta: [
      { title: `My Friend — ${CENTER_NAME} · Review Queue` },
      {
        name: "description",
        content:
          "Staff dashboard for reviewing cases handed off by My Friend. Calm, professional, accountable.",
      },
    ],
  }),
  component: CenterDashboard,
});

function CenterDashboard() {
  const cases = useCases();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (cases.length && !selectedId) setSelectedId(cases[0].id);
  }, [cases, selectedId]);

  const selected = cases.find((c) => c.id === selectedId) || null;

  return (
    <div
      className="min-h-dvh w-full"
      style={{
        background: "var(--color-center-bg)",
        fontFamily: "var(--font-center)",
        color: "var(--color-center-slate)",
      }}
    >
      <header
        className="flex items-center justify-between px-6 py-3 bg-white"
        style={{ borderBottom: "1px solid #E2E8F0" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold"
            style={{ background: "var(--color-center-blue)" }}
          >
            MF
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">
              My Friend — {CENTER_NAME}
            </p>
            <p className="text-xs text-slate-500 leading-tight">
              Review Queue · staff view · live
            </p>
          </div>
        </div>
        <Link
          to="/"
          className="text-xs font-medium px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50"
        >
          ← Back to elder app
        </Link>
      </header>

      <div className="flex" style={{ minHeight: "calc(100dvh - 56px)" }}>
        <aside
          className="w-[320px] shrink-0 p-4"
          style={{ borderRight: "1px solid #E2E8F0", background: "#fff" }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Review Queue
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
              {cases.length}
            </span>
          </div>
          {cases.length === 0 ? (
            <div className="text-sm text-slate-500 leading-relaxed py-8 px-2 text-center border border-dashed border-slate-200 rounded-md">
              No cases yet. Capture a document in the elder app to see it appear here in real time.
            </div>
          ) : (
            <ul className="space-y-2">
              {cases.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className="w-full text-left rounded-lg p-3 border transition animate-slide-in-card"
                    style={{
                      background: selectedId === c.id ? "#EFF6FF" : "#fff",
                      borderColor: selectedId === c.id ? "#BFDBFE" : "#E2E8F0",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-sm">
                        {c.doc_type ?? "Document"}
                      </span>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Tracking {c.tracking_id} · {formatRelative(c.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="flex-1 p-8">
          {selected ? <CaseDetail c={selected} /> : <EmptyState />}
        </main>
      </div>
    </div>
  );
}

function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  const isReview = status === "needs_review";
  const isReviewed = status === "reviewed";
  const bg = isReviewed ? "#E6F3EE" : isReview ? "#FEF3E2" : "#E0F2FE";
  const fg = isReviewed ? "#1F7A63" : isReview ? "#B07314" : "#075985";
  const dot = isReviewed ? "#3FA892" : isReview ? "#E2A23B" : "#0284C7";
  const label = isReviewed
    ? "Reviewed"
    : isReview
      ? "Needs review"
      : "Sent — pending";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: bg, color: fg, border: `1px solid ${fg}33` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-center">
      <div>
        <p className="text-slate-700 text-lg font-semibold">Select a case to review</p>
        <p className="text-slate-500 text-sm mt-1">
          Cases sent from the elder app appear in the queue on the left, live.
        </p>
      </div>
    </div>
  );
}

function CaseDetail({ c }: { c: CaseRow }) {
  const missing = Array.isArray(c.possible_missing_fields) ? c.possible_missing_fields : [];
  const audit = Array.isArray(c.audit_trail) ? c.audit_trail : [];

  const markReviewed = async () => {
    await supabase.from("cases").update({ status: "reviewed" }).eq("id", c.id);
  };

  return (
    <div className="max-w-4xl animate-slide-in-card">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {c.doc_type ?? "Document"} — {c.doc_name ?? ""}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tracking {c.tracking_id} · {formatRelative(c.created_at)}
          </p>
        </div>
        <StatusBadge status={c.status} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Document">
          <KV k="Type" v={c.doc_type ?? "Unknown"} />
          <KV k="Name" v={c.doc_name ?? "—"} />
          <KV
            k="AI confidence"
            v={c.confidence != null ? `${Math.round(Number(c.confidence) * 100)}%` : "—"}
          />
        </Card>
        <Card title="AI summary">
          <p className="text-sm text-slate-700">{c.ai_summary || "—"}</p>
          <div className="mt-2">
            <p className="text-xs uppercase font-semibold text-slate-500 mb-1">
              {missing.length ? "Possible missing fields" : "Status"}
            </p>
            {missing.length ? (
              <ul className="text-sm space-y-0.5">
                {missing.map((m, i) => (
                  <li key={i} className="text-amber-700">• {m}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-teal-700">No visible missing fields</p>
            )}
          </div>
        </Card>
      </div>

      {c.image_url && (
        <Card title="Captured image" className="mt-4">
          <img
            src={c.image_url}
            alt="Submitted document"
            className="max-w-full max-h-[420px] rounded border border-slate-200"
          />
        </Card>
      )}

      <Card title="Audit log" className="mt-4">
        <ul className="divide-y divide-slate-100">
          {audit.map((row, i) => (
            <li key={i} className="flex gap-4 py-2 text-sm">
              <span className="text-slate-500 font-mono text-xs w-36 shrink-0">
                {new Date(row.time).toLocaleTimeString()}
              </span>
              <span className="text-slate-700">{row.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex gap-2 mt-6">
        <button
          className="px-4 py-2 rounded-md font-semibold text-white text-sm"
          style={{ background: "var(--color-center-blue)" }}
        >
          Open
        </button>
        <button className="px-4 py-2 rounded-md font-semibold text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
          Call client back
        </button>
        <button
          onClick={markReviewed}
          className="px-4 py-2 rounded-md font-semibold text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          Mark reviewed
        </button>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-white rounded-lg p-4 ${className}`}
      style={{ border: "1px solid #E2E8F0" }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-right text-slate-900">{v}</span>
    </div>
  );
}
