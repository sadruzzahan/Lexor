/**
 * G23 admin gate — protects observability surfaces that mutate global
 * state (prompt activation) or expose CI/golden fixtures (replay).
 *
 * The token lives in BRIEFCASE_ADMIN_TOKEN; the request must present
 * it via either the `x-admin-token` header or `Authorization: Bearer`.
 * If the env is unset the gate denies every request — fail-closed —
 * because shipping admin endpoints with no token would be the
 * authorization bypass the architect flagged.
 */
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../lib/errors";

function presented(req: Request): string | null {
  const header = req.header("x-admin-token");
  if (header && header.length > 0) return header;
  const auth = req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const expected = process.env["BRIEFCASE_ADMIN_TOKEN"];
  if (!expected || expected.length === 0) {
    next(
      new ApiError(
        "forbidden",
        "admin surface disabled (BRIEFCASE_ADMIN_TOKEN unset)",
      ),
    );
    return;
  }
  const got = presented(req);
  if (!got || !constantTimeEq(got, expected)) {
    next(new ApiError("forbidden", "admin token required"));
    return;
  }
  next();
}
