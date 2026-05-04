import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import type { IEventSink } from "../lib/eventSink.js";
import type { DbSink } from "../lib/dbSink.js";
import { CostTracker } from "../lib/costTracker.js";
import { runJurisdictionDetector } from "./jurisdictionDetector.js";
import { runSceneCaptureTagger } from "./sceneCaptureTagger.js";
import { runWitnessMapper } from "./witnessMapper.js";
import { runSuspectBackground } from "./suspectBackground.js";
import { runStatementDrafter } from "./statementDrafter.js";
import { db } from "@workspace/db";
import { runsTable, caseFilesTable, casesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type {
  AgentContext,
  CaseFileInfo,
  JurisdictionContext,
  SceneTagResult,
  WitnessMapResult,
  SuspectProfileResult,
} from "./types.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CaseFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sourceType: z.string().nullable(),
  storageUrl: z.string(),
  caption: z.string().nullable(),
});

const JurisdictionSchema = z.object({
  country: z.string(),
  region: z.string(),
  language: z.string(),
  legalSystem: z.string(),
  confidence: z.number(),
  statutes: z.array(z.string()),
});

const RunInputSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  goal: z.string(),
  caseFiles: z.array(CaseFileSchema),
});

const Phase1OutputSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  goal: z.string(),
  caseFiles: z.array(CaseFileSchema),
  jurisdiction: JurisdictionSchema,
});

const SceneOutputSchema = z.object({
  tags: z.array(z.string()),
  summary: z.string(),
  confidence: z.number(),
});

const WitnessOutputSchema = z.object({
  witnesses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      statementExcerpt: z.string(),
      confidence: z.number(),
    }),
  ),
  summary: z.string(),
});

const SuspectOutputSchema = z.object({
  suspects: z.array(
    z.object({
      description: z.string(),
      sources: z.array(z.string()),
      verifiedCitations: z.array(z.string()),
    }),
  ),
  summary: z.string(),
  policyDrops: z.array(z.string()),
});

