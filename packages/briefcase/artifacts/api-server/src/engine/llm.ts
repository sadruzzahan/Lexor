/**
 * Unified LLM chokepoint — the only place subagents call into Vercel AI
 * SDK 5. All four engine subsystems hang off this entry:
 *
 *   1. ModelRouter  — taskKind → model + emit `model_routed`
 *   2. SemanticCache — embed prompt → return prior result + emit `cache_hit`
 *   3. (real call)  generateObject through the routed model
 *   4. CostMeter    — record token spend + emit `cost_update`
 *
 * Subagents pass a thin `emit` callback (the same SubagentEmit they
 * already have) so SSE events are surfaced through the existing
 * orchestrator plumbing without new wire types in shared.ts.
 */
import { generateObject } from "ai";
import type { z } from "zod";
import { routeModel, persistDecision, type TaskKind } from "./modelRouter";
import { lookup as cacheLookup, recordMiss, recordHit } from "./semanticCache";
import { record as recordCost } from "./costMeter";
import { usdCost } from "./pricing";
import { checkGuardrail, shouldDegrade } from "./costGuardrail";
import { getReformulation } from "./retryPolicy";
import { withSpan } from "./tracing";
import { logger } from "../lib/logger";
import type { SubagentEmit } from "../agents/shared";

const log = logger.child({ component: "llm" });

/**
 * Per-run monotonic counter for `model_routing_decisions.idx` so each
 * decision row in a run is uniquely ordered. Cleared in
 * `finalizeRunDecisions` when the run finishes.
 */
const decisionIdxByRun = new Map<string, number>();
function nextDecisionIdx(runId: string): number {
  const next = (decisionIdxByRun.get(runId) ?? 0) + 1;
  decisionIdxByRun.set(runId, next);
  return next - 1; // 0-based
}
/** Called by the orchestrator in finally{} to release the counter. */
export function finalizeRunDecisions(runId: string): void {
  decisionIdxByRun.delete(runId);
}

export interface CallLLMArgs<TSchema extends z.ZodTypeAny> {
  taskKind: TaskKind;
  schema: TSchema;
  prompt: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Run + subagent identity threaded for cost / routing logs + SSE. */
  runId?: string | undefined;
  subagent?: string | undefined;
  /**
   * Emit callback so model_routed / cache_hit show up on the run's SSE
   * channel. Subagents pass their own SubagentEmit; if omitted we just
   * skip emission (e.g. JurisdictionDetector cache-warm path).
   */
  emit?: SubagentEmit | undefined;
  /** Disable semantic cache for this call (default: enabled). */
  cache?: boolean;
  /**
   * Optional structured tool-args hash so callers binding the same
   * prompt template against different argument sets don't collide on
   * semantic recall (per spec NFR-E-003 cache key shape).
   */
  toolArgsHash?: string;
}

export interface CallLLMResult<T> {
  object: T;
  modelId: string;
  cached: boolean;
  usd: number;
  latencyMs: number;
}

/**
 * Single entry every subagent uses instead of bare `generateObject`. The
 * function preserves the previous failure semantics — if the model
 * throws, the error propagates so callers' try/catch + fallback logic
 * still works.
 */
