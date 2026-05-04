import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { caseFilesTable } from "./case-files";

export const chainOfCustodyTable = pgTable("chain_of_custody", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  fileId: text("file_id").notNull().references(() => caseFilesTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  device: jsonb("device"),
  gps: jsonb("gps"),
  sha256: text("sha256"),
  prevSha256: text("prev_sha256"),
  signature: text("signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChainOfCustodySchema = createInsertSchema(chainOfCustodyTable).omit({ id: true, createdAt: true });
export const selectChainOfCustodySchema = createSelectSchema(chainOfCustodyTable);

export type InsertChainOfCustody = z.infer<typeof insertChainOfCustodySchema>;
export type ChainOfCustody = typeof chainOfCustodyTable.$inferSelect;
