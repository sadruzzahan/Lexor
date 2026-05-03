import { Router, type IRouter, type Request, type Response } from "express";
import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";
import { rateLimit } from "../../middlewares/rateLimit";
import { runTrial, getLatestTrial } from "../../services/trial/run";

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertCaseAccess(
  req: Request,
  caseId: string,
): Promise<void> {
  if (!UUID_RE.test(caseId)) {
    throw new HttpError(400, "invalid_input", "Invalid caseId.");
  }
  const userId = getUserId(req);
  const [theCase] = await db
    .select({ userId: casesTable.userId, status: casesTable.status })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  if (!theCase) throw new HttpError(404, "not_found", "Case not found.");
  if (theCase.userId && theCase.userId !== userId) {
    throw new HttpError(403, "forbidden", "Not your case.");
  }
}

const trialStartLimit = rateLimit({
  name: "trial-start",
  scope: "user-or-ip",
  windowMs: 60 * 60 * 1000,
  max: 20,
});

/**
 * GET /counsel/cases/:caseId/trial
 * Replay the most recent simulated hearing for a case. Returns null
 * when no trial has been run yet so the UI can render a "Start trial"
 * call-to-action.
 */
router.get(
  "/cases/:caseId/trial",
  async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId ?? "");
    await assertCaseAccess(req, caseId);
    const trial = await getLatestTrial(caseId);
    res.json({ trial });
  },
);

/**
 * POST /counsel/cases/:caseId/trial
 * Run a fresh trial. Idempotent: returns the existing complete trial
 * unless `force=true`. The hearing runs synchronously inside the
 * request — the SLA is <45s. The route is rate-capped at 20/hr/user
 * because each run is an LLM-bound hot path.
 */
router.post(
  "/cases/:caseId/trial",
  trialStartLimit,
  async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId ?? "");
    await assertCaseAccess(req, caseId);
    const force = req.body?.force === true;

    // Refuse to spawn a trial against an unfinished case — the briefing
    // depends on parsed + violations, which only land at status="complete".
    const [theCase] = await db
      .select({ status: casesTable.status })
      .from(casesTable)
      .where(eq(casesTable.id, caseId))
      .limit(1);
    if (theCase?.status !== "complete") {
      throw new HttpError(
        409,
        "case_not_ready",
        "Wait for the case pipeline to finish before running a trial.",
      );
    }

    try {
      const trialId = await runTrial(caseId, { force });
      const trial = await getLatestTrial(caseId);
      req.log.info({ caseId, trialId }, "trial run requested");
      res.json({ trial });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(500, "trial_failed", `Trial failed: ${message}`);
    }
  },
);

export default router;
