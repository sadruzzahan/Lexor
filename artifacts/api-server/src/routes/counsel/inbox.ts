import { Router, type IRouter, type Request, type Response } from "express";
import { db, gmailWatchesTable, inboxAlertsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";
import { rateLimit } from "../../middlewares/rateLimit";
import { isGmailConnected, getGmailProfile, sendReply } from "../../services/inbox/gmail";
import { ingestEmail, resolveAlert } from "../../services/inbox/ingest";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f-]{36}$/i;

function requireUser(req: Request): string {
  const userId = getUserId(req);
  if (!userId) {
    throw new HttpError(401, "unauthorized", "Sign in to use Inbox Sentinel.");
  }
  return userId;
}

/**
 * GET /counsel/inbox/status
 * Powers the Settings page connection card.
 */
router.get("/inbox/status", async (req: Request, res: Response) => {
  const userId = requireUser(req);
  const [watch] = await db
    .select()
    .from(gmailWatchesTable)
    .where(eq(gmailWatchesTable.userId, userId))
    .limit(1);
  // Probe the connector regardless of watch state so the UI can offer
  // "connect" if the Repl has the integration but the user hasn't
  // opted in yet.
  const connectorReady = await isGmailConnected();
  const profile = connectorReady ? await getGmailProfile() : null;
  // Only reveal the connected mailbox address to the user who actually
  // bound it. A non-owner shouldn't be able to learn the connector
  // owner's email just by hitting /inbox/status.
  const isOwner = Boolean(
    watch?.gmailEmail &&
      profile?.emailAddress &&
      watch.gmailEmail.toLowerCase() === profile.emailAddress.toLowerCase(),
  );
  res.json({
    connectorReady,
    connectedEmail: isOwner ? (profile?.emailAddress ?? null) : null,
    watch: watch
      ? {
          enabled: watch.enabled,
          phoneNumber: watch.phoneNumber,
          lastHistoryId: watch.lastHistoryId,
          createdAt: watch.createdAt,
        }
      : null,
    twilioConfigured: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_PHONE_NUMBER,
    ),
  });
});

const enableSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+\d{8,15}$/, "phoneNumber must be E.164, e.g. +14155551234")
    .optional()
    .nullable(),
});

/**
 * POST /counsel/inbox/enable
 * Idempotent — creates or updates the watch row for the signed-in user.
 * The actual OAuth happens in the Replit integrations panel; this just
 * persists "this user opted into the sentinel" + their phone.
 */
router.post(
  "/inbox/enable",
  rateLimit({ name: "inbox-enable", scope: "user-or-ip", windowMs: 60_000, max: 10 }),
  async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const parsed = enableSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, "invalid_input", parsed.error.message);
    }
    const profile = await getGmailProfile();
    if (!profile) {
      throw new HttpError(
        503,
        "gmail_not_connected",
        "Gmail integration is not connected. Open the integrations panel and connect Gmail first.",
      );
    }
    // CONNECTOR-OWNER GATE.
    // The Replit Gmail connector is currently global-scoped (one mailbox
    // per Repl). If we let any signed-in user bind it, two unrelated
    // users could both claim the same mailbox and the scheduler would
    // fan its messages out to both — a tenant-isolation violation.
    // We refuse here when another userId already owns this gmailEmail.
    // Per-user OAuth (follow-up #17) replaces this guard with a per-
    // watch credential lookup.
    const [conflict] = await db
      .select({ userId: gmailWatchesTable.userId })
      .from(gmailWatchesTable)
      .where(eq(gmailWatchesTable.gmailEmail, profile.emailAddress))
      .limit(1);
    if (conflict && conflict.userId !== userId) {
      throw new HttpError(
        409,
        "mailbox_already_bound",
        "This Gmail account is already bound to another Lexor user on this workspace. Per-user Gmail OAuth is not yet available — only one user can enable Inbox Sentinel against the shared connector.",
      );
    }
    const [existing] = await db
      .select()
      .from(gmailWatchesTable)
      .where(eq(gmailWatchesTable.userId, userId))
      .limit(1);
    if (existing) {
      const [updated] = await db
        .update(gmailWatchesTable)
        .set({
          enabled: true,
          phoneNumber: parsed.data.phoneNumber ?? existing.phoneNumber,
          gmailEmail: profile.emailAddress,
          lastHistoryId: profile.historyId,
          updatedAt: new Date(),
        })
        .where(eq(gmailWatchesTable.id, existing.id))
        .returning();
      res.json({ ok: true, watch: updated });
      return;
    }
    const [row] = await db
      .insert(gmailWatchesTable)
      .values({
        userId,
        connectionId: "google-mail",
        gmailEmail: profile.emailAddress,
        phoneNumber: parsed.data.phoneNumber ?? null,
        lastHistoryId: profile.historyId,
        enabled: true,
      })
      .returning();
    res.json({ ok: true, watch: row });
  },
);

/**
 * POST /counsel/inbox/disable
 * Soft-disables the watch (we don't delete it so we keep the lastHistoryId
 * checkpoint if the user re-enables later).
 */
router.post("/inbox/disable", async (req: Request, res: Response) => {
  const userId = requireUser(req);
  await db
    .update(gmailWatchesTable)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(gmailWatchesTable.userId, userId));
  res.json({ ok: true });
});

const ingestSchema = z.object({
  fromDisplay: z.string().min(1).max(200),
  fromAddress: z.string().email().max(200),
  subject: z.string().min(1).max(400),
  bodyText: z.string().min(1).max(8000),
});

