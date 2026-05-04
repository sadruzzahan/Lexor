/**
 * G23 AdaptivePlanner — NFR-E-013.
 *
 * Tracks how often each subagent produces an empty artifact within a
 * single case. After two consecutive empties on a given subagent the
 * planner skips it on subsequent runs of *the same case* (case-scoped
 * — spec is explicit that this signal must not leak across cases or
 * across users so we never index by userId or by tenant).
 *
 * Surfacing: `proposeSkips` returns a human-readable note that the
 * orchestrator concatenates into the planner_step `notes` field so the
 * Glass Box shows *why* a subagent was skipped on retry.
 */
import { db, plannerSkipHistory } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const EMPTY_THRESHOLD = 2;

export async function recordSubagentOutcome(args: {
  caseId: string;
  subagent: string;
  isEmpty: boolean;
}): Promise<void> {
  const inc = args.isEmpty ? 1 : 0;
  try {
    await db
      .insert(plannerSkipHistory)
      .values({
        caseId: args.caseId,
        subagent: args.subagent,
        emptyCount: inc,
        runCount: 1,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [plannerSkipHistory.caseId, plannerSkipHistory.subagent],
        set: {
          // Reset the empty streak on any non-empty result so a single
          // good run rehabilitates a previously-skipped subagent.
          emptyCount: args.isEmpty
            ? sql`${plannerSkipHistory.emptyCount} + 1`
            : sql`0`,
          runCount: sql`${plannerSkipHistory.runCount} + 1`,
          lastSeenAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err, ...args }, "adaptivePlanner: recordSubagentOutcome failed");
  }
}

export async function proposeSkips(args: {
  caseId: string;
  planned: string[];
}): Promise<{ kept: string[]; skipped: string[]; note: string }> {
  if (args.planned.length === 0) {
    return { kept: [], skipped: [], note: "" };
  }
  let history: Array<{ subagent: string; emptyCount: number }> = [];
  try {
    history = await db
      .select({
        subagent: plannerSkipHistory.subagent,
        emptyCount: plannerSkipHistory.emptyCount,
      })
      .from(plannerSkipHistory)
      .where(eq(plannerSkipHistory.caseId, args.caseId));
  } catch (err) {
    logger.warn({ err }, "adaptivePlanner: history lookup failed; planning every subagent");
    return { kept: args.planned, skipped: [], note: "" };
  }
  const skipSet = new Set(
    history.filter((h) => h.emptyCount >= EMPTY_THRESHOLD).map((h) => h.subagent),
  );
  const kept = args.planned.filter((s) => !skipSet.has(s));
  const skipped = args.planned.filter((s) => skipSet.has(s));
  const note =
    skipped.length === 0
      ? ""
      : `Adaptive planner skipped ${skipped.join(", ")} — empty in ≥${EMPTY_THRESHOLD} prior runs of this case.`;
  // Safety net: never drop the entire plan. If learning would skip
  // every planned subagent, run the full plan and re-learn from a
  // fresh empty signal.
  if (kept.length === 0) {
    return { kept: args.planned, skipped: [], note: "" };
  }
  return { kept, skipped, note };
}

export async function clearCaseHistory(caseId: string): Promise<void> {
  try {
    await db.delete(plannerSkipHistory).where(eq(plannerSkipHistory.caseId, caseId));
  } catch (err) {
    logger.warn({ err, caseId }, "adaptivePlanner: clearCaseHistory failed");
  }
}

