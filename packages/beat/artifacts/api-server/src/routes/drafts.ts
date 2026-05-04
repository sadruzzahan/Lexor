import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { casesTable, draftsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "./auth.js";

type AuthedRequest = Request & { userId: string };

const router: IRouter = Router();

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

// GET /v1/cases/:caseId/draft — get the latest draft for a case
router.get("/v1/cases/:caseId/draft", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;
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
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: "Failed to get draft", details: String(err) });
  }
});

// PUT /v1/cases/:caseId/draft — upsert (create or replace) the draft
router.put("/v1/cases/:caseId/draft", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;

    const [existing] = await db
      .select()
      .from(draftsTable)
      .where(eq(draftsTable.caseId, caseId))
      .orderBy(desc(draftsTable.updatedAt))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(draftsTable)
        .set({
          body: req.body.body,
          artifactId: req.body.artifactId ?? existing.artifactId,
          updatedAt: new Date(),
        })
        .where(eq(draftsTable.id, existing.id))
        .returning();
      res.json(updated);
      return;
    }

    const [created] = await db.insert(draftsTable).values({
      caseId,
      body: req.body.body,
      artifactId: req.body.artifactId ?? null,
    }).returning();
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: "Failed to upsert draft", details: String(err) });
  }
});

export default router;
