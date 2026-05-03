import type { Extraction } from "../vision";
import type { Violation } from "./index";
import { getStatute } from "../grounding/statutes";

export function detectDebtViolations(ext: Extraction): Violation[] {
  const out: Violation[] = [];
  const t = ext.rawText;

  // Validation notice (within 5 days of initial communication)
  const looksLikeInitial = /this is (an|our) (initial|first) (communication|attempt)/i.test(
    t,
  );
  const hasValidation =
    /right to dispute|verify the debt|written request within (30|thirty) days/i.test(t);
  if (looksLikeInitial && !hasValidation) {
    const s = getStatute("15 U.S.C. § 1692g")!;
    out.push({
      code: "FDCPA_NO_VALIDATION_NOTICE",
      statute: s.code,
      description:
        "An initial debt-collection communication must include a validation notice telling you the amount, the creditor's name, and your right to dispute the debt within 30 days.",
      severity: "high",
      citationUrl: s.url,
      agency: "CFPB",
    });
  }

  // False or misleading representations — implying lawyer involvement, gov affiliation, jail
  if (/jail|arrest|criminal charges|prosecut/i.test(t)) {
    const s = getStatute("15 U.S.C. § 1692e")!;
    out.push({
      code: "FDCPA_FALSE_THREAT_ARREST",
      statute: s.code,
      description:
        "Threatening arrest, jail, or criminal prosecution to collect a consumer debt is a false and misleading representation prohibited by the FDCPA.",
      severity: "critical",
      citationUrl: s.url,
      agency: "CFPB",
    });
  }
  if (/our (attorney|law firm) will sue|legal action will be taken immediately/i.test(t)) {
    const s = getStatute("15 U.S.C. § 1692e")!;
    out.push({
      code: "FDCPA_FALSE_LEGAL_ACTION",
      statute: s.code,
      description:
        "Threatening legal action that the collector cannot or does not intend to take violates the FDCPA's prohibition on false representations.",
      severity: "high",
      citationUrl: s.url,
      agency: "CFPB",
    });
  }

  // Communications restrictions — odd-hour calls
  if (/we have called you (\d+|several|many) times/i.test(t)) {
    const s = getStatute("15 U.S.C. § 1692c")!;
    out.push({
      code: "FDCPA_HARASSMENT",
      statute: s.code,
      description:
        "Repeated calls intended to annoy, abuse, or harass may violate the FDCPA's communication restrictions, including the prohibition on calls at unusual times or places.",
      severity: "medium",
      citationUrl: s.url,
      agency: "CFPB",
    });
  }

  return out;
}
