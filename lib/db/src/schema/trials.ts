import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";

export const trialStatus = pgEnum("trial_status", [
  "queued",
  "running",
  "complete",
  "failed",
]);

export const trialOutcome = pgEnum("trial_outcome", [
  "plaintiff",
  "defendant",
  "mixed",
  "undetermined",
]);

export const trialCharacter = pgEnum("trial_character", [
  "opposing",
  "judge",
  "your_counsel",
]);

export const trialsTable = pgTable(
  "trials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    status: trialStatus("status").notNull().default("queued"),
    predictedOutcome: trialOutcome("predicted_outcome"),
    predictedRationale: text("predicted_rationale"),
    swingArguments: jsonb("swing_arguments"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("trials_case_id_idx").on(t.caseId)],
);

export const trialTurnsTable = pgTable(
  "trial_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trialId: uuid("trial_id")
      .notNull()
      .references(() => trialsTable.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    character: trialCharacter("character").notNull(),
    line: text("line").notNull(),
    citation: text("citation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("trial_turns_trial_id_idx").on(t.trialId)],
);

export const insertTrialSchema = createInsertSchema(trialsTable).omit({
  id: true,
  startedAt: true,
});
export const selectTrialSchema = createSelectSchema(trialsTable);
export type Trial = typeof trialsTable.$inferSelect;
export type InsertTrial = z.infer<typeof insertTrialSchema>;

export const insertTrialTurnSchema = createInsertSchema(trialTurnsTable).omit({
  id: true,
  createdAt: true,
});
export const selectTrialTurnSchema = createSelectSchema(trialTurnsTable);
export type TrialTurn = typeof trialTurnsTable.$inferSelect;
export type InsertTrialTurn = z.infer<typeof insertTrialTurnSchema>;
