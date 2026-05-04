/**
 * Observability routes (G21 Tier S + G23 Engine Extensions).
 *
 *   R-20  GET    /v1/runs/:runId/cost
 *   R-21  GET    /v1/runs/:runId/audit
 *   R-22  GET    /v1/runs/:runId/trace
 *   R-23  GET    /v1/runs/:runId/messages          (list bus traffic)
 *   R-24  POST   /v1/runs/:runId/messages          (force-inject — replay)
 *   R-25  GET    /v1/cache/stats
 *   R-26  GET    /v1/replay/cases
 *   R-27  POST   /v1/replay/cases/:replayCaseId/run
 *   R-28  GET    /v1/prompts/:promptKey
 *   R-29  POST   /v1/prompts/:promptKey/activate
 *
 *   G23 also adds:
 *   GET    /v1/mcp/servers                          (list registered MCP servers)
 *   GET    /v1/runs/:runId/webrtc/:peer             (drain signaling queue)
 *   POST   /v1/runs/:runId/webrtc/:peer             (push signal)
 */
import { Router, type IRouter } from "express";
import { db, agentCosts, runs, cases, runEvents } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { GetRunParams } from "@workspace/api-zod";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { requireDemoUser } from "../middlewares/demoUser";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  snapshotCost,
  snapshotCacheStats,
  buildAuditBundle,
  snapshotTrace,
  postAgentMessage,
  listAgentMessages,
  listReplayCases,
  runReplay,
  listPromptVersions,
  activatePromptVersion,
  webrtcPushSignal,
  webrtcPullSignals,
} from "../engine";
import { mcpRegistry } from "../mcp/registry";
import { runDefenderRolePack } from "../orchestration/orchestrator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireDemoUser);

/**
 * Same ownership pattern as routes/runs.ts loadOwnedRun — gate every
 * observability lookup on a runs→cases→userId join so a caller can't
 * read another user's cost ledger by guessing UUIDs (architect: IDOR).
 */
