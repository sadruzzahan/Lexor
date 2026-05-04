/**
 * CostMeter (G21 spec §9.7.A) — per-run accumulator that records every
 * LLM + tool call and emits a `cost_update` SSE event at ~1Hz so the
 * Glass Box / cost rail can show live spend.
 *
 * One ledger per run, stored in-process; persistence to `agent_costs`
 * happens on every record + on stop so a crash doesn't lose the meter.
 */
import { db, agentCosts } from "@workspace/db";
import { logger } from "../lib/logger";

export interface CostRecord {
  /** "model:gpt-5-mini" / "tool:tavilySearch" — bucket label. */
  bucket: string;
  /** "model" | "tool" | other free-form. */
  kind: "model" | "tool" | "embedding";
  /** Optional subagent attribution for byPhase rollup. */
  phase?: string | undefined;
  usd: number;
}

interface Ledger {
  totalUsd: number;
  byModel: Record<string, number>;
  byTool: Record<string, number>;
  byPhase: Record<string, number>;
  /** Last value emitted on the wire — skip emit when nothing changed. */
  lastEmittedUsd: number;
  lastEmittedAt: number;
  emit?: (payload: Record<string, unknown> & { type: string }) => Promise<unknown>;
  timer?: NodeJS.Timeout;
}

const ledgers = new Map<string, Ledger>();
const log = logger.child({ component: "costMeter" });

const TICK_MS = 1000;

export function start(
  runId: string,
  emit: (payload: Record<string, unknown> & { type: string }) => Promise<unknown>,
): void {
  if (ledgers.has(runId)) {
    // Re-bind emit (fresh writer for the same run shouldn't double-tick).
    const existing = ledgers.get(runId)!;
    existing.emit = emit;
    return;
  }
  const ledger: Ledger = {
    totalUsd: 0,
    byModel: {},
    byTool: {},
    byPhase: {},
    lastEmittedUsd: -1,
    lastEmittedAt: 0,
    emit,
  };
  ledger.timer = setInterval(() => {
    void tickEmit(runId).catch((err) =>
      log.warn({ err, runId }, "costMeter tick failed (continuing)"),
    );
  }, TICK_MS);
  // Don't keep the event loop alive if the run is the only thing running.
  ledger.timer.unref?.();
  ledgers.set(runId, ledger);
}

export async function record(runId: string, rec: CostRecord): Promise<void> {
  const ledger = ledgers.get(runId);
  if (!ledger) return;
  ledger.totalUsd = +(ledger.totalUsd + rec.usd).toFixed(6);
  if (rec.kind === "model" || rec.kind === "embedding") {
    const key = rec.bucket.replace(/^model:|^embedding:/, "");
    ledger.byModel[key] = +((ledger.byModel[key] ?? 0) + rec.usd).toFixed(6);
  } else if (rec.kind === "tool") {
    const key = rec.bucket.replace(/^tool:/, "");
    ledger.byTool[key] = +((ledger.byTool[key] ?? 0) + rec.usd).toFixed(6);
  }
  if (rec.phase) {
    ledger.byPhase[rec.phase] = +((ledger.byPhase[rec.phase] ?? 0) + rec.usd).toFixed(6);
  }
  await persist(runId, ledger).catch(() => undefined);
}

async function tickEmit(runId: string): Promise<void> {
  const ledger = ledgers.get(runId);
  if (!ledger || !ledger.emit) return;
  // Skip if nothing changed since the last tick — avoids 1Hz noise.
  if (ledger.totalUsd === ledger.lastEmittedUsd) return;
  ledger.lastEmittedUsd = ledger.totalUsd;
  ledger.lastEmittedAt = Date.now();
  await ledger.emit({
    type: "cost_update",
    totalUsd: ledger.totalUsd,
    byModel: { ...ledger.byModel },
    byTool: { ...ledger.byTool },
    byPhase: { ...ledger.byPhase },
  });
}

async function persist(runId: string, ledger: Ledger): Promise<void> {
  try {
    await db
      .insert(agentCosts)
      .values({
        runId,
        totalUsd: ledger.totalUsd.toFixed(6),
        byModel: ledger.byModel,
        byTool: ledger.byTool,
        byPhase: ledger.byPhase,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentCosts.runId,
        set: {
          totalUsd: ledger.totalUsd.toFixed(6),
          byModel: ledger.byModel,
          byTool: ledger.byTool,
          byPhase: ledger.byPhase,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.warn({ err, runId }, "costMeter persist failed (continuing)");
  }
}

export async function stop(runId: string): Promise<void> {
  const ledger = ledgers.get(runId);
  if (!ledger) return;
  if (ledger.timer) clearInterval(ledger.timer);
  // Final emit + persist so the wire + DB end on the true total.
  if (ledger.emit && ledger.totalUsd !== ledger.lastEmittedUsd) {
    try {
      await ledger.emit({
        type: "cost_update",
        totalUsd: ledger.totalUsd,
        byModel: { ...ledger.byModel },
        byTool: { ...ledger.byTool },
        byPhase: { ...ledger.byPhase },
      });
    } catch (err) {
      log.warn({ err, runId }, "costMeter final emit failed (continuing)");
    }
  }
  await persist(runId, ledger).catch(() => undefined);
  ledgers.delete(runId);
}

export interface CostSnapshot {
  totalUsd: number;
  byModel: Record<string, number>;
  byTool: Record<string, number>;
  byPhase: Record<string, number>;
}

export function snapshot(runId: string): CostSnapshot | null {
  const l = ledgers.get(runId);
  if (!l) return null;
  return {
    totalUsd: l.totalUsd,
    byModel: { ...l.byModel },
    byTool: { ...l.byTool },
    byPhase: { ...l.byPhase },
  };
}
