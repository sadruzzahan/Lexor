import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../../lib/logger";

/**
 * Mirror Trial — three role-prompted Claude agents play out a simulated
 * hearing. Grounded ONLY in facts already established by the case
 * pipeline (parsed letter, detected violations, jurisdiction, opposing
 * party). The prompts forbid inventing citations or quoting non-existent
 * briefs/opinions.
 *
 * Drift from spec: live grounding in CourtListener briefs / judge
 * opinions is deferred — we do not have a CourtListener token in this
 * environment. The prompts use the same case context the rest of the
 * app has already grounded against.
 */

export type TrialCharacter = "opposing" | "judge" | "your_counsel";

export interface TrialContext {
  vertical: string;
  jurisdiction: string | null;
  opposingPartyName: string;
  documentSummary: string;
  keyClaims: string[];
  violations: Array<{
    code: string;
    statute: string;
    description: string;
    severity: string;
  }>;
}

export interface TrialTurnDraft {
  character: TrialCharacter;
  line: string;
  citation: string | null;
  ended: boolean;
}

export interface TrialVerdict {
  outcome: "plaintiff" | "defendant" | "mixed" | "undetermined";
  rationale: string;
  swingArguments: string[];
}

const COMMON_RULES = `Strict rules for every line you produce:
- Do NOT invent statute numbers, case names, or quote rulings that do not
  appear in the supplied violations list.
- If you reference a statute it MUST be one verbatim from the violations
  list (or the well-known canon implied by the vertical, e.g. FDCPA for
  debt). When in doubt, speak in plain English without a citation.
- Two sentences max per line. Courtroom-style phrasing: address the
  judge as "Your Honor". No emojis, no markdown.
- Output a SINGLE JSON object: { "line": string, "citation": string|null,
  "ended": boolean }. "ended" is true only on the Judge's final verdict.`;

function systemFor(character: TrialCharacter): string {
  if (character === "opposing") {
    return `You are OPPOSING COUNSEL — the lawyer for the party that sent
the user the letter. Your job is to argue, in good faith and within
the bounds of the law, why the letter is valid and the defendant
(the user) should lose. You are skilled but ethical. You do not
fabricate facts.

${COMMON_RULES}`;
  }
  if (character === "judge") {
    return `You are the JUDGE. You preside neutrally. You do NOT advocate.
You may ask clarifying questions, rule on objections, and at the end
of the hearing deliver a short verdict. Set "ended": true ONLY on the
verdict turn, and ONLY after both sides have argued at least twice.
Your verdict line must begin with "Verdict:" and state the outcome
("for the defendant" / "for the plaintiff" / "split").

${COMMON_RULES}`;
  }
  return `You are YOUR COUNSEL — the lawyer defending the user (the
recipient of the letter). Your job is to surface the strongest
defenses grounded in the documented violations, statutes, and facts
of the case. You are zealous but never invent law.

${COMMON_RULES}`;
}

/**
 * Render the case context as a compact briefing the agents can reason
 * over. Same shape passed to all three agents — each sees the same
 * record, but interprets it through its role prompt.
 */
function briefingText(ctx: TrialContext): string {
  const violations = ctx.violations.length
    ? ctx.violations
        .map(
          (v) =>
            `  - ${v.code} [${v.severity}] (${v.statute}) — ${v.description}`,
        )
        .join("\n")
    : "  (none specifically detected)";
  const claims = ctx.keyClaims.length
    ? ctx.keyClaims.map((c) => `  - ${c}`).join("\n")
    : "  (none extracted)";
  return `CASE BRIEFING
Vertical: ${ctx.vertical}
Jurisdiction: ${ctx.jurisdiction ?? "unknown"}
Opposing party: ${ctx.opposingPartyName}

What the letter says (key claims):
${claims}

Documented violations by the opposing party (the ONLY statutes you may cite):
${violations}`;
}

function transcriptForPrompt(
  turns: Array<{ character: TrialCharacter; line: string }>,
): string {
  if (turns.length === 0) return "(no prior turns — this is the opening)";
  return turns
    .map(
      (t) =>
        `${t.character === "opposing" ? "Opposing Counsel" : t.character === "judge" ? "Judge" : "Your Counsel"}: ${t.line}`,
    )
    .join("\n");
}

/**
 * Ask one of the three agents to produce its next turn. All three share
 * one model call shape; only the system prompt varies.
 */
