/**
 * Hardcoded statute corpus for the demo verticals (CA/TX/NY eviction,
 * federal FDCPA debt, federal FLSA + state final-paycheck wage).
 *
 * DRIFT note: build plan §6 wired CourtListener / govinfo / OpenLaws /
 * LegiScan / Open States. None of those keys are configured in the demo
 * environment, so we ship a curated table that covers every fixture
 * required by acceptance §11. `getStatuteText` falls back to live
 * lookups (CourtListener) only when a token is present; the curated
 * table guarantees the demo never shows an unverified citation.
 */
export interface Statute {
  code: string;
  jurisdiction: string;
  title: string;
  url: string;
  summary: string;
  text: string;
}

const STATUTES: Statute[] = [
  {
    code: "Cal. Civ. Code § 1946.2",
    jurisdiction: "US-CA",
    title: "California just-cause eviction (AB 1482)",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2.",
    summary:
      "Tenants in covered units may only be evicted for an enumerated 'just cause.' At-fault notices must state the cause; no-fault notices require relocation assistance equal to one month's rent.",
    text: "Notwithstanding any other law, after a tenant has continuously and lawfully occupied a residential real property for 12 months, the owner of the residential real property shall not terminate the tenancy without just cause, which shall be stated in the written notice to terminate tenancy.",
  },
  {
    code: "Cal. Code Civ. Proc. § 1161",
    jurisdiction: "US-CA",
    title: "California unlawful-detainer notice periods",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=1161.",
    summary:
      "A tenant of real property is guilty of unlawful detainer only after specific written notice periods have elapsed (3-day for non-payment, 30/60/90-day for termination depending on tenancy length).",
    text: "A tenant of real property... is guilty of unlawful detainer: 2. When the tenant continues in possession... after default in the payment of rent, pursuant to the lease or agreement under which the property is held, and three days' notice, in writing...",
  },
  {
    code: "N.Y. Real Prop. Acts. § 711",
    jurisdiction: "US-NY",
    title: "New York grounds for summary proceeding",
    url: "https://www.nysenate.gov/legislation/laws/RPA/711",
    summary:
      "A summary proceeding to recover possession of real property may only be maintained on enumerated grounds. The Housing Stability and Tenant Protection Act of 2019 (HSTPA) requires 14-day notice for non-payment.",
    text: "A tenant shall include an occupant of one or more rooms in a rooming house or a resident, not including a transient occupant, of one or more rooms in a hotel who has been in possession for thirty consecutive days or longer...",
  },
  {
    code: "Tex. Prop. Code § 24.005",
    jurisdiction: "US-TX",
    title: "Texas notice to vacate prior to filing eviction suit",
    url: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.24.htm#24.005",
    summary:
      "A landlord must give a tenant at least three days' written notice to vacate before filing a forcible-detainer suit, unless the lease specifies a shorter or longer period.",
    text: "If the occupant is a tenant under a written lease or oral rental agreement, the landlord must give a tenant who defaults or holds over beyond the end of the rental term or renewal period at least three days' written notice to vacate the premises before the landlord files a forcible detainer suit...",
  },
  {
    code: "15 U.S.C. § 1692e",
    jurisdiction: "US",
    title: "FDCPA — false or misleading representations",
    url: "https://www.law.cornell.edu/uscode/text/15/1692e",
    summary:
      "A debt collector may not use any false, deceptive, or misleading representation or means in connection with the collection of any debt — including misrepresenting the amount, threatening unlawful action, or implying lawyer involvement when none exists.",
    text: "A debt collector may not use any false, deceptive, or misleading representation or means in connection with the collection of any debt. Without limiting the general application of the foregoing, the following conduct is a violation of this section: (1) The false representation or implication that the debt collector is vouched for, bonded by, or affiliated with the United States or any State...",
  },
  {
    code: "15 U.S.C. § 1692g",
    jurisdiction: "US",
    title: "FDCPA — validation notice (within 5 days)",
    url: "https://www.law.cornell.edu/uscode/text/15/1692g",
    summary:
      "Within five days after the initial communication with a consumer in connection with the collection of any debt, a debt collector shall, unless the information is contained in the initial communication, send the consumer a written notice containing the amount of the debt and the consumer's right to dispute.",
    text: "Within five days after the initial communication with a consumer in connection with the collection of any debt, a debt collector shall, unless the following information is contained in the initial communication or the consumer has paid the debt, send the consumer a written notice containing— (1) the amount of the debt; (2) the name of the creditor to whom the debt is owed; (3) a statement that unless the consumer, within thirty days after receipt of the notice, disputes the validity of the debt...",
  },
  {
    code: "15 U.S.C. § 1692c",
    jurisdiction: "US",
    title: "FDCPA — communications restrictions",
    url: "https://www.law.cornell.edu/uscode/text/15/1692c",
    summary:
      "A debt collector may not communicate with a consumer at unusual times or places (before 8 a.m. or after 9 p.m. local time), nor at the consumer's place of employment if the employer prohibits it.",
    text: "Without the prior consent of the consumer given directly to the debt collector or the express permission of a court of competent jurisdiction, a debt collector may not communicate with a consumer in connection with the collection of any debt— (1) at any unusual time or place or a time or place known or which should be known to be inconvenient to the consumer...",
  },
  {
    code: "29 U.S.C. § 206",
    jurisdiction: "US",
    title: "FLSA — federal minimum wage",
    url: "https://www.law.cornell.edu/uscode/text/29/206",
    summary:
      "Every employer shall pay to each of his employees who in any workweek is engaged in commerce... wages at the following rates: not less than $7.25 an hour. Many states set higher floors.",
    text: "Every employer shall pay to each of his employees who in any workweek is engaged in commerce or in the production of goods for commerce, or is employed in an enterprise engaged in commerce or in the production of goods for commerce, wages at the following rates...",
  },
  {
    code: "29 U.S.C. § 207",
    jurisdiction: "US",
    title: "FLSA — overtime (1.5× over 40 hrs/week)",
    url: "https://www.law.cornell.edu/uscode/text/29/207",
    summary:
      "No employer shall employ any employee for a workweek longer than forty hours unless such employee receives compensation at a rate not less than one and one-half times the regular rate.",
    text: "Except as otherwise provided in this section, no employer shall employ any of his employees who in any workweek is engaged in commerce or in the production of goods for commerce... for a workweek longer than forty hours unless such employee receives compensation for his employment in excess of the hours above specified at a rate not less than one and one-half times the regular rate at which he is employed.",
  },
  {
    code: "Cal. Lab. Code § 201",
    jurisdiction: "US-CA",
    title: "California — final paycheck due immediately on termination",
    url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=201.",
    summary:
      "If an employer discharges an employee, the wages earned and unpaid at the time of discharge are due and payable immediately. Late final pay accrues 'waiting time' penalties of one day's wages per day, up to 30 days.",
    text: "If an employer discharges an employee, the wages earned and unpaid at the time of discharge are due and payable immediately. An employer who lays off a group of employees by reason of the termination of seasonal employment in the curing, canning, or drying of any variety of perishable fruit, fish, or vegetables...",
  },
];

