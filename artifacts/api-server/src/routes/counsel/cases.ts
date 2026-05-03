import { Router, type IRouter, type Request, type Response } from "express";
import { db, casesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ObjectStorageService } from "../../lib/objectStorage";
import { rateLimit } from "../../middlewares/rateLimit";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";
import { pipelineQueue } from "../../lib/queue";
import { runPipeline, subscribe } from "../../services/pipeline";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const ipLimit = rateLimit({
  name: "case-create",
  scope: "ip",
  windowMs: 60 * 60 * 1000,
  max: 30,
});

const userLimit = rateLimit({
  name: "case-finalize",
  scope: "user-or-ip",
  windowMs: 60 * 60 * 1000,
  max: 60,
});

/**
 * POST /counsel/cases
 * Creates a placeholder case row and returns a presigned upload URL.
 * Rate limited per IP for unauthenticated callers.
 */
router.post("/cases", ipLimit, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const language =
    typeof req.body?.language === "string" ? req.body.language : "en";
  const jurisdiction =
    typeof req.body?.jurisdictionHint === "string"
      ? req.body.jurisdictionHint
      : null;
  const inlineText =
    typeof req.body?.inlineText === "string" &&
    req.body.inlineText.trim().length >= 20
      ? (req.body.inlineText as string)
      : null;

  // Inline-text mode: synthetic / paste path. We skip object storage and
  // mark the case with a /text/<base64> sentinel that the pipeline knows
  // how to decode. This powers the "Try a sample" button and tests.
  if (inlineText) {
    const sentinel = `/text/${Buffer.from(inlineText, "utf8").toString("base64")}`;
    const [row] = await db
      .insert(casesTable)
      .values({
        userId,
        language,
        jurisdiction,
        status: "queued",
        vertical: "other",
        rawDocumentUrl: sentinel,
      })
      .returning();
    if (!row)
      throw new HttpError(500, "internal_error", "Could not create case");
    req.log.info({ caseId: row.id, userId, mode: "text" }, "case created");
    pipelineQueue
      .enqueue(`pipeline:${row.id}`, () => runPipeline(row.id))
      .catch((err) =>
        req.log.error({ err, caseId: row.id }, "pipeline crashed"),
      );
    // Inline-text mode: no presigned upload, no object path. We return
    // the same shape but with nulls so the OpenAPI CreateCaseResult
    // contract holds (uploadURL/objectPath nullable).
    res.json({ caseId: row.id, uploadURL: null, objectPath: null });
    return;
  }

  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);

  const [row] = await db
    .insert(casesTable)
    .values({
      userId,
      language,
      jurisdiction,
      status: "queued",
      vertical: "other",
    })
    .returning();

  if (!row) throw new HttpError(500, "internal_error", "Could not create case");

  req.log.info({ caseId: row.id, userId }, "case created");

  res.json({ caseId: row.id, uploadURL, objectPath });
});

/**
 * PATCH /counsel/cases/:id/finalize
 * Records the uploaded object path + hash and (eventually) enqueues the
 * pipeline. Pipeline implementation lives in the feature task.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCaseId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new HttpError(400, "invalid_input", "Invalid case id.");
  }
  return id;
}

/**
 * Ownership rule: a case's `userId` is set when an authenticated Clerk user
 * created it. Anonymous cases (userId === null) are readable/finalizable by
 * any caller (we have no other handle on them — the case id is the bearer
 * token). A case owned by user A is never accessible to user B.
 */
function assertCanAccess(
  row: { userId: string | null },
  callerUserId: string | null,
): void {
  if (row.userId !== null && row.userId !== callerUserId) {
    throw new HttpError(404, "not_found", "Case not found.");
  }
}

