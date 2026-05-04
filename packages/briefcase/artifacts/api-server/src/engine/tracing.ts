/**
 * Tracing (G22 spec §9.7.B NFR-E-009) — light OpenTelemetry wrapper
 * around model + tool + agent calls. Spans are recorded into an
 * in-memory per-run buffer that backs the R-22 GET /v1/runs/:id/trace
 * JSON output, and forwarded into any externally-configured OTel
 * processor (when `OTEL_EXPORTER_OTLP_ENDPOINT` is set the host
 * environment will pick the same global tracer via @opentelemetry/api).
 *
 * The wrapper is dependency-light: it imports only the OTel API
 * surface. If no OTel SDK is wired, the global tracer is a no-op
 * tracer that returns a NonRecordingSpan — safe to call in unit tests
 * and dev environments without configuring a collector.
 */
import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { logger } from "../lib/logger";

const log = logger.child({ component: "tracing" });

const TRACER = trace.getTracer("briefcase-engine", "0.0.0");

export interface RecordedSpan {
  name: string;
  kind: "model" | "tool" | "agent";
  attributes: Record<string, string | number | boolean>;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
}

const buffers = new Map<string, RecordedSpan[]>();

/**
 * Per-run TTL eviction. The orchestrator calls `scheduleDrop(runId)` in
 * its `finally` block instead of dropping immediately, so completed
 * runs remain inspectable via R-22 GET /v1/runs/:id/trace for the TTL
 * window. After the window the entry is freed to bound process memory.
 */
const TRACE_TTL_MS = Number(process.env["BRIEFCASE_TRACE_TTL_MS"] ?? 30 * 60_000);
const dropTimers = new Map<string, NodeJS.Timeout>();

/**
 * Wrap an async fn in an OTel span and an in-memory record. Use sparingly
 * — every model + tool call goes through here so the wrapper has to
 * stay zero-cost in the success path.
 */
export async function withSpan<T>(
  args: {
    name: string;
    kind: RecordedSpan["kind"];
    runId?: string | undefined;
    attributes?: Record<string, string | number | boolean>;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const startMs = Date.now();
  const span = TRACER.startSpan(args.name, {
    attributes: { "engine.kind": args.kind, ...(args.attributes ?? {}) },
  });
  if (args.runId) span.setAttribute("engine.runId", args.runId);
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    record(args, startMs, "ok");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    record(args, startMs, "error", message);
    throw err;
  } finally {
    span.end();
  }
}

function record(
  args: { name: string; kind: RecordedSpan["kind"]; runId?: string | undefined; attributes?: Record<string, string | number | boolean> },
  startMs: number,
  status: "ok" | "error",
  error?: string,
): void {
  if (!args.runId) return;
  const endMs = Date.now();
  const span: RecordedSpan = {
    name: args.name,
    kind: args.kind,
    attributes: args.attributes ?? {},
    startMs,
    endMs,
    durationMs: endMs - startMs,
    status,
    ...(error ? { error } : {}),
  };
  let buf = buffers.get(args.runId);
  if (!buf) {
    buf = [];
    buffers.set(args.runId, buf);
  }
  // Cap buffer per run so a runaway loop can't OOM the process.
  if (buf.length > 5_000) buf.shift();
  buf.push(span);
}

/** Snapshot the in-memory spans for `runId`. Empty array if none. */
export function snapshotTrace(runId: string): RecordedSpan[] {
  return [...(buffers.get(runId) ?? [])];
}

/** Drop the buffer immediately. Used by tests + manual cleanup. */
export function dropTrace(runId: string): void {
  buffers.delete(runId);
  const t = dropTimers.get(runId);
  if (t) {
    clearTimeout(t);
    dropTimers.delete(runId);
  }
  log.debug({ runId }, "trace buffer dropped");
}

/**
 * Schedule TTL-based eviction of the trace buffer for `runId`. Called
 * from the orchestrator's `finally` so completed runs remain queryable
 * via R-22 for `BRIEFCASE_TRACE_TTL_MS` (default 30m) before the buffer
 * is freed.
 */
export function scheduleDrop(runId: string): void {
  const existing = dropTimers.get(runId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    buffers.delete(runId);
    dropTimers.delete(runId);
    log.debug({ runId }, "trace buffer TTL-evicted");
  }, TRACE_TTL_MS);
  t.unref?.();
  dropTimers.set(runId, t);
}
