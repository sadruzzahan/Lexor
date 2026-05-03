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

const BY_CODE = new Map(STATUTES.map((s) => [s.code.toLowerCase(), s]));

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
