import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coalitionsTable } from "./coalitions";

export const lawyerBidsTable = pgTable(
  "lawyer_bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coalitionId: uuid("coalition_id")
      .notNull()
      .references(() => coalitionsTable.id, { onDelete: "cascade" }),
    lawyerName: text("lawyer_name").notNull(),
    lawyerBarNumber: text("lawyer_bar_number").notNull(),
    lawyerEmail: text("lawyer_email").notNull(),
    lawyerFirm: text("lawyer_firm"),
    contingencyPercent: numeric("contingency_percent", {
      precision: 5,
      scale: 2,
    }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lawyer_bids_coalition_id_idx").on(t.coalitionId)],
);

export const insertLawyerBidSchema = createInsertSchema(lawyerBidsTable).omit({
  id: true,
  createdAt: true,
});
export const selectLawyerBidSchema = createSelectSchema(lawyerBidsTable);
export type LawyerBid = typeof lawyerBidsTable.$inferSelect;
export type InsertLawyerBid = z.infer<typeof insertLawyerBidSchema>;
