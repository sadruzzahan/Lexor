import { Router, type IRouter, type Request, type Response } from "express";
import { HttpError } from "../../middlewares/errorEnvelope";
import { buildDossier, searchEntities } from "../../services/adversary";

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /counsel/adversary/search?q=
 * Fuzzy lookup across the curated registry + persisted entities.
 * Registered BEFORE the parameterized route so Express doesn't route
 * `/search` into the `:entityId` matcher.
 */
router.get(
  "/adversary/search",
  async (req: Request, res: Response) => {
    const qRaw = req.query.q;
    const q = typeof qRaw === "string" ? qRaw : "";
    if (q.trim().length === 0) {
      throw new HttpError(400, "invalid_input", "q is required.");
    }
    const results = await searchEntities(q);
    res.json({ results });
  },
);

/**
 * GET /counsel/adversary/:entityId
 * Returns the full dossier for a previously-resolved entity.
 */
router.get(
  "/adversary/:entityId",
  async (req: Request, res: Response) => {
    const id = String(req.params.entityId ?? "");
    if (!UUID_RE.test(id)) {
      throw new HttpError(400, "invalid_input", "Invalid entityId.");
    }
    const excludeRaw = req.query.excludeCaseId;
    const excludeCaseId =
      typeof excludeRaw === "string" && UUID_RE.test(excludeRaw)
        ? excludeRaw
        : undefined;
    const dossier = await buildDossier(id, { excludeCaseId });
    if (!dossier) throw new HttpError(404, "not_found", "Entity not found.");
    res.json(dossier);
  },
);

export default router;
