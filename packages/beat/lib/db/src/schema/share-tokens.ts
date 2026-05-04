import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { draftsTable } from "./drafts";

export const shareTokensTable = pgTable("share_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  token: text("token").notNull().unique().$defaultFn(() => crypto.randomUUID()),
  caseId: text("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  draftId: text("draft_id").references(() => draftsTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("share_tokens_expires_at_idx").on(t.expiresAt),
]);

export const insertShareTokenSchema = createInsertSchema(shareTokensTable).omit({ id: true, token: true, createdAt: true });
export const selectShareTokenSchema = createSelectSchema(shareTokensTable);

export type InsertShareToken = z.infer<typeof insertShareTokenSchema>;
export type ShareToken = typeof shareTokensTable.$inferSelect;
