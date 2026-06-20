// Simple in-memory + localStorage pub-sub for the demo handoff.
import { useEffect, useState } from "react";

export type Branch = "missing" | "complete";

export type HandoffCase = {
  id: string;
  tracking: string;
  initials: string;
  doc: string;
  branch: Branch;
  found: string[];
  missing: string[];
  clarity: string;
  urgency: "Low" | "Medium" | "High";
  receivedAt: string;
  auditLog: { time: string; text: string }[];
  arrivedAt: number; // for animation timing
};

const KEY = "myfriend.cases.v1";
const listeners = new Set<() => void>();

function read(): HandoffCase[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function write(cases: HandoffCase[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(cases));
  listeners.forEach((l) => l());
}

export function addCase(c: HandoffCase) {
  const existing = read().filter((x) => x.id !== c.id);
  write([c, ...existing]);
}
export function clearCases() {
  write([]);
}

export function useCases(): HandoffCase[] {
  const [cases, setCases] = useState<HandoffCase[]>(() => read());
  useEffect(() => {
    const update = () => setCases(read());
    listeners.add(update);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) update();
    };
    window.addEventListener("storage", onStorage);
    update();
    return () => {
      listeners.delete(update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return cases;
}

export function buildCase(branch: Branch): HandoffCase {
  const now = new Date();
  const hh = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, "0");
  const t1 = `${((hh + 11) % 12) + 1}:${mm}`;
  const m2 = String((now.getMinutes() + 1) % 60).padStart(2, "0");
  const t2 = `${((hh + 11) % 12) + 1}:${m2}`;
  const missing = branch === "missing" ? ["Signature", "Date"] : [];
  return {
    id: `MF-2048`,
    tracking: "MF-2048",
    initials: "R. M.",
    doc: "FL-142 — Schedule of Assets and Debts",
    branch,
    found: ["Name", "Case number", "Assets", "Debts"],
    missing,
    clarity: "Good after retake",
    urgency: branch === "missing" ? "Medium" : "Low",
    receivedAt: `${t2} PM`,
    auditLog: [
      { time: t1, text: "Camera detected blurry document and asked user to retake." },
      { time: t1, text: "Clear image saved as fl142_rosa_m_2026-06-20.jpg." },
      { time: t1, text: "AI extracted document type: FL-142 Schedule of Assets and Debts." },
      {
        time: t2,
        text:
          branch === "missing"
            ? "Missing signature and date flagged for human review."
            : "AI checklist passed all required fields.",
      },
      {
        time: t2,
        text:
          branch === "missing"
            ? "Package uploaded to East Bay Justice Center review inbox."
            : "Package auto-uploaded to East Bay Justice Center FL-142 intake folder.",
      },
      { time: t2, text: "User notified: received, tracking ID MF-2048." },
    ],
    arrivedAt: Date.now(),
  };
}

// Seed extra demo cases so the reviewer queue feels alive (content only — no UI changes).
export function seedDemoCases() {
  const existing = read();
  if (existing.some((c) => c.id === "MF-2049" || c.id === "MF-2050")) return;
  const walter: HandoffCase = {
    id: "MF-2049",
    tracking: "MF-2049",
    initials: "W. B.",
    doc: "Debt collection letter",
    branch: "missing",
    found: ["Sender", "Amount", "Deadline"],
    missing: ["Client response"],
    clarity: "Good",
    urgency: "High",
    receivedAt: "Yesterday",
    auditLog: [
      { time: "9:14", text: "Clear image saved as debt_letter_walter_b.jpg." },
      { time: "9:14", text: "AI detected deadline in 7 days — flagged urgent." },
      { time: "9:15", text: "Staff callback requested." },
    ],
    arrivedAt: Date.now() - 86_400_000,
  };
  const lina: HandoffCase = {
    id: "MF-2050",
    tracking: "MF-2050",
    initials: "L. C.",
    doc: "FL-150 — Income and Expense Declaration",
    branch: "complete",
    found: ["Name", "Income", "Expenses", "Signature", "Date"],
    missing: [],
    clarity: "Good",
    urgency: "Low",
    receivedAt: "Yesterday",
    auditLog: [
      { time: "8:02", text: "Clear image saved as fl150_lina_c.jpg." },
      { time: "8:02", text: "AI checklist passed all required fields." },
      { time: "8:03", text: "Package uploaded to East Bay Justice Center intake folder." },
    ],
    arrivedAt: Date.now() - 90_000_000,
  };
  write([...existing, walter, lina]);
}
