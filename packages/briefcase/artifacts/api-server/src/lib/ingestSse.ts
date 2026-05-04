/**
 * Tiny SSE writer for ingest streams (R-07/R-08). Mirrors the run-events
 * wire format: `id: <idx>\nevent: ingest_event\ndata: <json>\n\n`. Unlike
 * the run hub, ingest events are ephemeral (no DB persistence — the
 * resulting `case_files` rows are the durable state) so this writer is
 * intentionally simple: idx is local to a single connection.
 */
import type { Response } from "express";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type IngestEventPayload =
  | { type: "progress"; message?: string; progress?: number }
  | { type: "file_ingested"; file: Record<string, unknown>; message?: string }
  | { type: "error"; message: string }
  | { type: "done"; message?: string };

export interface IngestSseChannel {
  emit(payload: IngestEventPayload): void;
  end(): void;
  /** True once `end()` has been called or the client closed the socket. */
  readonly closed: boolean;
}

export function openIngestSse(res: Response): IngestSseChannel {
  res.writeHead(200, SSE_HEADERS);
  res.write(`retry: 3000\n\n`);
  let idx = 0;
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  return {
    emit(payload) {
      if (closed) return;
      const body = { idx, ...payload };
      res.write(`id: ${idx}\nevent: ingest_event\ndata: ${JSON.stringify(body)}\n\n`);
      idx += 1;
    },
    end() {
      if (closed) return;
      closed = true;
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}
