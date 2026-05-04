/**
 * ModelRouter (G21 spec §9.7.A) — chooses the right model for the
 * declared task kind, emits a `model_routed` SSE event with rationale +
 * estimated cost, and persists the decision into
 * `model_routing_decisions` for replay / Glass Box.
 *
 * Subagents declare *intent* (taskKind) rather than picking a literal
 * model. That lets us swap a model fleet-wide (provider outage, new
 * release) by editing this file alone — every callsite stays put.
 */
import type { LanguageModel } from "ai";
type LanguageModelV2 = LanguageModel;
import {
  anthropicProvider,
  openaiProvider,
  geminiProvider,
} from "../lib/providers";
import { db, modelRoutingDecisions } from "@workspace/db";
import { logger } from "../lib/logger";
import { priceFor } from "./pricing";

/**
 * Intent buckets the rest of the engine speaks in. New subagents should
 * extend this union rather than naming a model directly.
 */
export type TaskKind =
  | "legal-reasoning" // long-context, citation-grade reasoning (planner, defender pack)
  | "structured-classification" // small structured outputs (jurisdiction, plea outcomes)
  | "vision" // multimodal, OCR-backed extraction (extractEntities)
  | "personas"; // creative role-play under a tight persona (jurors)

export interface RoutedModel {
  /** AI SDK model handle ready to drop into generateObject({model}). */
  model: LanguageModelV2;
  /** String key for cost lookup + decision logging. */
  modelId: string;
  /** Human label ("Anthropic", "OpenAI", "Google"). */
  provider: string;
}

export interface RouteCandidate {
  modelId: string;
  provider: string;
  build: () => LanguageModelV2;
  /** Lower = preferred. Ranking signal, not a hard ordering. */
  rank: number;
}

const CANDIDATES: Record<TaskKind, RouteCandidate[]> = {
  "legal-reasoning": [
    {
      modelId: "claude-sonnet-4-6",
      provider: "Anthropic",
      build: () => anthropicProvider("claude-sonnet-4-6"),
      rank: 0,
    },
    {
      modelId: "gpt-5",
      provider: "OpenAI",
      build: () => openaiProvider("gpt-5"),
      rank: 1,
    },
  ],
  "structured-classification": [
    {
      modelId: "gpt-5-mini",
      provider: "OpenAI",
      build: () => openaiProvider("gpt-5-mini"),
      rank: 0,
    },
    {
      modelId: "claude-haiku-4",
      provider: "Anthropic",
      build: () => anthropicProvider("claude-haiku-4"),
      rank: 1,
    },
  ],
  vision: [
    {
      modelId: "gemini-3-flash-preview",
      provider: "Google",
      build: () => geminiProvider("gemini-3-flash-preview"),
      rank: 0,
    },
  ],
  personas: [
    {
      modelId: "gpt-5-mini",
      provider: "OpenAI",
      build: () => openaiProvider("gpt-5-mini"),
      rank: 0,
    },
  ],
};

export interface RouteRequest {
  taskKind: TaskKind;
  runId?: string | undefined;
  subagent?: string | undefined;
  /** Approximate prompt size — used for the cost prediction only. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

export interface RouteResult extends RoutedModel {
  taskKind: TaskKind;
  rationale: string;
  candidates: Array<{ modelId: string; provider: string; rank: number }>;
  /** Predicted USD cost for this single call. */
  predictedUsd: number;
}

/**
 * Pick the best model for a taskKind. Best = lowest rank that has a
 * provider key configured at process start. If a candidate's `build()`
 * throws (e.g. missing env var), we fall back to the next.
 */
export function routeModel(req: RouteRequest): RouteResult {
  const list = CANDIDATES[req.taskKind];
  const sorted = [...list].sort((a, b) => a.rank - b.rank);
  let chosen: RouteCandidate | undefined;
  let model: LanguageModelV2 | undefined;
  let lastErr: unknown;
  for (const c of sorted) {
    try {
      model = c.build();
      chosen = c;
      break;
    } catch (err) {
      lastErr = err;
      logger.warn(
        { err, modelId: c.modelId, taskKind: req.taskKind },
        "ModelRouter candidate unavailable; trying next",
      );
    }
  }
  if (!chosen || !model) {
    throw new Error(
      `ModelRouter: no candidate available for taskKind=${req.taskKind}: ${String(lastErr)}`,
    );
  }

  const inTok = req.estimatedInputTokens ?? 1500;
  const outTok = req.estimatedOutputTokens ?? 600;
  const p = priceFor(chosen.modelId);
  const predictedUsd = +(
    (inTok * p.inputPerM + outTok * p.outputPerM) /
    1_000_000
  ).toFixed(6);

  const candidates = sorted.map((c) => ({
    modelId: c.modelId,
    provider: c.provider,
    rank: c.rank,
  }));

  const rationale =
    chosen.rank === sorted[0]!.rank
      ? `${chosen.provider} ${chosen.modelId} is the preferred model for ${req.taskKind}.`
      : `Preferred ${sorted[0]!.modelId} unavailable — fell back to ${chosen.modelId}.`;

  return {
    model,
    modelId: chosen.modelId,
    provider: chosen.provider,
    taskKind: req.taskKind,
    rationale,
    candidates,
    predictedUsd,
  };
}

/**
 * Persist a routing decision. Best-effort — never throws so a DB hiccup
 * cannot derail the run. Called by `callLLM` after each route.
 */
export async function persistDecision(args: {
  runId: string;
  idx: number;
  taskKind: TaskKind;
  candidates: RouteResult["candidates"];
  chosenModel: string;
  rationale: string;
  costUsd: number;
  latencyMs: number;
}): Promise<void> {
  try {
    await db.insert(modelRoutingDecisions).values({
      runId: args.runId,
      idx: args.idx,
      taskKind: args.taskKind,
      candidates: args.candidates,
      chosenModel: args.chosenModel,
      rationale: args.rationale,
      costUsd: args.costUsd.toFixed(6),
      latencyMs: args.latencyMs,
    });
  } catch (err) {
    logger.warn(
      { err, runId: args.runId, idx: args.idx },
      "Failed to persist model routing decision (continuing)",
    );
  }
}