router.patch(
  "/cases/:id/finalize",
  userLimit,
  async (req: Request, res: Response) => {
    const id = parseCaseId(req);
    const objectPath =
      typeof req.body?.objectPath === "string" ? req.body.objectPath : null;
    if (!objectPath) {
      throw new HttpError(400, "invalid_input", "objectPath is required");
    }
    // Hardening: only accept presigned-storage paths through finalize.
    // The /text/<base64> sentinel is a server-side construct used only by
    // the inline-text create flow; allowing a client to set it via
    // finalize would let them inject arbitrary letter text into any case.
    if (!objectPath.startsWith("/objects/")) {
      throw new HttpError(400, "invalid_input", "objectPath must be a /objects/ path");
    }
    const rawDocumentHash =
      typeof req.body?.rawDocumentHash === "string"
        ? req.body.rawDocumentHash
        : null;

    const callerUserId = getUserId(req);
    const [existing] = await db
      .select({ userId: casesTable.userId })
      .from(casesTable)
      .where(eq(casesTable.id, id))
      .limit(1);
    if (!existing) throw new HttpError(404, "not_found", "Case not found.");
    assertCanAccess(existing, callerUserId);

    // Claim flow: an authenticated user finalizing a previously-anonymous
    // case becomes its owner. Atomic via the WHERE clause — we only set
    // userId when it is still NULL, so two concurrent claimants cannot
    // race each other into co-ownership.
    const claimUserId =
      existing.userId === null && callerUserId !== null ? callerUserId : null;

    const [updated] = await db
      .update(casesTable)
      .set({
        rawDocumentUrl: objectPath,
        rawDocumentHash,
        status: "queued",
        updatedAt: new Date(),
        ...(claimUserId ? { userId: claimUserId } : {}),
      })
      .where(
        claimUserId
          ? sql`${casesTable.id} = ${id} AND ${casesTable.userId} IS NULL`
          : eq(casesTable.id, id),
      )
      .returning();

    if (!updated) throw new HttpError(404, "not_found", "Case not found.");

    req.log.info({ caseId: id }, "case finalized — enqueueing pipeline");

    // Fire and forget — SSE consumers see the event stream; the row is
    // updated in place. Errors are caught inside the pipeline.
    pipelineQueue
      .enqueue(`pipeline:${id}`, () => runPipeline(id))
      .catch((err) => req.log.error({ err, caseId: id }, "pipeline crashed"));

    res.json(updated);
  },
);

router.get("/cases/:id", async (req: Request, res: Response) => {
  const id = parseCaseId(req);
  const callerUserId = getUserId(req);
  const [row] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "not_found", "Case not found.");
  assertCanAccess(row, callerUserId);

  // Claim-on-read: same atomic pattern as finalize. If the case is still
  // anonymous and the caller is signed in, attach them as owner.
  if (row.userId === null && callerUserId !== null) {
    const [claimed] = await db
      .update(casesTable)
      .set({ userId: callerUserId, updatedAt: new Date() })
      .where(
        sql`${casesTable.id} = ${id} AND ${casesTable.userId} IS NULL`,
      )
      .returning();
    if (claimed) {
      req.log.info(
        { caseId: id, userId: callerUserId },
        "anonymous case claimed by user",
      );
      res.json(claimed);
      return;
    }
  }

  res.json(row);
});

/**
 * GET /counsel/cases/:id/events
 * SSE stream of pipeline events. Subscribers receive each step_start /
 * step_complete and a final complete or error event. If a client connects
 * after the pipeline has finished, the route also replays the case's
 * terminal status so the UI can paint immediately.
 */
router.get("/cases/:id/events", async (req: Request, res: Response) => {
  const id = parseCaseId(req);
  // Authz: confirm the case exists and the caller may read it BEFORE we
  // attach a listener. Otherwise random UUIDs could create dangling bus
  // entries and leak step events from cases owned by other users.
  const callerUserId = getUserId(req);
  const [existing] = await db
    .select({ userId: casesTable.userId, status: casesTable.status })
    .from(casesTable)
    .where(eq(casesTable.id, id))
    .limit(1);
  if (!existing) throw new HttpError(404, "not_found", "Case not found.");
  assertCanAccess(existing, callerUserId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: "ready", caseId: id });

  const unsubscribe = subscribe(id, (event) => {
    send(event);
    if (event.type === "complete" || event.type === "error") {
      // Let the client gracefully reconnect; we don't end here so the
      // browser doesn't auto-retry.
    }
  });

  // Replay terminal status (we already loaded it during the authz check).
  if (existing.status === "complete") send({ type: "complete", caseId: id });
  else if (existing.status === "failed")
    send({ type: "error", step: "init", message: "Pipeline previously failed." });

  const heartbeat = setInterval(() => res.write(`: heartbeat\n\n`), 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

export default router;
