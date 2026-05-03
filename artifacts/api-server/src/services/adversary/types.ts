/**
 * Shared types for the adversary subsystem. Kept separate from
 * registry.ts to avoid cycles when other modules want just the type.
 */

export type EntityKind = "landlord" | "employer" | "debt_collector" | "unknown";

export interface DossierDefense {
  id: string;
  title: string;
  summary: string;
  citation: string;
  citationUrl: string;
  successRate?: string;
  bodyParagraph: string;
}

export interface DossierTimelineEvent {
  date: string;
  label: string;
  kind: "lawsuit" | "settlement" | "consent_order" | "sanction" | "press";
  url?: string;
}

export interface DossierLitigationStats {
  totalCases: number;
  asPlaintiff: number;
  asDefendant: number;
  winRatePctAsDefendant: number;
  sanctions: Array<{
    year: number;
    agency: string;
    amountUsd?: number;
    summary: string;
    url?: string;
  }>;
  commonViolations: string[];
}

export interface DossierOtherCase {
  vertical: string;
  jurisdiction: string | null;
  createdAt: string;
}

export interface AdversaryDossier {
  entityId: string;
  displayName: string;
  normalizedName: string;
  kind: EntityKind;
  jurisdictions: string[];
  alternateNames: string[];
  registrationData: Record<string, unknown> | null;
  litigationStats: DossierLitigationStats;
  defensesThatWorked: DossierDefense[];
  timeline: DossierTimelineEvent[];
  otherCases: DossierOtherCase[];
  source: "curated" | "ai_estimated" | "empty";
  sourceNote: string;
  lastRefreshedAt: string | null;
}
