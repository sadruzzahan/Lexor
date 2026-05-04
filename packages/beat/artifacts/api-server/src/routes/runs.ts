import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { casesTable, runsTable, runEventsTable } from "@workspace/db/schema";
import { eq, desc, asc, max } from "drizzle-orm";
import { SseEmitter } from "../lib/sseEmitter.js";
import { DbSink } from "../lib/dbSink.js";
import { runOrchestrator } from "../agents/orchestrator.js";
import { registerRun, unregisterRun, getRunEntry } from "../lib/runRegistry.js";
import { requireAuth } from "./auth.js";

type AuthedRequest = Request & { userId: string };

const router: IRouter = Router();

const log = (msg: string, err?: unknown) =>
  console.error(`[runs] ${msg}`, err !== undefined ? String(err) : "");

type RunEvent = typeof runEventsTable.$inferSelect;

/**
 * Assert that the authenticated user owns the case.
 * Returns the caseRow if found and owned, or null after sending an error response.
 */
async function assertCaseOwnership(
  caseId: string,
  userId: string,
  res: import("express").Response,
): Promise<typeof casesTable.$inferSelect | null> {
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!caseRow || caseRow.deletedAt) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  if (!caseRow.userId || caseRow.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return caseRow;
}

/**
 * Assert that the authenticated user owns the run (via case ownership).
 * Returns the run if found and owned, or null after sending an error response.
 */
async function assertRunOwnership(
  runId: string,
  userId: string,
  res: import("express").Response,
): Promise<typeof runsTable.$inferSelect | null> {
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return null;
  }
  const caseRow = await assertCaseOwnership(run.caseId, userId, res);
  if (!caseRow) return null;
  return run;
}

// ── POST /v1/cases/:caseId/run ────────────────────────────────────────────────
router.post("/v1/cases/:caseId/run", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;

    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;

    const [existingRun] = await db
      .select()
      .from(runsTable)
      .where(eq(runsTable.caseId, caseId))
      .orderBy(desc(runsTable.createdAt))
      .limit(1);

    if (existingRun && (existingRun.status === "running" || existingRun.status === "pending")) {
      res.status(409).json({ error: "A run is already in progress", runId: existingRun.id });
      return;
    }

    const [run] = await db
      .insert(runsTable)
      .values({ caseId, status: "pending", idempotencyKey: req.body?.idempotencyKey ?? null })
      .returning();

    res.status(201).json({ runId: run.id });

    const controller = new AbortController();
    const sink = new DbSink(run.id);
    registerRun(run.id, caseId, controller, sink);

    runOrchestrator(run.id, caseId, sink, controller.signal)
      .catch((err) => log(`background orchestrator error runId=${run.id}`, err))
      .finally(() => unregisterRun(run.id));
  } catch (err) {
    res.status(500).json({ error: "Failed to start run", details: String(err) });
  }
});

// ── GET /v1/runs/:runId — get run status ────────────────────────────────────
router.get("/v1/runs/:runId", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as AuthedRequest).userId;
    const run = await assertRunOwnership(String(req.params.runId), userId, res);
    if (!run) return;
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: "Failed to get run", details: String(err) });
  }
});

// ── DELETE /v1/runs/:runId — cancel a run ───────────────────────────────────
router.delete("/v1/runs/:runId", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as AuthedRequest).userId;
    const runId = String(req.params.runId);
    const run = await assertRunOwnership(runId, userId, res);
    if (!run) return;

    const active = getRunEntry(runId);
    if (active) {
      active.controller.abort();
      unregisterRun(runId);
    }

    await db.update(runsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(runsTable.id, runId));

    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to cancel run", details: String(err) });
  }
});

function writeEvent(res: { write: (s: string) => void }, event: RunEvent): void {
  const data = { idx: event.idx, eventType: event.eventType, ...(event.payload as object) };
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function fetchAllEvents(runId: string): Promise<RunEvent[]> {
  return db
    .select()
    .from(runEventsTable)
    .where(eq(runEventsTable.runId, runId))
    .orderBy(asc(runEventsTable.idx))
    .catch(() => [] as RunEvent[]);
}

// ── GET /v1/runs/:runId/events — SSE stream ─────────────────────────────────
router.get("/v1/runs/:runId/events", requireAuth, async (req, res): Promise<void> => {
  const runId = String(req.params.runId);
  const userId = (req as AuthedRequest).userId;

  let run: typeof runsTable.$inferSelect | undefined;
  try {
    const owned = await assertRunOwnership(runId, userId, res);
    if (!owned) return;
    run = owned;
  } catch (err) {
    res.status(500).json({ error: "Failed to start SSE stream", details: String(err) });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const isFinished =
    run.status === "completed" || run.status === "failed" || run.status === "cancelled";

  if (isFinished) {
    const events = await fetchAllEvents(runId);
    for (const event of events) writeEvent(res, event);
    if (!events.some((e) => e.eventType === "done")) {
      res.write(
        `data: ${JSON.stringify({ idx: events.length, eventType: "done", runId, totalEvents: events.length })}\n\n`,
      );
    }
    res.end();
    return;
  }

  const [maxRow] = await db
    .select({ maxIdx: max(runEventsTable.idx) })
    .from(runEventsTable)
    .where(eq(runEventsTable.runId, runId))
    .catch(() => [{ maxIdx: null as number | null }]);
  const snapshotMax: number = maxRow?.maxIdx ?? -1;

  const liveEmitter = new SseEmitter(res, runId, snapshotMax);
  const active = getRunEntry(runId);
  if (active) {
    active.sink.setLiveSink(liveEmitter);
  } else if (run.status === "pending") {
    const controller = new AbortController();
    const sink = new DbSink(runId);
    sink.setLiveSink(liveEmitter);
    registerRun(runId, run.caseId, controller, sink);
    runOrchestrator(runId, run.caseId, sink, controller.signal)
      .catch((err) => log(`fallback live orchestrator error runId=${runId}`, err))
      .finally(() => unregisterRun(runId));
  }

  const replayEvents = snapshotMax >= 0
    ? await db
        .select()
        .from(runEventsTable)
        .where(eq(runEventsTable.runId, runId))
        .orderBy(asc(runEventsTable.idx))
        .catch(() => [] as RunEvent[])
    : [];
  const bounded = replayEvents.filter((e) => e.idx <= snapshotMax);
  for (const event of bounded) writeEvent(res, event);

  const replayedMax = bounded.length > 0 ? bounded[bounded.length - 1].idx : snapshotMax;
  liveEmitter.setWatermark(replayedMax);

  req.on("close", () => {
    const a = getRunEntry(runId);
    if (a) a.sink.clearLiveSink();
    clearInterval(pollInterval);
  });

  const pollInterval = setInterval(async () => {
    try {
      const [current] = await db
        .select({ status: runsTable.status })
        .from(runsTable)
        .where(eq(runsTable.id, runId));
      if (
        !current ||
        current.status === "completed" ||
        current.status === "failed" ||
        current.status === "cancelled"
      ) {
        clearInterval(pollInterval);
        if (!res.closed) res.end();
      }
    } catch {
      // ignore transient DB errors
    }
  }, 2000);
});

export default router;
