import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationChannel = pgEnum("notification_channel", [
  "inapp",
  "email",
  "whatsapp",
]);

export const notificationKind = pgEnum("notification_kind", [
  "coalition_invite",
  "coalition_update",
]);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id"),
    userId: text("user_id"),
    kind: notificationKind("kind").notNull(),
    channel: notificationChannel("channel").notNull(),
    payload: jsonb("payload").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_case_idx").on(t.caseId),
    index("notifications_user_idx").on(t.userId),
  ],
);

export const insertNotificationSchema =
  createInsertSchema(notificationsTable).omit({ id: true, sentAt: true });
export const selectNotificationSchema = createSelectSchema(notificationsTable);
export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
