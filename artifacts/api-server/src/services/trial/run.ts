import {
  db,
  casesTable,
  entitiesTable,
  trialsTable,
  trialTurnsTable,
} from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import {
  nextTurn,
  summarizeVerdict,
  type TrialCharacter,
  type TrialContext,
} from "./agents";

const MAX_TURNS = 8;

/**
 * Run the multi-agent simulated hearing for a case. Persists every turn
 * as it lands so the UI can replay the same transcript later from the
 * same URL. Idempotent at the trial-row level: re-running on the same
 * caseId returns the most recent trial without re-spending tokens
 * unless `force` is set.
 */
export async function runTrial(
  caseId: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  // Pull the case + its adversary entity name for the briefing.
  const [theCase] = await db
    .select({
      id: casesTable.id,
      vertical: casesTable.vertical,
      jurisdiction: casesTable.jurisdiction,
      parsed: casesTable.parsed,
      violations: casesTable.violations,
      adversaryEntityId: casesTable.adversaryEntityId,
    })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  if (!theCase) throw new Error("case_not_found");

  // Reuse a complete trial unless force.
  if (!opts.force) {
    const [existing] = await db
      .select()
      .from(trialsTable)
      .where(eq(trialsTable.caseId, caseId))
      .orderBy(desc(trialsTable.startedAt))
      .limit(1);
    if (existing && existing.status === "complete") return existing.id;
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

  const parsed = (theCase.parsed ?? null) as
    | {
        documentType?: string | null;
        keyClaims?: string[];
        sender?: { name?: string | null };
      }
    | null;
  const documentSummary = parsed?.documentType
    ? `A ${parsed.documentType}`
    : `A ${theCase.vertical} letter`;
  const keyClaims = Array.isArray(parsed?.keyClaims)
    ? parsed!.keyClaims.slice(0, 6)
    : [];
  const violations = Array.isArray(theCase.violations)
    ? (theCase.violations as TrialContext["violations"]).slice(0, 6)
    : [];

  const ctx: TrialContext = {
    vertical: theCase.vertical,
    jurisdiction: theCase.jurisdiction,
    opposingPartyName,
    documentSummary,
    keyClaims,
    violations,
  };

  const [trial] = await db
    .insert(trialsTable)
    .values({ caseId, status: "running" })
    .returning();
  if (!trial) throw new Error("trial_insert_failed");

  // Turn order: opening sequence is YourCounsel → Opposing → Judge,
  // then alternating until the Judge sets ended=true or MAX_TURNS hits.
  const order: TrialCharacter[] = [
    "your_counsel",
    "opposing",
    "judge",
    "your_counsel",
    "opposing",
    "judge",
    "your_counsel",
    "judge",
  ];

  const transcript: Array<{ character: TrialCharacter; line: string }> = [];

  try {
    for (let i = 0; i < MAX_TURNS; i++) {
      const character = order[i] ?? "judge";
      const turn = await nextTurn(ctx, character, transcript);
      transcript.push({ character: turn.character, line: turn.line });
      await db.insert(trialTurnsTable).values({
        trialId: trial.id,
        ord: i,
        character: turn.character,
        line: turn.line,
        citation: turn.citation,
      });
      if (turn.ended && turn.character === "judge") break;
    }

    const verdict = await summarizeVerdict(ctx, transcript);

    await db
      .update(trialsTable)
      .set({
        status: "complete",
        predictedOutcome: verdict.outcome,
        predictedRationale: verdict.rationale,
        swingArguments: verdict.swingArguments,
        completedAt: new Date(),
      })
      .where(eq(trialsTable.id, trial.id));

    logger.info(
      { caseId, trialId: trial.id, outcome: verdict.outcome },
      "trial complete",
    );
    return trial.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, caseId, trialId: trial.id }, "trial failed");
    await db
      .update(trialsTable)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(trialsTable.id, trial.id));
    throw err;
  }
}

export interface TrialView {
  id: string;
  caseId: string;
  status: "queued" | "running" | "complete" | "failed";
  predictedOutcome: "plaintiff" | "defendant" | "mixed" | "undetermined" | null;
  predictedRationale: string | null;
  swingArguments: string[];
  startedAt: string;
  completedAt: string | null;
  turns: Array<{
    ord: number;
    character: TrialCharacter;
    line: string;
    citation: string | null;
  }>;
}

export async function getLatestTrial(caseId: string): Promise<TrialView | null> {
  const [trial] = await db
    .select()
    .from(trialsTable)
    .where(eq(trialsTable.caseId, caseId))
    .orderBy(desc(trialsTable.startedAt))
    .limit(1);
  if (!trial) return null;
  const turns = await db
    .select({
      ord: trialTurnsTable.ord,
      character: trialTurnsTable.character,
      line: trialTurnsTable.line,
      citation: trialTurnsTable.citation,
    })
    .from(trialTurnsTable)
    .where(eq(trialTurnsTable.trialId, trial.id))
    .orderBy(asc(trialTurnsTable.ord));
  return {
    id: trial.id,
    caseId: trial.caseId,
    status: trial.status,
    predictedOutcome: trial.predictedOutcome,
    predictedRationale: trial.predictedRationale,
    swingArguments: Array.isArray(trial.swingArguments)
      ? (trial.swingArguments as string[])
      : [],
    startedAt: trial.startedAt.toISOString(),
    completedAt: trial.completedAt ? trial.completedAt.toISOString() : null,
    turns,
  };
}
