/**
 * RetryPolicy (G22 spec §9.7.B NFR-E-005) — one-shot retry with
 * exponential backoff and optional reformulation. The reformulator
 * (caller-supplied) is invoked between attempts so subagents can shrink
 * scope or hand the next attempt a hint about which fields the
 * QualityJudge marked weak.
 *
 * Each attempt is persisted to `agent_traces` so the Glass Box can show
 * the full reformulation history. Per spec, transient failures past
 * the budget surface with the full attempt log attached as the
 * thrown Error's `cause`.
 */
import { db, agentTraces } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const log = logger.child({ component: "retryPolicy" });

export interface RetryAttemptInfo<T> {
  attempt: number;
  /** Result from the previous attempt — present from attempt #2 onward. */
  previousResult?: T;
  /** Reason the previous attempt was rejected (judge weakness, error, etc). */
  previousReason?: string;
}

/**
 * Per-(runId, subagent) reformulation hints. When `withRetry` decides
 * to re-run an attempt it stores a short instruction here; `callLLM`
 * (engine/llm.ts) consumes it on the next model invocation and prepends
 * it to the system prompt so the LLM actually adapts its scope or
 * focus for the retry. The reformulator can be a caller-supplied
 * function (`RetryArgs.reformulate`) — when omitted we fall back to
 * the previous attempt's failure reason. Per spec NFR-E-005 the
 * reformulation is the difference between a "blind retry" and a
 * useful one: the second attempt must shrink scope or change tactics,
 * not just re-roll the dice.
 */
const reformulationByKey = new Map<string, string>();
function keyOf(runId: string | undefined, subagent: string): string {
  return `${runId ?? "_"}::${subagent}`;
}
export function getReformulation(
  runId: string | undefined,
  subagent: string,
): string | undefined {
  return reformulationByKey.get(keyOf(runId, subagent));
}
export function setReformulation(
  runId: string | undefined,
  subagent: string,
  hint: string,
): void {
  reformulationByKey.set(keyOf(runId, subagent), hint);
}
export function clearReformulation(
  runId: string | undefined,
  subagent: string,
): void {
  reformulationByKey.delete(keyOf(runId, subagent));
}

/** Structured reformulation history surfaced when the budget is exhausted. */
export interface RetryAttemptRecord {
  attempt: number;
  ok: boolean;
  reason?: string;
  reformulation?: string;
  elapsedMs: number;
}

/**
 * Thrown when callers pass `throwOnExhaust: true` and the retry budget
 * is exhausted. The `attempts` field carries the full structured
 * reformulation history so SSE/UI/log consumers can render every
 * tactic the engine tried before giving up — per spec NFR-E-005 the
 * surfacing must be structured, not a flat string.
 */
export class RetryExhaustedError<T> extends Error {
  readonly attempts: RetryAttemptRecord[];
  readonly subagent: string;
  readonly value: T | undefined;
  constructor(subagent: string, attempts: RetryAttemptRecord[], value: T | undefined) {
    super(`Retry budget exhausted for ${subagent} after ${attempts.length} attempt(s)`);
    this.name = "RetryExhaustedError";
    this.subagent = subagent;
    this.attempts = attempts;
    this.value = value;
  }
}

export interface RetryArgs<T> {
  runId?: string | undefined;
  subagent: string;
  /** Default 1 retry (= 2 attempts total). */
  maxAttempts?: number;
  /** Initial backoff in ms. Subsequent delays double. Default 250ms. */
  baseDelayMs?: number;
  /** Run the work — return either {ok:true, value} or {ok:false, reason, value?}. */
  attempt: (info: RetryAttemptInfo<T>) => Promise<RetryOutcome<T>>;
  /**
   * Produce the reformulation hint used by the *next* attempt. Returned
   * string is registered via `setReformulation` so the next callLLM
   * invocation in the same (runId, subagent) prepends it to the system
   * prompt. When omitted we fall back to a one-line directive built
   * from the previous failure reason ("Previous attempt rejected: …
   * Tighten scope and address the listed weak fields.").
   */
  reformulate?: (info: RetryAttemptInfo<T>) => string;
}

export type RetryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; value?: T };

export interface RetryResult<T> {
  value: T | undefined;
  /** Final attempt outcome (so callers know whether the last retry passed). */
  passed: boolean;
  attempts: RetryAttemptRecord[];
}