/**
 * POST /counsel/inbox/ingest
 * Demo + acceptance entry-point. Accepts a synthetic email payload and
 * runs the full classify → fire → dispatch pipeline. Used by:
 *  - the Settings page "Test the sentinel" panel
 *  - scripts/src/inboxAcceptance.ts (60s gate)
 *
 * Rate limited tightly so this can't be abused as an outbound dialer.
 */
router.post(
  "/inbox/ingest",
  rateLimit({ name: "inbox-ingest", scope: "user-or-ip", windowMs: 60_000, max: 6 }),
  async (req: Request, res: Response) => {
    const userId = requireUser(req);
    // Make sure the user has a watch row even if they haven't enabled
    // for real polling — the test path should still work.
    const [existing] = await db
      .select()
      .from(gmailWatchesTable)
      .where(eq(gmailWatchesTable.userId, userId))
      .limit(1);
    if (!existing) {
      await db
        .insert(gmailWatchesTable)
        .values({ userId, connectionId: "test-fixture", enabled: true });
    }
    const parsed = ingestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, "invalid_input", parsed.error.message);
    }
    const result = await ingestEmail({ userId, ...parsed.data });
    req.log.info(
      {
        userId,
        category: result.classification.category,
        fired: result.alertId !== null,
        dispatchChannel: result.dispatch?.channel ?? null,
        latencyMs: result.dispatch?.dispatchLatencyMs ?? null,
      },
      "inbox ingest",
    );
    res.json({
      alertId: result.alertId,
      category: result.classification.category,
      confidence: result.classification.confidence,
      gist: result.classification.gist,
      deadlineIso: result.classification.deadlineIso,
      matchedKeywords: result.classification.matchedKeywords,
      dispatch: result.dispatch,
    });
  },
);

/**
 * GET /counsel/inbox/alerts
 * The Settings page polls this every 5s while the page is open to
 * surface in-app dispatched alerts in real time.
 */
router.get("/inbox/alerts", async (req: Request, res: Response) => {
  const userId = requireUser(req);
  const rows = await db
    .select()
    .from(inboxAlertsTable)
    .where(eq(inboxAlertsTable.userId, userId))
    .orderBy(desc(inboxAlertsTable.firedAt))
    .limit(20);
  res.json({
    alerts: rows.map((r) => ({
      id: r.id,
      category: r.category,
      status: r.status,
      senderDisplay: r.senderDisplay,
      subject: r.subject,
      gist: r.gist,
      deadlineIso: r.deadlineIso,
      draftedReply: r.draftedReply,
      callSid: r.callSid,
      firedAt: r.firedAt,
      dispatchedAt: r.dispatchedAt,
      resolvedAt: r.resolvedAt,
      caseId: r.caseId,
    })),
  });
});

const sendSchema = z.object({
  alertId: z.string().regex(UUID_RE),
  /** Optional override — voice flow may edit before sending. */
  body: z.string().min(1).max(4000).optional(),
});

/**
 * POST /counsel/inbox/send
 * Backs the realtime tool `send_email_reply` AND the Settings UI "Send"
 * button. Requires that the alert has gmailMessageId+threadId (i.e.
 * came from the polling path, not the fixture path) AND that the gmail
 * connector is reachable.
 */
router.post(
  "/inbox/send",
  rateLimit({ name: "inbox-send", scope: "user-or-ip", windowMs: 60_000, max: 5 }),
  async (req: Request, res: Response) => {
    const userId = requireUser(req);
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, "invalid_input", parsed.error.message);
    }
    const [alert] = await db
      .select()
      .from(inboxAlertsTable)
      .where(
        and(
          eq(inboxAlertsTable.id, parsed.data.alertId),
          eq(inboxAlertsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!alert) throw new HttpError(404, "not_found", "Alert not found.");
    if (!alert.gmailThreadId || !alert.gmailMessageId) {
      throw new HttpError(
        409,
        "no_thread",
        "This alert came from the test fixture path and has no Gmail thread to reply to.",
      );
    }
    const meta = (alert.meta ?? {}) as { toAddress?: string };
    if (!meta.toAddress) {
      throw new HttpError(
        409,
        "no_recipient",
        "Alert metadata missing recipient address.",
      );
    }
    const body = parsed.data.body ?? alert.draftedReply ?? "";
    if (!body) throw new HttpError(409, "no_body", "No reply body to send.");
    const sendResult = await sendReply({
      threadId: alert.gmailThreadId,
      to: meta.toAddress,
      subject: alert.subject,
      body,
      inReplyToMessageId: alert.gmailMessageId,
    });
    if (!sendResult) {
      await resolveAlert(userId, alert.id, "failed");
      throw new HttpError(502, "gmail_send_failed", "Gmail send failed.");
    }
    await resolveAlert(userId, alert.id, "sent");
    res.json({ ok: true, gmailMessageId: sendResult.messageId });
  },
);

const resolveSchema = z.object({
  alertId: z.string().regex(UUID_RE),
  status: z.enum(["dismissed", "reviewed"]),
});

router.post("/inbox/resolve", async (req: Request, res: Response) => {
  const userId = requireUser(req);
  const parsed = resolveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, "invalid_input", parsed.error.message);
  }
  const ok = await resolveAlert(userId, parsed.data.alertId, parsed.data.status);
  if (!ok) throw new HttpError(404, "not_found", "Alert not found.");
  res.json({ ok: true });
});

export default router;
