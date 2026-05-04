import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { runsTable } from "./runs";

export const citationSourceTypeEnum = pgEnum("citation_source_type", [
  "file",
  "web",
  "database",
  "witness",
  "sensor",
]);

export const citationsTable = pgTable("citations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  artifactKind: text("artifact_kind").notNull(),
  sourceType: citationSourceTypeEnum("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  span: jsonb("span"),
  verifiedQuote: text("verified_quote"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCitationSchema = createInsertSchema(citationsTable).omit({ id: true, createdAt: true });
export const selectCitationSchema = createSelectSchema(citationsTable);

export type InsertCitation = z.infer<typeof insertCitationSchema>;
export type Citation = typeof citationsTable.$inferSelect;
