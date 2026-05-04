import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { casesTable, draftsTable, shareTokensTable, artifactsTable, runsTable } from "@workspace/db/schema";
import { eq, desc, and, gt } from "drizzle-orm";
import { requireAuth } from "./auth.js";

type AuthedRequest = Request & { userId: string };

const router: IRouter = Router();

// POST /v1/cases/:id/share — create a short-lived share token (7-day expiry)
// Requires auth + case ownership
router.post("/v1/cases/:id/share", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.id);
    const userId = (req as AuthedRequest).userId;

    const [caseRow] = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, caseId))
      .limit(1);

    if (!caseRow || caseRow.deletedAt) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    if (!caseRow.userId || caseRow.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [draft] = await db
      .select()
      .from(draftsTable)
      .where(eq(draftsTable.caseId, caseId))
      .orderBy(desc(draftsTable.updatedAt))
      .limit(1);

    if (!draft) {
      res.status(404).json({ error: "No draft found for this case" });
      return;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [shareToken] = await db
      .insert(shareTokensTable)
      .values({
        caseId,
        draftId: draft.id,
        expiresAt,
      })
      .returning();

    res.json({ token: shareToken.token, expiresAt: shareToken.expiresAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to create share token", details: String(err) });
  }
});

// GET /v1/share/:token — retrieve draft + case metadata for a share token
// Intentionally PUBLIC — share links are accessed by unauthenticated recipients
router.get("/v1/share/:token", async (req, res): Promise<void> => {
  try {
    const token = String(req.params.token);
    const now = new Date();

    const [shareToken] = await db
      .select()
      .from(shareTokensTable)
      .where(
        and(
          eq(shareTokensTable.token, token),
          gt(shareTokensTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!shareToken) {
      res.status(404).json({ error: "Share link not found or has expired" });
      return;
    }

    const [caseRow] = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, shareToken.caseId))
      .limit(1);

    if (!caseRow || caseRow.deletedAt) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const draftQuery = shareToken.draftId
      ? db.select().from(draftsTable).where(eq(draftsTable.id, shareToken.draftId)).limit(1)
      : db.select().from(draftsTable).where(eq(draftsTable.caseId, shareToken.caseId)).orderBy(desc(draftsTable.updatedAt)).limit(1);

    const [draft] = await draftQuery;

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    const sceneTagRows = await db
      .select({ data: artifactsTable.data })
      .from(artifactsTable)
      .innerJoin(runsTable, eq(artifactsTable.runId, runsTable.id))
      .where(
        and(
          eq(runsTable.caseId, shareToken.caseId),
          eq(artifactsTable.kind, "scene_tags"),
        ),
      )
      .orderBy(desc(artifactsTable.createdAt))
      .limit(1);

    res.json({
      caseTitle: caseRow.title,
      caseId: caseRow.id,
      description: caseRow.description ?? null,
      draft: {
        id: draft.id,
        body: draft.body,
        updatedAt: draft.updatedAt,
      },
      sceneTags: sceneTagRows[0]?.data ?? null,
      expiresAt: shareToken.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve share", details: String(err) });
  }
});

export default router;
