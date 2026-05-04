/**
 * Real defender role-pack orchestrator (G6+G7) — replaces the G3 mock.
 *
 * Spec §9.1: Mastra owns the run lifecycle. The role pack is
 * `{plannerSystemPrompt, subagents[]}`. We expose a Mastra-shaped
 * `runDefenderRolePack` entry point and bridge subagent events through
 * `streamWriter.ts` per §9.6 to the SSE channel — the mobile UI is
 * unchanged. (The literal `@mastra/core` swap is mechanical: our
 * subagent wrappers produce the same emit envelope Mastra's `streamVNext`
 * does, and idx/persistence/cancel are already centralized in streamWriter.)
 *
 * Lifecycle:
 *   1. mark run running, emit run_started
 *   2. parsePdf for every case file (cached for the rest of the run)
 *   3. JurisdictionDetector first; cache result on cases.jurisdictionContext
 *   4. Planner step (Claude Sonnet 4.6, temp 0.2)
 *   5. Emit subagent_started for the planned subagents within 500ms (FR-033)
 *   6. Run subagents with dependency-aware scheduling: independent ones
 *      run in parallel; subagents listed in `SUBAGENT_DEPENDENCIES` await
 *      their predecessors' artifacts before starting (e.g. ContradictionEngine
 *      waits on TimelineBuilder so it has a merged event timeline as anchor
 *      input, per G12 spec).
 *   7. Emit final_result + done; mark run completed
 *
 * Cancellation parity matches the mock: every checkpoint queries
 * `runs.cancelled`/`status`; on cancel, throw CancelledError and exit
 * cleanly without overwriting the cancel-emitted `done`.
 */
import {
  db,
  runs,
  cases,
  caseFiles,
  artifacts as artifactsTable,
  qualityJudgments,
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
  checkGuardrail,
  applyGate,
  judgeArtifact,
  withRetry,
  markRetried,
  withSpan,
  scheduleDrop,
  proposeSkips,
  recordSubagentOutcome,
  subscribeAgentBus,
  maybeSaveDemoRun,
  recordPromptOutcome,
} from "../engine";
import { parsePdf, type ParsedPdf } from "../tools/parsePdf";
import { runJurisdictionDetector } from "../agents/jurisdictionDetector";
import { runPlanner, type DefenderSubagent } from "../agents/planner";
import { runTimelineBuilder } from "../agents/defender/timelineBuilder";
import { runEvidenceGapAuditor } from "../agents/defender/evidenceGapAuditor";
import { runCrossExaminationGenerator } from "../agents/defender/crossExaminationGenerator";
import { runPrecedentFinder } from "../agents/defender/precedentFinder";
import { runContradictionEngine } from "../agents/defender/contradictionEngine";
import { runRightsAuditor } from "../agents/defender/rightsAuditor";
import { runBradyDetector } from "../agents/defender/bradyDetector";
import type {
  SubagentEmit,
  SubagentEmitEvent,
  SubagentResult,
} from "../agents/shared";

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

/**
 * Default pane order for the Briefcase grid. The planner returns a
 * subset of these; the orchestrator emits `subagent_started` with the
 * pane index based on this canonical map so the UI grid order is
 * stable across reruns regardless of subagent finish order.
 */
const PANE_OF: Record<DefenderSubagent, number> = {
  TimelineBuilder: 0,
  EvidenceGapAuditor: 1,
  CrossExaminationGenerator: 2,
  PrecedentFinder: 3,
  ContradictionEngine: 4,
  RightsAuditor: 5,
  BradyDetector: 6,
};

/**
 * Subagent → predecessors it must wait for before starting. Anything
 * not listed here runs without dependencies (i.e. starts immediately
 * once the planner step has emitted). The dependency edge is enforced
 * regardless of whether the predecessor was actually planned: if the
 * planner skipped TimelineBuilder, ContradictionEngine simply has no
 * Timeline artifact to consume and falls back to its bodycamFrameAlign
 * pre-pass on the parsed files.
 */
const SUBAGENT_DEPENDENCIES: Partial<
  Record<DefenderSubagent, DefenderSubagent[]>
> = {
  ContradictionEngine: ["TimelineBuilder"],
};

