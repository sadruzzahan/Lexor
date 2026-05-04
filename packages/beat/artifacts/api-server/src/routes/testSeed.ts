/**
 * Test-only seeding endpoint — NOT mounted in production.
 * Registered only when NODE_ENV !== "production".
 *
 * POST /api/v1/test/seed-completed-investigation
 *   Creates a case + completed run + events + artifacts + draft in one call.
 *   Returns { caseId, runId, draftId } so tests can navigate directly.
 *
 * DELETE /api/v1/test/seed-completed-investigation/:caseId
 *   Hard-deletes the seeded case (cascades to run, events, artifacts, draft).
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  casesTable,
  runsTable,
  runEventsTable,
  artifactsTable,
  draftsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const SEED_DRAFT_BODY = [
  "## Incident Summary",
  "",
  "At approximately 14:30 on the date of the incident, the suspect was observed near 12 Harbor Dock.",
  "Two witnesses corroborated the timeline. [cite:photo-1]",
  "",
  "## Witness Accounts",
  "",
  "Witness A stated the individual was wearing a dark jacket and carrying a duffel bag. [cite:witness-1]",
  "Witness B provided consistent testimony regarding the direction of travel. [cite:witness-2]",
  "",
  "## Physical Evidence",
  "",
  "Scene photographs document the point of entry. [cite:photo-2]",
  "",
  "## Conclusion",
  "",
  "The totality of evidence supports further investigation. All findings are preliminary and subject to verification.",
].join("\n");

router.post(
  "/v1/test/seed-completed-investigation",
  async (req, res): Promise<void> => {
    try {
      const userId =
        String(req.body?.userId ?? "demo_user_detective");
      const suffix = String(req.body?.suffix ?? "");

      // 1. Case with detected jurisdiction
      const [caseRow] = await db
        .insert(casesTable)
        .values({
          userId,
          title: `E2E Seeded Investigation${suffix ? ` (${suffix})` : ""} ${Date.now()}`,
          goal: "Suspect seen near 12 Harbor Dock. Two witnesses. Armed robbery at 14:30.",
          jurisdictionContext: {
            country: "US",
            region: "CA",
            language: "en",
            legalSystem: "common_law",
            confidence: 0.95,
            statutes: ["18 U.S.C. § 1951", "Cal. Pen. Code § 211"],
          },
        })
        .returning();

      // 2. Completed run
      const [run] = await db
        .insert(runsTable)
        .values({
          caseId: caseRow.id,
          status: "completed",
          startedAt: new Date(Date.now() - 60_000),
          completedAt: new Date(),
        })
        .returning();

      // 3. Run events — minimal set that drives useAgentRun to "done" state
      const events: Array<{ idx: number; eventType: string; payload: unknown }> = [
        { idx: 0, eventType: "run_started", payload: { runId: run.id } },
        {
          idx: 1,
          eventType: "subagent_started",
          payload: { name: "JurisdictionDetector" },
        },
        {
          idx: 2,
          eventType: "subagent_completed",
          payload: {
            name: "JurisdictionDetector",
            data: { country: "US", region: "CA" },
          },
        },
        {
          idx: 3,
          eventType: "subagent_started",
          payload: { name: "SceneCaptureTagger" },
        },
        {
          idx: 4,
          eventType: "subagent_started",
          payload: { name: "WitnessMapper" },
        },
        {
          idx: 5,
          eventType: "subagent_started",
          payload: { name: "SuspectBackground" },
        },
        {
          idx: 6,
          eventType: "partial_result",
          payload: {
            subagent: "SceneCaptureTagger",
            data: { text: "Scene analysis: two points of entry identified. [cite:photo-1]" },
          },
        },
        {
          idx: 7,
          eventType: "partial_result",
          payload: {
            subagent: "WitnessMapper",
            data: { text: "Witness A: consistent with timeline. [cite:witness-1]" },
          },
        },
        {
          idx: 8,
          eventType: "subagent_completed",
          payload: {
            name: "SceneCaptureTagger",
            data: { tags: ["entry-point", "dock", "low-light"] },
          },
        },
        {
          idx: 9,
          eventType: "subagent_completed",
          payload: {
            name: "WitnessMapper",
            data: { witnesses: [{ id: "witness-1", credibility: 0.8 }] },
          },
        },
        {
          idx: 10,
          eventType: "subagent_completed",
          payload: { name: "SuspectBackground", data: { citations: 2 } },
        },
        {
          idx: 11,
          eventType: "subagent_started",
          payload: { name: "StatementDrafter" },
        },
        {
          idx: 12,
          eventType: "partial_result",
          payload: { subagent: "StatementDrafter", data: { text: SEED_DRAFT_BODY } },
        },
        {
          idx: 13,
          eventType: "subagent_completed",
          payload: { name: "StatementDrafter", data: { wordCount: 120 } },
        },
        { idx: 14, eventType: "done", payload: { runId: run.id } },
      ];

      await db.insert(runEventsTable).values(
        events.map((e) => ({
          runId: run.id,
          idx: e.idx,
          eventType: e.eventType,
          payload: e.payload,
        })),
      );

      // 4. Artifacts
      const [draftArtifact] = await db
        .insert(artifactsTable)
        .values({
          runId: run.id,
          subagent: "StatementDrafter",
          kind: "statement_draft",
          data: { body: SEED_DRAFT_BODY },
        })
        .returning();

      // 5. Draft
      const [draft] = await db
        .insert(draftsTable)
        .values({
          caseId: caseRow.id,
          artifactId: draftArtifact.id,
          body: SEED_DRAFT_BODY,
        })
        .returning();

      res.status(201).json({
        caseId: caseRow.id,
        runId: run.id,
        draftId: draft.id,
        artifactId: draftArtifact.id,
        draft: { body: SEED_DRAFT_BODY },
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: "Seed failed", details: String(err) });
    }
  },
);

router.delete(
  "/v1/test/seed-completed-investigation/:caseId",
  async (req, res): Promise<void> => {
    try {
      const caseId = String(req.params.caseId);
      // Hard-delete — cascades to runs, events, artifacts, drafts, files
      await db.delete(casesTable).where(eq(casesTable.id, caseId));
      res.status(204).send();
    } catch (err) {
      res
        .status(500)
        .json({ error: "Cleanup failed", details: String(err) });
    }
  },
);

export default router;
