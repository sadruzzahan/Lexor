/**
 * CostGuardrail (G22 spec §9.7.B NFR-E-011) — per-user / per-tenant
 * monthly USD ceiling enforcement.
 *
 *   - Read once per run start and cached for the duration of the run.
 *   - Each call site (callLLM, runWithProgress) calls `check(runId)` to
 *     find out whether to (a) proceed normally, (b) degrade to a
 *     cheaper model (when remainingUsd is small but positive), or
 *     (c) halt outright (when ceiling exceeded with hard_stop=true).
 *   - Emits a single `guardrail_warning` per state transition so the
 *     UI doesn't get spammed.
 */
import { db, costCeilings, agentCosts, runs, cases } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { snapshot as snapshotCost } from "./costMeter";
import type { SubagentEmit } from "../agents/shared";

const log = logger.child({ component: "costGuardrail" });

export type GuardrailState = "ok" | "degrade" | "halt";

interface RunCeiling {
  /** Resolved monthly USD cap from cost_ceilings (lowest applicable). */
  monthlyUsd: number;
  hardStop: boolean;
  /** Current month's already-spent USD across this scope (best-effort). */
  monthSpentUsdAtStart: number;
  /** Most recent state we emitted, for change detection. */
  lastState: GuardrailState;
  emit?: SubagentEmit | undefined;
  /** Cached so multiple checks per call don't re-query Postgres. */
  userId?: string | undefined;
}

const ceilings = new Map<string, RunCeiling>();

/** Default ceiling when no row exists. Generous enough to never bite in dev. */
const DEFAULT_MONTHLY_USD = 250;

/**
 * Initialize the guardrail for `runId`. Call once at orchestrator start;
 * pulls the active ceiling for the run's owner from `cost_ceilings`
 * (preferring the user-scoped row over the global default).
 */
export async function startGuardrail(args: {
  runId: string;
  emit?: SubagentEmit | undefined;
}): Promise<void> {
  let monthlyUsd = DEFAULT_MONTHLY_USD;
  let hardStop = true;
  let userId: string | undefined;
  try {
    // Resolve the run's owning user via the existing runs→cases join.
    const rows = await db
      .select({ userId: cases.userId })
      .from(runs)
      .innerJoin(cases, eq(cases.id, runs.caseId))
      .where(eq(runs.id, args.runId))
      .limit(1);
    userId = rows[0]?.userId;

    // Resolve the ceiling using user → tenant → global precedence.
    // Tenant-mapping for users isn't modeled yet, so the tenant tier
    // is read for any tenant-scoped row whose scopeId === userId
    // (lets ops set per-account tenant overrides today; will become a
    // proper users.tenantId join when Org/Tenant lands). Global rows
    // are stored with scope IS NULL or scope = 'global'.
    const candidates = await db
      .select()
      .from(costCeilings)
      .where(
        userId
          ? inArray(costCeilings.scope, ["user", "tenant", "global"])
          : eq(costCeilings.scope, "global"),
      );
    const userRow = candidates.find(
      (r) => r.scope === "user" && r.scopeId === userId,
    );
    const tenantRow = candidates.find(
      (r) => r.scope === "tenant" && r.scopeId === userId,
    );
    const globalRow = candidates.find((r) => r.scope === "global");
    const chosen = userRow ?? tenantRow ?? globalRow;
    if (chosen) {
      monthlyUsd = Number(chosen.monthlyUsd ?? DEFAULT_MONTHLY_USD);
      hardStop = chosen.hardStop;
    }
  } catch (err) {
    log.warn({ err, runId: args.runId }, "guardrail config load failed; using default ceiling");
  }

  // Sum the rest of this user's runs this month so the new run starts
  // with the correct remaining budget. Best-effort — a failed query
  // just means the new run has the full ceiling to itself.
  let monthSpentUsdAtStart = 0;
  try {
    if (userId) {
      const startOfMonth = new Date();
      startOfMonth.setUTCDate(1);
      startOfMonth.setUTCHours(0, 0, 0, 0);
      const all = await db
        .select({ totalUsd: agentCosts.totalUsd, updatedAt: agentCosts.updatedAt })
        .from(agentCosts)
        .innerJoin(runs, eq(runs.id, agentCosts.runId))
        .innerJoin(cases, eq(cases.id, runs.caseId))
        .where(eq(cases.userId, userId));
      monthSpentUsdAtStart = all
        .filter((r) => r.updatedAt && r.updatedAt >= startOfMonth)
        .reduce((s, r) => s + Number(r.totalUsd ?? 0), 0);
    }
  } catch (err) {
    log.warn({ err, runId: args.runId }, "guardrail month-spent query failed");
  }

  ceilings.set(args.runId, {
    monthlyUsd,
    hardStop,
    monthSpentUsdAtStart,
    lastState: "ok",
    ...(args.emit ? { emit: args.emit } : {}),
    ...(userId ? { userId } : {}),
  });
}

/** Drop the in-memory entry once the run finishes. */
export function stopGuardrail(runId: string): void {
  ceilings.delete(runId);
}

export interface GuardrailDecision {
  state: GuardrailState;
  remainingUsd: number;
  recommendation: string;
}

/**
 * Check the current ledger against the cached ceiling. Cheap — reads
 * the in-memory CostMeter snapshot, no DB hit. Emits
 * `guardrail_warning` only when the state changes from the previous
 * check so a 1Hz cost tick doesn't spam the wire.
 */
export async function checkGuardrail(runId: string): Promise<GuardrailDecision> {
  const cfg = ceilings.get(runId);
  if (!cfg) {
    return { state: "ok", remainingUsd: Number.POSITIVE_INFINITY, recommendation: "" };
  }
  const live = snapshotCost(runId);
  const spentThisRun = live?.totalUsd ?? 0;
  const totalSpent = cfg.monthSpentUsdAtStart + spentThisRun;
  const remainingUsd = +(cfg.monthlyUsd - totalSpent).toFixed(6);

  let state: GuardrailState;
  let recommendation: string;
  if (remainingUsd <= 0 && cfg.hardStop) {
    state = "halt";
    recommendation = `Monthly ceiling of $${cfg.monthlyUsd.toFixed(2)} reached. Halting further model + tool calls for this run.`;
  } else if (remainingUsd <= cfg.monthlyUsd * 0.1) {
    state = "degrade";
    recommendation = `Less than 10% of the monthly $${cfg.monthlyUsd.toFixed(2)} budget remaining; routing future calls to cheaper models.`;
  } else {
    state = "ok";
    recommendation = "";
  }

  if (state !== cfg.lastState) {
    cfg.lastState = state;
    if (state !== "ok" && cfg.emit) {
      try {
        await cfg.emit({
          type: "guardrail_warning",
          state,
          remainingUsd,
          ceilingUsd: cfg.monthlyUsd,
          recommendation,
        });
      } catch (err) {
        log.warn({ err, runId }, "guardrail_warning emit failed (continuing)");
      }
    }
  }

  return { state, remainingUsd, recommendation };
}

/**
 * Hook used by ModelRouter.routeModel to bias toward cheaper
 * candidates when state==='degrade'. Read-only — never throws.
 */
export function shouldDegrade(runId: string): boolean {
  const cfg = ceilings.get(runId);
  return cfg?.lastState === "degrade";
}
