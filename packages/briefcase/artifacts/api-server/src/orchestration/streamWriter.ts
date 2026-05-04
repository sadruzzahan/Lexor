import { db, runEvents } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runHub } from "./runHub";

/**
 * Single bridge between agent runners (mock today, real Mastra in G6) and the
 * SSE channel. All writes flow through here so we get one place that:
 *
 *   1. Computes the next monotonic `idx` for the run.
 *   2. Persists the event to `run_events` BEFORE publishing live (the DB
 *      trigger `run_events_monotonic_idx_trg` rejects gaps).
 *   3. Publishes to the in-memory `runHub` so live SSE listeners pick it up.
 *
 * Per-run writes are serialized by a promise chain so concurrent producers
 * cannot interleave indices.
 */

type EventPayload = { type: string } & Record<string, unknown>;
type PersistedEvent = EventPayload & { idx: number };

const queues = new Map<string, Promise<void>>();
const idxCache = new Map<string, number>();
// Set of runs that have already persisted a terminal `done`. Subsequent
// emits return EMIT_DROPPED — this is how cancel-vs-orchestrator parity is
// enforced. Bounded FIFO so long-lived processes don't grow unbounded;
// orchestrator status guards + DB monotonic-idx trigger are the backstop.
const TERMINAL_RUNS_CAP = 10_000;
const terminalRuns = new Set<string>();
function markTerminal(runId: string): void {
  if (terminalRuns.size >= TERMINAL_RUNS_CAP) {
    const oldest = terminalRuns.values().next().value;
    if (oldest) terminalRuns.delete(oldest);
  }
  terminalRuns.add(runId);
}

async function nextIdx(runId: string): Promise<number> {
  const cached = idxCache.get(runId);
  if (cached !== undefined) return cached + 1;

  const rows = await db
    .select({ max: sql<number | null>`max(${runEvents.idx})` })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  const max = rows[0]?.max;
  return max === null || max === undefined ? 0 : max + 1;
}

/** Returned by emit() when the writer has already seen a terminal event. */
export const EMIT_DROPPED = -1;

export interface StreamWriter {
  /**
   * Persist + publish an event. Returns the assigned idx, or `EMIT_DROPPED`
   * if the run is already terminal (later events are silently dropped).
   */
  emit: (payload: EventPayload) => Promise<number>;
  /** Best-effort cleanup once a run is terminal. */
  close: () => void;
}

export function streamWriterFor(runId: string): StreamWriter {
  return {
    async emit(payload: EventPayload) {
      // Fast-path: if a `done` already landed, drop without touching the DB.
      if (terminalRuns.has(runId)) return EMIT_DROPPED;

      // chain onto the per-run queue so persistence is strictly serialized
      const previous = queues.get(runId) ?? Promise.resolve();
      let resolveOuter!: (idx: number) => void;
      let rejectOuter!: (err: unknown) => void;
      const outer = new Promise<number>((res, rej) => {
        resolveOuter = res;
        rejectOuter = rej;
      });

      const next = previous
        .catch(() => undefined)
        .then(async () => {
          // Re-check inside the queue: the previous emit may itself have
          // been the `done`. Race-free without producer coordination.
          if (terminalRuns.has(runId)) {
            resolveOuter(EMIT_DROPPED);
            return;
          }
          const idx = await nextIdx(runId);
          const enriched: PersistedEvent = { idx, ...payload };
          await db.insert(runEvents).values({
            runId,
            idx,
            type: payload.type,
            payload: enriched,
          });
          idxCache.set(runId, idx);
          if (payload.type === "done") markTerminal(runId);
          runHub.publish(runId, { idx, type: payload.type, data: enriched });
          resolveOuter(idx);
        })
        .catch((err) => {
          rejectOuter(err);
        });

      queues.set(runId, next);
      return outer;
    },

    close() {
      queues.delete(runId);
      idxCache.delete(runId);
      // terminalRuns is intentionally retained so a late emit (e.g.
      // orchestrator finishing after cancel.close()) is still dropped.
    },
  };
}
