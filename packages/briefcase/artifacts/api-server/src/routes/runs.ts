import { Router, type IRouter } from "express";
import { db, cases, runs } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  StartCaseRunParams,
  StartCaseRunBody,
  GetRunParams,
  StreamRunEventsParams,
  StreamRunEventsQueryParams,
  CancelRunParams,
} from "@workspace/api-zod";
import { ApiError } from "../lib/errors";
import { requireDemoUser } from "../middlewares/demoUser";
import { runDefenderRolePack } from "../orchestration/orchestrator";
import {
  runOnDemandSubagent,
  isOnDemandSubagent,
  ON_DEMAND_SUBAGENTS,
} from "../orchestration/onDemandSubagent";
import { streamWriterFor, EMIT_DROPPED } from "../orchestration/streamWriter";
import { streamRunEvents } from "../lib/sse";
import { logger } from "../lib/logger";
import { serializeRun } from "./cases";

const router: IRouter = Router();

/**
 * Deterministic mock identity used by the developer-facing curl in the G3
 * acceptance criteria:
 *   curl -N -H "x-demo-user: demo_user_pd" \
 *        http://localhost:80/api/v1/runs/MOCK/events
 *
 * The literal string "MOCK" in the path resolves to this UUID; the run is
 * lazily created the first time the endpoint is hit so a single curl
 * round-trip end-to-end demonstrates the whole pipeline.
 */
const MOCK_LITERAL = "MOCK";
const MOCK_RUN_ID = "00000000-0000-0000-0000-0000000000aa";
const MOCK_CASE_ID = "00000000-0000-0000-0000-0000000000bb";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "error"]);
const ACTIVE_STATUSES = ["pending", "running"];

router.use(requireDemoUser);

// R-10 Start a case run
router.post("/cases/:caseId/run", async (req, res, next) => {
  try {
    const { caseId } = StartCaseRunParams.parse(req.params);
    const body = StartCaseRunBody.parse(req.body);
    const userId = req.demoUser!.id;

    const result = await db.transaction(async (tx) => {
      // Lock the case row to serialize concurrent start-run attempts on the
      // same case (prevents two concurrent requests both passing the active
      // check below and each inserting a fresh "pending" run).
      const lockedCase = await tx
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.id, caseId),
            eq(cases.userId, userId),
            isNull(cases.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (lockedCase.length === 0) {
        throw new ApiError("not_found", "Case not found");
      }
      const caseRow = lockedCase[0]!;

      // Idempotent replay: if this exact key was already used, return the
      // same runId. Restricted to this case (cross-case reuse is a conflict).
      const existingByKey = await tx
        .select()
        .from(runs)
        .where(eq(runs.idempotencyKey, body.idempotencyKey))
        .limit(1);
      if (existingByKey.length) {
        const existing = existingByKey[0]!;
        if (existing.caseId !== caseId) {
          throw new ApiError(
            "conflict",
            "idempotencyKey already used for a different case",
          );
        }
        return { runId: existing.id, idempotent: true, caseRow };
      }

      // Concurrency check: only one active run per case. Safe under the row
      // lock above — concurrent attempts queue here and see the just-inserted
      // active run.
      const active = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(eq(runs.caseId, caseId), inArray(runs.status, ACTIVE_STATUSES)),
        )
        .limit(1);
      if (active.length) {
        throw new ApiError(
          "conflict",
          "Another run is already active on this case",
        );
      }

      const goal = body.goal ?? caseRow.title;
      try {
        const inserted = await tx
          .insert(runs)
          .values({
            caseId,
            rolePack: caseRow.rolePack,
            goal,
            idempotencyKey: body.idempotencyKey,
            status: "pending",
          })
          .returning({ id: runs.id });
        return { runId: inserted[0]!.id, idempotent: false, caseRow, goal };
      } catch (err) {
        // Race fallback: if a concurrent request inserted the same
        // idempotencyKey between our SELECT and INSERT, the unique constraint
        // fires. Re-resolve and return idempotent.
        if (isUniqueViolation(err)) {
          const replay = await tx
            .select()
            .from(runs)
            .where(eq(runs.idempotencyKey, body.idempotencyKey))
            .limit(1);
          if (replay.length && replay[0]!.caseId === caseId) {
            return { runId: replay[0]!.id, idempotent: true, caseRow };
          }
        }
        throw err;
      }
    });

    if (!result.idempotent) {
      // Fire-and-forget: orchestrator updates `runs.status` and emits events.
      const goal = (result as { goal: string }).goal;
      void runDefenderRolePack({
        runId: result.runId,
        caseId,
        rolePack: result.caseRow.rolePack as "defender" | "detective",
        goal,
      }).catch((err) => {
        logger.error({ err, runId: result.runId }, "Defender orchestrator crashed");
      });
    }

    res
      .status(201)
      .json({ runId: result.runId, idempotent: result.idempotent });
  } catch (err) {
    next(err);
  }
});

