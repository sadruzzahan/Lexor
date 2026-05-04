import type { RequestHandler } from "express";
import { db, users } from "@workspace/db";
import { DEMO_USER_SLUG, resolveDemoUserId } from "@workspace/db/demo";
import { eq } from "drizzle-orm";
import { ApiError } from "../lib/errors";

const DEMO_HEADER = "x-demo-user";

const userCache = new Map<string, { id: string; slug: string }>();

export const requireDemoUser: RequestHandler = async (req, _res, next) => {
  try {
    const headerValue = req.header(DEMO_HEADER);
    if (!headerValue) {
      throw new ApiError(
        "unauthorized",
        `Missing required header: ${DEMO_HEADER}`,
      );
    }

    const slug = headerValue.trim();
    const id = resolveDemoUserId(slug);
    if (!id) {
      throw new ApiError(
        "unauthorized",
        `Unknown demo user: ${slug}`,
      );
    }

    const cached = userCache.get(slug);
    if (cached) {
      req.demoUser = cached;
      next();
      return;
    }

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new ApiError(
        "unauthorized",
        `Demo user '${slug}' is not seeded. Run pnpm --filter @workspace/api-server seed.`,
      );
    }

    const resolved = { id: rows[0]!.id, slug };
    userCache.set(slug, resolved);
    req.demoUser = resolved;
    next();
  } catch (err) {
    next(err);
  }
};

export { DEMO_USER_SLUG };
