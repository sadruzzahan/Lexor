import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Per-user Gmail watch row. We don't store OAuth tokens — those live in
 * the Replit Gmail connector. We only persist the connection-level state
 * we need to drive polling and to surface a "connected" UI.
 *
 * Drift from spec: the Replit Gmail connector exposes the
 * gmail.addons.current.message.* + gmail.send scopes (i.e. add-on scopes,
 * not full mailbox-read), so live `users.messages.list` polling and
 * Pub/Sub `users.watch` are not authorized. The schema and code path are
 * still here so the moment a wider scope (gmail.readonly or gmail.modify)
 * is granted, polling drops in unchanged.
 */
export const gmailWatchesTable = pgTable(
  "gmail_watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().unique(),
    // The Replit connector connection id, persisted for traceability.
    connectionId: text("connection_id").notNull(),
    // The Gmail address this watch is bound to. Recorded at enable time
    // from the connector profile and used by the scheduler to refuse
    // dispatching messages from a connector account that does not match
    // (multi-tenancy guard while we're on a single-account connector).
    gmailEmail: text("gmail_email"),
    // Phone number to call on a hit. E.164. Hashed on read for logs.
    phoneNumber: text("phone_number"),
    // Last historyId we processed. Polling fetches `history.list?startHistoryId=`.
    lastHistoryId: text("last_history_id"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("gmail_watches_user_id_idx").on(t.userId),
    // HARD multi-tenancy guard: only one enabled watch per Gmail
    // address. Combined with the connector-owner refusal in
    // /inbox/enable, this makes it physically impossible for two
    // distinct app users to both bind the (currently global) Replit
    // Gmail connector — which would otherwise let one mailbox's
    // messages be alerted under multiple unrelated users.
    uniqueIndex("gmail_watches_email_unique_enabled_idx")
      .on(t.gmailEmail)
      .where(sql`${t.enabled} = true AND ${t.gmailEmail} IS NOT NULL`),
  ],
);

export const inboxAlertStatus = pgEnum("inbox_alert_status", [
  "fired",
  "dispatched",
  "reviewed",
  "sent",
  "dismissed",
  "failed",
]);

export const inboxAlertCategory = pgEnum("inbox_alert_category", [
  "eviction",
  "court_summons",
  "debt",
  "irs",
  "ice",
  "employment",
]);

/**
 * Inbox alert — one row per "legally significant" email the classifier
 * flags. Holds the drafted reply for the voice send/review flow.
 *
 * IMPORTANT — privacy: per spec, "all inbound email content is processed
 * in-memory and not persisted beyond the resulting case row." We keep
 * only: classifier verdict, sender display, deadline, our drafted reply,
 * the reply target message id (so gmail.send can thread). We do NOT
 * persist the full original email body. The case row downstream may
 * persist the body if the user later opts in via review.
 */
export const inboxAlertsTable = pgTable(
  "inbox_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    caseId: uuid("case_id"),
    category: inboxAlertCategory("category").notNull(),
    status: inboxAlertStatus("status").notNull().default("fired"),
    // Sender display ("Smith Properties LLC <leases@smithprop.com>") —
    // the display name itself is needed for the voice-read gist.
    senderDisplay: text("sender_display").notNull(),
    subject: text("subject").notNull(),
    // Plain-language gist (≤2 sentences) the voice agent reads.
    gist: text("gist").notNull(),
    // ISO date string when present. Voice reads aloud as "by Friday".
    deadlineIso: text("deadline_iso"),
    // The drafted reply (plain text) the agent offers to send.
    draftedReply: text("drafted_reply"),
    // Gmail messageId + threadId to thread the reply correctly.
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    // Twilio CallSid if outbound call placed; null = degraded path used.
    callSid: text("call_sid"),
    // Confidence score from the classifier 0..1.
    confidence: text("confidence"),
    // Free-form metadata: keywords matched, classifier model, etc.
    meta: jsonb("meta"),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("inbox_alerts_user_id_idx").on(t.userId),
    index("inbox_alerts_case_id_idx").on(t.caseId),
    index("inbox_alerts_status_idx").on(t.status),
  ],
);

export type GmailWatch = typeof gmailWatchesTable.$inferSelect;
export type InboxAlert = typeof inboxAlertsTable.$inferSelect;
