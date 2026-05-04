import { pgTable, text, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { runsTable } from "./runs";

export const artifactKindEnum = pgEnum("artifact_kind", [
  "jurisdiction",
  "scene_tags",
  "witness_map",
  "suspect_profile",
  "statement_draft",
  "incident_report",
  "citation",
  "summary",
]);

export const artifactsTable = pgTable("artifacts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("run_id").notNull().references(() => runsTable.id, { onDelete: "cascade" }),
  subagent: text("subagent").notNull(),
  kind: artifactKindEnum("kind").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArtifactSchema = createInsertSchema(artifactsTable).omit({ id: true, createdAt: true });
export const selectArtifactSchema = createSelectSchema(artifactsTable);

export type InsertArtifact = z.infer<typeof insertArtifactSchema>;
export type Artifact = typeof artifactsTable.$inferSelect;
