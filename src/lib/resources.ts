// Curated, deterministic resource lists keyed by resource category.
// Demo-safe: NO live search. Claude classifies the document; this maps it to real help.

export type Resource = { name: string; helpsWith: string; contact?: string };

const RESOURCES_BY_CATEGORY: Record<string, Resource[]> = {
  legal: [
    { name: "Local Legal Aid Center", helpsWith: "Free legal help for low-income residents", contact: "Call 211" },
    { name: "Court Self-Help Center", helpsWith: "Walk-in help with court paperwork", contact: "courts.ca.gov/selfhelp" },
    { name: "Fee Waiver — Form FW-001", helpsWith: "Skip court filing fees if you can't afford them" },
  ],
  benefits: [
    { name: "Benefits Enrollment Help (211)", helpsWith: "Apply for food, cash aid, and Medi-Cal", contact: "Call 211" },
    { name: "County Social Services", helpsWith: "In-person help with public benefits" },
  ],
  housing: [
    { name: "Housing Assistance (211)", helpsWith: "Rent help and eviction prevention", contact: "Call 211" },
    { name: "Tenant Rights Hotline", helpsWith: "Free advice on your rights as a renter" },
  ],
  healthcare: [
    { name: "Community Health Clinic", helpsWith: "Low-cost or free medical care", contact: "Call 211" },
    { name: "Medi-Cal Enrollment Help", helpsWith: "Apply for free or low-cost health coverage" },
  ],
  immigration: [
    { name: "Nonprofit Immigration Legal Aid", helpsWith: "Trusted, low-cost immigration help", contact: "Call 211" },
  ],
  general: [
    { name: "211 Help Line", helpsWith: "Connects you to local help for almost anything", contact: "Call 211" },
  ],
  none: [],
};

export function getResources(category?: string | null): Resource[] {
  const key = (category ?? "general").toLowerCase().trim();
  return RESOURCES_BY_CATEGORY[key] ?? RESOURCES_BY_CATEGORY.general;
}

export function getAccountablePartner(category?: string | null): { name: string; label: string } {
  const key = (category ?? "general").toLowerCase().trim();
  const map: Record<string, { name: string; label: string }> = {
    legal:       { name: "Legal Aid Center",        label: "Connect me with the Legal Aid Center" },
    benefits:    { name: "Benefits Caseworker",     label: "Connect me with a Benefits Caseworker" },
    housing:     { name: "Housing Advocate",        label: "Connect me with a Housing Advocate" },
    healthcare:  { name: "Community Health Worker", label: "Connect me with a Community Health Worker" },
    immigration: { name: "Immigration Legal Aid",   label: "Connect me with Immigration Legal Aid" },
    general:     { name: "Social Worker",           label: "Connect me with a Social Worker" },
    none:        { name: "Social Worker",           label: "Connect me with a Social Worker" },
  };
  return map[key] ?? map.general;
}

/** Convert spoken-email dictation into a real email-ish string.
 *  e.g. "harry potter at gmail dot com" → "harrypotter@gmail.com"
 */
export function normalizeSpokenEmail(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bat\b/gi, "@")
    .replace(/\bdot\b/gi, ".")
    .replace(/\bdash\b/gi, "-")
    .replace(/\bunderscore\b/gi, "_")
    .replace(/\s+/g, "")
    .replace(/[.。!?！？]+$/g, "");
}
