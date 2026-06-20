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
    found: ["Name", "Assets", "Debts"],
    missing,
    clarity: "Good",
    urgency: branch === "missing" ? "Medium" : "Low",
    receivedAt: `${t2} PM`,
    auditLog: [
      { time: t1, text: "Scanned FL-142" },
      { time: t1, text: "Read: name, assets, debts" },
      {
        time: t1,
        text:
          branch === "missing"
            ? "Missing: signature, date"
            : "All required fields present",
      },
      { time: t1, text: "Flagged: human review" },
      { time: t2, text: "Sent to legal aid center" },
    ],
    arrivedAt: Date.now(),
  };
}