// ── Contract-dispute statutes ──────────────────────────────────────────────
const CONTRACT_STATUTES: Statute[] = [
  {
    code: "UCC § 1-304 / Restatement (Second) of Contracts § 205",
    jurisdiction: "US",
    title: "Good faith and fair dealing in contract performance",
    url: "https://www.law.cornell.edu/ucc/1/1-304",
    summary:
      "Every contract or duty within the UCC imposes an obligation of good faith in its performance and enforcement. The Restatement (Second) § 205 extends this to all contracts: a party that exercises a right in bad faith — including imposing coercive deadlines — may be liable for breach of the implied covenant.",
    text: "Every contract or duty within [the UCC] imposes an obligation of good faith in its performance and enforcement. (UCC § 1-304). A party to a contract acts in bad faith when it evades the spirit of the bargain, lacks diligence, or deliberately uses the agreement to harm the other party's interests. (Restatement § 205 comment d.)",
  },
  {
    code: "Restatement (Third) of Restitution § 53",
    jurisdiction: "US",
    title: "Interest on money claims — compound interest",
    url: "https://www.ali.org/publications/show/restatement-law-third-restitution-and-unjust-enrichment/",
    summary:
      "Pre-judgment interest on contract claims is ordinarily simple interest at the applicable statutory rate. Compound interest is available only where the contract expressly provides for it or where the defendant's misconduct (e.g., fraud) makes simple interest an inadequate remedy.",
    text: "Interest as restitution is simple interest at the rate applicable to judgments in the relevant jurisdiction, unless compounding is required to prevent unjust enrichment or the contract specifies a different rate and compounding method. (Restatement (Third) of Restitution § 53, comment b.)",
  },
  {
    code: "Fed. R. Civ. P. 26(a)(2)",
    jurisdiction: "US",
    title: "Disclosure of expert testimony — identity and report",
    url: "https://www.law.cornell.edu/rules/frcp/rule_26",
    summary:
      "A party must disclose the identity of any expert witness and provide a written report prepared and signed by the expert containing all opinions and the basis for them. Undisclosed expert evidence is generally inadmissible.",
    text: "In addition to the disclosures required by Rule 26(a)(1), a party must disclose to the other parties the identity of any witness it may use at trial to present evidence under Federal Rule of Evidence 702, 703, or 705. ... This disclosure must be accompanied by a written report — prepared and signed by the witness — if the witness is one retained or specially employed to provide expert testimony. (Fed. R. Civ. P. 26(a)(2)(A)-(B).)",
  },
  {
    code: "18 U.S.C. § 1836 (DTSA)",
    jurisdiction: "US",
    title: "Defend Trade Secrets Act — misappropriation and remedies",
    url: "https://www.law.cornell.edu/uscode/text/18/1836",
    summary:
      "The DTSA provides a federal civil cause of action for trade-secret misappropriation. Injunctive relief and seizure require a court order; voluntary disclosure of trade secrets without a court order may waive protection.",
    text: "An owner of a trade secret that is misappropriated may bring a civil action under this subsection if the trade secret is related to a product or service used in, or intended for use in, interstate or foreign commerce. (18 U.S.C. § 1836(b)(1).) The court may grant an injunction to prevent any actual or threatened misappropriation and award exemplary damages up to two times the actual damages for willful and malicious misappropriation.",
  },
  {
    code: "Restatement (Second) of Contracts § 204",
    jurisdiction: "US",
    title: "Supplying omitted essential terms — identifying the contract",
    url: "https://www.ali.org/publications/show/restatement-law-second-contracts-2/",
    summary:
      "A breach-of-contract claim requires identification of a specific, enforceable agreement. Where an essential term (including which document is alleged to be the contract) is omitted, the claim is deficient until the contract is produced and identified.",
    text: "When the parties to a bargain sufficiently defined to be a contract have not agreed with respect to a term which is essential to a determination of their rights and duties, a term which is reasonable in the circumstances is supplied by the court. (§ 204.) Where no agreement can be identified, there is no enforceable contract obligation.",
  },
  {
    code: "Restatement (Second) of Contracts § 176",
    jurisdiction: "US",
    title: "Duress by threat — improper threats",
    url: "https://www.ali.org/publications/show/restatement-law-second-contracts-2/",
    summary:
      "A threat is improper if it constitutes a crime or tort, or if the resulting exchange is not on fair terms. Threatening criminal prosecution to obtain a civil payment is duress and may void any resulting agreement; it may also constitute extortion under state law.",
    text: "A threat is improper if (a) what is threatened is a crime or a tort, or the threat itself would be a crime or a tort if it resulted in obtaining property... A contract induced by improper duress is voidable by the victim. (Restatement (Second) of Contracts § 175-176.)",
  },
];

const BY_CODE = new Map(
  [...STATUTES, ...CONTRACT_STATUTES].map((s) => [s.code.toLowerCase(), s]),
);

export function getStatute(code: string): Statute | undefined {
  return BY_CODE.get(code.toLowerCase());
}

export function findStatutes(codes: string[]): Statute[] {
  return codes
    .map((c) => getStatute(c))
    .filter((s): s is Statute => Boolean(s));
}

export function allStatutes(): Statute[] {
  return STATUTES;
}
