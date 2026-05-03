import { db, inboxAlertsTable, gmailWatchesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { classifyEmail, type InboxClassification } from "./classify";
import { dispatchAlert, type AlertDispatchResult } from "./alert";

/**
 * Single entry-point used by:
 *  (a) the future Gmail polling scheduler (when the wider scope lands)
 *  (b) the test/fixture ingest endpoint (used by the demo + acceptance)
 *
 * In-memory only: the email body is NOT persisted. Only the classifier
 * verdict + the gist + the drafted reply (which the user explicitly
 * sees + sends) are stored. This matches the spec's privacy promise.
 */
export interface IngestInput {
  userId: string;
  fromDisplay: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  // Optional Gmail identifiers — present when (b) is the polling path.
  gmailMessageId?: string;
  gmailThreadId?: string;
}

export interface IngestResult {
  fired: boolean;
  alertId: string | null;
  classification: InboxClassification;
  dispatch: AlertDispatchResult | null;
}

export async function ingestEmail(input: IngestInput): Promise<IngestResult> {
  const firedAtMs = Date.now();

  // Idempotency: the polling scheduler runs every 30s over a rolling
  // 90s window, so the same Gmail message id can land here multiple
  // times. Refuse to re-fire the alert + re-call the user. We dedupe
  // on (userId, gmailMessageId). Test fixtures pass no id, so they
  // are exempt — each test run is intentionally a fresh alert.
  if (input.gmailMessageId) {
    const [dup] = await db
      .select({ id: inboxAlertsTable.id })
      .from(inboxAlertsTable)
      .where(
        and(
          eq(inboxAlertsTable.userId, input.userId),
          eq(inboxAlertsTable.gmailMessageId, input.gmailMessageId),
        ),
      )
      .limit(1);
    if (dup) {
      logger.debug(
        { userId: input.userId, gmailMessageId: input.gmailMessageId },
        "inbox ingest: duplicate gmail message — skipping",
      );
      return {
        fired: false,
        alertId: dup.id,
        classification: {
          category: null,
          confidence: 0,
          gist: "",
          deadlineIso: null,
          draftedReply: "",
          matchedKeywords: [],
        },
        dispatch: null,
      };
    }
  }

  const classification = await classifyEmail({
    fromDisplay: input.fromDisplay,
    subject: input.subject,
    bodyText: input.bodyText,
  });

  // Confidence floor: don't interrupt the user on a coin flip. Mirrors
  // the same gate used by the Hearing Coach interjection path.
  const SIGNIFICANCE_FLOOR = 0.6;
  if (
    classification.category === null ||
    classification.confidence < SIGNIFICANCE_FLOOR
  ) {
    logger.debug(
      {
        userId: input.userId,
        category: classification.category,
        confidence: classification.confidence,
      },
      "inbox ingest: not significant",
    );
    // Not significant — no alert created. Returning `fired:false` so
    // downstream metrics (and the acceptance harness) treat this as a
    // correct non-fire instead of a fire-with-null-alert.
    return { fired: false, alertId: null, classification, dispatch: null };
  }

  const [watch] = await db
    .select()
    .from(gmailWatchesTable)
    .where(eq(gmailWatchesTable.userId, input.userId))
    .limit(1);

  const [alert] = await db
    .insert(inboxAlertsTable)
    .values({
      userId: input.userId,
      category: classification.category,
      status: "fired",
      senderDisplay: input.fromDisplay,
      subject: input.subject,
      gist: classification.gist,
      deadlineIso: classification.deadlineIso,
      draftedReply: classification.draftedReply,
      gmailMessageId: input.gmailMessageId ?? null,
      gmailThreadId: input.gmailThreadId ?? null,
      confidence: String(classification.confidence),
      meta: {
        matchedKeywords: classification.matchedKeywords,
        toAddress: input.fromAddress,
      },
    })
    .returning();

  if (!alert) {
    logger.error("inbox ingest: insert returned no row");
    return { fired: false, alertId: null, classification, dispatch: null };
  }

  const dispatch = await dispatchAlert({
    alertId: alert.id,
    phoneNumber: watch?.phoneNumber ?? null,
    classification,
    firedAtMs,
  });

  return {
    fired: true,
    alertId: alert.id,
    classification,
    dispatch,
  };
}

/** Mark an alert resolved (sent / dismissed / reviewed). */
export async function resolveAlert(
  userId: string,
  alertId: string,
  status: "sent" | "dismissed" | "reviewed" | "failed",
): Promise<boolean> {
  const r = await db
    .update(inboxAlertsTable)
    .set({ status, resolvedAt: new Date() })
    .where(
      and(
        eq(inboxAlertsTable.id, alertId),
        eq(inboxAlertsTable.userId, userId),
      ),
    )
    .returning({ id: inboxAlertsTable.id });
  return r.length > 0;
}
