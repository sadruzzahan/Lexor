import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const disclosuresTable = pgTable(
  "disclosures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    sessionId: text("session_id"),
    version: text("version").notNull(),
    shownAt: timestamp("shown_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("disclosures_user_id_idx").on(t.userId),
    index("disclosures_session_id_idx").on(t.sessionId),
  ],
);

export const insertDisclosureSchema = createInsertSchema(disclosuresTable).omit(
  { id: true, shownAt: true },
);
export const selectDisclosureSchema = createSelectSchema(disclosuresTable);
export type Disclosure = typeof disclosuresTable.$inferSelect;
export type InsertDisclosure = z.infer<typeof insertDisclosureSchema>;
