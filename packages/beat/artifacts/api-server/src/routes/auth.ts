import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as Request & { userId: string }).userId = userId;
  next();
}

router.get("/v1/auth/me", requireAuth, async (req, res): Promise<void> => {
  try {
    const clerkUserId = (req as Request & { userId: string }).userId;

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, clerkUserId));

    if (existing) {
      res.json(existing);
      return;
    }

    let email: string | null = null;
    let displayName = "Detective";

    try {
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      email = clerkUser.emailAddresses?.[0]?.emailAddress ?? null;
      const fullName = [clerkUser.firstName, clerkUser.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      displayName = fullName || clerkUser.username || email || "Detective";
    } catch {
      // Non-fatal: use defaults if Clerk user lookup fails
    }

    const [created] = await db
      .insert(usersTable)
      .values({
        id: clerkUserId,
        displayName,
        email,
        tier: "free",
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: "Failed to provision user", details: String(err) });
  }
});

export default router;
