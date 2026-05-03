import { EventEmitter } from "events";
import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractFromImage, extractFromText } from "./vision";
import { classify, inferJurisdiction, type Vertical } from "./classify";
import { runRules, type Violation } from "./rules";
import { draftResponseLetter } from "./drafting/responseLetter";
import { draftRegulatorComplaint } from "./drafting/regulatorComplaint";
import type { RegulatorComplaint } from "./drafting/regulatorComplaint";
import type { ResponseLetter } from "./drafting/responseLetter";

/**
 * Per-case event bus. SSE consumers subscribe via the events route; the
 * pipeline emits step events which both stream out and are persisted to
 * the case row as terminal state.
 */
export type PipelineEvent =
  | { type: "step_start"; step: PipelineStep; label: string }
  | { type: "step_complete"; step: PipelineStep; label: string; data?: unknown }
  | { type: "complete"; caseId: string }
  | { type: "error"; step: PipelineStep | "init"; message: string };

export type PipelineStep =
  | "vision"
  | "classify"
  | "rules"
  | "grounding"
  | "draft"
  | "complaints"
  | "adversary"
  | "coalition";

const buses = new Map<string, EventEmitter>();
function bus(caseId: string): EventEmitter {
  let b = buses.get(caseId);
  if (!b) {
    b = new EventEmitter();
    b.setMaxListeners(50);
    buses.set(caseId, b);
  }
  return b;
}
export function subscribe(
  caseId: string,
  listener: (e: PipelineEvent) => void,
): () => void {
  const b = bus(caseId);
  b.on("event", listener);
  return () => {
    b.off("event", listener);
    // Drop the bus once nobody is listening AND the case is past its
    // terminal step, so long-running processes don't accumulate dead
    // emitters indefinitely.
    if (b.listenerCount("event") === 0 && terminated.has(caseId)) {
      buses.delete(caseId);
      terminated.delete(caseId);
    }
  };
}
const terminated = new Set<string>();
function emit(caseId: string, event: PipelineEvent): void {
  bus(caseId).emit("event", event);
  if (event.type === "complete" || event.type === "error") {
    terminated.add(caseId);
    // No active listeners? Drop the emitter immediately.
    const b = buses.get(caseId);
    if (b && b.listenerCount("event") === 0) {
      buses.delete(caseId);
      terminated.delete(caseId);
    }
  }
}

const storage = new ObjectStorageService();

const STEP_LABELS: Record<PipelineStep, string> = {
  vision: "Reading your letter…",
  classify: "Identifying the document type…",
  rules: "Checking what they did wrong…",
  grounding: "Locating your rights…",
  draft: "Drafting your response…",
  complaints: "Preparing regulator complaints…",
  adversary: "Pulling their record…",
  coalition: "Looking for your coalition…",
};

const STEP_DONE: Record<PipelineStep, string> = {
  vision: "Recognized",
  classify: "Classified",
  rules: "Violations found",
  grounding: "Statutes located",
  draft: "Response ready to send",
  complaints: "Complaints drafted",
  adversary: "Record gathered",
  coalition: "Coalition checked",
};

async function step<T>(
  caseId: string,
  s: PipelineStep,
  fn: () => Promise<T>,
  data?: (result: T) => unknown,
): Promise<T> {
  emit(caseId, { type: "step_start", step: s, label: STEP_LABELS[s] });
  const result = await fn();
  emit(caseId, {
    type: "step_complete",
    step: s,
    label: STEP_DONE[s],
    data: data ? data(result) : undefined,
  });
  return result;
}

/**
 * Drive a case from queued → complete. Persists every intermediate
 * artifact to the case row so the result page can render even if the
 * SSE stream was missed.
 */
