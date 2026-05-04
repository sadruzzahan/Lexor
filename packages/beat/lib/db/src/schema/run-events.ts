import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { runsTable } from "./runs";

export const runEventsTable = pgTable("run_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRunEventSchema = createInsertSchema(runEventsTable).omit({ id: true, createdAt: true });
export const selectRunEventSchema = createSelectSchema(runEventsTable);

export type InsertRunEvent = z.infer<typeof insertRunEventSchema>;
export type RunEvent = typeof runEventsTable.$inferSelect;
