/**
 * G14 objectionRulesLookup — keyword/heuristic match of a transcript
 * snippet against a per-jurisdiction evidence-rules catalog. Pure
 * in-process: no model call, no network. Used by CourtroomCopilot to
 * narrow the candidate ruleset before the small Claude judge decides
 * whether to surface a cue.
 *
 * Jurisdictions covered (skeletal — extend per gate G23 PromptRegistry):
 *   - US  (Federal Rules of Evidence — FRE)
 *   - UK  (Civil Evidence Act / common-law objections)
 *   - IN  (Indian Evidence Act — IEA)
 *
 * Each rule lists trigger phrases that mark the cue surface. A real
 * deployment would back this with a vectorized rules corpus; the
 * heuristic match keeps the live loop deterministic and offline.
 */

export type Jurisdiction = "US" | "UK" | "IN";

export interface ObjectionRule {
  ruleKey: string;
  jurisdiction: Jurisdiction;
  label: string;
  citation: string;
  description: string;
  /** Lowercased phrases that, when present in the snippet, mark this rule as a candidate. */
  triggers: string[];
  severity: "info" | "warn" | "strong";
}

const RULES: ObjectionRule[] = [
  // -------------------------------- US (FRE) --------------------------------
  {
    ruleKey: "us.fre.802",
    jurisdiction: "US",
    label: "Hearsay",
    citation: "Fed. R. Evid. 802",
    description: "Out-of-court statement offered for the truth of the matter asserted.",
    triggers: ["he told me", "she told me", "i heard", "they said", "she said that", "he said that"],
    severity: "strong",
  },
  {
    ruleKey: "us.fre.611c",
    jurisdiction: "US",
    label: "Leading question (direct)",
    citation: "Fed. R. Evid. 611(c)",
    description: "Leading question on direct examination.",
    triggers: ["isn't it true", "wouldn't you agree", "you would agree that"],
    severity: "warn",
  },
  {
    ruleKey: "us.fre.701",
    jurisdiction: "US",
    label: "Improper opinion (lay witness)",
    citation: "Fed. R. Evid. 701",
    description: "Lay opinion not based on personal perception.",
    triggers: ["in my opinion", "i believe that", "i think that he"],
    severity: "warn",
  },
  {
    ruleKey: "us.fre.403",
    jurisdiction: "US",
    label: "Unfairly prejudicial",
    citation: "Fed. R. Evid. 403",
    description: "Probative value substantially outweighed by danger of unfair prejudice.",
    triggers: ["criminal record", "prior conviction", "gang member", "addict"],
    severity: "warn",
  },
  {
    ruleKey: "us.fre.602",
    jurisdiction: "US",
    label: "Lack of personal knowledge",
    citation: "Fed. R. Evid. 602",
    description: "Witness has no personal knowledge of the matter.",
    triggers: ["i wasn't there", "i didn't see", "someone told me later"],
    severity: "warn",
  },
  // -------------------------------- UK ----------------------------------------
  {
    ruleKey: "uk.cea.114",
    jurisdiction: "UK",
    label: "Hearsay",
    citation: "Criminal Justice Act 2003 s.114",
    description: "Out-of-court statement; admissible only under a recognised exception.",
    triggers: ["he told me", "she told me", "i heard him", "i heard her say"],
    severity: "strong",
  },
  {
    ruleKey: "uk.pace.78",
    jurisdiction: "UK",
    label: "Unfair evidence",
    citation: "Police and Criminal Evidence Act 1984 s.78",
    description: "Court may exclude evidence if its admission would have an adverse effect on fairness.",
    triggers: ["no caution", "without a lawyer", "before being cautioned"],
    severity: "warn",
  },
  // -------------------------------- IN (IEA) ----------------------------------
  {
    ruleKey: "in.iea.60",
    jurisdiction: "IN",
    label: "Oral evidence must be direct",
    citation: "Indian Evidence Act s.60",
    description: "Oral evidence must, in all cases whatever, be direct.",
    triggers: ["he told me", "she told me", "i heard", "people are saying"],
    severity: "strong",
  },
  {
    ruleKey: "in.iea.143",
    jurisdiction: "IN",
    label: "Leading question",
    citation: "Indian Evidence Act s.143",
    description: "Leading question must not be put on direct examination without permission.",
    triggers: ["isn't it true", "you would agree", "wouldn't you say"],
    severity: "warn",
  },
];

export interface ObjectionMatch {
  rule: ObjectionRule;
  matchedTrigger: string;
}

/**
 * Return the candidate rules whose triggers appear in the (lowercased)
 * snippet, scoped to the given jurisdiction. The judge LLM in
 * `courtroomCopilot` then decides which (if any) deserve a cue.
 */
export function lookupObjectionCandidates(
  snippet: string,
  jurisdiction: Jurisdiction,
): ObjectionMatch[] {
  const hay = snippet.toLowerCase();
  const out: ObjectionMatch[] = [];
  for (const rule of RULES) {
    if (rule.jurisdiction !== jurisdiction) continue;
    for (const t of rule.triggers) {
      if (hay.includes(t)) {
        out.push({ rule, matchedTrigger: t });
        break;
      }
    }
  }
  return out;
}

export function listObjectionRules(jurisdiction: Jurisdiction): ObjectionRule[] {
  return RULES.filter((r) => r.jurisdiction === jurisdiction);
}
