import type { Extraction } from "../vision";
import type { Vertical } from "../classify";
import { detectEvictionViolations } from "./eviction";
import { detectDebtViolations } from "./debt";
import { detectWageViolations } from "./wage";

export type Severity = "low" | "medium" | "high" | "critical";

export interface Violation {
  code: string;
  statute: string;
  description: string;
  severity: Severity;
  citationUrl: string;
  agency: AgencyKind | null;
}

export type AgencyKind =
  | "HUD"
  | "CFPB"
  | "FTC"
  | "EEOC"
  | "STATE_AG"
  | "DOL_WHD";

export const AGENCY_LABEL: Record<AgencyKind, string> = {
  HUD: "U.S. Dept. of Housing & Urban Development",
  CFPB: "Consumer Financial Protection Bureau",
  FTC: "Federal Trade Commission",
  EEOC: "Equal Employment Opportunity Commission",
  STATE_AG: "State Attorney General",
  DOL_WHD: "U.S. Dept. of Labor — Wage & Hour Division",
};

export const AGENCY_FILE_URL: Record<AgencyKind, string> = {
  HUD: "https://www.hud.gov/program_offices/fair_housing_equal_opp/online-complaint",
  CFPB: "https://www.consumerfinance.gov/complaint/",
  FTC: "https://reportfraud.ftc.gov/",
  EEOC: "https://publicportal.eeoc.gov/Portal/Login.aspx",
  STATE_AG: "https://www.naag.org/find-my-ag/",
  DOL_WHD: "https://www.dol.gov/agencies/whd/contact/complaints",
};

/**
 * Filing-tier classification per build plan §6.2.
 *
 * tier 1 — agency operates a structured online complaint form we can
 *   guide the user through field-by-field (auto-fill via copy/paste of
 *   each section). The "File complaint" CTA jumps to the form and our
 *   modal walks them through the steps in order.
 *
 * tier 2 — no central federal portal (e.g. State AG, where the user has
 *   to find their state's office first). The expected flow is a
 *   one-click PDF the user prints and mails, plus a deep-link to the
 *   directory so they can locate the right office.
 */
export type AgencyTier = 1 | 2;
export const AGENCY_TIER: Record<AgencyKind, AgencyTier> = {
  HUD: 1,
  CFPB: 1,
  FTC: 1,
  EEOC: 1,
  DOL_WHD: 1,
  STATE_AG: 2,
};

export function runRules(
  extraction: Extraction,
  vertical: Vertical,
  jurisdiction: string | null,
): Violation[] {
  switch (vertical) {
    case "eviction":
      return detectEvictionViolations(extraction, jurisdiction);
    case "debt":
      return detectDebtViolations(extraction);
    case "wage":
      return detectWageViolations(extraction, jurisdiction);
    default:
      return [];
  }
}
