import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { casesTable, artifactsTable, runsTable } from "@workspace/db/schema";
import { eq, isNull, and, desc, count, lt, sql } from "drizzle-orm";
import { requireAuth } from "./auth";

type AuthedRequest = Request & { userId: string };

const router: IRouter = Router();

router.get("/v1/cases", requireAuth, async (req, res): Promise<void> => {
  try {
    const { status, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const userId = (req as AuthedRequest).userId;

    const userFilter = eq(casesTable.userId, userId);
    const notDeleted = isNull(casesTable.deletedAt);

    const whereClause = status
      ? and(
          userFilter,
          eq(casesTable.status, status as "open" | "closed" | "archived"),
          notDeleted,
        )
      : and(userFilter, notDeleted);

    const rows = await db
      .select()
      .from(casesTable)
      .where(whereClause)
      .orderBy(desc(casesTable.createdAt))
      .limit(Number(limit))
      .offset(Number(offset));

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(casesTable)
      .where(whereClause);

    res.json({ cases: rows, total: Number(total) });
  } catch (err) {
    res.status(500).json({ error: "Failed to list cases", details: String(err) });
  }
});

router.post("/v1/cases", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as AuthedRequest).userId;
    const [created] = await db.insert(casesTable).values({
      title: req.body.title,
      description: req.body.description ?? null,
      rolePack: req.body.rolePack ?? "detective",
      goal: req.body.goal ?? null,
      language: req.body.language ?? "en",
      userId,
      jurisdictionContext: req.body.jurisdictionContext ?? null,
      status: "open",
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: "Invalid body", details: String(err) });
  }
});

router.get("/v1/cases/:caseId", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const [found] = await db.select().from(casesTable).where(eq(casesTable.id, id));
    if (!found || found.deletedAt) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!found.userId || found.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Include artifacts from the latest run for this case
    const [latestRun] = await db
      .select({ id: runsTable.id })
      .from(runsTable)
      .where(eq(runsTable.caseId, id))
      .orderBy(desc(runsTable.createdAt))
      .limit(1);

    const artifacts = latestRun
      ? await db.select().from(artifactsTable).where(eq(artifactsTable.runId, latestRun.id))
      : [];

    res.json({ ...found, artifacts });
  } catch (err) {
    res.status(500).json({ error: "Failed to get case", details: String(err) });
  }
});

router.patch("/v1/cases/:caseId", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const [existing] = await db.select().from(casesTable).where(eq(casesTable.id, id));
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!existing.userId || existing.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const updates: Partial<typeof casesTable.$inferInsert> = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.goal !== undefined) updates.goal = req.body.goal;
    if (req.body.language !== undefined) updates.language = req.body.language;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.jurisdictionContext !== undefined) updates.jurisdictionContext = req.body.jurisdictionContext;
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(casesTable)
      .set(updates)
      .where(eq(casesTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update case", details: String(err) });
  }
});

router.delete("/v1/cases/:caseId", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const [existing] = await db.select().from(casesTable).where(eq(casesTable.id, id));
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    if (!existing.userId || existing.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.update(casesTable).set({ deletedAt: new Date() }).where(eq(casesTable.id, id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete case", details: String(err) });
  }
});

/**
 * DELETE /v1/cases
 * Admin bulk soft-delete for test/orphan cleanup.
 * Only available outside production (NODE_ENV !== "production").
 *
 * Query params:
 *   olderThan    — age in hours; accepts plain numbers ("24") or "Nh" format ("24h"). Default: 24.
 *   titlePattern — PostgreSQL regex pattern. Default: ^(E2E|@api|Capture pipeline|Audio-during-run)
 *
 * Returns { deleted: number }
 */
router.delete("/v1/cases", async (req, res): Promise<void> => {
  if (process.env["NODE_ENV"] === "production") {
    res.status(403).json({ error: "Not available in production" });
    return;
  }

  try {
    const rawOlderThan = String(req.query["olderThan"] ?? "24");
    const olderThanHours = Number(rawOlderThan.replace(/h$/i, ""));
    if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
      res.status(400).json({ error: "Invalid olderThan value; expected a number of hours e.g. '24' or '24h'" });
      return;
    }

    const titlePattern = String(
      req.query["titlePattern"] ?? "^(E2E|@api|Capture pipeline|Audio-during-run)",
    );

    const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);

    const deleted = await db
      .update(casesTable)
      .set({ deletedAt: new Date() })
      .where(
        and(
          isNull(casesTable.deletedAt),
          lt(casesTable.createdAt, cutoff),
          sql`${casesTable.title} ~ ${titlePattern}`,
        ),
      )
      .returning({ id: casesTable.id });

    res.json({ deleted: deleted.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to bulk-purge cases", details: String(err) });
  }
});

export default router;
