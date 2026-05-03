import twilio, { type Twilio } from "twilio";
import { logger } from "../../lib/logger";

/**
 * Lazily-constructed Twilio REST client. Returns null when credentials
 * are not configured, so call sites can degrade gracefully (the SMS
 * "I'll text you a link" branch becomes a no-op log line in dev).
 */
let cachedClient: Twilio | null | undefined;

export function getTwilioClient(): Twilio | null {
  if (cachedClient !== undefined) return cachedClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    logger.warn(
      "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set — SMS / WA outbound disabled.",
    );
    cachedClient = null;
    return null;
  }
  cachedClient = twilio(sid, token);
  return cachedClient;
}

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
  );
}

export interface SmsOpts {
  to: string;
  body: string;
}

export async function sendSms(opts: SmsOpts): Promise<string | null> {
  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!client || !from) {
    logger.info({ to: opts.to.slice(-4) }, "sendSms skipped — not configured");
    return null;
  }
  const msg = await client.messages.create({
    to: opts.to,
    from,
    body: opts.body,
  });
  return msg.sid;
}

export async function sendWhatsApp(opts: {
  to: string;
  body: string;
  mediaUrl?: string[];
}): Promise<string | null> {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!client || !from) {
    logger.info(
      { to: opts.to.slice(-4) },
      "sendWhatsApp skipped — not configured",
    );
    return null;
  }
  const fromAddr = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
  const toAddr = opts.to.startsWith("whatsapp:")
    ? opts.to
    : `whatsapp:${opts.to}`;
  const msg = await client.messages.create({
    from: fromAddr,
    to: toAddr,
    body: opts.body,
    mediaUrl: opts.mediaUrl,
  });
  return msg.sid;
}
