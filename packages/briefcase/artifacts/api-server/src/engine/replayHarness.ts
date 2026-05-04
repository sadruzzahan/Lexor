/**
 * G23 ReplayHarness — NFR-E-016.
 *
 * Two responsibilities:
 *
 * 1. **Auto-save** runs marked demo-quality (passed every QualityJudge,
 *    no policy_drops, finished ok) into `replay_cases`. The expected
 *    payload is the final artifact set so future runs can diff against
 *    a stable golden.
 * 2. **Replay** — re-execute the *current* defender orchestrator on the
 *    same case (fresh run row, same goal+rolePack), wait for it to
 *    finish, and diff the freshly produced artifacts against the golden
 *    expected map. This is what makes the harness a real regression
 *    suite: a behavior change in any subagent surfaces as a diff,
 *    not a missing event.
 *
 * The CLI (`scripts/replay.ts`) walks every replay_cases row and exits
 * non-zero on any failure so it can run in CI.
 */
import {
  db,
  replayCases,
  replayRuns,
  runs,
  artifacts as artifactsTable,
  qualityJudgments,
  policyDrops,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runDefenderRolePack } from "../orchestration/orchestrator";

export interface ReplayCaseSummary {
  id: string;
  runId: string | null;
  label: string;
  tags: string[];
  createdAt: string;
}

export interface ReplayDiffItem {
  artifact: string;
  reason: string;
}

export interface ReplayRunResult {
  replayCaseId: string;
  runId: string | null;
  passed: boolean;
  /** Wrapped to match OpenAPI ReplayRunResult.diff (object with items[]). */
  diff: { items: ReplayDiffItem[] };
}

async function isDemoQuality(runId: string): Promise<boolean> {
  const judges = await db
    .select({ score: qualityJudgments.score })
    .from(qualityJudgments)
    .where(eq(qualityJudgments.runId, runId));
  if (judges.length === 0) return false;
  const allPassed = judges.every((j) => Number(j.score ?? 0) >= 0.7);
  if (!allPassed) return false;
  const drops = await db
    .select({ id: policyDrops.id })
    .from(policyDrops)
    .where(eq(policyDrops.runId, runId))
    .limit(1);
  return drops.length === 0;
}

/**
 * Auto-save a run as a replay fixture if it qualifies. Idempotent:
 * a second call for the same runId is a no-op.
 */
export async function maybeSaveDemoRun(args: {
  runId: string;
  tags?: string[];
}): Promise<string | null> {
  if (!(await isDemoQuality(args.runId))) return null;

  const existing = await db
    .select({ id: replayCases.id })
    .from(replayCases)
    .where(eq(replayCases.runId, args.runId))
    .limit(1);
  if (existing.length > 0) return existing[0]!.id;

  const finals = await db
    .select({ kind: artifactsTable.kind, data: artifactsTable.data })
    .from(artifactsTable)
    .where(eq(artifactsTable.runId, args.runId));

  const expected: Record<string, unknown> = {};
  for (const a of finals) expected[a.kind] = a.data;

  const [row] = await db
    .insert(replayCases)
    .values({
      runId: args.runId,
      // Stable pointer back to the originating run; the replay path
      // resolves the caseId from `runs.runId` so the fixture row stays
      // schema-stable even as we evolve the harness.
      fixtureUri: `db://runs/${args.runId}`,
      expected,
      tags: args.tags ?? ["auto-saved", "demo-quality"],
    })
    .returning({ id: replayCases.id });

  logger.info({ runId: args.runId, replayCaseId: row?.id }, "replayHarness: saved demo run");
  return row?.id ?? null;
}

export async function listReplayCases(): Promise<ReplayCaseSummary[]> {
  const rows = await db.select().from(replayCases);
  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    label: (r.tags?.[0] ?? "replay") + ` (${(r.createdAt ?? new Date()).toISOString().slice(0, 10)})`,
    tags: r.tags ?? [],
    createdAt: (r.createdAt ?? new Date()).toISOString(),
  }));
}

/**
 * Re-execute the current defender orchestrator on the originating
 * case in a fresh runId, then diff produced artifacts against the
 * golden `expected` map. Mismatches are persisted to `replay_runs`.
 *
 * Determinism note: the LLM path is non-deterministic; this is why
 * the diff treats payload differences as regressions to investigate
 * rather than hard failures of the orchestrator. Stronger determinism
 * comes from the deterministic-replay mode (LLM mock), wired in a
 * follow-up.
 */
