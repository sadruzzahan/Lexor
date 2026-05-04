/**
 * disclosureChecklist — canonical Brady/discovery items the prosecution
 * is obligated to produce, keyed by (chargeFamily, jurisdictionIso2).
 *
 * The base list is hand-curated from the Brady v. Maryland line plus
 * common state discovery rules (IL Sup. Ct. R. 412, Fed. R. Crim. P.
 * 16). It is intentionally short and conservative — BradyDetector
 * augments it with an LLM call that can add items the LLM has high
 * confidence about and tag each with a verifiable rule citation
 * (verified separately by `verifyCitation`).
 */
export interface DisclosureItem {
  id: string;
  label: string;
  rationale: string;
  /** Authority that obliges production (e.g. "Brady v. Maryland, 373 U.S. 83"). */
  authority: string;
  /** Public URL where the rule text lives — used for citation verification. */
  authorityUrl: string;
  /** Verbatim quote from the authority that must match at authorityUrl. */
  authorityQuote: string;
}

const BRADY_BASELINE: DisclosureItem[] = [
  {
    id: "exculpatory_evidence",
    label: "Exculpatory evidence in the prosecution's possession",
    rationale:
      "Any material evidence favorable to the accused must be disclosed regardless of request.",
    authority: "Brady v. Maryland, 373 U.S. 83 (1963)",
    authorityUrl:
      "https://www.law.cornell.edu/supremecourt/text/373/83",
    authorityQuote:
      "the suppression by the prosecution of evidence favorable to an accused upon request violates due process",
  },
  {
    id: "impeachment_evidence",
    label: "Impeachment evidence on prosecution witnesses",
    rationale:
      "Information that would impeach a government witness is Brady material.",
    authority: "Giglio v. United States, 405 U.S. 150 (1972)",
    authorityUrl:
      "https://www.law.cornell.edu/supremecourt/text/405/150",
    authorityQuote:
      "When the reliability of a given witness may well be determinative of guilt or innocence",
  },
  {
    id: "officer_misconduct_history",
    label: "Officer prior misconduct / Brady-list status",
    rationale:
      "Prior sustained misconduct findings against testifying officers must be produced.",
    authority: "Kyles v. Whitley, 514 U.S. 419 (1995)",
    authorityUrl:
      "https://www.law.cornell.edu/supremecourt/text/514/419",
    authorityQuote:
      "the individual prosecutor has a duty to learn of any favorable evidence known to the others acting on the government's behalf",
  },
];

const FED_R_CRIM_P_16: DisclosureItem[] = [
  {
    id: "defendant_statements",
    label: "Defendant's recorded or written statements",
    rationale:
      "Rule 16(a)(1)(A)–(B) requires production of any relevant statement made by the defendant.",
    authority: "Fed. R. Crim. P. 16(a)(1)(B)",
    authorityUrl: "https://www.law.cornell.edu/rules/frcrmp/rule_16",
    authorityQuote:
      "Upon a defendant's request, the government must disclose to the defendant",
  },
  {
    id: "expert_witness_basis",
    label: "Basis and reasons for expert opinions (lab analyst)",
    rationale:
      "Rule 16(a)(1)(G) requires a written summary of any expert testimony.",
    authority: "Fed. R. Crim. P. 16(a)(1)(G)",
    authorityUrl: "https://www.law.cornell.edu/rules/frcrmp/rule_16",
    authorityQuote: "the witness's qualifications",
  },
];

const ILLINOIS_RULE_412: DisclosureItem[] = [
  {
    id: "il_412_witness_statements",
    label: "Witness statements and lists (IL Sup. Ct. R. 412(a)(i))",
    rationale:
      "Names, addresses, and prior statements of intended state witnesses must be produced.",
    authority: "Ill. Sup. Ct. R. 412(a)(i)",
    authorityUrl:
      "https://www.illinoiscourts.gov/Resources/d6c6e92b-3884-4f7b-9c3a-4e35e94f8f6e/Article%20IV.pdf",
    authorityQuote:
      "the names and last known addresses of persons whom the State intends to call as witnesses",
  },
  {
    id: "il_412_search_warrant_docs",
    label: "Search warrant + supporting affidavit (IL Sup. Ct. R. 412(a)(viii))",
    rationale:
      "All search and seizure documents must be produced when a warrant is at issue.",
    authority: "Ill. Sup. Ct. R. 412(a)(viii)",
    authorityUrl:
      "https://www.illinoiscourts.gov/Resources/d6c6e92b-3884-4f7b-9c3a-4e35e94f8f6e/Article%20IV.pdf",
    authorityQuote: "any documents",
  },
];

const ENGLAND_AND_WALES_CPIA: DisclosureItem[] = [
  {
    id: "cpia_unused_material",
    label: "Schedule of unused material (CPIA s.3)",
    rationale:
      "The prosecutor must disclose material that might reasonably undermine the case for the prosecution or assist the defence.",
    authority: "Criminal Procedure and Investigations Act 1996, s.3",
    authorityUrl:
      "https://www.legislation.gov.uk/ukpga/1996/25/section/3",
    authorityQuote:
      "any prosecution material which has not previously been disclosed",
  },
];

/**
 * Look up the canonical Brady + jurisdictional discovery items for a
 * (chargeFamily, jurisdiction) pair. Brady baseline is universal across
 * the US; Rule 16 layers on for federal/state common-law jurisdictions;
 * specific state rules layer on top of that. Non-US jurisdictions get
 * their own family.
 */
export function disclosureChecklist(args: {
  chargeFamily: string;
  jurisdictionIso2: string;
}): DisclosureItem[] {
  const iso = args.jurisdictionIso2.toUpperCase();
  if (iso === "US") {
    // Heuristic: Illinois-specific rules come into play when the
    // jurisdiction context is Illinois. We err toward including the
    // state-rules layer for the demo and let the LLM augmentation pass
    // prune anything that doesn't apply to the actual charge.
    return [...BRADY_BASELINE, ...FED_R_CRIM_P_16, ...ILLINOIS_RULE_412];
  }
  if (iso === "GB") {
    return [...ENGLAND_AND_WALES_CPIA];
  }
  // Default: Brady-style items only. The LLM augmentation step has the
  // jurisdiction context and can pull in domestic equivalents.
  return [...BRADY_BASELINE];
}
