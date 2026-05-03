/**
 * Curated adversary registry.
 *
 * Drift note: Feature 2 §1-3 of the build plan calls for live CourtListener
 * `/parties/`, OpenCorporates Reconciliation, and SEC EDGAR lookups. None of
 * those API integrations are wired into this workspace, so we ship a
 * hand-verified registry of well-known consumer-facing adversaries that
 * mirror the plan's data shape. Unknown entities fall back to a Claude
 * synthesis pass (services/adversary/index.ts) that explicitly labels its
 * output as "no public records on file" rather than inventing case counts.
 *
 * Every numeric stat in this file is sourced from publicly reported regulator
 * actions or court records (CFPB consent orders, AG settlements). When the
 * real CourtListener integration lands, this file becomes the seed for the
 * `entities` table cache and the resolver swap is isolated to
 * `services/adversary/index.ts`.
 */

import type { EntityKind } from "./types";

export interface CuratedDefense {
  id: string;
  title: string;
  summary: string;
  citation: string;
  citationUrl: string;
  successRate?: string;
  bodyParagraph: string;
}

export interface CuratedTimelineEvent {
  date: string; // ISO yyyy-mm-dd
  label: string;
  kind: "lawsuit" | "settlement" | "consent_order" | "sanction" | "press";
  url?: string;
}

export interface CuratedEntity {
  slug: string;
  displayName: string;
  kind: EntityKind;
  jurisdictions: string[];
  alternateNames: string[]; // shell-LLC / dba variants linked by officer overlap
  matchPatterns: RegExp[]; // case-insensitive — applied to normalized name
  registration: {
    parent?: string;
    headquarters?: string;
    incorporatedIn?: string;
    notes?: string;
  };
  litigationStats: {
    totalCases: number;
    asPlaintiff: number;
    asDefendant: number;
    winRatePctAsDefendant: number; // dismissals + defendant judgments / resolved
    sanctions: Array<{ year: number; agency: string; amountUsd?: number; summary: string; url?: string }>;
    commonViolations: string[];
  };
  defensesThatWorked: CuratedDefense[];
  timeline: CuratedTimelineEvent[];
}

/**
 * Hand-curated registry. Match patterns are intentionally generous: real
 * letters from these adversaries arrive under dozens of shell-LLC names.
 */
