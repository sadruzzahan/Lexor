import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { caseVertical } from "./cases";
import { entitiesTable } from "./entities";

export const coalitionStatus = pgEnum("coalition_status", [
  "forming",
  "open",
  "matched",
  "closed",
]);

export const coalitionsTable = pgTable(
  "coalitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    vertical: caseVertical("vertical").notNull(),
    jurisdiction: text("jurisdiction"),
    letterTemplateHash: text("letter_template_hash"),
    caseCount: integer("case_count").notNull().default(0),
    status: coalitionStatus("status").notNull().default("forming"),
    classComplaintDraftHtml: text("class_complaint_draft_html"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("coalitions_entity_id_idx").on(t.entityId)],
);

export const insertCoalitionSchema = createInsertSchema(coalitionsTable).omit({
  id: true,
  createdAt: true,
});
export const selectCoalitionSchema = createSelectSchema(coalitionsTable);
export type Coalition = typeof coalitionsTable.$inferSelect;
export type InsertCoalition = z.infer<typeof insertCoalitionSchema>;
