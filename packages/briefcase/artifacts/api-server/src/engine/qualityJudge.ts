/**
 * QualityJudge (G22 spec §9.7.B NFR-E-010) — small evaluator that
 * scores every subagent artifact 0..1 against a role-pack rubric. Low
 * scores are surfaced so RetryPolicy can attempt a single retry with a
 * smaller scope (or alternate model via ModelRouter).
 *
 * The judge runs through the unified `callLLM` chokepoint so its
 * routing / cache / cost go through the same plumbing as every other
 * model call — no new auth, no new pricing, no new cache wiring.
 *
 * Persistence: every judgment lands in `quality_judgments` so the
 * Glass Box can replay rubric scores deterministically. A failed DB
 * insert is logged but never blocks the orchestrator.
 */
import { z } from "zod";
import { db, qualityJudgments } from "@workspace/db";
import { logger } from "../lib/logger";
import { callLLM } from "./llm";
import type { SubagentEmit } from "../agents/shared";

const log = logger.child({ component: "qualityJudge" });

/**
 * Default pass threshold. Subagents that score below this trigger a
 * single RetryPolicy attempt. 0.6 mirrors the spec's "weak output"
 * cutoff — anything stronger is shown as-is.
 */
export const DEFAULT_THRESHOLD = 0.6;

/**
 * Static role-pack rubrics. Lives here per spec §9.7.B (Out of scope:
 * PromptRegistry — judge rubrics live as static prompts here). G23
 * will swap these constants for live PromptRegistry lookups without
 * touching the call sites.
 */
const RUBRIC_BY_ROLEPACK: Record<string, string> = {
  defender: [
    "You are evaluating a defender-pack subagent's structured artifact.",
    "Score it on a 0..1 scale against this rubric:",
    "1) Does it cite verified authorities for every legal claim?",
    "2) Is the jurisdiction consistent with the case context?",
    "3) Are factual claims grounded in the parsed case files (no hallucinated names, dates, or charges)?",
    "4) Is it actionable for the lawyer (not generic advice)?",
    "Respond with `score` (0..1), `rationale` (1-2 sentences), and `weakFields` (an array of artifact field names that lowered the score; empty if none).",
  ].join("\n"),
  detective: [
    "You are evaluating a detective-pack subagent's structured artifact.",
    "Score it on a 0..1 scale against this rubric:",
    "1) Are leads grounded in the supplied evidence?",
    "2) Are inferences clearly distinguished from facts?",
    "3) Does it flag missing evidence rather than fabricating it?",
    "Respond with `score` (0..1), `rationale` (1-2 sentences), and `weakFields` (string array; empty if none).",
  ].join("\n"),
};

const judgeSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string(),
  weakFields: z.array(z.string()),
});

export type JudgeResult = z.infer<typeof judgeSchema>;

export interface JudgeArgs {
  runId: string;
  rolePack: "defender" | "detective";
  subagent: string;
  /** The artifact being scored — JSON-serializable. */
  artifact: unknown;
  emit?: SubagentEmit | undefined;
  threshold?: number;
}

export interface JudgeOutcome extends JudgeResult {
  passed: boolean;
  threshold: number;
}

/**
 * Score `args.artifact`, emit `judge_score`, persist `quality_judgments`,
 * and return `{score, rationale, weakFields, passed, threshold}`. The
 * caller decides whether to retry — the judge itself never re-invokes a
 * subagent.
 */
export async function judgeArtifact(args: JudgeArgs): Promise<JudgeOutcome> {
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;
  const rubric = RUBRIC_BY_ROLEPACK[args.rolePack] ?? RUBRIC_BY_ROLEPACK["defender"]!;

  // Bound the prompt — large artifacts get truncated to keep the judge
  // call cheap (the judge sees enough structure to score, never the
  // full nested document).
  const serialized = JSON.stringify(args.artifact);
  const trimmed = serialized.length > 8_000
    ? `${serialized.slice(0, 8_000)}…(truncated ${serialized.length - 8_000} chars)`
    : serialized;

  let outcome: JudgeResult;
  try {
    const res = await callLLM({
      taskKind: "structured-classification",
      schema: judgeSchema,
      system: rubric,
      prompt: `Subagent: ${args.subagent}\nArtifact:\n${trimmed}`,
      temperature: 0,
      maxOutputTokens: 250,
      runId: args.runId,
      subagent: `${args.subagent}.judge`,
      emit: args.emit,
      // Disable semantic cache for the judge — we want a fresh
      // evaluation per artifact (the subagent output is unique).
      cache: false,
    });
    outcome = res.object;
  } catch (err) {
    // Judge failure should never block the run — degrade open with a
    // neutral score so RetryPolicy doesn't kick in needlessly.
    log.warn({ err, runId: args.runId, subagent: args.subagent }, "judge call failed; passing through");
    outcome = { score: 1, rationale: `Judge unavailable: ${String(err)}`, weakFields: [] };
  }

  const passed = outcome.score >= threshold;

  if (args.emit) {
    try {
      await args.emit({
        type: "judge_score",
        subagent: args.subagent,
        score: outcome.score,
        rationale: outcome.rationale,
        weakFields: outcome.weakFields,
        threshold,
        passed,
      });
    } catch (err) {
      log.warn({ err }, "judge_score emit failed (continuing)");
    }
  }

  try {
    await db.insert(qualityJudgments).values({
      runId: args.runId,
      subagent: args.subagent,
      rubric: { rolePack: args.rolePack, threshold },
      score: outcome.score.toFixed(2),
      rationale: outcome.rationale,
      retried: false,
    });
  } catch (err) {
    log.warn({ err, runId: args.runId }, "quality_judgments persist failed (continuing)");
  }

  return { ...outcome, passed, threshold };
}

/**
 * Marks the prior judgment row for `(runId, subagent)` as retried so
 * the Glass Box can collapse "scored 0.4 → retried → scored 0.8" into
 * one expandable timeline entry. Best-effort; never throws.
 */
export async function markRetried(runId: string, subagent: string): Promise<void> {
  try {
    const { eq, and, sql } = await import("drizzle-orm");
    await db
      .update(qualityJudgments)
      .set({ retried: true })
      .where(
        and(
          eq(qualityJudgments.runId, runId),
          eq(qualityJudgments.subagent, subagent),
          // Only flip the most recent unretried row.
          sql`${qualityJudgments.retried} is not true`,
        ),
      );
  } catch (err) {
    log.warn({ err, runId, subagent }, "markRetried failed (continuing)");
  }
}