export async function callLLM<TSchema extends z.ZodTypeAny>(
  args: CallLLMArgs<TSchema>,
): Promise<CallLLMResult<z.infer<TSchema>>> {
  const t0 = Date.now();

  // ------------------------------------------------------------------
  // CostGuardrail (G22 NFR-E-011) — halt on hard-stop, downgrade
  // taskKind on degrade so the cheapest candidate wins routing.
  // ------------------------------------------------------------------
  if (args.runId) {
    const decision = await checkGuardrail(args.runId);
    if (decision.state === "halt") {
      throw new Error(
        `CostGuardrail halt: ${decision.recommendation || "monthly ceiling reached"}`,
      );
    }
  }
  // When degrading, swap legal-reasoning for the cheaper structured
  // bucket so the next routeModel call picks the mini model. Other
  // task kinds already use mini-tier candidates.
  let effectiveTaskKind: TaskKind = args.taskKind;
  if (
    args.runId &&
    args.taskKind === "legal-reasoning" &&
    shouldDegrade(args.runId)
  ) {
    effectiveTaskKind = "structured-classification";
  }

  // ------------------------------------------------------------------
  // RetryPolicy reformulation (NFR-E-005) — when the current run/subagent
  // is mid-retry, prepend the registered hint to the system prompt and
  // shrink the output budget so the second attempt is materially
  // different from the first (smaller scope), not a blind re-roll.
  // ------------------------------------------------------------------
  const reformulation = args.subagent
    ? getReformulation(args.runId, args.subagent)
    : undefined;
  const effectiveSystem = reformulation
    ? `${args.system ? `${args.system}\n\n` : ""}REFORMULATION DIRECTIVE: ${reformulation}`
    : args.system;
  const effectiveMaxOutput = reformulation && args.maxOutputTokens
    ? Math.max(150, Math.floor(args.maxOutputTokens * 0.6))
    : args.maxOutputTokens;

  const route = routeModel({
    taskKind: effectiveTaskKind,
    runId: args.runId,
    subagent: args.subagent,
    estimatedInputTokens: Math.min(8000, Math.ceil(args.prompt.length / 4)),
    estimatedOutputTokens: effectiveMaxOutput ?? 800,
  });

  // Emit model_routed so the Glass Box can render the choice.
  if (args.emit) {
    try {
      await args.emit({
        type: "model_routed",
        taskKind: args.taskKind,
        chosenModel: route.modelId,
        provider: route.provider,
        rationale: route.rationale,
        candidates: route.candidates,
        predictedCostUsd: route.predictedUsd,
      });
    } catch (err) {
      log.warn({ err }, "model_routed emit failed (continuing)");
    }
  }

  // ---------------------------------------------------------------------
  // Semantic cache lookup
  // ---------------------------------------------------------------------
  const cacheKeyArgs = {
    taskKind: args.taskKind,
    model: route.modelId,
    prompt: effectiveSystem ? `${effectiveSystem}\n\n${args.prompt}` : args.prompt,
    ...(args.toolArgsHash ? { toolArgsHash: args.toolArgsHash } : {}),
    // A retry must never serve the cached first-attempt response, or
    // the "reformulation" loses all force.
    enabled: args.cache !== false && !reformulation,
  };
  const lookupRes = await cacheLookup(cacheKeyArgs);
  if (lookupRes.hit) {
    const parsed = args.schema.safeParse(lookupRes.hit.result);
    if (parsed.success) {
      const elapsed = Date.now() - t0;
      // Credit the saved spend on the cache row so /v1/cache/stats
      // shows accurate dollar savings (G21 R-25). Hit-count bump
      // happens here too via touchHit.
      await recordHit(lookupRes.hit.cacheKey, route.predictedUsd);
      if (args.emit) {
        try {
          await args.emit({
            type: "cache_hit",
            taskKind: args.taskKind,
            similarity: lookupRes.hit.similarity,
            cacheKey: lookupRes.hit.cacheKey,
            costSavedUsd: route.predictedUsd,
            lastUsedAt: lookupRes.hit.lastUsedAt,
          });
        } catch (err) {
          log.warn({ err }, "cache_hit emit failed (continuing)");
        }
      }
      if (args.runId) {
        await persistDecision({
          runId: args.runId,
          idx: nextDecisionIdx(args.runId),
          taskKind: args.taskKind,
          candidates: route.candidates,
          chosenModel: route.modelId,
          rationale: `${route.rationale} (cache hit, similarity ${lookupRes.hit.similarity.toFixed(3)})`,
          costUsd: 0,
          latencyMs: elapsed,
        });
      }
      return {
        object: parsed.data,
        modelId: route.modelId,
        cached: true,
        usd: 0,
        latencyMs: elapsed,
      };
    }
    // Stale cache schema — fall through to a fresh call. The live call
    // below will recordMiss on `lookupRes.cacheKey`; we also delete the
    // stale row first so the new write isn't a no-op via
    // onConflictDoNothing, ensuring caching resumes for this key.
    log.info({ taskKind: args.taskKind }, "cache hit failed schema validation; refetching");
    try {
      const { deleteByCacheKey } = await import("./semanticCache");
      await deleteByCacheKey(lookupRes.hit.cacheKey);
    } catch (err) {
      log.warn({ err }, "stale cache delete failed (continuing)");
    }
  }

  // ---------------------------------------------------------------------
  // Real LLM call
  // ---------------------------------------------------------------------
  const callArgs: Parameters<typeof generateObject>[0] = {
    model: route.model,
    schema: args.schema,
    prompt: args.prompt,
  };
  if (effectiveSystem !== undefined) callArgs.system = effectiveSystem;
  if (args.temperature !== undefined) callArgs.temperature = args.temperature;
  if (effectiveMaxOutput !== undefined) callArgs.maxOutputTokens = effectiveMaxOutput;
  const result = await withSpan(
    {
      name: `llm.${effectiveTaskKind}.${route.modelId}`,
      kind: "model",
      runId: args.runId,
      attributes: {
        "engine.taskKind": effectiveTaskKind,
        "engine.model": route.modelId,
        "engine.provider": route.provider,
        ...(args.subagent ? { "engine.subagent": args.subagent } : {}),
      },
    },
    () => generateObject(callArgs),
  );
  const elapsed = Date.now() - t0;

  const usage = (result as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
  const inputTokens = Number(usage?.inputTokens ?? 0);
  const outputTokens = Number(usage?.outputTokens ?? 0);
  const usd = usdCost({ model: route.modelId, inputTokens, outputTokens });

  if (args.runId) {
    await recordCost(args.runId, {
      bucket: `model:${route.modelId}`,
      kind: "model",
      ...(args.subagent ? { phase: args.subagent } : {}),
      usd,
    });
    await persistDecision({
      runId: args.runId,
      idx: nextDecisionIdx(args.runId),
      taskKind: args.taskKind,
      candidates: route.candidates,
      chosenModel: route.modelId,
      rationale: route.rationale,
      costUsd: usd,
      latencyMs: elapsed,
    });
  }

  // Cache the result for next time. parse-validated by the call already.
  await recordMiss({
    cacheKey: lookupRes.cacheKey,
    embedding: lookupRes.embedding,
    result: (result as { object: unknown }).object,
    costUsd: usd,
  });

  return {
    object: (result as { object: z.infer<TSchema> }).object,
    modelId: route.modelId,
    cached: false,
    usd,
    latencyMs: elapsed,
  };
}

