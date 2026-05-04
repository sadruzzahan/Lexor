/**
 * On-demand single-subagent runner (G13). Used by the Jury / Plea /
 * Adversarial "Run this" buttons — these subagents are too expensive to
 * include in the baseline planner pack, so the user fires them
 * individually after reviewing the dashboard. Each invocation creates
 * its own `runs` row + SSE stream so the existing
 * `useAgentRun(runId)` UI plumbing works unchanged.
 *
 * Lifecycle (mirrors `runDefenderRolePack` but executes exactly one
 * subagent and skips the planner step):
 *   1. mark run running, emit run_started
 *   2. parsePdf for every case file (cached in this run)
 *   3. JurisdictionDetector (re-uses cached context if present)
 *   4. emit subagent_started for the chosen subagent (pane=0)
 *   5. run subagent → emit subagent_completed + persist artifact
 *   6. emit final_result + done; mark run completed
 */
import {
  db,
  runs,
  caseFiles,
  artifacts as artifactsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { streamWriterFor, EMIT_DROPPED, type StreamWriter } from "./streamWriter";
import {
  startCostMeter,
  stopCostMeter,
  finalizeRunDecisions,
  startGuardrail,
  stopGuardrail,
  applyGate,
  judgeArtifact,
  withRetry,
  markRetried,
  withSpan,
  scheduleDrop,
} from "../engine";
import { parsePdf, type ParsedPdf } from "../tools/parsePdf";
import { runJurisdictionDetector } from "../agents/jurisdictionDetector";
import { runMockJurySimulator } from "../agents/defender/mockJurySimulator";
import { runPleaOutcomeSimulator } from "../agents/defender/pleaOutcomeSimulator";
import { runProsecutionSimulator } from "../agents/defender/prosecutionSimulator";
import type {
  SubagentEmit,
  SubagentEmitEvent,
  SubagentResult,
} from "../agents/shared";

export const ON_DEMAND_SUBAGENTS = [
  "MockJurySimulator",
  "PleaOutcomeSimulator",
  "ProsecutionSimulator",
] as const;

export type OnDemandSubagent = (typeof ON_DEMAND_SUBAGENTS)[number];

export function isOnDemandSubagent(name: string): name is OnDemandSubagent {
  return (ON_DEMAND_SUBAGENTS as readonly string[]).includes(name);
}

const ACTIVE_STATUSES = ["pending", "running"];

class CancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}

async function isCancelled(runId: string): Promise<boolean> {
  const rows = await db
    .select({ status: runs.status, cancelled: runs.cancelled })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (rows.length === 0) return true;
  const r = rows[0]!;
  return r.cancelled === true || r.status === "cancelled";
}

function makeEmit(
  writer: StreamWriter,
  subagent: string,
  checkpoint: () => Promise<void>,
): SubagentEmit {
  return async (ev: SubagentEmitEvent) => {
    await checkpoint();
    if (ev.type === "tool_call") {
      await writer.emit({
        type: "tool_call",
        subagent,
        tool: ev.tool,
        args: ev.args,
        status: ev.status,
      });
    } else if (ev.type === "tool_result") {
      await writer.emit({
        type: "tool_result",
        subagent,
        tool: ev.tool,
        resultPreview: ev.resultPreview,
      });
    } else if (ev.type === "partial_result") {
      await writer.emit({
        type: "partial_result",
        subagent,
        data: ev.data,
      });
    } else if (ev.type === "tool_progress") {
      await writer.emit({
        type: "tool_progress",
        subagent,
        tool: ev.tool,
        progress: ev.progress,
        ...(ev.note !== undefined ? { note: ev.note } : {}),
        elapsedMs: ev.elapsedMs,
        seq: ev.seq,
        ...(ev.meta ? { meta: ev.meta } : {}),
      });
    } else if (ev.type === "model_routed") {
      await writer.emit({
        type: "model_routed",
        subagent,
        taskKind: ev.taskKind,
        chosenModel: ev.chosenModel,
        provider: ev.provider,
        rationale: ev.rationale,
        candidates: ev.candidates,
        predictedCostUsd: ev.predictedCostUsd,
      });
    } else if (ev.type === "cache_hit") {
      await writer.emit({
        type: "cache_hit",
        subagent,
        taskKind: ev.taskKind,
        similarity: ev.similarity,
        cacheKey: ev.cacheKey,
        costSavedUsd: ev.costSavedUsd,
        lastUsedAt: ev.lastUsedAt,
      });
    } else if (ev.type === "policy_drop") {
      await writer.emit({
        type: "policy_drop",
        subagent: ev.subagent,
        rule: ev.rule,
        droppedPayloadPreview: ev.droppedPayloadPreview,
      });
    } else if (ev.type === "judge_score") {
      await writer.emit({
        type: "judge_score",
        subagent: ev.subagent,
        score: ev.score,
        rationale: ev.rationale,
        weakFields: ev.weakFields,
        threshold: ev.threshold,
        passed: ev.passed,
      });
    } else if (ev.type === "guardrail_warning") {
      await writer.emit({
        type: "guardrail_warning",
        state: ev.state,
        remainingUsd: ev.remainingUsd,
        ceilingUsd: ev.ceilingUsd,
        recommendation: ev.recommendation,
      });
    } else if (ev.type === "retry_exhausted") {
      await writer.emit({
        type: "retry_exhausted",
        subagent: ev.subagent,
        attempts: ev.attempts,
      });
    }
  };
}

