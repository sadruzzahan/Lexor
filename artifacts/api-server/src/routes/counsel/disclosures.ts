import { Router, type IRouter, type Request, type Response } from "express";
import { db, disclosuresTable } from "@workspace/db";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";

const router: IRouter = Router();

/**
 * POST /counsel/disclosures/ack
 * Records a row proving we surfaced the legal disclaimer. Anonymous users
 * pass a sessionId; authenticated users get their userId attached.
 */
router.post("/disclosures/ack", async (req: Request, res: Response) => {
  const version =
    typeof req.body?.version === "string" ? req.body.version : null;
  if (!version) {
    throw new HttpError(400, "invalid_input", "version is required");
  }
  const sessionId =
    typeof req.body?.sessionId === "string" && req.body.sessionId.length > 0
      ? req.body.sessionId
      : null;
  const userId = getUserId(req);

  // Every disclosure row must be attributable to *something* — an anonymous
  // visitor's sessionId or an authenticated Clerk user. Refuse otherwise so
  // the audit log is not polluted with un-attributable acks.
  if (!userId && !sessionId) {
    throw new HttpError(
      400,
      "invalid_input",
      "sessionId is required for anonymous users.",
    );
  }

  const [row] = await db
    .insert(disclosuresTable)
    .values({ userId, sessionId, version })
    .returning();

  if (!row) throw new HttpError(500, "internal_error", "Could not record");

  req.log.info(
    { disclosureId: row.id, userId, sessionId, version },
    "disclosure acknowledged",
  );

  res.json({ ok: true, shownAt: row.shownAt });
});

export default router;
