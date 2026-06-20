import { createFileRoute, Link } from "@tanstack/react-router";
import { useCases, seedDemoCases, type HandoffCase } from "@/lib/handoff";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/center")({
  head: () => ({
    meta: [
      { title: "My Friend — Legal Aid Center · Review Queue" },
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
      {/* Header */}
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
              My Friend — Legal Aid Center
            </p>
            <p className="text-xs text-slate-500 leading-tight">
              Review Queue · staff view
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
        {/* Left rail */}
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
              No cases yet. Run the elder app demo to "Step 5" and tap{" "}
              <em>See the center's side →</em>.
            </div>
          ) : (
            <ul className="space-y-2">
              {cases.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className="w-full text-left rounded-lg p-3 border transition animate-slide-in-card"
                    style={{
                      background:
                        selectedId === c.id ? "#EFF6FF" : "#fff",
                      borderColor:
                        selectedId === c.id ? "#BFDBFE" : "#E2E8F0",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-sm">
                        {c.initials} — FL-142
                      </span>
                      <StatusBadge branch={c.branch} />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Tracking {c.tracking} · received {c.receivedAt}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Main */}
        <main className="flex-1 p-8">
          {selected ? (
            <CaseDetail c={selected} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function StatusBadge({ branch }: { branch: "missing" | "complete" }) {
  const isMissing = branch === "missing";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{
        background: isMissing ? "#FEF3E2" : "#E6F3EE",
        color: isMissing ? "#B07314" : "#1F7A63",
        border: `1px solid ${isMissing ? "#F5DDA8" : "#B7E0D0"}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: isMissing ? "#E2A23B" : "#3FA892",
        }}
      />
      {isMissing ? "Needs review" : "Pending confirmation"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-center">
      <div>
        <p className="text-slate-700 text-lg font-semibold">
          Select a case to review
        </p>
        <p className="text-slate-500 text-sm mt-1">
          Cases handed off from the elder app appear in the queue on the left.
        </p>
      </div>
    </div>
  );
}

function CaseDetail({ c }: { c: HandoffCase }) {
  return (
    <div className="max-w-4xl animate-slide-in-card">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {c.initials} — FL-142
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tracking {c.tracking} · received {c.receivedAt}
          </p>
        </div>
        <StatusBadge branch={c.branch} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Document">
          <KV k="Form" v={c.doc} />
          <KV k="Photo clarity" v={c.clarity} />
          <KV k="Urgency" v={c.urgency} />
        </Card>
        <Card title="What My Friend found">
          <KV k="Read" v={c.found.join(", ")} />
          <KV
            k={c.missing.length ? "Missing" : "Status"}
            v={
              c.missing.length
                ? c.missing.join(", ")
                : "All required fields present"
            }
            highlight={c.missing.length > 0 ? "amber" : "teal"}
          />
        </Card>
      </div>

      <Card title="Audit log" className="mt-4">
        <ul className="divide-y divide-slate-100">
          {c.auditLog.map((row, i) => (
            <li key={i} className="flex gap-4 py-2 text-sm">
              <span className="text-slate-500 font-mono w-12">{row.time}</span>
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
        <button className="px-4 py-2 rounded-md font-semibold text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
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

function KV({
  k,
  v,
  highlight,
}: {
  k: string;
  v: string;
  highlight?: "amber" | "teal";
}) {
  const color =
    highlight === "amber"
      ? "#B07314"
      : highlight === "teal"
      ? "#1F7A63"
      : "#0F172A";
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-right" style={{ color }}>
        {v}
      </span>
    </div>
  );
}
