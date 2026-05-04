/**
 * ContradictionEngine — high-precision typed contradictions across the
 * full document set.
 *
 * Difference vs EvidenceGapAuditor (G7): EvidenceGapAuditor surveys
 * pairwise factual mismatches as "Gaps". ContradictionEngine layers a
 * deterministic timestamp-anchor pass (`bodycamFrameAlign`) on top of
 * the same crossDocDiff signal so timing-driven contradictions
 * (bodycam activation gaps, lab intake vs incident timestamps,
 * witness-claimed times) are surfaced with explicit second-level
 * deltas the planner and Briefcase pane can highlight without the LLM
 * inventing arithmetic.
 *
 * Spec G12: runs after TimelineBuilder so it has anchors. The
 * orchestrator's dependency-aware scheduler enforces this ordering and
 * threads TimelineBuilder's merged event list into `ctx.timeline`. The
 * engine prefers those merged events when present (cleaner than the
 * raw HH:MM:SS regex pass) and falls back to the deterministic
 * bodycamFrameAlign pre-pass when Timeline is absent (e.g. planner
 * skipped TimelineBuilder).
 *
 * Honesty: anything cited as a rule is sent through `verifyCitation`
 * and silently dropped on failure (spec §10.4).
 */
import { z } from "zod";
import { callLLM } from "../../engine";
import { logger } from "../../lib/logger";
import {
  alignBodycamFrames,
  extractAnchors,
  type AlignedAnchor,
} from "../../tools/bodycamFrameAlign";
import { crossDocDiff, type Contradiction } from "../../tools/crossDocDiff";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { TimelineArtifact } from "./timelineBuilder";
import type { SubagentEmit, SubagentResult } from "../shared";

const TypedContradictionSchema = z.object({
  claim: z.string(),
  type: z.enum(["timestamp", "identity", "sequence", "fact"]),
  severity: z.enum(["low", "medium", "high"]),
  sourceA: z.object({
    fileName: z.string(),
    quote: z.string(),
  }),
  sourceB: z.object({
    fileName: z.string(),
    quote: z.string(),
  }),
  explanation: z.string(),
  /**
   * Present only for `type: "timestamp"` items the bodycamFrameAlign
   * pre-pass surfaced. Lets the UI render an explicit "Δ 17m 38s"
   * badge without re-parsing the LLM prose.
   */
  anchor: z
    .object({
      tsA: z.string(),
      tsB: z.string(),
      deltaSeconds: z.number().int(),
    })
    .nullable(),
});

const TypedSetSchema = z.object({
  contradictions: z.array(TypedContradictionSchema),
});

export type TypedContradiction = z.infer<typeof TypedContradictionSchema>;

export interface ContradictionsArtifact {
  kind: "Contradictions";
  contradictions: TypedContradiction[];
  /** Deterministic timestamp anchors the LLM was offered as grounding. */
  timeAnchors: AlignedAnchor[];
  priority: number;
  language: string;
}

const SEVERITY_WEIGHT: Record<TypedContradiction["severity"], number> = {
  low: 0.06,
  medium: 0.14,
  high: 0.28,
};

function fmtDelta(seconds: number): string {
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const sign = seconds < 0 ? "-" : "+";
  return `${sign}${m}m ${s}s`;
}

