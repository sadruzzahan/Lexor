import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";

type AuthedRequest = Request & { userId: string };

const router: IRouter = Router();

/**
 * GET /v1/users/:userId
 * Returns a user's own profile. Users can only access their own record.
 */
router.get("/v1/users/:userId", requireAuth, async (req, res): Promise<void> => {
  try {
    const requestedId = String(req.params.userId);
    const authUserId = (req as AuthedRequest).userId;

    if (requestedId !== authUserId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [found] = await db.select().from(usersTable).where(eq(usersTable.id, requestedId));
    if (!found) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: "Failed to get user", details: String(err) });
  }
});

/**
 * PATCH /v1/users/:userId
 * Updates own user profile. Users can only modify their own record.
 * Tier changes are not user-controlled (ignored in body).
 */
router.patch("/v1/users/:userId", requireAuth, async (req, res): Promise<void> => {
  try {
    const requestedId = String(req.params.userId);
    const authUserId = (req as AuthedRequest).userId;

    if (requestedId !== authUserId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, requestedId));
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
    if (req.body.email !== undefined) updates.email = req.body.email;

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, requestedId))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update user", details: String(err) });
  }
});

/**
 * DELETE /v1/users/:userId
 * Deletes own account. Users can only delete their own record.
 */
router.delete("/v1/users/:userId", requireAuth, async (req, res): Promise<void> => {
  try {
    const requestedId = String(req.params.userId);
    const authUserId = (req as AuthedRequest).userId;

    if (requestedId !== authUserId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, requestedId));
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.id, requestedId));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user", details: String(err) });
  }
});

export default router;
