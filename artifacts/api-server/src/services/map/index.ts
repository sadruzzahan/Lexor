/**
 * Public surface for the Predator Map service.
 *
 * Two responsibilities:
 *   1. **Write path** — `recordMarkerForCase` is invoked from the pipeline
 *      after the adversary resolves. Inserts one anonymized row in
 *      `map_markers` and increments `entities.pinCount`. Idempotent on
 *      (caseId, entityId) so re-runs don't double-count.
 *   2. **Read path** — `queryMarkers`, `queryEntityRollup`, and `queryStats`
 *      back the three /map/* endpoints. Read-side enforces the k-anonymity
 *      cell suppression (≥3 markers per CELL_DEG cell).
 */

import { createHash } from "node:crypto";
import { db, mapMarkersTable, entitiesTable, casesTable } from "@workspace/db";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { CELL_DEG, placeCase, snapToCell } from "./geo";
import type { Vertical } from "../classify";

export const ANONYMITY_MIN = 3;

interface RecordOpts {
  caseId: string;
  entityId: string;
  vertical: Vertical;
  jurisdiction: string | null;
  violationCodes: string[];
}

/**
 * One-way fingerprint of a case used solely to dedupe pipeline retries
 * without ever storing case identity on the marker.
 */
function caseFingerprint(caseId: string): string {
  return createHash("sha256").update(`map:${caseId}`).digest("hex");
}

/**
 * Insert one marker for this case if we can place it geographically.
 * Returns the inserted marker id or null if skipped (no jurisdiction or
 * already recorded for this case). Never throws — the map is best-effort
 * and must not fail the pipeline.
 *
 * Idempotency is DB-enforced via the unique index on
 * (entity_id, case_fingerprint). On conflict we no-op and skip the
 * pinCount bump, so retries cannot corrupt the leaderboard.
 *
 * Privacy contract:
 *   - Coordinates are written at 0.01° precision (≈1 km), never finer.
 *   - The case identity is one-way hashed into `case_fingerprint`; the
 *     row contains nothing that links back to a user.
 *   - Suppression of low-density areas (<3 cases per cell) is enforced
 *     at READ time in `queryMarkers`, not at write time. We deliberately
 *     accept this trade-off because pre-write suppression would create
 *     a chicken-and-egg problem (no first marker can ever be inserted
 *     in a fresh region) and would silently drop legitimate signal.
 */
export async function recordMarkerForCase(
  opts: RecordOpts,
): Promise<string | null> {
  try {
    const placed = placeCase({
      caseId: opts.caseId,
      jurisdiction: opts.jurisdiction,
    });
    if (!placed) return null;

    // Per spec: round to 0.01° at write time so even raw rows in the
    // database are coarsened beyond a single building / address. This is
    // belt-and-braces on top of the read-time cell suppression.
    const coarseLat = (Math.round(placed.lat * 100) / 100).toFixed(2);
    const coarseLng = (Math.round(placed.lng * 100) / 100).toFixed(2);

    const inserted = await db
      .insert(mapMarkersTable)
      .values({
        entityId: opts.entityId,
        caseVertical: opts.vertical,
        violationCodes: opts.violationCodes,
        coarseLat,
        coarseLng,
        zipCode: opts.jurisdiction,
        caseFingerprint: caseFingerprint(opts.caseId),
      })
      .onConflictDoNothing({
        target: [mapMarkersTable.entityId, mapMarkersTable.caseFingerprint],
      })
      .returning({ id: mapMarkersTable.id });

    if (inserted.length === 0) return null;

    await db
      .update(entitiesTable)
      .set({ pinCount: sql`${entitiesTable.pinCount} + 1` })
      .where(eq(entitiesTable.id, opts.entityId));

    return inserted[0]!.id;
  } catch (err) {
    logger.warn({ err, caseId: opts.caseId }, "map marker insert failed");
    return null;
  }
}

export interface MarkerCell {
  lat: number;
  lng: number;
  count: number;
  topVertical: string;
  topEntityId: string | null;
}

interface QueryOpts {
  bbox?: [number, number, number, number] | null; // [minLng,minLat,maxLng,maxLat]
  vertical?: Vertical | null;
  violationCode?: string | null;
  sinceDays?: number | null;
  entityId?: string | null;
}

/**
 * Aggregate markers into anonymized cells. Cells with fewer than
 * ANONYMITY_MIN markers are dropped server-side; the client never sees
 * them. The `entityId` filter intentionally bypasses k-anonymity ONLY
 * when the caller is asking about a specific entity — that filter is
 * what the case-page Map tab uses.
 */