const DraftOutputSchema = z.object({
  title: z.string(),
  wordCount: z.number(),
  status: z.string(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const JURISDICTION_FALLBACK: JurisdictionContext = {
  country: "US",
  region: "CA",
  language: "en",
  legalSystem: "common_law",
  confidence: 0.5,
  statutes: [],
};

function makeCtx(
  base: z.infer<typeof RunInputSchema>,
  jurisdiction: JurisdictionContext,
  signal: AbortSignal,
): AgentContext {
  return {
    caseId: base.caseId,
    runId: base.runId,
    goal: base.goal,
    caseFiles: base.caseFiles as CaseFileInfo[],
    jurisdiction,
    signal,
  };
}

// ── Deferred helper ───────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Workflow factory ──────────────────────────────────────────────────────────

export function createDetectiveWorkflow(
  sink: IEventSink,
  signal: AbortSignal,
  costTracker: CostTracker,
) {
  // Phase 1 (serial): detect jurisdiction before any parallel work starts.
  const jurisdictionStep = createStep({
    id: "JurisdictionDetector",
    inputSchema: RunInputSchema,
    outputSchema: Phase1OutputSchema,
    execute: async ({ inputData }) => {
      sink.emit("subagent_started", { name: "JurisdictionDetector" });
      const jurisdiction = await runJurisdictionDetector(
        {
          caseId: inputData.caseId,
          runId: inputData.runId,
          goal: inputData.goal,
          caseFiles: inputData.caseFiles as CaseFileInfo[],
          signal,
        },
        sink,
        costTracker,
      );
      return { ...inputData, jurisdiction };
    },
  });

  // Shared Promises: each sibling resolves its deferred on completion.
  // StatementDrafter awaits all three via Promise.all — explicit, no API ambiguity.
  // All four steps are in .parallel() so they emit subagent_started near-simultaneously.
  const sceneDeferred = deferred<SceneTagResult>();
  const witnessDeferred = deferred<WitnessMapResult>();
  const suspectDeferred = deferred<SuspectProfileResult>();

  const sceneStep = createStep({
    id: "SceneCaptureTagger",
    inputSchema: Phase1OutputSchema,
    outputSchema: SceneOutputSchema,
    execute: async ({ inputData }) => {
      sink.emit("subagent_started", { name: "SceneCaptureTagger" });
      try {
        const result = await runSceneCaptureTagger(
          makeCtx(inputData, inputData.jurisdiction as JurisdictionContext, signal),
          sink,
          costTracker,
        );
        sceneDeferred.resolve(result);
        return result;
      } catch (err) {
        sceneDeferred.reject(err);
        throw err;
      }
    },
  });

  const witnessStep = createStep({
    id: "WitnessMapper",
    inputSchema: Phase1OutputSchema,
    outputSchema: WitnessOutputSchema,
    execute: async ({ inputData }) => {
      sink.emit("subagent_started", { name: "WitnessMapper" });
      try {
        const result = await runWitnessMapper(
          makeCtx(inputData, inputData.jurisdiction as JurisdictionContext, signal),
          sink,
          costTracker,
        );
        witnessDeferred.resolve(result);
        return result;
      } catch (err) {
        witnessDeferred.reject(err);
        throw err;
      }
    },
  });

  const suspectStep = createStep({
    id: "SuspectBackground",
    inputSchema: Phase1OutputSchema,
    outputSchema: SuspectOutputSchema,
    execute: async ({ inputData }) => {
      sink.emit("subagent_started", { name: "SuspectBackground" });
      try {
        const result = await runSuspectBackground(
          makeCtx(inputData, inputData.jurisdiction as JurisdictionContext, signal),
          sink,
          costTracker,
        );
        suspectDeferred.resolve(result);
        return result;
      } catch (err) {
        suspectDeferred.reject(err);
        throw err;
      }
    },
  });

  // StatementDrafter is in the same .parallel() block (emits subagent_started
  // near-simultaneously with siblings), then explicitly awaits all three sibling
  // results via Promise.all before synthesizing.
  const draftStep = createStep({
    id: "StatementDrafter",
    inputSchema: Phase1OutputSchema,
    outputSchema: DraftOutputSchema,
    execute: async ({ inputData }) => {
      // Announce immediately — same parallel block, subagent_started within ~500ms of siblings
      sink.emit("subagent_started", { name: "StatementDrafter" });

      // Await all three sibling results via explicit Promises — guaranteed complete outputs
      const [sceneResult, witnessResult, suspectResult] = await Promise.all([
        sceneDeferred.promise,
        witnessDeferred.promise,
        suspectDeferred.promise,
      ]);

      const jurisdiction =
        (inputData.jurisdiction as JurisdictionContext | undefined) ?? JURISDICTION_FALLBACK;
      const ctx = makeCtx(inputData, jurisdiction, signal);

      const draft = await runStatementDrafter(
        ctx,
        sink,
        { jurisdiction, sceneResult, witnessResult, suspectResult },
        costTracker,
      );

      return {
        title: "Incident Report",
        wordCount: draft.split(/\s+/).filter(Boolean).length,
        status: "complete",
      };
    },
  });

  // Topology:
  //   Phase 1: JurisdictionDetector (serial)
  //   Phase 2: SceneCaptureTagger + WitnessMapper + SuspectBackground + StatementDrafter
  //            — all four in .parallel(), all emit subagent_started near-simultaneously
  //            — StatementDrafter awaits siblings via explicit Promise.all
  return createWorkflow({
    id: "detective-investigation",
    inputSchema: RunInputSchema,
    outputSchema: DraftOutputSchema,
  })
    .then(jurisdictionStep)
    .parallel([sceneStep, witnessStep, suspectStep, draftStep])
    .commit();
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runOrchestrator(
  runId: string,
  caseId: string,
  sink: IEventSink,
  signal: AbortSignal,
): Promise<void> {
  await db
    .update(runsTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(runsTable.id, runId));

  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  const goal: string =
    caseRow?.goal ??
    caseRow?.description ??
    String((caseRow as Record<string, unknown>)?.title ?? "Unknown incident");

  const rawFiles = await db.select().from(caseFilesTable).where(eq(caseFilesTable.caseId, caseId));
  const caseFiles: CaseFileInfo[] = rawFiles.map((f) => ({
    id: f.id,
    filename: f.filename,
    mimeType: f.mimeType,
    sourceType: f.sourceType,
    storageUrl: f.storageUrl,
    caption: f.caption,
  }));

  sink.emit("run_started", { runId, caseId });

  const costTracker = new CostTracker();
  let finalStatus: "completed" | "failed" | "cancelled" = "failed";
  try {
    const workflow = createDetectiveWorkflow(sink, signal, costTracker);
    const run = await workflow.createRun({ runId });
    const result = await run.start({ inputData: { runId, caseId, goal, caseFiles } });
    finalStatus = signal.aborted
      ? "cancelled"
      : result.status === "success"
        ? "completed"
        : "failed";
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || signal.aborted) {
      finalStatus = "cancelled";
    } else {
      console.error("[orchestrator] error:", err);
      sink.emit("error", { message: String(err) });
      finalStatus = "failed";
    }
  }

  await finalize(runId, finalStatus, sink, costTracker);
}

async function finalize(
  runId: string,
  status: "completed" | "failed" | "cancelled",
  sink: IEventSink,
  costTracker: CostTracker,
): Promise<void> {
  const now = new Date();
  sink.emit("done", { runId, totalEvents: sink.totalEvents + 1 });

  const dbSink = sink as DbSink;
  if (typeof dbSink.drain === "function") {
    await dbSink.drain();
  }
  sink.close();

  const realCost = costTracker.totalCostUsdString();

  const setFields: Partial<{
    status: "completed" | "failed" | "cancelled";
    completedAt: Date;
    cancelledAt: Date;
    totalCostUsd: string;
  }> = { status };
  if (status === "completed" || status === "failed") {
    setFields.completedAt = now;
    setFields.totalCostUsd = realCost;
  } else {
    setFields.cancelledAt = now;
    setFields.totalCostUsd = realCost;
  }

  await db.update(runsTable).set(setFields).where(eq(runsTable.id, runId)).catch(console.error);
}
