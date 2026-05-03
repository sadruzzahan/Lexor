import { db, inboxAlertsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import type { InboxClassification } from "./classify";

/**
 * Dispatch an outbound voice alert for a fired inbox alert.
 *
 * Real path (when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN +
 * TWILIO_PHONE_NUMBER are configured): place a Twilio call to the
 * user's verified phone whose TwiML `<Connect><Stream>` opens a
 * Media Stream WebSocket against the existing realtime bridge,
 * preloading the alert as inbound context (so the agent reads the
 * gist + deadline + offers send/review).
 *
 * Degraded path (default in this environment): mark the alert as
 * "fired" + leave it for the in-app SSE stream the Settings page
 * subscribes to. The user sees a toast + alert card with the same
 * gist/deadline/draft and the same send/review actions, just
 * triggered by tap instead of voice.
 */

export interface AlertDispatchResult {
  channel: "voice" | "in_app";
  callSid: string | null;
  /** Best-effort latency from fire → dispatch in ms. Asserted ≤60s in tests. */
  dispatchLatencyMs: number;
}

interface DispatchInput {
  alertId: string;
  phoneNumber: string | null;
  classification: InboxClassification;
  firedAtMs: number;
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );
}

export async function dispatchAlert(
  input: DispatchInput,
): Promise<AlertDispatchResult> {
  const { alertId, phoneNumber, classification, firedAtMs } = input;

  // Voice path requires both Twilio creds AND a verified user phone.
  if (twilioConfigured() && phoneNumber && /^\+\d{8,15}$/.test(phoneNumber)) {
    try {
      const callSid = await placeOutboundCall({ to: phoneNumber, alertId });
      const latency = Date.now() - firedAtMs;
      await db
        .update(inboxAlertsTable)
        .set({
          status: "dispatched",
          callSid,
          dispatchedAt: new Date(),
        })
        .where(eq(inboxAlertsTable.id, alertId));
      logger.info({ alertId, callSid, latency }, "inbox alert dispatched (voice)");
      return { channel: "voice", callSid, dispatchLatencyMs: latency };
    } catch (err) {
      logger.error({ err, alertId }, "twilio dispatch failed; degrading to in-app");
    }
  }

  // Degraded: in-app alert. The Settings page polls /inbox/alerts and the
  // user reviews + sends from the UI. We still mark dispatched-at so the
  // 60s acceptance gate measures the user-perceived latency uniformly.
  const latency = Date.now() - firedAtMs;
  await db
    .update(inboxAlertsTable)
    .set({ status: "dispatched", dispatchedAt: new Date() })
    .where(eq(inboxAlertsTable.id, alertId));
  logger.info(
    { alertId, latency, category: classification.category },
    "inbox alert dispatched (in_app degraded path)",
  );
  return { channel: "in_app", callSid: null, dispatchLatencyMs: latency };
}

/**
 * Twilio outbound call. Returns CallSid. Uses the public Replit dev/deploy
 * domain so Twilio can reach the TwiML endpoint.
 */
async function placeOutboundCall(opts: {
  to: string;
  alertId: string;
}): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_PHONE_NUMBER!;
  const host = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  if (!host) {
    throw new Error("REPLIT_DOMAINS missing — cannot build Twilio webhook URL");
  }
  // Pass alertId as a query param so the TwiML handler can look up the
  // preloaded gist + draft and pass them to the realtime bridge.
  const twimlUrl = `https://${host}/api/counsel/voice/incoming?alertId=${encodeURIComponent(opts.alertId)}`;
  const body = new URLSearchParams({
    To: opts.to,
    From: from,
    Url: twimlUrl,
    Method: "POST",
  });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`twilio outbound call failed: ${r.status} ${text}`);
  }
  const j = (await r.json()) as { sid?: string };
  if (!j.sid) throw new Error("twilio response missing CallSid");
  return j.sid;
}
