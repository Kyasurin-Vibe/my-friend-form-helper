// Curated, deterministic resource lists keyed by document type.
// Demo-safe: NO live search. Claude identifies the doc type; this maps it to real help.

export type Resource = {
  name: string;
  helpsWith: string;
  contact?: string;
};

const RESOURCES_BY_DOC: Record<string, Resource[]> = {
  "FL-142": [
    {
      name: "Local Legal Aid Center",
      helpsWith: "Free help completing your divorce financial forms",
      contact: "Call 211",
    },
    {
      name: "Court Self-Help Center",
      helpsWith: "Walk-in help with family law paperwork",
      contact: "courts.ca.gov/selfhelp",
    },
    {
      name: "Fee Waiver — Form FW-001",
      helpsWith: "Skip court filing fees if you can't afford them",
    },
  ],
  "FL-150": [
    {
      name: "Local Legal Aid Center",
      helpsWith: "Free help with your income & expense declaration",
      contact: "Call 211",
    },
    {
      name: "Court Self-Help Center",
      helpsWith: "Walk-in help with family law paperwork",
      contact: "courts.ca.gov/selfhelp",
    },
    {
      name: "Fee Waiver — Form FW-001",
      helpsWith: "Skip court filing fees if you can't afford them",
    },
  ],
  "DV-100": [
    {
      name: "Domestic Violence Legal Aid",
      helpsWith: "Confidential help with restraining orders",
      contact: "Call 211",
    },
    {
      name: "Court Self-Help Center",
      helpsWith: "Walk-in help filing protective orders",
      contact: "courts.ca.gov/selfhelp",
    },
  ],
  default: [
    {
      name: "Local Legal Aid Center",
      helpsWith: "Free legal help for low-income residents",
      contact: "Call 211",
    },
    {
      name: "Court Self-Help Center",
      helpsWith: "Walk-in help understanding court paperwork",
      contact: "courts.ca.gov/selfhelp",
    },
  ],
};

export function getResources(documentType?: string | null): Resource[] {
  if (!documentType) return RESOURCES_BY_DOC.default;
  const key = documentType.toUpperCase().trim();
  return RESOURCES_BY_DOC[key] ?? RESOURCES_BY_DOC.default;
}
