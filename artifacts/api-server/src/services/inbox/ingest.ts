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
    return { fired: true, alertId: null, classification, dispatch: null };
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