export interface OnDemandRunOptions {
  runId: string;
  caseId: string;
  goal: string;
  subagent: OnDemandSubagent;
}

export async function runOnDemandSubagent(
  opts: OnDemandRunOptions,
): Promise<void> {
  const { runId, caseId, goal, subagent } = opts;
  const writer = streamWriterFor(runId);
  const log = logger.child({ runId, onDemand: subagent });

  const checkpoint = async () => {
    if (await isCancelled(runId)) throw new CancelledError();
  };

  try {
    await db
      .update(runs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.status, "pending")));

    await checkpoint();
    await writer.emit({
      type: "run_started",
      runId,
      rolePack: "defender",
      goal,
    });
    startCostMeter(runId, (payload) => writer.emit(payload));
    const orchestratorEmit = makeEmit(writer, "Orchestrator", checkpoint);
    await startGuardrail({ runId, emit: orchestratorEmit });

    // Step 1: parse files.
    const files = await db
      .select({ id: caseFiles.id, name: caseFiles.name })
      .from(caseFiles)
      .where(eq(caseFiles.caseId, caseId));
    const parsedFiles: ParsedPdf[] = [];
    for (const f of files) {
      await checkpoint();
      try {
        parsedFiles.push(
          await parsePdf({
            caseId,
            fileId: f.id,
            runId,
            emit: orchestratorEmit,
            subagent: "Orchestrator",
          }),
        );
      } catch (err) {
        log.warn({ err, fileId: f.id }, "parsePdf failed (continuing)");
      }
    }

    // Step 2: jurisdiction (cached after the first defender pack run).
    await checkpoint();
    const jdEmit = makeEmit(writer, "JurisdictionDetector", checkpoint);
    await jdEmit({
      type: "tool_call",
      tool: "langDetect",
      args: { files: parsedFiles.length },
      status: "running",
    });
    const { context: jurisdictionContext, cached } =
      await runJurisdictionDetector({
        caseId,
        parsedFiles,
        runId,
        emit: jdEmit,
      });
    await jdEmit({
      type: "tool_result",
      tool: "langDetect",
      resultPreview: cached
        ? `cached: ${jurisdictionContext.country}`
        : `${jurisdictionContext.country} / ${jurisdictionContext.language}`,
    });

    // Step 3: emit subagent_started (pane 0 — single-pane on-demand run).
    await checkpoint();
    await writer.emit({
      type: "subagent_started",
      subagent,
      pane: 0,
    });

    // Step 4: full G22 quality loop (run → gate → judge) wrapped in
    // `withRetry`. Same shape as the orchestrator path so on-demand
    // simulators get true reformulation on quality failure rather
    // than a blind re-roll.
    const ctx = { runId, parsedFiles, jurisdictionContext, goal };
    const emit = makeEmit(writer, subagent, checkpoint);
    const gateCtx = {
      runId,
      rolePack: "defender" as const,
      subagent,
      jurisdictionIso2: jurisdictionContext.iso2,
      emit,
    };
    const runByName = async (): Promise<SubagentResult<{ kind: string; priority: number }>> => {
      if (subagent === "MockJurySimulator") return runMockJurySimulator(emit, ctx);
      if (subagent === "PleaOutcomeSimulator") return runPleaOutcomeSimulator(emit, ctx);
      return runProsecutionSimulator(emit, ctx);
    };

    let cancelled: CancelledError | null = null;
    let lastWasGateDrop = false;
    let lastGateRule: string | null = null;
    let lastDroppedKind = "Unknown";
    const retry = await withRetry<{ kind: string; priority: number }>({
      runId,
      subagent,
      maxAttempts: 2,
      reformulate: (info) => {
        const why = info.previousReason ?? "previous attempt rejected";
        return `Previous attempt rejected (${why}). For this retry: tighten scope, address ONLY the listed weak fields, emit fewer items, and avoid adding new citations. Prefer brevity over breadth.`;
      },
      attempt: async (info) => {
        if (info.attempt > 1) await markRetried(runId, subagent);
        let result: SubagentResult<{ kind: string; priority: number }>;
        try {
          result = await withSpan(
            {
              name: `agent.${subagent}`,
              kind: "agent",
              runId,
              attributes: { "engine.subagent": subagent, "engine.attempt": info.attempt },
            },
            () => runByName(),
          );
        } catch (err) {
          if (err instanceof CancelledError) {
            cancelled = err;
            throw err;
          }
          return { ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
        const gated = await applyGate(
          result.artifact as unknown as Record<string, unknown>,
          gateCtx,
        );
        if (!gated.allowed) {
          lastWasGateDrop = true;
          lastGateRule = gated.rule;
          lastDroppedKind = result.artifact.kind;
          return {
            ok: false,
            reason: `gate-drop:${gated.rule}`,
            value: { kind: result.artifact.kind, priority: 0 },
          };
        }
        lastWasGateDrop = false;
        lastGateRule = null;
        const final = gated.artifact as unknown as { kind: string; priority: number };
        const judged = await judgeArtifact({
          runId,
          rolePack: "defender",
          subagent: info.attempt === 1 ? subagent : `${subagent}.retry`,
          artifact: final,
          emit,
        });
        if (!judged.passed) {
          return {
            ok: false,
            reason: `judge:${judged.score.toFixed(2)}<${judged.threshold} weak=[${judged.weakFields.join(",")}]`,
            value: final,
          };
        }
        return { ok: true, value: final };
      },
    });

    if (cancelled) throw cancelled as CancelledError;

    let finalArtifact: { kind: string; priority: number };
    if (lastWasGateDrop) {
      await writer.emit({
        type: "subagent_completed",
        subagent,
        data: { kind: lastDroppedKind, priority: 0, dropped: true, rule: lastGateRule },
      });
      finalArtifact = { kind: lastDroppedKind, priority: 0 };
      if (!retry.passed) {
        await writer.emit({ type: "retry_exhausted", subagent, attempts: retry.attempts });
      }
    } else if (!retry.value) {
      log.error({ runId, subagent, attempts: retry.attempts }, "On-demand subagent failed");
      await writer.emit({
        type: "error",
        subagent,
        message: retry.attempts.at(-1)?.reason ?? "subagent failed",
      });
      await writer.emit({
        type: "subagent_completed",
        subagent,
        data: { kind: "Error", priority: 0, error: true },
      });
      if (!retry.passed) {
        await writer.emit({ type: "retry_exhausted", subagent, attempts: retry.attempts });
      }
      finalArtifact = { kind: "Error", priority: 0 };
    } else {
      finalArtifact = retry.value;
      if (!retry.passed) {
        await writer.emit({
          type: "retry_exhausted",
          subagent,
          attempts: retry.attempts,
        });
      }
      await checkpoint();
      await writer.emit({
        type: "subagent_completed",
        subagent,
        data: finalArtifact,
      });
      try {
        await db.insert(artifactsTable).values({
          runId,
          subagent,
          kind: finalArtifact.kind,
          data: finalArtifact,
        });
      } catch (err) {
        log.warn({ err }, "Failed to persist on-demand artifact (continuing)");
      }
    }

    await checkpoint();
    await writer.emit({
      type: "final_result",
      data: { summary: `${subagent} ready.`, subagents: [subagent] },
    });

    const idx = await writer.emit({ type: "done", runId, cancelled: false });
    if (idx !== EMIT_DROPPED) {
      await db
        .update(runs)
        .set({ status: "completed", completedAt: new Date() })
        .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_STATUSES)));
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      log.info("On-demand subagent cancelled");
    } else {
      log.error({ err }, "On-demand subagent failed");
      try {
        // Emit an `error` SSE BEFORE the terminal `done` so the UI's
        // toast / store reducer treats the run as failed (parity with
        // the baseline orchestrator). Without this, `done(cancelled:false)`
        // alone shows "Ready" on a failed run.
        await writer.emit({
          type: "error",
          subagent,
          message: err instanceof Error ? err.message : String(err),
        });
        const errIdx = await writer.emit({
          type: "done",
          runId,
          cancelled: false,
        });
        if (errIdx !== EMIT_DROPPED) {
          await db
            .update(runs)
            .set({
              status: "error",
              completedAt: new Date(),
              errorMessage: err instanceof Error ? err.message : String(err),
            })
            .where(
              and(eq(runs.id, runId), inArray(runs.status, ACTIVE_STATUSES)),
            );
        }
      } catch (innerErr) {
        log.error({ err: innerErr }, "Failed to record on-demand failure");
      }
    }
  } finally {
    await stopCostMeter(runId).catch(() => undefined);
    finalizeRunDecisions(runId);
    stopGuardrail(runId);
    scheduleDrop(runId);
    writer.close();
  }
}