// R-10b On-demand single-subagent run (G13: Jury / Plea / Adversarial).
// Body: { subagent: OnDemandSubagent, idempotencyKey: string, goal?: string }
router.post("/cases/:caseId/subagent/:name/run", async (req, res, next) => {
  try {
    const { caseId } = StartCaseRunParams.parse({ caseId: req.params["caseId"] });
    const name = String(req.params["name"] ?? "");
    if (!isOnDemandSubagent(name)) {
      throw new ApiError(
        "validation_error",
        `Unknown on-demand subagent. Supported: ${ON_DEMAND_SUBAGENTS.join(", ")}`,
      );
    }
    const body = StartCaseRunBody.parse(req.body);
    const userId = req.demoUser!.id;

    const result = await db.transaction(async (tx) => {
      const lockedCase = await tx
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.id, caseId),
            eq(cases.userId, userId),
            isNull(cases.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (lockedCase.length === 0) {
        throw new ApiError("not_found", "Case not found");
      }
      const caseRow = lockedCase[0]!;

      const existingByKey = await tx
        .select()
        .from(runs)
        .where(eq(runs.idempotencyKey, body.idempotencyKey))
        .limit(1);
      if (existingByKey.length) {
        const existing = existingByKey[0]!;
        if (existing.caseId !== caseId) {
          throw new ApiError(
            "conflict",
            "idempotencyKey already used for a different case",
          );
        }
        return { runId: existing.id, idempotent: true, caseRow };
      }

      const active = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(eq(runs.caseId, caseId), inArray(runs.status, ACTIVE_STATUSES)),
        )
        .limit(1);
      if (active.length) {
        throw new ApiError(
          "conflict",
          "Another run is already active on this case",
        );
      }

      const goal = body.goal ?? caseRow.title;
      try {
        const inserted = await tx
          .insert(runs)
          .values({
            caseId,
            rolePack: caseRow.rolePack,
            goal,
            idempotencyKey: body.idempotencyKey,
            status: "pending",
          })
          .returning({ id: runs.id });
        return { runId: inserted[0]!.id, idempotent: false, caseRow, goal };
      } catch (err) {
        if (isUniqueViolation(err)) {
          const replay = await tx
            .select()
            .from(runs)
            .where(eq(runs.idempotencyKey, body.idempotencyKey))
            .limit(1);
          if (replay.length && replay[0]!.caseId === caseId) {
            return { runId: replay[0]!.id, idempotent: true, caseRow };
          }
        }
        throw err;
      }
    });

    if (!result.idempotent) {
      const goal = (result as { goal: string }).goal;
      void runOnDemandSubagent({
        runId: result.runId,
        caseId,
        goal,
        subagent: name,
      }).catch((err) => {
        logger.error(
          { err, runId: result.runId, subagent: name },
          "On-demand subagent crashed",
        );
      });
    }

    res
      .status(201)
      .json({ runId: result.runId, idempotent: result.idempotent });
  } catch (err) {
    next(err);
  }
});

// R-12 Get final run state — also accepts the MOCK literal
router.get("/runs/:runId", async (req, res, next) => {
  try {
    const raw = req.params["runId"];
    if (raw !== MOCK_LITERAL) GetRunParams.parse({ runId: raw });
    const runId = await resolveRunId(raw);

    const row = await loadOwnedRun(runId, req.demoUser!.id);
    res.json(serializeRun(row));
  } catch (err) {
    next(err);
  }
});

// R-11 Stream run events (SSE)
router.get("/runs/:runId/events", async (req, res, next) => {
  try {
    const requested = req.params["runId"];
    // Validate UUID for non-MOCK requests; MOCK is a deterministic literal that
    // resolves to a fixed UUID in `resolveRunId` and would otherwise fail UUID
    // validation. (StreamRunEventsParams.runId is a Zod uuid().)
    if (requested !== MOCK_LITERAL) {
      StreamRunEventsParams.parse({ runId: requested });
    }
    const runId = await resolveRunId(requested, { autoStartMock: true });

    const query = StreamRunEventsQueryParams.parse(req.query);

    let since = -1;
    if (typeof query.since === "number") {
      since = query.since;
    } else {
      const lastEventId = req.header("Last-Event-ID");
      if (lastEventId) {
        const parsed = Number.parseInt(lastEventId, 10);
        if (!Number.isNaN(parsed) && parsed >= -1) since = parsed;
      }
    }

    const row = await loadOwnedRun(runId, req.demoUser!.id);
    const isTerminal = TERMINAL_STATUSES.has(row.status);

    await streamRunEvents(req, res, { runId, since, isTerminal });
  } catch (err) {
    next(err);
  }
});

