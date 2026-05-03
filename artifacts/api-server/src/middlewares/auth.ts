import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { HttpError } from "./errorEnvelope";

/**
 * Returns the Clerk userId if signed in, otherwise null.
 * Lexor allows anonymous browsing, so most routes use this rather than `requireAuth`.
 */
export function getUserId(req: Request): string | null {
  try {
    const auth = getAuth(req);
    return auth?.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Express middleware that requires an authenticated user.
 * Used on routes like coalition.join where consent must be tied to an identity.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const userId = getUserId(req);
  if (!userId) {
    next(new HttpError(401, "unauthorized", "Sign in required."));
    return;
  }
  next();
};
