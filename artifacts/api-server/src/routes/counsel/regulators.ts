import { Router, type IRouter, type Request, type Response } from "express";
import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";

const router: IRouter = Router();

/**
 * POST /counsel/regulators/file
 * Returns the agency complaint draft for a given case + agency. The
 * actual filing flow (Tier 1 direct submit / Tier 2 PDF download) is
 * scoped to the post-MVP polish task; the foundation returns the
 * pre-drafted complaint produced by the pipeline so the UI can preview it.
 */
router.post("/regulators/file", async (req: Request, res: Response) => {
  const caseId = typeof req.body?.caseId === "string" ? req.body.caseId : null;
  const agency = typeof req.body?.agency === "string" ? req.body.agency : null;
  if (!caseId || !agency) {
    throw new HttpError(400, "invalid_input", "caseId and agency are required.");
  }

  const [row] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  if (!row) throw new HttpError(404, "not_found", "Case not found.");

  // Authz: same rule as cases — anonymous case is bearer-token-style on
  // the case id; an owned case is private to its owner.
  const callerUserId = getUserId(req);
  if (row.userId !== null && row.userId !== callerUserId) {
    throw new HttpError(404, "not_found", "Case not found.");
  }

  const complaints = (row.regulatorComplaints as
    | Array<{ agency: string }>
    | null) ?? [];
  const complaint = complaints.find((c) => c.agency === agency);
  if (!complaint) {
    throw new HttpError(
      404,
      "not_found",
      "No drafted complaint for this agency on this case.",
    );
  }
  res.json(complaint);
});

export default router;
