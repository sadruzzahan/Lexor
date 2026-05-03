import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
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
    /**
     * Deterministic per-(case, entity) fingerprint used to make pipeline
     * retries idempotent. Stored as a one-way hash of the caseId so we
     * cannot recover case identity from the marker (preserving the
     * "no row links to a user" anonymization guarantee) while still
     * letting `INSERT ... ON CONFLICT DO NOTHING` dedupe re-runs.
     */
    caseFingerprint: text("case_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("map_markers_zip_code_idx").on(t.zipCode),
    index("map_markers_entity_id_idx").on(t.entityId),
    uniqueIndex("map_markers_entity_fingerprint_uq").on(
      t.entityId,
      t.caseFingerprint,
    ),
  ],
);

export const insertMapMarkerSchema = createInsertSchema(mapMarkersTable).omit({
  id: true,
  createdAt: true,
});
export const selectMapMarkerSchema = createSelectSchema(mapMarkersTable);
export type MapMarker = typeof mapMarkersTable.$inferSelect;
export type InsertMapMarker = z.infer<typeof insertMapMarkerSchema>;