// R-13 Cancel a run
router.post("/runs/:runId/cancel", async (req, res, next) => {
  try {
    const { runId } = CancelRunParams.parse(req.params);

    const row = await loadOwnedRun(runId, req.demoUser!.id);

    if (TERMINAL_STATUSES.has(row.status)) {
      throw new ApiError("conflict", `Run is already ${row.status}`);
    }

    // Parity: orchestrator emits `done` THEN updates status. If our cancel
    // `done(cancelled:true)` wins the streamWriter (idx >= 0), we also beat
    // its status UPDATE — so the conditional flip below must affect 1 row.
    // EMIT_DROPPED means orchestrator's done already landed; bail 409.
    const writer = streamWriterFor(runId);
    let emittedIdx: number;
    try {
      emittedIdx = await writer.emit({ type: "done", runId, cancelled: true });
    } catch (err) {
      writer.close();
      throw err;
    }

    if (emittedIdx === EMIT_DROPPED) {
      writer.close();
      const fresh = await loadOwnedRun(runId, req.demoUser!.id);
      // Orchestrator's terminal `done` already persisted; its status UPDATE
      // may not have landed yet, so report the authoritative event outcome
      // rather than the (possibly still-active) status string.
      throw new ApiError(
        "conflict",
        TERMINAL_STATUSES.has(fresh.status)
          ? `Run is already ${fresh.status}`
          : `Run completed before cancel was applied`,
      );
    }

    const requestedAt = new Date();
    const flipped = await db
      .update(runs)
      .set({ status: "cancelled", cancelled: true, completedAt: requestedAt })
      .where(and(eq(runs.id, runId), inArray(runs.status, ACTIVE_STATUSES)))
      .returning({ id: runs.id });

    writer.close();

    if (flipped.length === 0) {
      // Invariant violation — should be unreachable.
      logger.error({ runId }, "cancel: parity invariant violated (0 rows flipped)");
      const fresh = await loadOwnedRun(runId, req.demoUser!.id);
      throw new ApiError(
        "conflict",
        TERMINAL_STATUSES.has(fresh.status)
          ? `Run is already ${fresh.status}`
          : `Run completed before cancel was applied`,
      );
    }

    res.status(202).json({
      runId,
      cancellationRequestedAt: requestedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a run scoped to the caller's user via runs→cases ownership join.
 * Throws 404 (not 403) for unowned runs to avoid leaking existence.
 */
async function loadOwnedRun(runId: string, userId: string) {
  const rows = await db
    .select({ run: runs })
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
  return rows[0]!.run;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // node-postgres surfaces SQLSTATE on err.code; 23505 = unique_violation.
  const code = (err as { code?: string }).code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// MOCK convenience: lazily create a deterministic mock case + run on first hit
// ---------------------------------------------------------------------------

let mockBootstrap: Promise<void> | null = null;

async function resolveRunId(
  raw: string | undefined,
  opts: { autoStartMock?: boolean } = {},
): Promise<string> {
  if (!raw) {
    throw new ApiError("validation_error", "Missing runId");
  }
  if (raw === MOCK_LITERAL) {
    if (opts.autoStartMock) {
      await ensureMockRun();
    }
    return MOCK_RUN_ID;
  }
  return raw;
}

async function ensureMockRun(): Promise<void> {
  // Fast path: if the bootstrap already ran AND the run row still exists,
  // reuse the cached promise. If the row was deleted (eg. dev DB reset
  // mid-process), fall through and re-bootstrap so /runs/MOCK/events stays
  // self-healing without requiring a server restart.
  if (mockBootstrap) {
    const present = await db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.id, MOCK_RUN_ID))
      .limit(1);
    if (present.length) return mockBootstrap;
    mockBootstrap = null;
  }
  mockBootstrap = (async () => {
    const existing = await db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, MOCK_RUN_ID))
      .limit(1);
    if (existing.length) return; // already exists; replay will do its job

    const { DEMO_USER_ID } = await import("@workspace/db/demo");

    // Seed a deterministic case + run. We rely on demo user already existing
    // (seeded by `pnpm seed`); if not, fail loud — that's a setup error.
    await db
      .insert(cases)
      .values({
        id: MOCK_CASE_ID,
        userId: DEMO_USER_ID,
        title: "MOCK demo case",
        description: "Auto-created when GET /v1/runs/MOCK/events is hit.",
        rolePack: "defender",
        status: "running",
      })
      .onConflictDoNothing();

    await db
      .insert(runs)
      .values({
        id: MOCK_RUN_ID,
        caseId: MOCK_CASE_ID,
        rolePack: "defender",
        goal: "MOCK end-to-end SSE smoke test",
        status: "pending",
      })
      .onConflictDoNothing();

    void runDefenderRolePack({
      runId: MOCK_RUN_ID,
      caseId: MOCK_CASE_ID,
      rolePack: "defender",
      goal: "MOCK end-to-end SSE smoke test",
    }).catch((err) => {
      logger.error({ err }, "Defender orchestrator (MOCK literal) crashed");
    });
  })().catch((err) => {
    mockBootstrap = null;
    throw err;
  });
  return mockBootstrap;
}

export default router;
