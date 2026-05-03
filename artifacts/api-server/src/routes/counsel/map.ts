import { Router, type IRouter, type Request, type Response } from "express";
import { HttpError } from "../../middlewares/errorEnvelope";
import {
  queryMarkers,
  queryStats,
  queryEntityRollup,
} from "../../services/map";
import type { Vertical } from "../../services/classify";

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VERTICALS = new Set<Vertical>(["eviction", "debt", "wage", "other"]);

function parseVertical(raw: unknown): Vertical | null {
  if (typeof raw !== "string") return null;
  return VERTICALS.has(raw as Vertical) ? (raw as Vertical) : null;
}

function parseBbox(
  raw: unknown,
): [number, number, number, number] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((s) => Number.parseFloat(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng > maxLng || minLat > maxLat) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function parseInt0(raw: unknown, max: number): number | null {
  if (typeof raw !== "string") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return n;
}

router.get("/map/markers", async (req: Request, res: Response) => {
  const cells = await queryMarkers({
    bbox: parseBbox(req.query.bbox),
    vertical: parseVertical(req.query.vertical),
    violationCode:
      typeof req.query.violation === "string" && req.query.violation.length < 64
        ? req.query.violation
        : null,
    sinceDays: parseInt0(req.query.sinceDays, 365 * 5),
    entityId:
      typeof req.query.entityId === "string" && UUID_RE.test(req.query.entityId)
        ? req.query.entityId
        : null,
  });
  res.json({
    markers: cells.map((c) => ({
      // Stable synthetic cell id (NOT a row uuid) — see MapMarker schema.
      id: `cell:${c.lat.toFixed(2)}:${c.lng.toFixed(2)}:${c.topVertical}`,
      entityId: c.topEntityId ?? null,
      caseVertical: c.topVertical,
      violationCodes: [],
      coarseLat: c.lat,
      coarseLng: c.lng,
      zipCode: null,
      createdAt: null,
      count: c.count,
    })),
  });
});

router.get("/map/stats", async (_req: Request, res: Response) => {
  res.json(await queryStats());
});

router.get("/map/entity/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    throw new HttpError(400, "invalid_input", "Invalid id.");
  }
  const rollup = await queryEntityRollup(id);
  if (!rollup) throw new HttpError(404, "not_found", "Entity not found.");
  res.json(rollup);
});

export default router;
