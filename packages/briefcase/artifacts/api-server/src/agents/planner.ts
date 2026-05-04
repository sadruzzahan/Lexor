/**
 * Planner agent — Claude Sonnet 4.6, temp 0.2 (spec §9.2). Decomposes the
 * user goal into subagents for the defender role pack. The planner always
 * returns the four defender subagents unless the user's goal explicitly
 * excludes one.
 */
import { z } from "zod";
import { callLLM, loadPrompt } from "../engine";
import type { SubagentEmit } from "./shared";
// Canonical planner system prompt lives at prompts/defender_planner.md
// (per task #7 spec). The G23 PromptRegistry (NFR-E-012) wraps it so
// admin can ship A/B variants without redeploying — the .md content is
// the file fallback that lazy-seeds the first prompt_versions row.
import DEFENDER_PLANNER_PROMPT from "../../prompts/defender_planner.md";
import type { JurisdictionContext } from "../lib/jurisdictions";
import type { ParsedPdf } from "../tools/parsePdf";
import { logger } from "../lib/logger";

const ALL_DEFENDER_SUBAGENTS = [
  "TimelineBuilder",
  "EvidenceGapAuditor",
  "CrossExaminationGenerator",
  "PrecedentFinder",
  "ContradictionEngine",
  "RightsAuditor",
  "BradyDetector",
] as const;

export type DefenderSubagent = (typeof ALL_DEFENDER_SUBAGENTS)[number];

const PlannerOutputSchema = z.object({
  subagentsPlanned: z.array(z.enum(ALL_DEFENDER_SUBAGENTS)),
  notes: z.string(),
});

export interface PlannerResult {
  /** PromptRegistry attribution so the orchestrator can feed
   * recordPromptOutcome with the exact (key, version) that produced
   * this plan. Aggregates per-version A/B metrics. */
  promptKey: string;
  promptVersion: string;
  subagentsPlanned: DefenderSubagent[];
  notes: string;
}

function summarizeFile(f: ParsedPdf): string {
  const head = f.markdown.replace(/\s+/g, " ").trim().slice(0, 180);
  return `${f.fileName} (${f.pages.length}p): ${head}${head.length === 180 ? "…" : ""}`;
}

export async function runPlanner(args: {
  goal: string;
  jurisdictionContext: JurisdictionContext;
  parsedFiles: ParsedPdf[];
  runId?: string;
  /**
   * Tenant identifier for sticky-by-tenant A/B variant pick in the
   * PromptRegistry. The orchestrator passes the case's userId so the
   * same operator always sees the same planner-prompt arm.
   */
  tenantId?: string | null;
  /**
   * Optional emit so the planner's model_routed / cache_hit decisions
   * surface on the SSE stream tagged subagent="Planner". Orchestrator
   * passes a real emit; tests/headless callers may omit it.
   */
  emit?: SubagentEmit;
}): Promise<PlannerResult> {
  const fileSummaries = args.parsedFiles.map(summarizeFile);
  // G23 NFR-E-012: pull the active version + variant via PromptRegistry.
  // File content is the lazy-seed fallback so we never block on the DB.
  const loaded = await loadPrompt("defender_planner", {
    tenantId: args.tenantId ?? null,
    fileFallback: DEFENDER_PLANNER_PROMPT,
  }).catch((err) => {
    logger.warn({ err }, "PromptRegistry load failed; using bundled file content");
    return { promptKey: "defender_planner", version: "file-1", variant: null, body: DEFENDER_PLANNER_PROMPT };
  });
  const prompt = `${loaded.body}

---
INPUTS

jurisdictionContext: ${JSON.stringify(args.jurisdictionContext)}
goal: ${args.goal}
fileSummaries:
${fileSummaries.map((s) => `- ${s}`).join("\n")}
`;

  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: PlannerOutputSchema,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 1500,
      runId: args.runId,
      subagent: "Planner",
      ...(args.emit ? { emit: args.emit } : {}),
    });
    // Spec safety net: never an empty plan.
    const planned: DefenderSubagent[] = object.subagentsPlanned.length
      ? object.subagentsPlanned
      : [...ALL_DEFENDER_SUBAGENTS];
    return {
      promptKey: loaded.promptKey,
      promptVersion: loaded.version,
      subagentsPlanned: planned,
      notes: object.notes,
    };
  } catch (err) {
    logger.warn({ err }, "Planner LLM failed; using full default plan");
    return {
      promptKey: loaded.promptKey,
      promptVersion: loaded.version,
      subagentsPlanned: [...ALL_DEFENDER_SUBAGENTS],
      notes:
        "Planner fell back to the default defender pack (timeline, gaps, cross-exam, precedents) due to an upstream error.",
    };
  }
}
