import { logger } from "./logger";

/**
 * Tiny in-process FIFO promise queue with bounded concurrency.
 * Used to serialize asynchronous pipeline work (vision parse → classify →
 * draft) without taking on a full job runner dependency. Replace with a real
 * queue (BullMQ, etc.) when we move off in-process execution.
 */
export class PromiseQueue {
  private active = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly concurrency = 2) {}

  enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.active += 1;
        const startedAt = Date.now();
        try {
          const value = await task();
          resolve(value);
        } catch (err) {
          logger.error({ err, label }, "queue task failed");
          reject(err);
        } finally {
          this.active -= 1;
          logger.debug(
            { label, durationMs: Date.now() - startedAt, active: this.active },
            "queue task done",
          );
          const next = this.pending.shift();
          if (next) next();
        }
      };

      if (this.active < this.concurrency) {
        run();
      } else {
        this.pending.push(run);
      }
    });
  }

  get inFlight(): number {
    return this.active + this.pending.length;
  }
}

export const pipelineQueue = new PromiseQueue(2);
