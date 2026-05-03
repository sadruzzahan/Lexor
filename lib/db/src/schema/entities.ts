import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entityKind = pgEnum("entity_kind", [
  "landlord",
  "employer",
  "debt_collector",
  "unknown",
]);

export const entitiesTable = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalizedName: text("normalized_name").notNull(),
    displayName: text("display_name").notNull(),
    kind: entityKind("kind").notNull().default("unknown"),
    jurisdictions: text("jurisdictions").array().notNull().default([]),
    registrationData: jsonb("registration_data"),
    litigationStats: jsonb("litigation_stats"),
    alternateNames: text("alternate_names").array().notNull().default([]),
    pinCount: integer("pin_count").notNull().default(0),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("entities_normalized_name_uq").on(t.normalizedName)],
);

export const insertEntitySchema = createInsertSchema(entitiesTable).omit({
  id: true,
  createdAt: true,
});
export const selectEntitySchema = createSelectSchema(entitiesTable);
export type Entity = typeof entitiesTable.$inferSelect;
export type InsertEntity = z.infer<typeof insertEntitySchema>;
