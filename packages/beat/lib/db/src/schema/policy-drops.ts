import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { runsTable } from "./runs";

export const policyDropsTable = pgTable("policy_drops", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  subagent: text("subagent").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPolicyDropSchema = createInsertSchema(policyDropsTable).omit({ id: true, createdAt: true });
export const selectPolicyDropSchema = createSelectSchema(policyDropsTable);

export type InsertPolicyDrop = z.infer<typeof insertPolicyDropSchema>;
export type PolicyDrop = typeof policyDropsTable.$inferSelect;
