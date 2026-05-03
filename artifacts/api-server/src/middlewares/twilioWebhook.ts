import type { Request, Response, NextFunction } from "express";
import twilio from "twilio";

/**
 * Verify the X-Twilio-Signature header on inbound webhooks.
 *
 * Twilio computes HMAC-SHA1 over the full request URL (scheme + host +
 * path + query) plus the sorted POST params, signed with our auth token.
 * Without this guard, /voice/incoming and /whatsapp/inbound are
 * unauthenticated entry points that anyone could POST to — including
 * payloads carrying attacker-controlled MediaUrl values that we'd then
 * fetch with our Twilio Basic Auth header attached. That is a classic
 * SSRF + credential-exfiltration vector, so verification is mandatory
 * whenever TWILIO_AUTH_TOKEN is set.
 *
 * In dev (no token) we skip verification and log a warning so local
 * webhook testing still works.
 */
export function verifyTwilioSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    req.log.warn(
      "TWILIO_AUTH_TOKEN not set — skipping Twilio signature verification (dev only).",
    );
    next();
    return;
  }
  const signature = req.get("x-twilio-signature") ?? "";
  if (!signature) {
    res.status(403).send("missing signature");
    return;
  }
  // Reconstruct the URL Twilio used to call us. We're behind the global
  // Replit proxy, so prefer the X-Forwarded-* headers; fall back to the
  // request's own protocol/host.
  const proto = (req.get("x-forwarded-proto") ?? req.protocol ?? "https")
    .split(",")[0]
    ?.trim();
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
  const url = `${proto}://${host}${req.originalUrl}`;
  const params = (req.body ?? {}) as Record<string, string>;
  const valid = twilio.validateRequest(token, signature, url, params);
  if (!valid) {
    req.log.warn({ url }, "twilio signature validation failed");
    res.status(403).send("invalid signature");
    return;
  }
  next();
}