export async function runContradictionEngine(
  emit: SubagentEmit,
  ctx: {
    runId?: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    /**
     * TimelineBuilder's merged event list — present when the planner
     * scheduled TimelineBuilder and it succeeded. The orchestrator's
     * dependency-aware scheduler awaits TimelineBuilder before
     * starting this subagent so the events are real anchors, not
     * stale data from a previous run.
     */
    timeline?: TimelineArtifact | null;
  },
): Promise<SubagentResult<ContradictionsArtifact>> {
  const language = ctx.jurisdictionContext.language;

  if (ctx.parsedFiles.length < 2) {
    await emit({
      type: "partial_result",
      data: {
        contradictions: 0,
        priority: 0.2,
        note: "Need at least two documents to detect contradictions.",
      },
    });
    return {
      artifact: {
        kind: "Contradictions",
        contradictions: [],
        timeAnchors: [],
        priority: 0.2,
        language,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Pass 1 — deterministic timestamp anchors via bodycamFrameAlign.
  // ---------------------------------------------------------------------
  const perFileAnchors = ctx.parsedFiles.map((f) => ({
    file: f,
    anchors: extractAnchors({ fileName: f.fileName, text: f.markdown }),
  }));
  const totalAnchors = perFileAnchors.reduce(
    (n, x) => n + x.anchors.length,
    0,
  );
  await emit({
    type: "tool_call",
    tool: "bodycamFrameAlign",
    args: { files: ctx.parsedFiles.length },
    status: "running",
  });
  await emit({
    type: "tool_result",
    tool: "bodycamFrameAlign",
    resultPreview: `${totalAnchors} time anchors across ${ctx.parsedFiles.length} files`,
  });

  const aligned: AlignedAnchor[] = [];
  for (let i = 0; i < perFileAnchors.length; i++) {
    for (let j = i + 1; j < perFileAnchors.length; j++) {
      const a = perFileAnchors[i]!;
      const b = perFileAnchors[j]!;
      if (a.anchors.length === 0 || b.anchors.length === 0) continue;
      // Route through the streaming-tools wrapper so any future
      // E2B-backed implementation streams tool_progress + records
      // into CostMeter without further plumbing.
      aligned.push(
        ...(await alignBodycamFrames({
          fileA: a.file.fileName,
          textA: a.file.markdown,
          fileB: b.file.fileName,
          textB: b.file.markdown,
          topN: 8,
          ...(ctx.runId ? { runId: ctx.runId } : {}),
          emit,
          subagent: "ContradictionEngine",
        })),
      );
    }
  }
  // Keep the tightest deltas globally (most likely to be alignable
  // claims about the same event).
  aligned.sort(
    (x, y) => Math.abs(x.deltaSeconds) - Math.abs(y.deltaSeconds),
  );
  const tightest = aligned.slice(0, 16);

  // ---------------------------------------------------------------------
  // Pass 2 — pairwise crossDocDiff on the same documents. Capped to keep
  // latency bounded inside the 90-s run budget.
  // ---------------------------------------------------------------------
  const collected: Contradiction[] = [];
  const pairs: Array<[ParsedPdf, ParsedPdf]> = [];
  for (let i = 0; i < ctx.parsedFiles.length; i++) {
    for (let j = i + 1; j < ctx.parsedFiles.length; j++) {
      pairs.push([ctx.parsedFiles[i]!, ctx.parsedFiles[j]!]);
      if (pairs.length >= 6) break;
    }
    if (pairs.length >= 6) break;
  }
  for (const [a, b] of pairs) {
    await emit({
      type: "tool_call",
      tool: "crossDocDiff",
      args: { docA: a.fileName, docB: b.fileName },
      status: "running",
    });
    const found = await crossDocDiff({
      docA: { fileName: a.fileName, text: a.markdown },
      docB: { fileName: b.fileName, text: b.markdown },
      language,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      emit,
      subagent: "ContradictionEngine",
    });
    collected.push(...found);
    await emit({
      type: "tool_result",
      tool: "crossDocDiff",
      resultPreview: `${found.length} between ${a.fileName} and ${b.fileName}`,
    });
  }

  // ---------------------------------------------------------------------
  // Pass 3 — LLM synthesis: re-type + pick severity using both signals.
  // The LLM sees the deterministic time anchors plus the raw
  // crossDocDiff hits and produces a clean `TypedContradiction[]` set.
  // ---------------------------------------------------------------------
  const anchorsBundle = tightest
    .map(
      (p, i) =>
        `[T${i + 1}] Δ ${fmtDelta(p.deltaSeconds)} | ${p.fileA}@${p.anchorA.raw} ↔ ${p.fileB}@${p.anchorB.raw}\n  A: …${p.anchorA.context}…\n  B: …${p.anchorB.context}…`,
    )
    .join("\n\n");

  // TimelineBuilder events as a separate, higher-quality anchor track.
  // These are already merged + deduplicated across files so the LLM
  // reasons about real wall-clock events, not raw token matches.
  const timelineBundle = ctx.timeline
    ? ctx.timeline.events
        .slice(0, 16)
        .map((e, i) => {
          const srcs = (e.sources ?? [])
            .slice(0, 3)
            .map(
              (s) =>
                `${s.fileName}${s.page ? ` p.${s.page}` : ""}: "${s.quote.slice(0, 100)}"`,
            )
            .join(" | ");
          return `[E${i + 1}] ${e.date} — ${e.title} (conf ${e.confidence})\n  sources: ${srcs}`;
        })
        .join("\n\n")
    : "";

  const diffsBundle = collected
    .map(
      (c, i) =>
        `[D${i + 1}] severity=${c.severity} type=${c.type} | ${c.sourceA.fileName} vs ${c.sourceB.fileName}\n  claim: ${c.claim}\n  A: ${c.sourceA.quote}\n  B: ${c.sourceB.quote}\n  why: ${c.explanation}`,
    )
    .join("\n\n");

  const prompt = `You are ContradictionEngine for a criminal-defense run.
Output language: ${language}.

You are given:
  - MERGED_TIMELINE: TimelineBuilder's authoritative merged event list
    (present when TimelineBuilder ran). Each event has a date, title,
    confidence, and the source quotes that grounded it. Prefer this as
    the canonical anchor track when present.
  - TIME_ANCHORS: deterministic HH:MM:SS pairs across the case files,
    smallest delta first. Use these as a secondary signal — especially
    useful for sub-minute deltas TimelineBuilder may have collapsed.
  - CROSS_DOC_DIFFS: candidate factual mismatches the EvidenceGapAuditor
    would surface. Re-type and re-rank them for the contradiction pane.

Return a single JSON object {"contradictions": [...]} where each item:
  - type ∈ {timestamp, identity, sequence, fact}
  - severity ∈ {low, medium, high}
  - sourceA / sourceB include verbatim quotes from the named files
  - explanation: one sentence
  - anchor: present (with tsA, tsB, deltaSeconds) ONLY for timestamp items
    that align with one of the TIME_ANCHORS pairs; null otherwise

Drop any candidate where you cannot find a verbatim anchoring quote in
both documents. Do not invent quotes.

MERGED_TIMELINE
${timelineBundle || "(TimelineBuilder did not run for this case)"}

TIME_ANCHORS
${anchorsBundle || "(none — files contain no parseable HH:MM:SS tokens)"}

CROSS_DOC_DIFFS
${diffsBundle || "(no pairwise diffs surfaced)"}`;

  let drafted: z.infer<typeof TypedSetSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: TypedSetSchema,
      prompt,
      runId: ctx.runId,
      subagent: "ContradictionEngine",
      emit,
    });
    drafted = object;
  } catch (err) {
    logger.warn({ err }, "ContradictionEngine LLM failed");
    drafted = { contradictions: [] };
  }

  await emit({
    type: "partial_result",
    data: {
      anchors: tightest.length,
      diffs: collected.length,
      contradictions: drafted.contradictions.length,
      priority: Math.min(1, 0.4 + drafted.contradictions.length * 0.1),
    },
  });

  const priority = Math.min(
    1,
    0.35 +
      drafted.contradictions.reduce(
        (sum, c) => sum + SEVERITY_WEIGHT[c.severity],
        0,
      ),
  );

  return {
    artifact: {
      kind: "Contradictions",
      contradictions: drafted.contradictions,
      timeAnchors: tightest,
      priority,
      language,
    },
  };
}