async function assertOwnsRun(runId: string, userId: string): Promise<void> {
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(cases, eq(cases.id, runs.caseId))
    .where(
      and(
        eq(runs.id, runId),
        eq(cases.userId, userId),
        isNull(cases.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ApiError("not_found", "Run not found");
  }
}

router.get("/runs/:runId/cost", async (req, res, next) => {
  try {
    const { runId } = GetRunParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);

    const live = snapshotCost(runId);
    if (live) {
      res.json({
        runId,
        totalUsd: live.totalUsd,
        byModel: live.byModel,
        byTool: live.byTool,
        byPhase: live.byPhase,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const rows = await db
      .select()
      .from(agentCosts)
      .where(eq(agentCosts.runId, runId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new ApiError("not_found", "run cost ledger not found");
    }
    res.json({
      runId,
      totalUsd: Number(row.totalUsd ?? 0),
      byModel: (row.byModel as Record<string, number>) ?? {},
      byTool: (row.byTool as Record<string, number>) ?? {},
      byPhase: (row.byPhase as Record<string, number>) ?? {},
      updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/runs/:runId/audit", async (req, res, next) => {
  try {
    const { runId } = GetRunParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);
    const bundle = await buildAuditBundle(runId);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="briefcase-audit-${runId}.zip"`,
    );
    res.setHeader("X-Bundle-Signature", bundle.signature);
    res.setHeader("X-Signing-Key-Id", bundle.signingKeyId);
    res.setHeader("Content-Length", String(bundle.sizeBytes));
    res.end(Buffer.from(bundle.zipBytes));
  } catch (err) {
    next(err);
  }
});

router.get("/runs/:runId/trace", async (req, res, next) => {
  try {
    const { runId } = GetRunParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);
    const spans = snapshotTrace(runId);
    res.json({ runId, spans });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// G15 — Time-Travel Debugger: R-23 Branch a run from a prior event index.
// Records the parent linkage + branchedAtIdx on the child row and kicks the
// orchestrator with the (optionally edited) goal. We deliberately do NOT
// copy parent's run_events into the child — the UI stitches `parent[0..idx]`
// with the child's freshly-emitted events, which keeps the unique
// (run_id, idx) constraint clean and makes the divergence point obvious.
// ---------------------------------------------------------------------------
const BranchRunInput = z.object({
  branchedAtIdx: z.number().int().min(0),
  editedInputs: z
    .object({
      // Goal must be a non-empty, length-bounded string when provided.
      goal: z.string().trim().min(1).max(4000).optional(),
    })
    .passthrough()
    .optional(),
});

router.post("/runs/:runId/branch", async (req, res, next) => {
  try {
    const { runId: parentRunId } = GetRunParams.parse(req.params);
    await assertOwnsRun(parentRunId, req.demoUser!.id);
    const body = BranchRunInput.parse(req.body);

    const parentRows = await db
      .select()
      .from(runs)
      .where(eq(runs.id, parentRunId))
      .limit(1);
    const parent = parentRows[0];
    if (!parent) throw new ApiError("not_found", "Parent run not found");

    if (parent.rolePack !== "defender") {
      throw new ApiError(
        "validation_error",
        "Branching is currently only supported for defender role packs",
      );
    }

    // Validate branchedAtIdx is within the parent run's emitted event range.
    // Branching past the tail would produce a "stitched" timeline that
    // references events that never happened.
    const maxIdxRows = await db
      .select({ maxIdx: sql<number | null>`max(${runEvents.idx})` })
      .from(runEvents)
      .where(eq(runEvents.runId, parentRunId));
    const parentMaxIdx = maxIdxRows[0]?.maxIdx;
    if (parentMaxIdx == null) {
      throw new ApiError(
        "validation_error",
        "Parent run has no events to branch from",
      );
    }
    if (body.branchedAtIdx > parentMaxIdx) {
      throw new ApiError(
        "validation_error",
        `branchedAtIdx ${body.branchedAtIdx} is beyond parent run's last event (${parentMaxIdx})`,
      );
    }

    const childGoal = body.editedInputs?.goal ?? parent.goal ?? "";

    const inserted = await db
      .insert(runs)
      .values({
        caseId: parent.caseId,
        rolePack: parent.rolePack,
        goal: childGoal,
        status: "pending",
        parentRunId,
        branchedAtIdx: body.branchedAtIdx,
      })
      .returning({ id: runs.id });
    const childRunId = inserted[0]!.id;

    void runDefenderRolePack({
      runId: childRunId,
      caseId: parent.caseId,
      rolePack: "defender",
      goal: childGoal,
    }).catch((err) => {
      logger.error(
        { err, parentRunId, childRunId },
        "Branched orchestrator crashed",
      );
    });

    res.status(201).json({
      childRunId,
      parentRunId,
      branchedAtIdx: body.branchedAtIdx,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/cache/stats", async (_req, res, next) => {
  try {
    const stats = await snapshotCacheStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// G23 — AgentMessageBus (R-23 list, R-24 force-inject)
// ---------------------------------------------------------------------------

router.get("/runs/:runId/messages", async (req, res, next) => {
  try {
    const { runId } = GetRunParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);
    const items = await listAgentMessages(runId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const AgentMessageInput = z.object({
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
  body: z.record(z.string(), z.unknown()),
});

router.post("/runs/:runId/messages", async (req, res, next) => {
  try {
    const { runId } = GetRunParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);
    const parsed = AgentMessageInput.parse(req.body);
    const msg = await postAgentMessage({
      runId,
      from: parsed.from,
      to: parsed.to,
      body: parsed.body,
    });
    res.status(202).json(msg);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// G23 — ReplayHarness (R-26, R-27)
// ---------------------------------------------------------------------------

// Replay fixtures are CI golden cases — not user-scoped — so they sit
// behind the admin token (architect: "Broken access control on replay").
router.get("/replay/cases", requireAdmin, async (_req, res, next) => {
  try {
    const items = await listReplayCases();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const ReplayCaseParams = z.object({ replayCaseId: z.string().uuid() });

router.post("/replay/cases/:replayCaseId/run", requireAdmin, async (req, res, next) => {
  try {
    const { replayCaseId } = ReplayCaseParams.parse(req.params);
    const result = await runReplay(replayCaseId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// G23 — PromptRegistry (R-28, R-29)
// ---------------------------------------------------------------------------

const PromptKeyParams = z.object({ promptKey: z.string().min(1).max(200) });
const ActivatePromptInput = z.object({
  version: z.string().min(1).max(80),
  variant: z.string().min(1).max(80),
});

router.get("/prompts/:promptKey", requireAdmin, async (req, res, next) => {
  try {
    const { promptKey } = PromptKeyParams.parse(req.params);
    const items = await listPromptVersions(promptKey);
    if (items.length === 0) {
      throw new ApiError("not_found", "no prompt versions for key");
    }
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/prompts/:promptKey/activate", requireAdmin, async (req, res, next) => {
  try {
    const { promptKey } = PromptKeyParams.parse(req.params);
    const body = ActivatePromptInput.parse(req.body);
    const row = await activatePromptVersion({ promptKey, ...body });
    if (!row) throw new ApiError("not_found", "version+variant not found");
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// G23 — MCP catalog discovery
// ---------------------------------------------------------------------------

router.get("/mcp/servers", (_req, res, next) => {
  try {
    res.json({ items: mcpRegistry.list() });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// G23 — WebRTC signaling (Courtroom Mode media path; G14 will consume).
// ---------------------------------------------------------------------------

const WebRtcPeerParams = z.object({
  runId: z.string().uuid(),
  peer: z.enum(["presenter", "audience"]),
});

const WebRtcSignalInput = z.object({
  kind: z.enum(["offer", "answer", "ice"]),
  payload: z.record(z.string(), z.unknown()),
});

router.get("/runs/:runId/webrtc/:peer", async (req, res, next) => {
  try {
    const { runId, peer } = WebRtcPeerParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);
    const messages = webrtcPullSignals(runId, peer);
    res.json({ runId, peer, messages });
  } catch (err) {
    next(err);
  }
});

router.post("/runs/:runId/webrtc/:peer", async (req, res, next) => {
  try {
    const { runId, peer } = WebRtcPeerParams.parse(req.params);
    await assertOwnsRun(runId, req.demoUser!.id);
    const body = WebRtcSignalInput.parse(req.body);
    webrtcPushSignal({
      runId,
      from: peer,
      kind: body.kind,
      payload: body.payload,
      ts: Date.now(),
    });
    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