export async function queryMarkers(opts: QueryOpts): Promise<MarkerCell[]> {
  const wheres: SQL[] = [];
  if (opts.vertical) {
    wheres.push(eq(mapMarkersTable.caseVertical, opts.vertical));
  }
  if (opts.entityId) {
    wheres.push(eq(mapMarkersTable.entityId, opts.entityId));
  }
  if (opts.violationCode) {
    wheres.push(
      sql`${opts.violationCode} = ANY(${mapMarkersTable.violationCodes})`,
    );
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    const since = new Date(Date.now() - opts.sinceDays * 86400_000);
    wheres.push(gte(mapMarkersTable.createdAt, since));
  }
  if (opts.bbox) {
    const [minLng, minLat, maxLng, maxLat] = opts.bbox;
    wheres.push(
      sql`${mapMarkersTable.coarseLng}::float8 BETWEEN ${minLng} AND ${maxLng}`,
    );
    wheres.push(
      sql`${mapMarkersTable.coarseLat}::float8 BETWEEN ${minLat} AND ${maxLat}`,
    );
  }

  // Inline CELL_DEG as a literal: parameterized bindings make Postgres
  // treat the SELECT and GROUP BY round() expressions as distinct, which
  // breaks "must appear in the GROUP BY clause".
  const cell = sql.raw(CELL_DEG.toString());
  const latBucketSql = sql<number>`round(${mapMarkersTable.coarseLat}::numeric / ${cell})`;
  const lngBucketSql = sql<number>`round(${mapMarkersTable.coarseLng}::numeric / ${cell})`;

  const rows = await db
    .select({
      latBucket: sql<number>`${latBucketSql}::float8`,
      lngBucket: sql<number>`${lngBucketSql}::float8`,
      count: sql<number>`count(*)::int`,
      topVertical: sql<string>`mode() within group (order by ${mapMarkersTable.caseVertical})`,
      topEntityId: sql<string | null>`mode() within group (order by ${mapMarkersTable.entityId}::text)`,
    })
    .from(mapMarkersTable)
    .where(wheres.length ? and(...wheres) : undefined)
    .groupBy(latBucketSql, lngBucketSql);

  const min = opts.entityId ? 1 : ANONYMITY_MIN;
  return rows
    .filter((r) => r.count >= min)
    .map((r) => {
      const snapped = snapToCell(
        Number(r.latBucket) * CELL_DEG,
        Number(r.lngBucket) * CELL_DEG,
      );
      return {
        lat: snapped.lat,
        lng: snapped.lng,
        count: r.count,
        topVertical: r.topVertical ?? "other",
        topEntityId: r.topEntityId ?? null,
      };
    });
}

export interface MapStats {
  totalMarkers: number;
  weekMarkers: number;
  topEntities: Array<{
    entityId: string;
    displayName: string;
    pinCount: number;
    kind: string;
  }>;
  byVertical: Array<{ vertical: string; count: number }>;
}

export async function queryStats(): Promise<MapStats> {
  const since = new Date(Date.now() - 7 * 86400_000);
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      week: sql<number>`count(*) filter (where ${mapMarkersTable.createdAt} >= ${since})::int`,
    })
    .from(mapMarkersTable);

  const top = await db
    .select({
      entityId: entitiesTable.id,
      displayName: entitiesTable.displayName,
      pinCount: entitiesTable.pinCount,
      kind: entitiesTable.kind,
    })
    .from(entitiesTable)
    .where(sql`${entitiesTable.pinCount} > 0`)
    .orderBy(desc(entitiesTable.pinCount))
    .limit(10);

  const byVertical = await db
    .select({
      vertical: mapMarkersTable.caseVertical,
      count: sql<number>`count(*)::int`,
    })
    .from(mapMarkersTable)
    .groupBy(mapMarkersTable.caseVertical);

  return {
    totalMarkers: totals?.total ?? 0,
    weekMarkers: totals?.week ?? 0,
    topEntities: top.map((t) => ({
      entityId: t.entityId,
      displayName: t.displayName,
      pinCount: t.pinCount,
      kind: t.kind,
    })),
    byVertical: byVertical.map((b) => ({
      vertical: b.vertical,
      count: b.count,
    })),
  };
}

export interface EntityRollup {
  id: string;
  displayName: string;
  kind: string;
  jurisdictions: string[];
  pinCount: number;
  caseCount: number;
  topVertical: string | null;
}

export async function queryEntityRollup(
  entityId: string,
): Promise<EntityRollup | null> {
  const [ent] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!ent) return null;

  const [agg] = await db
    .select({
      caseCount: sql<number>`count(*)::int`,
      topVertical: sql<string | null>`mode() within group (order by ${casesTable.vertical})`,
    })
    .from(casesTable)
    .where(eq(casesTable.adversaryEntityId, entityId));

  return {
    id: ent.id,
    displayName: ent.displayName,
    kind: ent.kind,
    jurisdictions: ent.jurisdictions,
    pinCount: ent.pinCount,
    caseCount: agg?.caseCount ?? 0,
    topVertical: agg?.topVertical ?? null,
  };
}
