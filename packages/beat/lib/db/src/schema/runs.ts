import { pgTable, text, timestamp, pgEnum, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";

export const runStatusEnum = pgEnum("run_status", ["pending", "running", "completed", "failed", "cancelled"]);

export const runsTable = pgTable("runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  caseId: text("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  status: runStatusEnum("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").unique(),
  totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRunSchema = createInsertSchema(runsTable).omit({ id: true, createdAt: true });
export const selectRunSchema = createSelectSchema(runsTable);

export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runsTable.$inferSelect;