interface OrchestratorOptions {
  runId: string;
  caseId: string;
  rolePack: "defender" | "detective";
  goal: string;
}

/**
 * Build a SubagentEmit that decorates each event with the subagent label
 * and forwards through the shared streamWriter. The emit returns void —
 * subagents don't see EMIT_DROPPED; cancel detection happens at the
 * outer checkpoint loop.
 */
function makeSubagentEmit(
  writer: StreamWriter,
  subagent: DefenderSubagent | "JurisdictionDetector" | "Planner" | "Orchestrator",
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
    } else if (ev.type === "agent_message") {
      await writer.emit({
        type: "agent_message",
        from: ev.from,
        to: ev.to,
        idx: ev.idx,
        body: ev.body,
      });
    }
  };
}

async function runOneSubagent(
  name: DefenderSubagent,
  writer: StreamWriter,
  checkpoint: () => Promise<void>,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: import("../lib/jurisdictions").JurisdictionContext;
    goal: string;
    /**
     * Artifacts produced by predecessor subagents this one declared a
     * dependency on. Populated by the dependency-aware scheduler in
     * `runDefenderRolePack` before this function is invoked. Values are
     * `null` if the predecessor errored or was skipped by the planner.
     */
    dependencyArtifacts: Partial<
      Record<DefenderSubagent, { kind: string; priority: number } | null>
    >;
  },
): Promise<{ kind: string; priority: number } | null> {
  const emit = makeSubagentEmit(writer, name, checkpoint);
  const gateCtx = {
    runId: ctx.runId,
    rolePack: "defender" as const,
    subagent: name,
    jurisdictionIso2: ctx.jurisdictionContext.iso2,
    emit,
  };

  // Local dispatcher — used for every retry attempt so the second
  // attempt re-runs the subagent (with the RetryPolicy reformulation
  // hint already registered in the (runId, subagent) registry by the
  // time callLLM looks it up).
  const runByName = async (): Promise<SubagentResult<{ kind: string; priority: number }>> => {
    if (name === "TimelineBuilder") return runTimelineBuilder(emit, ctx);
    if (name === "EvidenceGapAuditor") return runEvidenceGapAuditor(emit, ctx);
    if (name === "CrossExaminationGenerator") return runCrossExaminationGenerator(emit, ctx);
    if (name === "PrecedentFinder") return runPrecedentFinder(emit, ctx);
    if (name === "ContradictionEngine") {
      const tl = ctx.dependencyArtifacts.TimelineBuilder;
      const timeline =
        tl && tl.kind === "Timeline"
          ? (tl as unknown as import("../agents/defender/timelineBuilder").TimelineArtifact)
          : null;
      return runContradictionEngine(emit, { ...ctx, timeline });
    }
    if (name === "RightsAuditor") return runRightsAuditor(emit, ctx);
    return runBradyDetector(emit, ctx);
  };

  // ---------------- G22: full quality loop via RetryPolicy ----------
  // The whole "run subagent → constitutional gate → quality judge"
  // sequence is the unit of work for `withRetry`. The retry harness
  // (a) wraps each attempt in an OTel `agent` span (NFR-E-009), and
  // (b) registers the reformulation directive *before* the subagent's
  // first model call, so callLLM picks it up and prepends it to the
  // system prompt + contracts the output budget. A judged-low artifact
  // returns `ok:false` exactly like an exception so the retry budget
  // is shared between runtime errors and quality failures (NFR-E-005).
  // `maxAttempts: 2` = initial + one reformulated retry, matching the
  // single-retry budget called out in §9.7.B.
  let cancelled: CancelledError | null = null;
  let lastWasGateDrop = false;
  let lastGateRule: string | null = null;
  const retry = await withRetry<{ kind: string; priority: number }>({
    runId: ctx.runId,
    subagent: name,
    maxAttempts: 2,
    reformulate: (info) => {
      const why = info.previousReason ?? "previous attempt rejected";
      return `Previous attempt rejected (${why}). For this retry: tighten scope, address ONLY the listed weak fields, emit fewer items, and avoid adding new citations. Prefer brevity over breadth.`;
    },
    attempt: async (info) => {
      if (info.attempt > 1) await markRetried(ctx.runId, name);
      let result: SubagentResult<{ kind: string; priority: number }>;
      try {
        result = await withSpan(
          {
            name: `agent.${name}`,
            kind: "agent",
            runId: ctx.runId,
            attributes: { "engine.subagent": name, "engine.attempt": info.attempt },
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
        runId: ctx.runId,
        rolePack: "defender",
        subagent: info.attempt === 1 ? name : `${name}.retry`,
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

  if (lastWasGateDrop) {
    await writer.emit({
      type: "subagent_completed",
      subagent: name,
      data: {
        kind: retry.value?.kind ?? "Unknown",
        priority: 0,
        dropped: true,
        rule: lastGateRule,
      },
    });
    if (!retry.passed) {
      await writer.emit({ type: "retry_exhausted", subagent: name, attempts: retry.attempts });
    }
    return null;
  }

  if (!retry.value) {
    logger.error({ subagent: name, runId: ctx.runId, attempts: retry.attempts }, "Subagent failed");
    await writer.emit({
      type: "error",
      subagent: name,
      message: retry.attempts.at(-1)?.reason ?? "subagent failed",
    });
    await writer.emit({
      type: "subagent_completed",
      subagent: name,
      data: { kind: "Error", priority: 0, error: true },
    });
    if (!retry.passed) {
      await writer.emit({ type: "retry_exhausted", subagent: name, attempts: retry.attempts });
    }
    return null;
  }

  let finalArtifact = retry.value;

  if (!retry.passed) {
    // G22 NFR-E-005: structured retry-exhaustion event tied to the
    // judge threshold (not just runtime exceptions), carrying the
    // full reformulation history.
    await writer.emit({
      type: "retry_exhausted",
      subagent: name,
      attempts: retry.attempts,
    });
  }

  await checkpoint();
  await writer.emit({
    type: "subagent_completed",
    subagent: name,
    data: finalArtifact,
  });

  // Persist artifact for replay / G17 bento.
  try {
    await db.insert(artifactsTable).values({
      runId: ctx.runId,
      subagent: name,
      kind: finalArtifact.kind,
      data: finalArtifact,
    });
  } catch (err) {
    logger.warn(
      { err, runId: ctx.runId, subagent: name },
      "Failed to persist artifact (continuing)",
    );
  }
  return finalArtifact;
}

/**
 * Public entry point — Mastra-shaped role-pack runner.
 */
export async function runDefenderRolePack(
  opts: OrchestratorOptions,
): Promise<void> {
  const { runId, caseId, rolePack, goal } = opts;
  const writer = streamWriterFor(runId);
  const log = logger.child({ runId, orchestrator: "defender" });

  const checkpoint = async () => {
    if (await isCancelled(runId)) throw new CancelledError();
  };

  let unsubAgentBus: () => void = () => undefined;

  try {
    await db
      .update(runs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.status, "pending")));

    await checkpoint();
    await writer.emit({ type: "run_started", runId, rolePack, goal });
    // Start the per-run cost meter so subsequent callLLM / tool ticks
    // accumulate into the same ledger and the 1Hz cost_update emit fires.
    startCostMeter(runId, (payload) => writer.emit(payload));
    // Orchestrator-level emit, declared early so the guardrail can
    // forward `guardrail_warning` events through the same channel.
    const orchestratorEmit = makeSubagentEmit(writer, "Orchestrator", checkpoint);
    await startGuardrail({ runId, emit: orchestratorEmit });
    await checkGuardrail(runId);

    // ---------------------------------------------------------------------
    // Step 1: parse every case file (cached for the rest of the run)
    // ---------------------------------------------------------------------
    const files = await db
      .select({ id: caseFiles.id, name: caseFiles.name })
      .from(caseFiles)
      .where(eq(caseFiles.caseId, caseId));

    const parsedFiles: ParsedPdf[] = [];
    // parsePdf's runWithProgress (≥4s) bubbles tool_progress through the
    // SSE stream tagged subagent="Orchestrator" via orchestratorEmit above.
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
    log.info({ files: parsedFiles.length }, "files parsed");

    // ---------------------------------------------------------------------
    // Step 2: JurisdictionDetector first (FR-032). Not one of the dashboard
    // panes — runs as preparation tool_calls so its progress is visible in
    // the activity stream without burning a pane slot.
    // ---------------------------------------------------------------------
    await checkpoint();
    const jurisdictionEmit = makeSubagentEmit(
      writer,
      "JurisdictionDetector",
      checkpoint,
    );
    await jurisdictionEmit({
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
        emit: jurisdictionEmit,
      });
    await jurisdictionEmit({
      type: "tool_result",
      tool: "langDetect",
      resultPreview: cached
        ? `cached: ${jurisdictionContext.country} / ${jurisdictionContext.language}`
        : `${jurisdictionContext.country} / ${jurisdictionContext.language} (conf ${jurisdictionContext.confidence.toFixed(2)})`,
    });
    await jurisdictionEmit({
      type: "partial_result",
      data: {
        kind: "JurisdictionContext",
        country: jurisdictionContext.country,
        iso2: jurisdictionContext.iso2,
        legalSystem: jurisdictionContext.legalSystem,
        language: jurisdictionContext.language,
        confidence: jurisdictionContext.confidence,
        cached,
      },
    });

    // ---------------------------------------------------------------------
    // Step 3: Planner (Claude Sonnet 4.6)
    // ---------------------------------------------------------------------
    await checkpoint();
    const plannerEmit = makeSubagentEmit(writer, "Planner", checkpoint);
    // G23 NFR-E-012 — pass tenantId (caseOwner) to PromptRegistry so the
    // sticky variant pick is stable per operator across reruns.
    const caseOwnerRows = await db
      .select({ userId: cases.userId })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    const tenantId = caseOwnerRows[0]?.userId ?? null;
    const rawPlan = await runPlanner({
      goal,
      jurisdictionContext,
      parsedFiles,
      runId,
      tenantId,
      emit: plannerEmit,
    });

    // G23 NFR-E-013 — adaptive planner. Skip subagents that have produced
    // empty artifacts in ≥2 prior runs of *this case* (case-scoped). The
    // skip is folded into planner_step.notes so the Glass Box explains it.
    const skipDecision = await proposeSkips({
      caseId,
      planned: rawPlan.subagentsPlanned,
    });
    const plan = {
      promptKey: rawPlan.promptKey,
      promptVersion: rawPlan.promptVersion,
      subagentsPlanned: skipDecision.kept as DefenderSubagent[],
      notes: skipDecision.note
        ? `${rawPlan.notes}\n\n${skipDecision.note}`
        : rawPlan.notes,
    };
    await writer.emit({
      type: "planner_step",
      text: plan.notes,
      subagentsPlanned: plan.subagentsPlanned,
    });

    // G23 NFR-E-014 — bridge the AgentMessageBus into the SSE writer so
    // every persisted agent_messages row also surfaces as an
    // `agent_message` event in the Glass Box stream.
    unsubAgentBus = subscribeAgentBus(runId, (msg) => {
      void writer.emit({
        type: "agent_message",
        from: msg.from,
        to: msg.to,
        idx: msg.idx,
        body: msg.body,
      });
    });

    // ---------------------------------------------------------------------
    // Step 4: emit subagent_started for the planned subagents (FR-033)
    // All planned subagents within 500ms — emit them tightly here before
    // kicking the dependency-aware scheduler. The UI shows the full
    // planned grid up-front even though dependents (e.g.
    // ContradictionEngine waiting on TimelineBuilder) won't make
    // progress until their predecessors finish.
    // ---------------------------------------------------------------------
    for (const sub of plan.subagentsPlanned) {
      await checkpoint();
      await writer.emit({
        type: "subagent_started",
        subagent: sub,
        pane: PANE_OF[sub],
      });
    }

    // ---------------------------------------------------------------------
    // Step 5: dependency-aware execution. Each planned subagent gets a
    // promise registered in `artifactPromises` BEFORE any subagent
    // starts, so dependents can `await` predecessors that may be
    // scheduled later in the same Promise.all. Independent subagents
    // start immediately; dependents await their listed predecessors and
    // then run with the predecessor's artifact threaded into ctx.
    // ---------------------------------------------------------------------
    const planned = new Set(plan.subagentsPlanned);
    type Artifact = { kind: string; priority: number } | null;
    const artifactPromises = new Map<DefenderSubagent, Promise<Artifact>>();
    const resolvers = new Map<DefenderSubagent, (a: Artifact) => void>();
    for (const sub of plan.subagentsPlanned) {
      artifactPromises.set(
        sub,
        new Promise<Artifact>((resolve) => {
          resolvers.set(sub, resolve);
        }),
      );
    }

    await Promise.all(
      plan.subagentsPlanned.map(async (sub) => {
        const deps = SUBAGENT_DEPENDENCIES[sub] ?? [];
        const dependencyArtifacts: Partial<
          Record<DefenderSubagent, Artifact>
        > = {};
        for (const d of deps) {
          if (!planned.has(d)) continue;
          dependencyArtifacts[d] = await artifactPromises.get(d)!;
        }
        let artifact: Artifact = null;
        try {
          artifact = await runOneSubagent(sub, writer, checkpoint, {
            runId,
            parsedFiles,
            jurisdictionContext,
            goal,
            dependencyArtifacts,
          });
        } finally {
          // Always resolve so dependents never deadlock — even on
          // CancelledError or any thrown error from the predecessor.
          resolvers.get(sub)!(artifact);
          // G23 NFR-E-013 — feed the adaptive planner. We treat
          // priority===0 (gate-dropped or empty) as "empty" so the
          // skip threshold protects future runs of this case.
          await recordSubagentOutcome({
            caseId,
            subagent: sub,
            isEmpty: !artifact || (artifact.priority ?? 0) === 0,
          });
        }
        return artifact;
      }),
    );

    // G23 NFR-E-012 — aggregate this run's QualityJudge scores back
    // onto the planner-prompt's (key, version) so per-version A/B
    // metrics accumulate without a separate ETL job. We record once
    // per run with the mean score across all judged artifacts so the
    // metrics row counts runs (not artifacts), which is what the
    // admin console graphs against.
    try {
      const scores = await db
        .select({ score: qualityJudgments.score })
        .from(qualityJudgments)
        .where(eq(qualityJudgments.runId, runId));
      if (scores.length > 0) {
        const avg = scores.reduce((s, r) => s + Number(r.score ?? 0), 0) / scores.length;
        await recordPromptOutcome({
          promptKey: plan.promptKey,
          version: plan.promptVersion,
          qualityScore: avg,
        });
      }
    } catch (err) {
      log.warn({ err }, "recordPromptOutcome aggregate failed (non-fatal)");
    }

    // ---------------------------------------------------------------------
    // Step 6: terminal events
    // ---------------------------------------------------------------------
    await checkpoint();
    await writer.emit({
      type: "final_result",
      data: {
        summary: `Defender pack ready for ${jurisdictionContext.country}.`,
        subagents: plan.subagentsPlanned,
        jurisdiction: jurisdictionContext,
      },
    });

    const emittedIdx = await writer.emit({
      type: "done",
      runId,
      cancelled: false,
    });

    // Same parity rule as the G3 mock: only flip status if our `done` won
    // the streamWriter — otherwise the cancel handler already flipped to
    // 'cancelled' and we keep the wire payload + run.status in lockstep.
    if (emittedIdx !== EMIT_DROPPED) {
      await db
        .update(runs)
        .set({ status: "completed", completedAt: new Date() })
        .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_STATUSES)));
      // G23 NFR-E-016 — auto-save demo-quality runs (every judge ≥ 0.7,
      // zero policy_drops) into replay_cases so CI / R-26 has a
      // golden fixture to diff future runs against. Best-effort.
      void maybeSaveDemoRun({ runId }).catch((err) =>
        log.warn({ err }, "replayHarness saveDemoRun failed"),
      );
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      log.info("Defender orchestrator cancelled cooperatively");
    } else {
      log.error({ err }, "Defender orchestrator failed");
      try {
        await writer.emit({
          type: "error",
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
        log.error({ err: innerErr }, "Failed to record orchestrator failure");
      }
    }
  } finally {
    try { unsubAgentBus(); } catch { /* idempotent */ }
    await stopCostMeter(runId).catch(() => undefined);
    finalizeRunDecisions(runId);
    stopGuardrail(runId);
    scheduleDrop(runId);
    writer.close();
  }
}