export async function runReplay(replayCaseId: string): Promise<ReplayRunResult> {
  const rows = await db
    .select()
    .from(replayCases)
    .where(eq(replayCases.id, replayCaseId))
    .limit(1);
  const fixture = rows[0];
  if (!fixture) throw new Error(`replay case not found: ${replayCaseId}`);

  const expected = (fixture.expected as Record<string, unknown>) ?? {};
  const diff: ReplayDiffItem[] = [];

  if (!fixture.runId) {
    diff.push({ artifact: "*", reason: "fixture has no originating runId (regression)" });
    return persistAndReturn(replayCaseId, null, diff);
  }

  // Resolve the originating case + goal so we can re-run identically.
  const originRows = await db
    .select({ caseId: runs.caseId, rolePack: runs.rolePack, goal: runs.goal })
    .from(runs)
    .where(eq(runs.id, fixture.runId))
    .limit(1);
  const origin = originRows[0];
  if (!origin) {
    diff.push({ artifact: "*", reason: "originating run no longer exists (regression)" });
    return persistAndReturn(replayCaseId, null, diff);
  }

  // Fresh run row for the replay; status starts pending so the
  // orchestrator's own status transitions still apply.
  const [inserted] = await db
    .insert(runs)
    .values({
      caseId: origin.caseId,
      rolePack: origin.rolePack,
      goal: origin.goal,
      status: "pending",
    })
    .returning({ id: runs.id });
  const newRunId = inserted!.id;

  try {
    await runDefenderRolePack({
      runId: newRunId,
      caseId: origin.caseId,
      rolePack: origin.rolePack as "defender" | "detective",
      goal: origin.goal ?? "",
    });
  } catch (err) {
    diff.push({
      artifact: "*",
      reason: `replay execution threw: ${(err as Error).message} (regression)`,
    });
    return persistAndReturn(replayCaseId, newRunId, diff);
  }

  const produced = await db
    .select({ kind: artifactsTable.kind, data: artifactsTable.data })
    .from(artifactsTable)
    .where(eq(artifactsTable.runId, newRunId));
  const observed: Record<string, unknown> = {};
  for (const a of produced) observed[a.kind] = a.data;

  // "Identical or improved" rule (NFR-E-016). LLM re-runs almost
  // never byte-equal a prior run, so we cannot demand bitwise
  // equality. Instead we apply a measurable improvement gate:
  //
  //   - Missing expected artifact     → REGRESSION (fail)
  //   - Payload differs AND new run's
  //     mean QualityJudge score
  //     >= origin run's mean score    → IMPROVEMENT (pass with note)
  //   - Payload differs AND new mean
  //     < origin mean                 → REGRESSION (fail)
  //   - Additional artifact kinds in
  //     the new run that weren't in
  //     the golden set                → IMPROVEMENT (pass, ignored)
  //
  // The mean is computed across all subagents in the run because
  // quality_judgments rows are keyed by (run_id, subagent) — not by
  // artifact kind — so a per-kind comparison would require a join
  // column we don't store today.
  const originAvg = await avgQualityForRun(fixture.runId);
  const newAvg = await avgQualityForRun(newRunId);
  for (const [kind, want] of Object.entries(expected)) {
    const got = observed[kind];
    if (got === undefined) {
      diff.push({ artifact: kind, reason: "missing in replay (regression)" });
      continue;
    }
    if (stableStringify(want) !== stableStringify(got)) {
      const improved = newAvg !== null && originAvg !== null && newAvg >= originAvg;
      const note = `origin=${originAvg?.toFixed(2) ?? "n/a"} new=${newAvg?.toFixed(2) ?? "n/a"}`;
      diff.push({
        artifact: kind,
        reason: improved
          ? `payload differs but quality non-regressed (${note}) (improvement)`
          : `payload differs and quality regressed (${note}) (regression)`,
      });
    }
  }
  return persistAndReturn(replayCaseId, newRunId, diff);
}

async function avgQualityForRun(runId: string): Promise<number | null> {
  const rows = await db
    .select({ score: qualityJudgments.score })
    .from(qualityJudgments)
    .where(eq(qualityJudgments.runId, runId));
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + Number(r.score ?? 0), 0);
  return total / rows.length;
}

function isRegression(d: ReplayDiffItem): boolean {
  return d.reason.includes("regression");
}

async function persistAndReturn(
  replayCaseId: string,
  runId: string | null,
  diff: ReplayDiffItem[],
): Promise<ReplayRunResult> {
  // Pass when no entry is a hard regression. Divergences still surface
  // in the diff payload so reviewers can investigate.
  const passed = !diff.some(isRegression);
  try {
    await db.insert(replayRuns).values({
      replayCaseId,
      runId,
      passed,
      diff: { items: diff },
    });
  } catch (err) {
    logger.warn({ err }, "replayHarness: replay_runs insert failed");
  }
  return { replayCaseId, runId, passed, diff: { items: diff } };
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}
