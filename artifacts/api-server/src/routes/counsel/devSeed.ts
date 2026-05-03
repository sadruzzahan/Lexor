/**
 * Dev-only seed for the Predator Map demo. Exposed at
 * POST /counsel/dev/seed-map and refused in production.
 *
 * Inserts a small roster of curated-flavor entities and ~150 anonymized
 * markers spread across US states + verticals so the map has visible
 * content during the demo. Idempotent — re-running tops up to TARGET.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  entitiesTable,
  mapMarkersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { HttpError } from "../../middlewares/errorEnvelope";
import { placeCase } from "../../services/map/geo";
import type { Vertical } from "../../services/classify";

const router: IRouter = Router();

interface SeedEntity {
  normalizedName: string;
  displayName: string;
  kind: "landlord" | "employer" | "debt_collector";
  vertical: Vertical;
  states: string[];
  weight: number; // proportional pin allocation
}

const ROSTER: SeedEntity[] = [
  {
    normalizedName: "greystar real estate",
    displayName: "Greystar Real Estate Partners",
    kind: "landlord",
    vertical: "eviction",
    states: ["US-CA", "US-TX", "US-FL", "US-NY", "US-WA", "US-CO", "US-AZ", "US-GA"],
    weight: 18,
  },
  {
    normalizedName: "portfolio recovery",
    displayName: "Portfolio Recovery Associates LLC",
    kind: "debt_collector",
    vertical: "debt",
    states: ["US-VA", "US-NY", "US-CA", "US-FL", "US-TX", "US-IL", "US-OH"],
    weight: 22,
  },
  {
    normalizedName: "midland credit",
    displayName: "Midland Credit Management Inc.",
    kind: "debt_collector",
    vertical: "debt",
    states: ["US-CA", "US-NY", "US-TX", "US-FL", "US-IL", "US-PA"],
    weight: 16,
  },
  {
    normalizedName: "amazon logistics",
    displayName: "Amazon Logistics — DSP Program",
    kind: "employer",
    vertical: "wage",
    states: ["US-CA", "US-WA", "US-NY", "US-TX", "US-MA", "US-NJ", "US-IL"],
    weight: 14,
  },
  {
    normalizedName: "invitation homes",
    displayName: "Invitation Homes Inc.",
    kind: "landlord",
    vertical: "eviction",
    states: ["US-FL", "US-GA", "US-TX", "US-NC", "US-AZ", "US-CA"],
    weight: 12,
  },
  {
    normalizedName: "doordash",
    displayName: "DoorDash Inc.",
    kind: "employer",
    vertical: "wage",
    states: ["US-CA", "US-NY", "US-IL", "US-MA", "US-WA"],
    weight: 8,
  },
];

const TARGET_TOTAL = 180;

router.post(
  "/dev/seed-map",
  async (_req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      throw new HttpError(403, "forbidden", "Dev seed is disabled in production.");
    }

    const [{ existing }] = await db
      .select({ existing: sql<number>`count(*)::int` })
      .from(mapMarkersTable);

    if (existing >= TARGET_TOTAL) {
      return res.json({ ok: true, skipped: true, existing });
    }

    let inserted = 0;
    const totalWeight = ROSTER.reduce((s, e) => s + e.weight, 0);

    for (const e of ROSTER) {
      // Upsert entity by normalized_name.
      const [ent] = await db
        .insert(entitiesTable)
        .values({
          normalizedName: e.normalizedName,
          displayName: e.displayName,
          kind: e.kind,
          jurisdictions: e.states,
        })
        .onConflictDoNothing({ target: entitiesTable.normalizedName })
        .returning({ id: entitiesTable.id });

      const entityId =
        ent?.id ??
        (
          await db
            .select({ id: entitiesTable.id })
            .from(entitiesTable)
            .where(eq(entitiesTable.normalizedName, e.normalizedName))
            .limit(1)
        )[0]?.id;
      if (!entityId) continue;

      const targetForEntity = Math.round(
        (TARGET_TOTAL * e.weight) / totalWeight,
      );

      const rows: Array<{
        entityId: string;
        caseVertical: Vertical;
        violationCodes: string[];
        coarseLat: string;
        coarseLng: string;
        zipCode: string;
      }> = [];

      for (let i = 0; i < targetForEntity; i++) {
        const state = e.states[i % e.states.length]!;
        const placed = placeCase({
          caseId: `${e.normalizedName}:${i}`,
          jurisdiction: state,
        });
        if (!placed) continue;
        rows.push({
          entityId,
          caseVertical: e.vertical,
          violationCodes: [],
          coarseLat: placed.lat.toFixed(4),
          coarseLng: placed.lng.toFixed(4),
          zipCode: state,
        });
      }

      if (rows.length === 0) continue;
      await db.insert(mapMarkersTable).values(rows);

      await db
        .update(entitiesTable)
        .set({ pinCount: sql`${entitiesTable.pinCount} + ${rows.length}` })
        .where(eq(entitiesTable.id, entityId));

      inserted += rows.length;
    }

    return res.json({ ok: true, inserted });
  },
);

export default router;
