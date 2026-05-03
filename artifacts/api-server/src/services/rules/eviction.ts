import type { Extraction } from "../vision";
import type { Violation } from "./index";
import { getStatute } from "../grounding/statutes";

/**
 * Eviction rules engine. Heuristic-only for the demo; covers the most
 * common violations that show up in CA/TX/NY notices.
 */
export function detectEvictionViolations(
  ext: Extraction,
  jurisdiction: string | null,
): Violation[] {
  const out: Violation[] = [];
  const text = ext.rawText.toLowerCase();

  // CA AB 1482 — must state just cause
  if (jurisdiction === "US-CA") {
    const justCauseMentioned =
      /just cause|civil code .*1946\.2|nonpayment|nuisance|breach of/i.test(
        ext.rawText,
      );
    if (!justCauseMentioned) {
      const s = getStatute("Cal. Civ. Code § 1946.2")!;
      out.push({
        code: "CA_AB1482_NO_JUST_CAUSE",
        statute: s.code,
        description:
          "Under AB 1482, a notice to terminate tenancy must state a 'just cause' for the eviction. This notice does not appear to do so.",
        severity: "high",
        citationUrl: s.url,
        agency: "STATE_AG",
      });
    }
    // 3-day notice for nonpayment must allow cure
    if (
      /three[\s-]day|3[\s-]day/i.test(ext.rawText) &&
      !/pay or quit|cure/i.test(ext.rawText)
    ) {
      const s = getStatute("Cal. Code Civ. Proc. § 1161")!;
      out.push({
        code: "CA_CCP_1161_NO_CURE",
        statute: s.code,
        description:
          "California requires a 3-day notice for non-payment to give the tenant the option to pay (cure) or quit. A bare 'quit' notice without a cure option is defective.",
        severity: "medium",
        citationUrl: s.url,
        agency: "STATE_AG",
      });
    }
  }

  // TX — must give 3 days unless lease overrides
  if (jurisdiction === "US-TX") {
    const isShort = /(?:24|48)\s*hours?|one[\s-]day|two[\s-]day/i.test(
      ext.rawText,
    );
    if (isShort) {
      const s = getStatute("Tex. Prop. Code § 24.005")!;
      out.push({
        code: "TX_PROP_24005_SHORT_NOTICE",
        statute: s.code,
        description:
          "Texas requires at least 3 days' written notice to vacate before filing an eviction unless the lease specifies otherwise. A shorter notice may be defective.",
        severity: "high",
        citationUrl: s.url,
        agency: "STATE_AG",
      });
    }
  }

  // NY — HSTPA 14-day notice for nonpayment
  if (jurisdiction === "US-NY") {
    if (
      /nonpayment|past due|rent owed/i.test(ext.rawText) &&
      !/14[\s-]day|fourteen[\s-]day/i.test(ext.rawText)
    ) {
      const s = getStatute("N.Y. Real Prop. Acts. § 711")!;
      out.push({
        code: "NY_HSTPA_14DAY",
        statute: s.code,
        description:
          "Under New York's HSTPA, landlords must give 14 days' written notice before commencing a non-payment proceeding. This notice appears to be shorter than required.",
        severity: "high",
        citationUrl: s.url,
        agency: "STATE_AG",
      });
    }
  }

  // Cross-jurisdiction: threats not permitted
  if (/sheriff will remove|throw out|put your belongings/i.test(text)) {
    const s = getStatute("Cal. Civ. Code § 1946.2") ?? getStatute("N.Y. Real Prop. Acts. § 711")!;
    out.push({
      code: "SELF_HELP_THREAT",
      statute: s.code,
      description:
        "Threatening to physically remove a tenant or their belongings (a 'self-help' eviction) is unlawful in every U.S. state. Only a court-issued writ executed by a sheriff may remove a tenant.",
      severity: "critical",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  return out;
}
