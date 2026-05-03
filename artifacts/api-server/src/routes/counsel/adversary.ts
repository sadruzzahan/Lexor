import { Router, type IRouter, type Request, type Response } from "express";
import { HttpError } from "../../middlewares/errorEnvelope";
import { buildDossier, searchEntities } from "../../services/adversary";

const router: IRouter = Router();

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
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, "invalid_input", "Invalid entityId.");
    }
    const dossier = await buildDossier(id);
    if (!dossier) throw new HttpError(404, "not_found", "Entity not found.");
    res.json(dossier);
  },
);

export default router;
