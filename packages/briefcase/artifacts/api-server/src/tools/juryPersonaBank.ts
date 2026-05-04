/**
 * juryPersonaBank — synthetic juror persona templates for MockJurySimulator
 * (G13). Each persona is a deterministic, label-only sketch (age band,
 * occupation family, lived experience anchor, prior-on-system disposition,
 * decision-making style). Personas are EXPLICITLY synthetic — never modeled
 * on real people, never seeded with real names, never attached to PII.
 *
 * The bank rotates by `venue` so the same case re-run for "Cook County, IL"
 * vs "Travis County, TX" gets a different mix without leaking demographic
 * specifics into the model that would risk stereotyping.
 *
 * Spec §10.4 honesty contract: every persona must include a label that
 * surfaces the synthetic nature in the UI; we ship `disclaimerLabel` so
 * the rendered juror card cannot accidentally read as a real human.
 */
import { createHash } from "node:crypto";

export interface JuryPersona {
  /** Stable id within a single run (persona-1 … persona-12). */
  id: string;
  /** Public label used in the UI. */
  displayName: string;
  ageBand: "18-29" | "30-44" | "45-59" | "60+";
  occupationFamily:
    | "trades"
    | "healthcare"
    | "education"
    | "retail/service"
    | "office/admin"
    | "tech"
    | "retired"
    | "self-employed"
    | "public sector"
    | "creative";
  livedExperienceAnchor: string;
  priorTrustInSystem: "low" | "moderate" | "high";
  decisionStyle:
    | "fact-driven"
    | "narrative-driven"
    | "rules-driven"
    | "consensus-seeking"
    | "skeptical";
  /** Surfaced in juror cards so the synthetic nature is never hidden. */
  disclaimerLabel: string;
}

const POOL: Omit<JuryPersona, "id" | "displayName" | "disclaimerLabel">[] = [
  {
    ageBand: "30-44",
    occupationFamily: "healthcare",
    livedExperienceAnchor: "Night-shift nurse; values precise procedure.",
    priorTrustInSystem: "moderate",
    decisionStyle: "fact-driven",
  },
  {
    ageBand: "45-59",
    occupationFamily: "trades",
    livedExperienceAnchor: "Union electrician; suspicious of unverified claims.",
    priorTrustInSystem: "moderate",
    decisionStyle: "skeptical",
  },
  {
    ageBand: "60+",
    occupationFamily: "retired",
    livedExperienceAnchor: "Former small-business owner; respects authority.",
    priorTrustInSystem: "high",
    decisionStyle: "rules-driven",
  },
  {
    ageBand: "18-29",
    occupationFamily: "retail/service",
    livedExperienceAnchor: "Barista finishing community college; new to civic duty.",
    priorTrustInSystem: "low",
    decisionStyle: "narrative-driven",
  },
  {
    ageBand: "30-44",
    occupationFamily: "education",
    livedExperienceAnchor: "Middle-school teacher; oriented to fairness.",
    priorTrustInSystem: "moderate",
    decisionStyle: "consensus-seeking",
  },
  {
    ageBand: "45-59",
    occupationFamily: "office/admin",
    livedExperienceAnchor: "Insurance adjuster; trained to weigh documentation.",
    priorTrustInSystem: "moderate",
    decisionStyle: "fact-driven",
  },
  {
    ageBand: "30-44",
    occupationFamily: "tech",
    livedExperienceAnchor: "Software engineer; pushes back on hand-waving.",
    priorTrustInSystem: "moderate",
    decisionStyle: "skeptical",
  },
  {
    ageBand: "60+",
    occupationFamily: "public sector",
    livedExperienceAnchor: "Retired city clerk; familiar with court procedure.",
    priorTrustInSystem: "high",
    decisionStyle: "rules-driven",
  },
  {
    ageBand: "30-44",
    occupationFamily: "self-employed",
    livedExperienceAnchor: "Independent contractor; resents perceived overreach.",
    priorTrustInSystem: "low",
    decisionStyle: "narrative-driven",
  },
  {
    ageBand: "45-59",
    occupationFamily: "creative",
    livedExperienceAnchor: "Graphic designer; pattern-matches on inconsistencies.",
    priorTrustInSystem: "moderate",
    decisionStyle: "narrative-driven",
  },
  {
    ageBand: "18-29",
    occupationFamily: "tech",
    livedExperienceAnchor: "QA engineer; insists on reproducible evidence.",
    priorTrustInSystem: "low",
    decisionStyle: "skeptical",
  },
  {
    ageBand: "60+",
    occupationFamily: "retired",
    livedExperienceAnchor: "Retired logistics manager; consensus-builder.",
    priorTrustInSystem: "moderate",
    decisionStyle: "consensus-seeking",
  },
  {
    ageBand: "30-44",
    occupationFamily: "healthcare",
    livedExperienceAnchor: "EMT; experienced with police interactions on scene.",
    priorTrustInSystem: "moderate",
    decisionStyle: "fact-driven",
  },
  {
    ageBand: "45-59",
    occupationFamily: "education",
    livedExperienceAnchor: "Adult-education instructor; emphasizes due process.",
    priorTrustInSystem: "moderate",
    decisionStyle: "rules-driven",
  },
];

function venueSeed(venue: string): number {
  const h = createHash("sha256").update(venue || "default").digest();
  return h.readUInt32BE(0);
}

/**
 * Pick `count` personas (default 12). Selection is deterministic per venue
 * so re-runs of the same case produce a stable jury composition.
 */
export function juryPersonaBank(args: {
  venue: string;
  count?: number;
}): JuryPersona[] {
  const count = Math.max(1, Math.min(args.count ?? 12, POOL.length));
  const seed = venueSeed(args.venue);
  const order = POOL.map((_, i) => i).sort((a, b) => {
    // Pseudo-random but deterministic ordering keyed on venue.
    const ah = (seed * 9301 + a * 49297) % 233280;
    const bh = (seed * 9301 + b * 49297) % 233280;
    return ah - bh;
  });
  const picked = order.slice(0, count);
  return picked.map((idx, i) => {
    const base = POOL[idx]!;
    const id = `persona-${i + 1}`;
    return {
      ...base,
      id,
      displayName: `Juror ${i + 1}`,
      disclaimerLabel: "Synthetic persona — not a real person",
    };
  });
}
