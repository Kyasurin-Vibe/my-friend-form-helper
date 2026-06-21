// Curated, deterministic resource lists keyed by resource category.
// Demo-safe: NO live search. Claude classifies the document; this maps it to real help.

import { t } from "./i18n";

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

const PARTNER_KEYS: Record<string, { nameKey: string; labelKey: string }> = {
  legal:       { nameKey: "partner_legal_aid",     labelKey: "partner_connect_legal_aid" },
  benefits:    { nameKey: "partner_benefits",      labelKey: "partner_connect_benefits" },
  housing:     { nameKey: "partner_housing",       labelKey: "partner_connect_housing" },
  healthcare:  { nameKey: "partner_health",        labelKey: "partner_connect_health" },
  immigration: { nameKey: "partner_immigration",   labelKey: "partner_connect_immigration" },
  general:     { nameKey: "partner_social_worker", labelKey: "partner_connect_social_worker" },
  none:        { nameKey: "partner_social_worker", labelKey: "partner_connect_social_worker" },
};

export function getAccountablePartner(category?: string | null): { name: string; label: string } {
  const key = (category ?? "general").toLowerCase().trim();
  const k = PARTNER_KEYS[key] ?? PARTNER_KEYS.general;
  return { name: t(k.nameKey), label: t(k.labelKey) };
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