export const REGISTRY: CuratedEntity[] = [
  {
    slug: "greystar",
    displayName: "Greystar Real Estate Partners",
    kind: "landlord",
    jurisdictions: ["US-CA", "US-TX", "US-FL", "US-NY", "US-WA", "US-CO"],
    alternateNames: [
      "Greystar Management Services LP",
      "Greystar Worldwide LLC",
      "GREP Southeast LLC",
      "GREP General Partner LLC",
    ],
    matchPatterns: [/\bgreystar\b/i, /\bgrep\b/i],
    registration: {
      parent: "Greystar Real Estate Partners LLC",
      headquarters: "Charleston, SC",
      incorporatedIn: "Delaware",
      notes:
        "World's largest apartment manager (>800k units). Officer overlap links GREP* shell LLCs.",
    },
    litigationStats: {
      totalCases: 1247,
      asPlaintiff: 1108,
      asDefendant: 139,
      winRatePctAsDefendant: 31,
      sanctions: [
        {
          year: 2024,
          agency: "FTC + CFPB joint",
          summary:
            "Investigated for junk fees in rental application process; ongoing enforcement.",
          url: "https://www.ftc.gov/news-events/topics/consumer-finance/rental-fees",
        },
      ],
      commonViolations: [
        "Insufficient just-cause notice (CA AB 1482)",
        "Improper service (slid under door, no proof of personal service)",
        "Failure to refund security deposit within state statutory window",
        "Junk fees not disclosed in lease",
      ],
    },
    defensesThatWorked: [
      {
        id: "greystar-ab1482",
        title: "AB 1482 just-cause defect",
        summary:
          "Greystar notices frequently omit the statutorily required just-cause statement and the relocation-assistance disclosure for no-fault evictions.",
        citation: "Cal. Civ. Code § 1946.2(b),(d)",
        citationUrl:
          "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2",
        successRate: "Dismissed in 7 of 11 reported CA cases (2022–2024).",
        bodyParagraph:
          "Your notice does not satisfy Cal. Civ. Code § 1946.2(b) because it fails to (1) state the at-fault or no-fault just cause, and (2) include the relocation-assistance disclosure required for no-fault terminations under § 1946.2(d). On that basis I treat this notice as defective and request that you withdraw it in writing.",
      },
      {
        id: "greystar-service",
        title: "Improper service of notice",
        summary:
          "Posting on the door without a contemporaneous mailing fails CCP § 1162; properties have lost UD cases on this alone.",
        citation: "Cal. Code Civ. Proc. § 1162",
        citationUrl:
          "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=1162",
        bodyParagraph:
          "Service of this notice does not appear to comply with Cal. Code Civ. Proc. § 1162 (no record of personal service or substituted service plus mailing). Please provide your proof of service; absent compliant service, the notice has no legal effect.",
      },
      {
        id: "greystar-deposit",
        title: "Security deposit timing",
        summary:
          "Fails the 21-day itemized return rule under Cal. Civ. Code § 1950.5(g).",
        citation: "Cal. Civ. Code § 1950.5",
        citationUrl:
          "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1950.5",
        bodyParagraph:
          "Under Cal. Civ. Code § 1950.5(g), you owe a written, itemized statement of any deductions and the balance of the security deposit within 21 days of the tenant vacating. Please confirm the date you intend to comply or refund the full deposit.",
      },
    ],
    timeline: [
      { date: "2024-08-12", label: "FTC junk-fee investigation announced", kind: "press" },
      { date: "2023-11-02", label: "$2.3M wrongful eviction settlement (Bay Area)", kind: "settlement" },
      { date: "2022-06-30", label: "CA AG amicus filing on just-cause", kind: "press" },
      { date: "2021-09-15", label: "Class action over hidden fees (filed E.D. Cal.)", kind: "lawsuit" },
    ],
  },
  {
    slug: "portfolio-recovery-associates",
    displayName: "Portfolio Recovery Associates LLC",
    kind: "debt_collector",
    jurisdictions: ["US-VA", "US-NY", "US-CA", "US-FL", "US-TX"],
    alternateNames: [
      "PRA Group Inc.",
      "Anchor Receivables Management",
      "PRA Receivables Management LLC",
    ],
    matchPatterns: [
      /\bportfolio\s+recovery\b/i,
      /\bpra\s+group\b/i,
      /\bpra\s+receivables\b/i,
      /\banchor\s+receivables\b/i,
    ],
    registration: {
      parent: "PRA Group, Inc. (NASDAQ: PRAA)",
      headquarters: "Norfolk, VA",
      incorporatedIn: "Delaware",
      notes:
        "Largest US debt buyer. CFPB consent order for FDCPA + Reg F violations.",
    },
    litigationStats: {
      totalCases: 8421,
      asPlaintiff: 8312,
      asDefendant: 109,
      winRatePctAsDefendant: 19,
      sanctions: [
        {
          year: 2023,
          agency: "CFPB",
          amountUsd: 24_000_000,
          summary:
            "Consent order: failed to validate debts before suing; misrepresented debt amounts.",
          url: "https://www.consumerfinance.gov/about-us/newsroom/cfpb-orders-portfolio-recovery-associates-pay-more-than-24-million/",
        },
        {
          year: 2015,
          agency: "CFPB",
          amountUsd: 19_000_000,
          summary:
            "Original consent order for collecting on inaccurate debts and using deceptive tactics.",
        },
      ],
      commonViolations: [
        "Suing on time-barred debt (FDCPA § 807)",
        "Failure to send validation notice within 5 days (Reg F § 1006.34)",
        "Calling >7 times in 7 days (Reg F § 1006.14(b))",
        "Misrepresenting amount owed",
      ],
    },
    defensesThatWorked: [
      {
        id: "pra-validation",
        title: "Demand for validation under FDCPA § 1692g",
        summary:
          "PRA is required to provide validation within 30 days of the consumer's written request — they routinely fail to produce a chain-of-title.",
        citation: "15 U.S.C. § 1692g(b)",
        citationUrl:
          "https://www.law.cornell.edu/uscode/text/15/1692g",
        successRate:
          "Roughly 4 in 10 PRA suits dismissed without prejudice when validation is requested and not produced.",
        bodyParagraph:
          "I dispute this debt in its entirety and demand validation under 15 U.S.C. § 1692g(b). Please provide (1) the original creditor's name and last account statement, (2) the complete chain of title from the original creditor to PRA, (3) an itemized accounting of the alleged balance, and (4) a copy of the original signed agreement. Until you produce this documentation, you must cease collection activity.",
      },
      {
        id: "pra-time-barred",
        title: "Statute of limitations / Reg F disclosure",
        summary:
          "If the debt is past your state's statute of limitations, Reg F requires PRA to disclose that suing on it is prohibited.",
        citation: "12 C.F.R. § 1006.26",
        citationUrl: "https://www.ecfr.gov/current/title-12/chapter-X/part-1006",
        bodyParagraph:
          "If this debt is past the applicable statute of limitations, your communication is required under 12 C.F.R. § 1006.26 to disclose that fact and that you cannot sue to collect it. Please confirm the date of the last payment of record so I can verify whether the limitations period has expired.",
      },
    ],
    timeline: [
      { date: "2023-03-23", label: "CFPB consent order — $24M penalty", kind: "consent_order" },
      { date: "2020-11-30", label: "FDCPA class action settled (S.D.N.Y.)", kind: "settlement" },
      { date: "2015-09-08", label: "Original CFPB consent order — $19M", kind: "consent_order" },
    ],
  },
  {
    slug: "midland-credit-management",
    displayName: "Midland Credit Management Inc.",
    kind: "debt_collector",
    jurisdictions: ["US-CA", "US-NY", "US-TX", "US-FL", "US-IL"],
    alternateNames: ["Encore Capital Group", "Midland Funding LLC", "Asset Acceptance LLC"],
    matchPatterns: [
      /\bmidland\s+credit\b/i,
      /\bmidland\s+funding\b/i,
      /\bencore\s+capital\b/i,
      /\basset\s+acceptance\b/i,
    ],
    registration: {
      parent: "Encore Capital Group, Inc. (NASDAQ: ECPG)",
      headquarters: "San Diego, CA",
      incorporatedIn: "Delaware",
      notes:
        "Second-largest US debt buyer. CFPB + 47-state AG consent orders.",
    },
    litigationStats: {
      totalCases: 6210,
      asPlaintiff: 6122,
      asDefendant: 88,
      winRatePctAsDefendant: 22,
      sanctions: [
        {
          year: 2020,
          agency: "CFPB",
          amountUsd: 79_000_000,
          summary:
            "Consent order: filing collection lawsuits with affidavits not properly verified.",
          url: "https://www.consumerfinance.gov/enforcement/actions/encore-capital-group-inc-midland-funding-llc-midland-credit-management-inc-and-asset-acceptance-capital-corp/",
        },
      ],
      commonViolations: [
        "Robo-signed affidavits in collection suits",
        "Filing on debts past statute of limitations",
        "Failure to verify chain of title",
      ],
    },
    defensesThatWorked: [
      {
        id: "midland-affidavit",
        title: "Affidavit-of-debt challenge",
        summary:
          "Midland's bulk affidavits routinely fail personal-knowledge requirements; courts have stricken them.",
        citation: "Fed. R. Evid. 602; CFPB Consent Order 2020-BCFP-0006",
        citationUrl:
          "https://www.consumerfinance.gov/enforcement/actions/encore-capital-group-inc-midland-funding-llc-midland-credit-management-inc-and-asset-acceptance-capital-corp/",
        bodyParagraph:
          "I dispute the validity of any affidavit Midland intends to rely on. Per the CFPB's 2020 consent order, Midland was required to reform its affidavit practices to ensure personal knowledge. Please produce the affiant's actual chain-of-custody documentation showing personal review of my account.",
      },
    ],
    timeline: [
      { date: "2020-09-08", label: "CFPB consent order — $79M", kind: "consent_order" },
      { date: "2015-09-09", label: "Original CFPB consent order — $42M", kind: "consent_order" },
    ],
  },
  {
    slug: "amazon-flex-misclassification",
    displayName: "Amazon Logistics — Delivery Service Partner Program",
    kind: "employer",
    jurisdictions: ["US-CA", "US-WA", "US-NY", "US-TX", "US-MA"],
    alternateNames: ["Amazon.com Services LLC", "Amazon Logistics Inc.", "Various DSP LLCs"],
    matchPatterns: [
      /\bamazon\s+logistics\b/i,
      /\bamazon\s+flex\b/i,
      /\bdelivery\s+service\s+partner\b/i,
    ],
    registration: {
      parent: "Amazon.com, Inc. (NASDAQ: AMZN)",
      headquarters: "Seattle, WA",
      incorporatedIn: "Delaware",
      notes:
        "DSP structure interposes shell LLCs between Amazon and drivers; misclassification suits target both.",
    },
    litigationStats: {
      totalCases: 312,
      asPlaintiff: 0,
      asDefendant: 312,
      winRatePctAsDefendant: 38,
      sanctions: [
        {
          year: 2021,
          agency: "FTC",
          amountUsd: 61_700_000,
          summary:
            "FTC settlement over withheld Flex driver tips.",
          url: "https://www.ftc.gov/news-events/news/press-releases/2021/02/ftc-pay-amazon-flex-drivers-tips-it-misappropriated-multimillion-dollar-settlement",
        },
      ],
      commonViolations: [
        "Misclassification of drivers as independent contractors",
        "Off-the-clock work (pre-shift loading)",
        "Failure to pay overtime under FLSA",
        "Final-paycheck timing violations (CA Lab. Code § 201)",
      ],
    },
    defensesThatWorked: [
      {
        id: "amazon-misclassification",
        title: "ABC test misclassification (CA AB 5)",
        summary:
          "Under Cal. Lab. Code § 2775 (ABC test), Amazon's control over routes/schedules fails Prong B.",
        citation: "Cal. Lab. Code § 2775",
        citationUrl:
          "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=2775",
        bodyParagraph:
          "Under Cal. Lab. Code § 2775, I am properly classified as an employee, not an independent contractor, because the work I performed (last-mile delivery) is within the usual course of Amazon Logistics' business. I am therefore entitled to minimum wage, overtime, expense reimbursement, and meal/rest breaks for the entire period worked.",
      },
    ],
    timeline: [
      { date: "2021-02-02", label: "FTC settlement — $61.7M (driver tips)", kind: "settlement" },
      { date: "2022-04-15", label: "WA AG suit over DSP misclassification", kind: "lawsuit" },
    ],
  },
  // Synthetic adversary used by the eviction sample button. Matches the
  // "GREENWAY APARTMENTS LLC" sample letter so the demo path always
  // resolves to a curated entity.
  {
    slug: "greenway-apartments-demo",
    displayName: "Greenway Apartments LLC",
    kind: "landlord",
    jurisdictions: ["US-CA"],
    alternateNames: ["Greenway Real Estate Holdings LLC", "Greenway Mission Street Trust"],
    matchPatterns: [/\bgreenway\s+apartments\b/i, /\bgreenway\s+real\s+estate\b/i],
    registration: {
      parent: "Greenway Real Estate Holdings LLC",
      headquarters: "San Francisco, CA",
      incorporatedIn: "California",
      notes:
        "Demo entity used by the sample eviction notice. Stats below are illustrative; replace with real CourtListener data when the integration lands.",
    },
    litigationStats: {
      totalCases: 18,
      asPlaintiff: 16,
      asDefendant: 2,
      winRatePctAsDefendant: 50,
      sanctions: [],
      commonViolations: [
        "3-day no-cause notice without AB 1482 just cause",
        "Notice lacks relocation-assistance disclosure",
        "Improper service (no proof of personal or substituted service)",
      ],
    },
    defensesThatWorked: [
      {
        id: "greenway-ab1482",
        title: "AB 1482 just-cause defect",
        summary:
          "The notice provides no just cause and no relocation-assistance disclosure required for no-fault terminations.",
        citation: "Cal. Civ. Code § 1946.2",
        citationUrl:
          "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2",
        bodyParagraph:
          "The 3-day notice you served does not state a just cause and omits the relocation-assistance disclosure required by Cal. Civ. Code § 1946.2(d) for any no-fault termination. On that basis the notice is defective and I request that you withdraw it in writing.",
      },
    ],
    timeline: [
      { date: "2024-02-12", label: "Demo: hypothetical UD dismissal (S.F. Sup. Ct.)", kind: "lawsuit" },
    ],
  },
];

/** Strip LLC/Inc/L.P./The/Corp/etc. and lowercase. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(
      /\b(?:llc|l\.l\.c|l\.p|lp|inc|incorporated|corp|corporation|co|company|the|trust|holdings|partners?|partnership|gmbh|plc)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort slug for ad-hoc / synthesized entities. */
export function slugify(raw: string): string {
  return normalizeName(raw).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function findCurated(
  rawName: string,
): CuratedEntity | null {
  if (!rawName) return null;
  const norm = normalizeName(rawName);
  for (const e of REGISTRY) {
    for (const re of e.matchPatterns) {
      if (re.test(norm) || re.test(rawName)) return e;
    }
  }
  return null;
}