export async function runPipeline(caseId: string): Promise<void> {
  emit(caseId, { type: "step_start", step: "vision", label: STEP_LABELS.vision });

  try {
    const [row] = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, caseId))
      .limit(1);
    if (!row) throw new Error(`case ${caseId} not found`);

    await db
      .update(casesTable)
      .set({ status: "parsing", updatedAt: new Date() })
      .where(eq(casesTable.id, caseId));

    // 1. Vision parse
    const extraction = await step(
      caseId,
      "vision",
      async () => {
        if (!row.rawDocumentUrl) {
          throw new Error("no document on case");
        }
        // If the "document" is base64-text-marker we go text-mode (synthetic
        // fixtures from the test harness drop a /text/<base64> path).
        const textPrefix = "/text/";
        if (row.rawDocumentUrl.startsWith(textPrefix)) {
          const decoded = Buffer.from(
            row.rawDocumentUrl.slice(textPrefix.length),
            "base64",
          ).toString("utf8");
          return extractFromText(decoded);
        }
        const file = await storage.getObjectEntityFile(row.rawDocumentUrl);
        const [meta] = await file.getMetadata();
        const contentType = meta.contentType ?? "image/jpeg";
        if (contentType === "application/pdf") {
          // Defer PDF rendering to the post-MVP polish task; for now ask the
          // model to read the text contents directly.
          const [buf] = await file.download();
          return extractFromText(buf.toString("utf8"));
        }
        const [buf] = await file.download();
        const mt =
          contentType === "image/png" || contentType === "image/webp"
            ? contentType
            : "image/jpeg";
        return extractFromImage({ base64: buf.toString("base64"), mediaType: mt });
      },
      (e) => ({
        documentType: e.documentType,
        sender: e.sender.name,
      }),
    );

    // 2. Classify + jurisdiction
    const { vertical, jurisdiction } = await step(
      caseId,
      "classify",
      async () => ({
        vertical: classify(extraction),
        jurisdiction:
          row.jurisdiction ?? inferJurisdiction(extraction) ?? null,
      }),
      (r) => r,
    );

    await db
      .update(casesTable)
      .set({
        status: "analyzing",
        vertical: vertical as Vertical,
        jurisdiction,
        parsed: extraction,
        updatedAt: new Date(),
      })
      .where(eq(casesTable.id, caseId));

    // 3. Rules → 4. Grounding (curated; baked into rule output)
    const violations = await step(
      caseId,
      "rules",
      async () => runRules(extraction, vertical, jurisdiction),
      (vs) => ({ count: vs.length, codes: vs.map((v) => v.code) }),
    );

    await step(
      caseId,
      "grounding",
      async () => violations.length,
      () => ({ groundedCount: violations.length }),
    );

    // 5. Draft response letter
    await db
      .update(casesTable)
      .set({ status: "drafting", violations, updatedAt: new Date() })
      .where(eq(casesTable.id, caseId));

    const letter: ResponseLetter = await step(
      caseId,
      "draft",
      () =>
        draftResponseLetter({
          extraction,
          vertical,
          jurisdiction,
          violations,
        }),
      (l) => ({ subject: l.subject, length: l.plainText.length }),
    );

    // 6. Regulator complaints — one per agency that has any violations
    const agencies = Array.from(
      new Set(
        violations
          .map((v) => v.agency)
          .filter((a): a is NonNullable<typeof a> => a !== null),
      ),
    );
    const complaints: RegulatorComplaint[] = await step(
      caseId,
      "complaints",
      async () => {
        const out: RegulatorComplaint[] = [];
        for (const agency of agencies) {
          out.push(
            await draftRegulatorComplaint({
              extraction,
              violations,
              agency,
            }),
          );
        }
        return out;
      },
      (cs) => ({ agencies: cs.map((c) => c.agency) }),
    );

    // Adversary + coalition stubs (real impls land in Features 2 + 5)
    await step(caseId, "adversary", async () => null, () => ({ status: "deferred" }));
    await step(caseId, "coalition", async () => null, () => ({ status: "deferred" }));

    await db
      .update(casesTable)
      .set({
        status: "complete",
        responseLetter: letter,
        regulatorComplaints: complaints,
        updatedAt: new Date(),
      })
      .where(eq(casesTable.id, caseId));

    emit(caseId, { type: "complete", caseId });
    logger.info({ caseId, vertical, violations: violations.length }, "pipeline complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, caseId }, "pipeline failed");
    await db
      .update(casesTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(casesTable.id, caseId))
      .catch(() => undefined);
    emit(caseId, { type: "error", step: "init", message });
  }
}
