import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? "unknown";
}

function userKey(req: Request): string | null {
  try {
    const auth = getAuth(req);
    return auth?.userId ?? null;
  } catch {
    return null;
  }
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  scope: "ip" | "user-or-ip";
  name: string;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const principal =
      opts.scope === "user-or-ip"
        ? (userKey(req) ?? clientIp(req))
        : clientIp(req);
    const key = `${opts.name}:${principal}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    if (bucket.count >= opts.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", retryAfter.toString());
      req.log?.warn(
        { key: opts.name, principal, retryAfter },
        "rate limit exceeded",
      );
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: "Too many requests. Please slow down and try again shortly.",
          requestId: req.id,
        },
      });
      return;
    }

    bucket.count += 1;
    next();
  };
}

// Periodic cleanup so the in-memory map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();
