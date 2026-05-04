import type { Response } from "express";
import type { IEventSink } from "./eventSink.js";

export class SseEmitter implements IEventSink {
  private _count = 0;
  private _closed = false;
  private _watermark: number;

  constructor(
    readonly res: Response,
    private readonly _runId: string,
    watermark = -1,
  ) {
    this._watermark = watermark;
  }

  setWatermark(idx: number): void {
    this._watermark = idx;
  }

  /**
   * Write a pre-indexed event from DbSink.
   * Events with idx <= watermark are suppressed (already sent during DB replay).
   */
  writeIndexed(idx: number, eventType: string, payload: Record<string, unknown>): void {
    if (this._closed) return;
    if (idx <= this._watermark) return;
    this._count++;
    const event = { idx, eventType, ...payload };
    try {
      this.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      this._closed = true;
    }
  }

  emit(eventType: string, payload: Record<string, unknown>): void {
    if (this._closed) return;
    const idx = this._count;
    this.writeIndexed(idx, eventType, payload);
  }

  get totalEvents(): number {
    return this._count;
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this.res.end();
    } catch {
      // ignore
    }
  }

  isClosed(): boolean {
    return this._closed;
  }
}
