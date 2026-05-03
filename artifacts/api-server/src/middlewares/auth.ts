import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { HttpError } from "./errorEnvelope";

/**
 * Returns the Clerk userId if signed in, otherwise null.
 * Lexor allows anonymous browsing, so most routes use this rather than `requireAuth`.
 */
export function getUserId(req: Request): string | null {
  // Dev/test escape hatch — disabled in production AND requires a
  // shared secret in `X-Test-Auth-Secret` matching INTERNAL_TEST_SECRET.
  // Used by acceptance harnesses (e.g. scripts/src/inboxAcceptance.ts).
  // Without both gates aligned, the header is ignored and we fall
  // through to the normal Clerk path — preventing impersonation if a
  // staging env is misconfigured.
  if (process.env.NODE_ENV !== "production") {
    const expected = process.env.INTERNAL_TEST_SECRET;
    const provided = req.header("x-test-auth-secret");
    const userHeader = req.header("x-test-user-id");
    if (
      expected &&
      provided &&
      provided === expected &&
      typeof userHeader === "string" &&
      userHeader.length > 0 &&
      userHeader.length <= 200
    ) {
      return userHeader;
    }
  }
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
