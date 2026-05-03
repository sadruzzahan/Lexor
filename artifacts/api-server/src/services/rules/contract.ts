import type { Extraction } from "../vision";
import type { Violation } from "./index";
import { getStatute } from "../grounding/statutes";

/**
 * Rules engine for contract-dispute / legal-demand-notice letters.
 *
 * Covers the most common procedural and substantive overreaches seen in
 * pre-litigation demand letters: coercive short deadlines, unlawful
 * compound-interest demands, unsubstantiated expert claims used as
 * leverage, demands for IP/source-code surrender without a court order,
 * and failure to identify the governing contract.
 */
export function detectContractViolations(ext: Extraction): Violation[] {
  const out: Violation[] = [];
  const t = ext.rawText;

  // ── 1. Unreasonably short response deadline ────────────────────────────
  // A demand giving fewer than 7 days to respond to a complex commercial
  // dispute is procedurally coercive and may be challenged as bad-faith
  // negotiation. 72-hour / 24-hour / 48-hour ultimatums are common red flags.
  const shortDeadlineMatch = t.match(
    /(?:within|no later than|by)\s+(?:72|48|24)\s*hours?|(?:72|48|24)[- ]hour\s+(?:deadline|ultimatum|notice|demand)/i,
  );
  const veryShortDaysMatch = t.match(
    /(?:within|no later than|by)\s+(?:one|two|three|1|2|3)\s+(?:business\s+)?days?/i,
  );
  if (shortDeadlineMatch || veryShortDaysMatch) {
    const s = getStatute("UCC § 1-304 / Restatement (Second) of Contracts § 205")!;
    out.push({
      code: "CONTRACT_COERCIVE_DEADLINE",
      statute: s.code,
      description:
        "The letter imposes an unreasonably short deadline (72 hours or fewer) to respond to complex commercial claims. Courts and arbitration panels treat such ultimatums as evidence of bad-faith negotiation; the deadline itself is not legally binding and you have the right to request a reasonable extension.",
      severity: "high",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  // ── 2. Compound interest claimed without statutory / contractual basis ──
  // Demanding compound interest on an unliquidated claim is improper unless
  // the underlying contract expressly authorises it and the rate is lawful.
  const compoundInterest =
    /compound(ed|ing)?\s+interest|interest\s+compound/i.test(t);
  const highInterestRate = (() => {
    const m = t.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:per\s+(?:annum|year|month)|p\.?a\.?|compound)/i);
    if (m && m[1]) return parseFloat(m[1]) > 12;
    return false;
  })();
  if (compoundInterest || highInterestRate) {
    const s = getStatute("Restatement (Third) of Restitution § 53")!;
    out.push({
      code: "CONTRACT_UNLAWFUL_INTEREST",
      statute: s.code,
      description:
        "The letter claims compound interest on the disputed amount. Compound interest on unliquidated contract claims is not available at common law unless the contract explicitly authorises it; courts typically award only simple pre-judgment interest at the statutory rate. Any rate above the state usury ceiling may be unenforceable.",
      severity: "high",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  // ── 3. Unverified forensic / expert evidence used as leverage ──────────
  // Citing a "forensic analysis" or "expert report" without disclosing the
  // expert's identity, methodology, or producing the report violates basic
  // evidentiary fairness and may be sanctionable if filed in court.
  if (/forensic\s+(analysis|audit|review|report|investigation)/i.test(t)) {
    const s = getStatute("Fed. R. Civ. P. 26(a)(2)")!;
    out.push({
      code: "CONTRACT_UNVERIFIED_FORENSIC_CLAIM",
      statute: s.code,
      description:
        "The letter references a 'forensic analysis' as the basis for its claims but does not identify the expert, their methodology, or provide the report. An opposing party is entitled to review any expert evidence before being required to respond; you may demand full disclosure before engaging with the allegations.",
      severity: "medium",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  // ── 4. Demand to surrender source code / IP without court order ─────────
  // A pre-litigation demand to hand over proprietary code, trade secrets, or
  // IP is not enforceable without a court order or arbitral award. Complying
  // voluntarily may waive trade-secret protections.
  if (
    /surrender|hand over|transfer|deliver\b.{0,60}(?:source code|codebase|repository|IP|intellectual property|trade secret)/i.test(t) ||
    /(?:source code|codebase|repository).{0,60}(?:surrender|hand over|transfer|deliver)/i.test(t)
  ) {
    const s = getStatute("18 U.S.C. § 1836 (DTSA)")!;
    out.push({
      code: "CONTRACT_IP_SURRENDER_DEMAND",
      statute: s.code,
      description:
        "The letter demands surrender of source code or intellectual property without a court order. You cannot be compelled to hand over proprietary assets pre-litigation. Voluntary disclosure without a court order may waive your trade-secret protections under the Defend Trade Secrets Act.",
      severity: "critical",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  // ── 5. No governing contract identified ──────────────────────────────
  // A breach-of-contract claim must identify the specific contract alleged
  // to have been breached. Letters that assert breach without attaching or
  // specifically identifying the agreement are deficient on their face.
  const claimsContractBreach =
    /breach of (contract|agreement|MSA|NDA|SLA|the terms)/i.test(t);
  const identifiesDocument =
    /attached hereto|enclosed herein|as amended|dated .{4,30}(?:agreement|contract|MSA)/i.test(t) ||
    /pursuant to (the|our|your) (?:agreement|contract|MSA|NDA|SLA) (?:dated|executed|signed)/i.test(t);
  if (claimsContractBreach && !identifiesDocument) {
    const s = getStatute("Restatement (Second) of Contracts § 204")!;
    out.push({
      code: "CONTRACT_NO_AGREEMENT_IDENTIFIED",
      statute: s.code,
      description:
        "The letter asserts breach of contract but does not attach or specifically identify the governing agreement (date, parties, document title). A valid breach-of-contract claim requires a specific, enforceable contract. You are entitled to demand a copy of the alleged contract before responding.",
      severity: "medium",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  // ── 6. Threat of criminal / regulatory referral for a civil dispute ──
  // Threatening to report a civil commercial dispute to criminal authorities
  // to coerce payment is extortion in many jurisdictions.
  if (
    /report(ing)? (this|the matter|you) to (the police|law enforcement|authorities|FBI|interpol)/i.test(t) ||
    /criminal (complaint|charges|referral|action).{0,60}(unless|if you (do not|fail))/i.test(t)
  ) {
    const s = getStatute("Restatement (Second) of Contracts § 176")!;
    out.push({
      code: "CONTRACT_CRIMINAL_THREAT_COERCION",
      statute: s.code,
      description:
        "The letter threatens criminal charges or a police report as leverage in a civil commercial dispute. Using the threat of criminal prosecution to compel payment may constitute extortion or criminal coercion under state law and can itself be grounds for a counter-claim.",
      severity: "critical",
      citationUrl: s.url,
      agency: "STATE_AG",
    });
  }

  return out;
}
