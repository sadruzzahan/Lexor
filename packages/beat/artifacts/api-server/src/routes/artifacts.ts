import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { casesTable, artifactsTable, runsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";

type AuthedRequest = Request & { userId: string };

const router: IRouter = Router();

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
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, run.caseId));
  if (!caseRow || caseRow.deletedAt) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  if (!caseRow.userId || caseRow.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return run;
}

router.get("/v1/runs/:runId/artifacts", requireAuth, async (req, res): Promise<void> => {
  try {
    const runId = String(req.params.runId);
    const userId = (req as AuthedRequest).userId;
    const run = await assertRunOwnership(runId, userId, res);
    if (!run) return;
    const artifacts = await db.select().from(artifactsTable).where(eq(artifactsTable.runId, runId));
    res.json({ artifacts });
  } catch (err) {
    res.status(500).json({ error: "Failed to list artifacts", details: String(err) });
  }
});

router.get("/v1/artifacts/:artifactId", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = String(req.params.artifactId);
    const userId = (req as AuthedRequest).userId;
    const [artifact] = await db.select().from(artifactsTable).where(eq(artifactsTable.id, id));
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    // Verify ownership via run → case
    const run = await assertRunOwnership(artifact.runId, userId, res);
    if (!run) return;
    res.json(artifact);
  } catch (err) {
    res.status(500).json({ error: "Failed to get artifact", details: String(err) });
  }
});

export default router;
