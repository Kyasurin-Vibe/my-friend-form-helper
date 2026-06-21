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
