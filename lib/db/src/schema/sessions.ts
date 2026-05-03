import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";

export const sessionChannel = pgEnum("session_channel", ["voice", "whatsapp"]);

export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: sessionChannel("channel").notNull(),
    externalId: text("external_id"),
    phoneNumberHash: text("phone_number_hash"),
    language: text("language").notNull().default("en"),
    caseId: uuid("case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),
    transcriptJsonl: text("transcript_jsonl"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("sessions_external_id_idx").on(t.externalId)],
);

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({
  id: true,
  startedAt: true,
});
export const selectSessionSchema = createSelectSchema(sessionsTable);
export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
