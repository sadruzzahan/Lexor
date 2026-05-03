import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coalitionsTable } from "./coalitions";
import { casesTable } from "./cases";

export const coalitionMembersTable = pgTable(
  "coalition_members",
  {
    coalitionId: uuid("coalition_id")
      .notNull()
      .references(() => coalitionsTable.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    hasOptedIn: boolean("has_opted_in").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.coalitionId, t.caseId] })],
);

export const insertCoalitionMemberSchema =
  createInsertSchema(coalitionMembersTable);
export const selectCoalitionMemberSchema =
  createSelectSchema(coalitionMembersTable);
export type CoalitionMember = typeof coalitionMembersTable.$inferSelect;
export type InsertCoalitionMember = z.infer<typeof insertCoalitionMemberSchema>;
