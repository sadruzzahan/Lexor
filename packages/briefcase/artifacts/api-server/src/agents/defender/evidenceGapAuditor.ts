/**
 * EvidenceGapAuditor (§9.4.2) — runs crossDocDiff over each ordered pair of
 * cached document parses. Uses the same parsePdf cache TimelineBuilder
 * populates so we don't re-fetch.
 */
import { crossDocDiff, type Contradiction } from "../../tools/crossDocDiff";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { SubagentEmit, SubagentResult } from "../shared";

export interface GapsArtifact {
  kind: "Gaps";
  contradictions: Contradiction[];
  priority: number;
  language: string;
}

const SEVERITY_WEIGHT: Record<Contradiction["severity"], number> = {
  low: 0.05,
  medium: 0.12,
  high: 0.25,
};

export async function runEvidenceGapAuditor(
  emit: SubagentEmit,
  ctx: {
    runId?: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
  },
): Promise<SubagentResult<GapsArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const collected: Contradiction[] = [];

  if (ctx.parsedFiles.length < 2) {
    await emit({
      type: "partial_result",
      data: {
        contradictions: 0,
        priority: 0.2,
        note: "Need at least two documents to find contradictions.",
      },
    });
    return {
      artifact: {
        kind: "Gaps",
        contradictions: [],
        priority: 0.2,
        language,
      },
    };
  }

  // All ordered pairs, capped at 6 pairs to keep latency bounded.
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
      subagent: "EvidenceGapAuditor",
    });
    collected.push(...found);
    await emit({
      type: "tool_result",
      tool: "crossDocDiff",
      resultPreview: `${found.length} contradiction${found.length === 1 ? "" : "s"} between ${a.fileName} and ${b.fileName}`,
    });
    await emit({
      type: "partial_result",
      data: {
        contradictions: collected.length,
        latestPair: `${a.fileName} ↔ ${b.fileName}`,
        priority: Math.min(1, 0.3 + collected.length * 0.1),
      },
    });
  }

  const priority = Math.min(
    1,
    0.3 + collected.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0),
  );

  return {
    artifact: {
      kind: "Gaps",
      contradictions: collected,
      priority,
      language,
    },
  };
}