export async function nextTurn(
  ctx: TrialContext,
  character: TrialCharacter,
  prior: Array<{ character: TrialCharacter; line: string }>,
): Promise<TrialTurnDraft> {
  const userPrompt = `${briefingText(ctx)}

TRANSCRIPT SO FAR:
${transcriptForPrompt(prior)}

It is your turn (${character.toUpperCase()}). Produce one short turn now as JSON.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      system: systemFor(character),
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no json in model output");
    const parsed = JSON.parse(jsonMatch[0]) as {
      line?: string;
      citation?: string | null;
      ended?: boolean;
    };
    const line = (parsed.line ?? "").trim();
    if (!line) throw new Error("empty line");
    return {
      character,
      line,
      citation: parsed.citation ?? null,
      ended: Boolean(parsed.ended),
    };
  } catch (err) {
    logger.warn({ err, character }, "trial turn fallback");
    return fallbackTurn(ctx, character, prior);
  }
}

/**
 * Heuristic mapping from a judge's verdict / rationale prose to one of
 * the four outcome enums. Used both as the catch-block fallback when
 * the LLM summary fails AND as a sanity gate that overrides the LLM
 * when it labels an outcome inconsistent with its own rationale.
 */
function inferOutcomeFromText(text: string): TrialVerdict["outcome"] {
  const lower = text.toLowerCase();
  const forDefendant =
    /for the defend|for defendant|in favor of (the )?defendant|defendant prevails|tenant prevails|tenant wins|consumer prevails|employee prevails|dismiss(ed|al|es)? (the |this )?(action|case|complaint)|grant(ed|s)? (the )?defendant|in favor of (the )?tenant|judgment for the defendant/.test(
      lower,
    );
  const forPlaintiff =
    /for the plaintiff|for plaintiff|in favor of (the )?plaintiff|plaintiff prevails|landlord prevails|judgment for the plaintiff|grant(ed|s)? (the )?plaintiff/.test(
      lower,
    );
  if (forDefendant && !forPlaintiff) return "defendant";
  if (forPlaintiff && !forDefendant) return "plaintiff";
  if (/split|mixed|partial|in part/.test(lower)) return "mixed";
  return "undetermined";
}

function fallbackTurn(
  ctx: TrialContext,
  character: TrialCharacter,
  prior: Array<{ character: TrialCharacter; line: string }>,
): TrialTurnDraft {
  // Deterministic fallbacks so a flaky upstream never leaves a half-
  // empty courtroom in the UI.
  const v = ctx.violations[0];
  if (character === "opposing") {
    return {
      character,
      line: `Your Honor, our client served notice in conformance with applicable ${ctx.vertical} law and the defendant's response is unsupported.`,
      citation: null,
      ended: false,
    };
  }
  if (character === "your_counsel") {
    return {
      character,
      line: v
        ? `Your Honor, the notice itself violates ${v.statute}: ${v.description}.`
        : `Your Honor, the notice fails to meet the statutory requirements that govern this dispute.`,
      citation: v?.statute ?? null,
      ended: false,
    };
  }
  // Judge fallback. End if we've already seen >=4 prior turns.
  const ended = prior.length >= 4;
  return {
    character,
    line: ended
      ? `Verdict: I find for the defendant on the limited record before me. The notice as drafted does not satisfy the controlling statute.`
      : `The court will hear from both sides. Counsel, proceed.`,
    citation: null,
    ended,
  };
}

/**
 * After the transcript is complete, ask Claude to summarize the verdict
 * structure (outcome + 2-3 swing arguments). Falls back to a heuristic
 * derived from the Judge's final line.
 */
export async function summarizeVerdict(
  ctx: TrialContext,
  turns: Array<{ character: TrialCharacter; line: string }>,
): Promise<TrialVerdict> {
  const judgeFinal =
    [...turns].reverse().find((t) => t.character === "judge")?.line ?? "";

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      system: `You summarize a simulated court hearing transcript.

CRITICAL ROLE MAPPING (read carefully):
- The USER (the person Lexor is helping) RECEIVED the letter and is
  represented by "Your Counsel". In a typical eviction / debt /
  termination case the user is therefore the DEFENDANT.
- The OPPOSING PARTY (landlord, debt collector, employer) sent the
  letter and is represented by "Opposing Counsel". They are the
  PLAINTIFF.
- Map the judge's ruling to whichever side WON:
    * Judge ruled for the user / "Your Counsel" / tenant / consumer /
      employee / recipient → outcome = "defendant".
    * Judge ruled for "Opposing Counsel" / landlord / collector /
      employer / sender → outcome = "plaintiff".
    * Partial wins on both sides → "mixed".
    * No clear ruling → "undetermined".

Output a single JSON object: { "outcome": "plaintiff"|"defendant"|
"mixed"|"undetermined", "rationale": string, "swingArguments":
string[] }. "swingArguments" lists the 2-3 arguments that most
influenced the verdict, each one short (<= 25 words). Do not invent
statutes.`,
      messages: [
        {
          role: "user",
          content: `${briefingText(ctx)}

TRANSCRIPT:
${transcriptForPrompt(turns)}

Summarize now.`,
        },
      ],
    });
    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no json");
    const parsed = JSON.parse(jsonMatch[0]) as TrialVerdict;
    if (
      !["plaintiff", "defendant", "mixed", "undetermined"].includes(
        parsed.outcome,
      )
    ) {
      throw new Error("invalid outcome");
    }
    // Sanity gate: the model frequently confuses plaintiff/defendant
    // because both layperson and procedural framings exist. Cross-check
    // against the actual judge final line + rationale text and override
    // when they disagree unambiguously.
    const heuristic = inferOutcomeFromText(
      `${judgeFinal} ${String(parsed.rationale ?? "")}`,
    );
    const finalOutcome =
      heuristic !== "undetermined" && heuristic !== parsed.outcome
        ? heuristic
        : parsed.outcome;
    return {
      outcome: finalOutcome,
      rationale: String(parsed.rationale ?? "").slice(0, 1000),
      swingArguments: Array.isArray(parsed.swingArguments)
        ? parsed.swingArguments.slice(0, 3).map((s) => String(s).slice(0, 200))
        : [],
    };
  } catch (err) {
    logger.warn({ err }, "verdict summary fallback");
    const outcome = inferOutcomeFromText(judgeFinal);
    return {
      outcome,
      rationale:
        judgeFinal ||
        "The simulated hearing did not produce a clear verdict on the limited record.",
      swingArguments: ctx.violations
        .slice(0, 3)
        .map((v) => `${v.code} (${v.statute}) — ${v.description}`),
    };
  }
}
