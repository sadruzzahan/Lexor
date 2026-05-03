import {
  pgTable,
  uuid,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coalitionsTable } from "./coalitions";
import { casesTable } from "./cases";
import { lawyerBidsTable } from "./lawyerBids";

export const coalitionVotesTable = pgTable(
  "coalition_votes",
  {
    coalitionId: uuid("coalition_id")
      .notNull()
      .references(() => coalitionsTable.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    bidId: uuid("bid_id")
      .notNull()
      .references(() => lawyerBidsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.coalitionId, t.caseId] }),
    index("coalition_votes_bid_idx").on(t.bidId),
  ],
);

export const insertCoalitionVoteSchema =
  createInsertSchema(coalitionVotesTable);
export const selectCoalitionVoteSchema =
  createSelectSchema(coalitionVotesTable);
export type CoalitionVote = typeof coalitionVotesTable.$inferSelect;
export type InsertCoalitionVote = z.infer<typeof insertCoalitionVoteSchema>;
