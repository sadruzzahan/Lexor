import { EventEmitter } from "node:events";

/**
 * In-memory pub/sub of agent events keyed by runId. Used by the SSE endpoint
 * to receive live events; the streamWriter publishes here after persistence.
 *
 * NOTE: Single-process only. Horizontal scaling will need Redis pub/sub.
 */
class RunHub {
  private readonly emitters = new Map<string, EventEmitter>();

  private get(runId: string): EventEmitter {
    let e = this.emitters.get(runId);
    if (!e) {
      e = new EventEmitter();
      e.setMaxListeners(50);
      this.emitters.set(runId, e);
    }
    return e;
  }

  publish(runId: string, payload: { idx: number; type: string; data: unknown }): void {
    this.get(runId).emit("event", payload);
  }

  subscribe(
    runId: string,
    handler: (payload: { idx: number; type: string; data: unknown }) => void,
  ): () => void {
    const e = this.get(runId);
    e.on("event", handler);
    return () => e.off("event", handler);
  }

  /** Number of live subscribers attached to this run's emitter. */
  subscriberCount(runId: string): number {
    const e = this.emitters.get(runId);
    return e ? e.listenerCount("event") : 0;
  }

  /** Drop the emitter once a run has terminated and replay history is complete. */
  drop(runId: string): void {
    const e = this.emitters.get(runId);
    if (e) {
      e.removeAllListeners();
      this.emitters.delete(runId);
    }
  }
}

export const runHub = new RunHub();
