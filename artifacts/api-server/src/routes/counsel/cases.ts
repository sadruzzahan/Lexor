import { Router, type IRouter, type Request, type Response } from "express";
import { db, casesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ObjectStorageService } from "../../lib/objectStorage";
import { rateLimit } from "../../middlewares/rateLimit";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";

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

    req.log.info({ caseId: id }, "case finalized");
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
 * SSE placeholder. Feature task will replace with real pipeline events.
 */
router.get("/cases/:id/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(
    `data: ${JSON.stringify({ type: "ready", caseId: req.params.id })}\n\n`,
  );
  // Heartbeat then close — real pipeline streaming arrives in Feature 1.
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    res.end();
  });
});

export default router;
