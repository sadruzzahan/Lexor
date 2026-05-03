import { db, inboxAlertsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { sendReply } from "./gmail";
import { sendSms } from "../voice/twilioClient";
import { resolveAlert } from "./ingest";

/**
 * Voice-tool helpers for the Inbox Sentinel realtime bridge.
 *
 * These are thin wrappers over the same Gmail-send + Twilio-SMS paths
 * the HTTP routes use. They exist as a separate module so the realtime
 * bridge can import them without pulling in Express's request lifecycle
 * or the rate-limit middleware (which is HTTP-only).
 *
 * Both functions are designed to NEVER throw — the realtime bridge
 * forwards the returned object straight back to the LLM as tool output,
 * and an unhandled exception there blocks the call.
 */

export async function sendInboxAlertReply(
  alertId: string,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(alertId)) {
    return { ok: false, error: "invalid_alert_id" };
  }
  const [alert] = await db
    .select()
    .from(inboxAlertsTable)
    .where(eq(inboxAlertsTable.id, alertId))
    .limit(1);
  if (!alert) return { ok: false, error: "not_found" };
  if (alert.status !== "fired" && alert.status !== "dispatched") {
    return { ok: false, error: `wrong_state:${alert.status}` };
  }
  if (!alert.gmailThreadId || !alert.gmailMessageId) {
    return { ok: false, error: "no_thread_to_reply_to" };
  }
  const meta = (alert.meta ?? {}) as { toAddress?: string };
  if (!meta.toAddress) return { ok: false, error: "no_recipient" };
  if (!alert.draftedReply) return { ok: false, error: "no_body" };

  const result = await sendReply({
    threadId: alert.gmailThreadId,
    to: meta.toAddress,
    subject: alert.subject,
    body: alert.draftedReply,
    inReplyToMessageId: alert.gmailMessageId,
  });
  if (!result) {
    await resolveAlert(alert.userId, alert.id, "failed");
    return { ok: false, error: "gmail_send_failed" };
  }
  await resolveAlert(alert.userId, alert.id, "sent");
  logger.info({ alertId, userId: alert.userId }, "inbox voice tool: reply sent");
  return { ok: true, status: "sent" };
}

export async function textAlertDeeplink(opts: {
  alertId: string;
  toPhone: string;
}): Promise<{ ok: boolean; sent?: boolean; url?: string; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(opts.alertId)) {
    return { ok: false, error: "invalid_alert_id" };
  }
  const host = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  if (!host) return { ok: false, error: "no_public_host" };
  const url = `https://${host}/lexor/settings#alert=${opts.alertId}`;
  const body = `Lexor: open your inbox alert to review the drafted reply → ${url}`;
  const sid = await sendSms({ to: opts.toPhone, body });
  return { ok: true, sent: Boolean(sid), url };
}