/**
 * Run `attempt` up to `maxAttempts` times, sleeping with exponential
 * backoff between failures. Returns the last value regardless of
 * outcome so callers can degrade gracefully (showing a weak result is
 * usually still better than nothing — the SSE judge_score event tells
 * the user the artifact is below the rubric threshold).
 */
export async function withRetry<T>(args: RetryArgs<T>): Promise<RetryResult<T>> {
  const max = args.maxAttempts ?? 2;
  const base = args.baseDelayMs ?? 250;
  const log2 = log.child({ runId: args.runId, subagent: args.subagent });

  const attempts: RetryAttemptRecord[] = [];
  let lastValue: T | undefined;
  let lastReason: string | undefined;
  let pendingReformulation: string | undefined;

  for (let i = 1; i <= max; i++) {
    const info: RetryAttemptInfo<T> = {
      attempt: i,
      ...(lastValue !== undefined ? { previousResult: lastValue } : {}),
      ...(lastReason !== undefined ? { previousReason: lastReason } : {}),
    };

    // Install the reformulation hint so callLLM picks it up for any
    // model call inside this attempt. Cleared after the attempt so a
    // subsequent unrelated subagent run isn't biased.
    if (pendingReformulation) {
      setReformulation(args.runId, args.subagent, pendingReformulation);
    } else {
      clearReformulation(args.runId, args.subagent);
    }

    const t0 = Date.now();
    let outcome: RetryOutcome<T>;
    try {
      outcome = await args.attempt(info);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      outcome = { ok: false, reason };
      log2.warn({ err, attempt: i }, "retry attempt threw");
    } finally {
      // Always release the registry entry after the attempt — the next
      // attempt sets its own (or none) before invoking.
      clearReformulation(args.runId, args.subagent);
    }
    const elapsed = Date.now() - t0;

    if (outcome.value !== undefined) lastValue = outcome.value;
    lastReason = outcome.ok ? undefined : outcome.reason;

    const record: RetryAttemptRecord = {
      attempt: i,
      ok: outcome.ok,
      elapsedMs: elapsed,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
      ...(pendingReformulation ? { reformulation: pendingReformulation } : {}),
    };
    attempts.push(record);

    // Build the hint for the *next* attempt now (so it survives the
    // backoff sleep and is in place by the time the loop re-enters).
    if (!outcome.ok && i < max) {
      const fallback = `Previous attempt rejected: ${truncate(outcome.reason, 200)}. Tighten scope and address the weak fields.`;
      pendingReformulation = args.reformulate
        ? args.reformulate({
            attempt: i + 1,
            ...(lastValue !== undefined ? { previousResult: lastValue } : {}),
            ...(lastReason !== undefined ? { previousReason: lastReason } : {}),
          })
        : fallback;
    } else {
      pendingReformulation = undefined;
    }

    // Persist this attempt to agent_traces (best-effort, never throws).
    // The reason of failed attempts is encoded into nodePath so the
    // Glass Box can render the full reformulation history (retry
    // budget exhausted ⇒ caller throws with attempts attached).
    if (args.runId) {
      try {
        const idx = await nextTraceIdx(args.runId);
        const status = outcome.ok ? "ok" : "fail";
        const reasonTag = outcome.ok ? "" : `: ${truncate(outcome.reason, 200)}`;
        await db.insert(agentTraces).values({
          runId: args.runId,
          idx,
          nodePath: `${args.subagent}/retry#${i}/${status}${reasonTag}`,
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: elapsed,
          costUsd: "0",
        });
      } catch (err) {
        log2.warn({ err }, "agent_traces persist failed (continuing)");
      }
    }

    if (outcome.ok) return { value: lastValue, passed: true, attempts };

    // Backoff before the next attempt (skip after the last).
    if (i < max) {
      const delay = base * 2 ** (i - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  log2.info({ attempts }, "retry budget exhausted; returning best-effort value");
  // Always clear so a later run with the same key starts clean.
  clearReformulation(args.runId, args.subagent);
  return { value: lastValue, passed: false, attempts };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

async function nextTraceIdx(runId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number | null>`max(${agentTraces.idx})` })
    .from(agentTraces)
    .where(eq(agentTraces.runId, runId));
  const max = rows[0]?.max;
  return max === null || max === undefined ? 0 : max + 1;
}
