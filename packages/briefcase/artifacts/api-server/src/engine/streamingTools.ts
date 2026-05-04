/**
 * StreamingTools (G21 spec §9.7.A) — wraps a tool function so any
 * invocation that has not resolved within `THRESHOLD_MS` starts emitting
 * `tool_progress` events at a fixed cadence until it does. Tools that
 * complete fast incur zero overhead beyond a single setTimeout that is
 * cleared in the same tick.
 *
 * The wrapper is intentionally generic so each tool keeps its own
 * argument/return signature; only the `emit` is woven in from the
 * subagent that owns the call.
 */
import type { SubagentEmit } from "../agents/shared";
import { logger } from "../lib/logger";
import { record as recordCost } from "./costMeter";
import { checkGuardrail } from "./costGuardrail";
import { withSpan } from "./tracing";

const log = logger.child({ component: "streamingTools" });

export const PROGRESS_THRESHOLD_MS = 4_000;
export const PROGRESS_TICK_MS = 2_000;
/**
 * Estimated full-duration ceiling for the 0..1 progress curve. Tools
 * that finish faster never tick; tools that exceed this asymptote at
 * 0.95 so the bar never claims to be done while we're still waiting.
 */
const PROGRESS_FULL_MS = 30_000;
const PROGRESS_CEIL = 0.95;

/**
 * Per-tool USD/sec cost estimate so the byTool ledger has meaningful
 * values. External-API tools are charged at a higher rate (real $$ per
 * call); local CPU-bound tools at a token-equivalent compute rate.
 * Numbers are conservative — a tool that runs for 5s registers a few
 * cents in the ledger so the dashboard pie has a slice.
 */
const TOOL_USD_PER_SEC: Record<string, number> = {
  tavilySearch: 0.005, // paid web search API
  verifyCitation: 0.0002, // outbound HTTP only
  parsePdf: 0.0002, // OCR-bound CPU
  crossDocDiff: 0.0001, // wraps callLLM (model cost already booked)
  extractEntities: 0.0001, // wraps callLLM
  monteCarlo: 0.001, // E2B sandbox runtime
};
const TOOL_USD_PER_SEC_DEFAULT = 0.0001;

export interface RunWithProgressArgs<T> {
  tool: string;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
  /**
   * Run id so the wrapper can charge tool latency into CostMeter byTool.
   * Optional — when missing the wrapper just emits progress without
   * recording cost (e.g. unit tests, ad-hoc CLI runs).
   */
  runId?: string | undefined;
  /** Free-form metadata for the progress payload (e.g. file count). */
  meta?: Record<string, unknown> | undefined;
  fn: () => Promise<T>;
}

/**
 * Run a tool with deferred progress emission. The function is invoked
 * exactly once; if it resolves before THRESHOLD_MS, no progress events
 * are sent — the wrapper degenerates into a single try/finally.
 */
export async function runWithProgress<T>(args: RunWithProgressArgs<T>): Promise<T> {
  const t0 = Date.now();
  let started = false;
  let stopped = false;
  let firstEmit: NodeJS.Timeout | undefined;
  let tick: NodeJS.Timeout | undefined;
  let progressSeq = 0;

  const emitProgress = async () => {
    if (stopped || !args.emit) return;
    const elapsedMs = Date.now() - t0;
    // Linear estimate against PROGRESS_FULL_MS, capped at PROGRESS_CEIL
    // so we never report 1.0 while the tool is still running.
    const progress = Math.min(PROGRESS_CEIL, +(elapsedMs / PROGRESS_FULL_MS).toFixed(3));
    const note = args.meta?.note != null ? String(args.meta.note) : `${(elapsedMs / 1000).toFixed(1)}s`;
    try {
      await args.emit({
        type: "tool_progress",
        tool: args.tool,
        progress,
        note,
        elapsedMs,
        seq: progressSeq++,
        ...(args.meta ? { meta: args.meta } : {}),
      });
    } catch (err) {
      log.warn({ err, tool: args.tool }, "tool_progress emit failed (continuing)");
    }
  };

  if (args.emit) {
    firstEmit = setTimeout(() => {
      started = true;
      void emitProgress();
      tick = setInterval(() => void emitProgress(), PROGRESS_TICK_MS);
      tick.unref?.();
    }, PROGRESS_THRESHOLD_MS);
    firstEmit.unref?.();
  }

  // CostGuardrail check — tools that cost real $$ (tavilySearch,
  // monteCarlo) are gated so a halted run can't keep spending.
  if (args.runId) {
    const decision = await checkGuardrail(args.runId);
    if (decision.state === "halt") {
      throw new Error(
        `CostGuardrail halt: ${decision.recommendation || "monthly ceiling reached"}`,
      );
    }
  }

  try {
    return await withSpan(
      {
        name: `tool.${args.tool}`,
        kind: "tool",
        runId: args.runId,
        attributes: {
          "engine.tool": args.tool,
          ...(args.subagent ? { "engine.subagent": args.subagent } : {}),
        },
      },
      () => args.fn(),
    );
  } finally {
    stopped = true;
    if (firstEmit) clearTimeout(firstEmit);
    if (tick) clearInterval(tick);
    void started; // silence unused warning (kept for future telemetry)
    if (args.runId) {
      const elapsedSec = (Date.now() - t0) / 1000;
      const rate = TOOL_USD_PER_SEC[args.tool] ?? TOOL_USD_PER_SEC_DEFAULT;
      const usd = +(elapsedSec * rate).toFixed(6);
      if (usd > 0) {
        await recordCost(args.runId, {
          bucket: `tool:${args.tool}`,
          kind: "tool",
          ...(args.subagent ? { phase: args.subagent } : {}),
          usd,
        }).catch((err) =>
          log.warn({ err, tool: args.tool }, "tool cost record failed (continuing)"),
        );
      }
    }
  }
}
