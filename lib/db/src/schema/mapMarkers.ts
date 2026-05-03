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
import { caseVertical } from "./cases";
import { entitiesTable } from "./entities";

export const mapMarkersTable = pgTable(
  "map_markers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    caseVertical: caseVertical("case_vertical").notNull(),
    violationCodes: text("violation_codes").array().notNull().default([]),
    coarseLat: numeric("coarse_lat", { precision: 8, scale: 4 }).notNull(),
    coarseLng: numeric("coarse_lng", { precision: 9, scale: 4 }).notNull(),
    zipCode: text("zip_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("map_markers_zip_code_idx").on(t.zipCode),
    index("map_markers_entity_id_idx").on(t.entityId),
  ],
);

export const insertMapMarkerSchema = createInsertSchema(mapMarkersTable).omit({
  id: true,
  createdAt: true,
});
export const selectMapMarkerSchema = createSelectSchema(mapMarkersTable);
export type MapMarker = typeof mapMarkersTable.$inferSelect;
export type InsertMapMarker = z.infer<typeof insertMapMarkerSchema>;
