import { Router, type IRouter, type Request, type Response } from "express";
import { db, casesTable, entitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";
import { rateLimit } from "../../middlewares/rateLimit";
import {
  generateInterjection,
  type CoachContext,
} from "../../services/coach/brain";

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadCoachContext(
  req: Request,
  caseId: string,
): Promise<CoachContext> {
  if (!UUID_RE.test(caseId)) {
    throw new HttpError(400, "invalid_input", "Invalid caseId.");
  }
  const userId = getUserId(req);
  const [theCase] = await db
    .select()
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  // Match the rest of the case routes: 404 on owner-mismatch.
  if (!theCase) throw new HttpError(404, "not_found", "Case not found.");
  if (theCase.userId && theCase.userId !== userId) {
    throw new HttpError(404, "not_found", "Case not found.");
  }
  if (theCase.status !== "complete") {
    throw new HttpError(
      409,
      "case_not_ready",
      "Coaching unlocks once the case pipeline finishes.",
    );
  }

  let opposingPartyName = "the opposing party";
  if (theCase.adversaryEntityId) {
    const [ent] = await db
      .select({ displayName: entitiesTable.displayName })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, theCase.adversaryEntityId))
      .limit(1);
    if (ent?.displayName) opposingPartyName = ent.displayName;
  }

  const parsed = (theCase.parsed ?? {}) as Record<string, unknown>;
  // ExtractionSchema stores rawText (verbatim) and keyClaims — there is no
  // `summary` or `plainEnglish` field. Use rawText (capped at 600 chars)
  // as the document summary so the coach brief is always populated.
  const rawText =
    typeof parsed.rawText === "string" ? parsed.rawText.trim() : "";
  const documentSummary = rawText
    ? rawText.slice(0, 600) + (rawText.length > 600 ? "…" : "")
    : "(no summary available)";
  const keyClaims = Array.isArray(parsed.keyClaims)
    ? (parsed.keyClaims as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];
  const violationsRaw = Array.isArray(theCase.violations)
    ? theCase.violations
    : [];
  const violations = violationsRaw.flatMap((v: unknown) => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    if (
      typeof o.code !== "string" ||
      typeof o.statute !== "string" ||
      typeof o.description !== "string"
    ) {
      return [];
    }
    return [
      {
        code: o.code,
        statute: o.statute,
        description: o.description,
        severity: typeof o.severity === "string" ? o.severity : "medium",
      },
    ];
  });

  return {
    vertical: theCase.vertical,
    jurisdiction: theCase.jurisdiction,
    opposingPartyName,
    documentSummary,
    keyClaims,
    violations,
  };
}

const interjectLimit = rateLimit({
  name: "coach-interject",
  scope: "user-or-ip",
  // ≈1 call per 2s sustained, with bursts up to ~30. The frontend
  // throttles to 1 per ~3s but we cap server-side too so a runaway
  // tab can't drain credits.
  windowMs: 60 * 1000,
  max: 30,
});

/**
 * GET /counsel/cases/:caseId/coach/brief
 * Returns a 2–3 sentence "starter brief" derived from the case context
 * that the frontend can speak immediately when the session starts, so
 * the user gets value before the courtroom even begins talking. Also
 * returns provider flags so the UI can light up "real-time mode" if/when
 * Deepgram + ElevenLabs land.
 */
router.get(
  "/cases/:caseId/coach/brief",
  async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId ?? "");
    const ctx = await loadCoachContext(req, caseId);

    const topViolation = ctx.violations[0];
    const briefLines: string[] = [];
    if (topViolation) {
      briefLines.push(
        `Your strongest defense is ${topViolation.statute}. Lead with it.`,
      );
    }
    briefLines.push("Stay calm. Object to leading questions.");
    briefLines.push("Never volunteer information they didn't ask for.");

    res.json({
      brief: briefLines.join(" "),
      providers: {
        // Both are intentionally false until the user wires keys. The
        // frontend uses browser SpeechRecognition + speechSynthesis as
        // graceful fallbacks.
        stt: process.env.DEEPGRAM_API_KEY ? "deepgram" : "browser",
        tts: process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "browser",
      },
      violations: ctx.violations.map((v) => ({
        statute: v.statute,
        description: v.description,
      })),
    });
  },
);

/**
 * POST /counsel/cases/:caseId/coach/interject
 * Body: { transcript: string }
 * Returns the next tactical whisper (or null = stay silent). Capped at
 * ~8 words server-side via brain.ts. Rate-limited at 30/min/user.
 */
router.post(
  "/cases/:caseId/coach/interject",
  interjectLimit,
  async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId ?? "");
    const ctx = await loadCoachContext(req, caseId);
    const transcript =
      typeof req.body?.transcript === "string" ? req.body.transcript : "";
    if (transcript.length > 8000) {
      throw new HttpError(
        400,
        "transcript_too_large",
        "Trim transcript to last 8k chars before posting.",
      );
    }
    const result = await generateInterjection({ ctx, transcript });
    req.log.info(
      { caseId, hasLine: result.line !== null, urgency: result.urgency },
      "coach interjection",
    );
    res.json(result);
  },
);

export default router;
