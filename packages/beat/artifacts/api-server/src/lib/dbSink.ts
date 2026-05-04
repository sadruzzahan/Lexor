import type { IEventSink } from "./eventSink.js";
import type { SseEmitter } from "./sseEmitter.js";
import { db } from "@workspace/db";
import { runEventsTable } from "@workspace/db/schema";
import { AnyRunEventSchema } from "@workspace/agent-protocol";
import { z } from "zod";

const EmitPayloadSchema = z.object({
  eventType: z.string().min(1),
}).passthrough();

export class DbSink implements IEventSink {
  private _idx = 0;
  private _closed = false;
  private _live: SseEmitter | null = null;
  private _pendingWrites: Promise<unknown>[] = [];

  constructor(private readonly runId: string) {}

  setLiveSink(live: SseEmitter): void {
    this._live = live;
  }

  clearLiveSink(): void {
    this._live = null;
  }

  emit(eventType: string, payload: Record<string, unknown>): void {
    if (this._closed) return;

    const envelope = { eventType, ...payload };
    const parsed = EmitPayloadSchema.safeParse(envelope);
    if (!parsed.success) {
      console.error("[dbsink] invalid event payload, dropping:", parsed.error.message);
      return;
    }

    const fullEvent = { idx: this._idx, ...envelope };
    const protoResult = AnyRunEventSchema.safeParse(fullEvent);
    if (!protoResult.success) {
      console.warn("[dbsink] event schema mismatch:", protoResult.error.message.slice(0, 200));
    }

    const currentIdx = this._idx++;

    const writePromise = db
      .insert(runEventsTable)
      .values({ runId: this.runId, idx: currentIdx, eventType, payload })
      .then(() => undefined)
      .catch((err) => console.error(`[dbsink] persist failed idx=${currentIdx}`, err));

    this._pendingWrites.push(writePromise);
    writePromise.finally(() => {
      const pos = this._pendingWrites.indexOf(writePromise);
      if (pos !== -1) this._pendingWrites.splice(pos, 1);
    });

    if (this._live && !this._live.isClosed()) {
      this._live.writeIndexed(currentIdx, eventType, payload);
    }
  }

  async drain(): Promise<void> {
    if (this._pendingWrites.length > 0) {
      await Promise.allSettled([...this._pendingWrites]);
    }
  }

  get totalEvents(): number {
    return this._idx;
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this._live && !this._live.isClosed()) {
      this._live.close();
      this._live = null;
    }
  }

  isClosed(): boolean {
    return this._closed;
  }
}
