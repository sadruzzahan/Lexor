import type { Request, Response } from "express";
import { db, runEvents } from "@workspace/db";
import { and, eq, gt, asc } from "drizzle-orm";
import { runHub } from "../orchestration/runHub";
import { logger } from "./logger";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

interface StreamOptions {
  runId: string;
  /** Last event index already seen by the client; resume at since+1. */
  since: number;
  /** Whether the run has already reached a terminal state in DB. */
  isTerminal: boolean;
}

/**
 * Stream `agent_event` SSE messages for a run. Writes are formatted as
 *   id: <idx>\nevent: agent_event\ndata: <json>\n\n
 * Replays persisted events from `run_events` first, then attaches a live
 * subscription to `runHub`. Closes the connection after the terminal `done`
 * event is delivered.
 */
export async function streamRunEvents(
  req: Request,
  res: Response,
  opts: StreamOptions,
): Promise<void> {
  const { runId, since, isTerminal } = opts;

  res.writeHead(200, SSE_HEADERS);
  res.write(`retry: 3000\n\n`);

  let lastSent = since;
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let sawDoneInHistory = false;

  const writeEvent = (idx: number, type: string, data: unknown): boolean => {
    if (closed) return false;
    if (idx <= lastSent) return false;
    lastSent = idx;
    const payload = `id: ${idx}\nevent: agent_event\ndata: ${JSON.stringify(data)}\n\n`;
    return res.write(payload);
  };

  // Release the per-run emitter when the run is terminal and no other
  // subscribers remain — keeps long-lived processes from leaking emitters.
  const maybeDropHub = (runIsTerminal: boolean): void => {
    if (!runIsTerminal) return;
    if (runHub.subscriberCount(runId) === 0) runHub.drop(runId);
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    if (unsubscribe) unsubscribe();
    res.end();
    maybeDropHub(sawDoneInHistory || isTerminal);
  };

  req.on("close", () => {
    closed = true;
    if (unsubscribe) unsubscribe();
    maybeDropHub(sawDoneInHistory || isTerminal);
  });

  // Buffer live events that arrive while we are still replaying history.
  const liveBuffer: Array<{ idx: number; type: string; data: unknown }> = [];
  let replaying = true;
  unsubscribe = runHub.subscribe(runId, (payload) => {
    if (replaying) {
      liveBuffer.push(payload);
    } else {
      writeEvent(payload.idx, payload.type, payload.data);
      if (payload.type === "done") {
        // Mark terminal so maybeDropHub() releases the emitter on the
        // live-done path too (history path sets it during replay).
        sawDoneInHistory = true;
        finish();
      }
    }
  });

  // Replay persisted history. Headers are already on the wire, so an error
  // here can't go through express error middleware — log + emit in-stream.
  let history: Array<{ idx: number; type: string; payload: unknown }> = [];
  try {
    history = await db
      .select({
        idx: runEvents.idx,
        type: runEvents.type,
        payload: runEvents.payload,
      })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.idx, since)))
      .orderBy(asc(runEvents.idx));
  } catch (err) {
    logger.error({ err, runId }, "SSE history replay failed after headers sent");
    if (!closed) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ code: "internal_error", message: "history replay failed" })}\n\n`,
      );
    }
    finish();
    return;
  }

  for (const row of history) {
    writeEvent(row.idx, row.type, row.payload);
    if (row.type === "done") sawDoneInHistory = true;
  }

  // Drain anything that arrived during replay (de-duped by lastSent).
  replaying = false;
  for (const ev of liveBuffer) {
    writeEvent(ev.idx, ev.type, ev.data);
    if (ev.type === "done") sawDoneInHistory = true;
  }

  // If the run was already terminal when we started OR we replayed past `done`,
  // close immediately. Otherwise keep the connection open for live events.
  if (sawDoneInHistory || isTerminal) {
    finish();
    return;
  }

  // Keep-alive comments every 25s in case there's a long quiet period.
  const ka = setInterval(() => {
    if (closed) {
      clearInterval(ka);
      return;
    }
    res.write(`: keepalive\n\n`);
  }, 25_000);
  req.on("close", () => clearInterval(ka));
}
