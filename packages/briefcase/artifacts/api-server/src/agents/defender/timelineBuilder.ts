/**
 * TimelineBuilder (§9.4.1) — parsePdf → extractEntities (Gemini) → mergeEvents.
 * Output language matches detected document language.
 *
 * Each subagent gets a thin SubagentEmit interface so the orchestrator owns
 * idx/SSE bridging — agents only emit "what happened", not the wire format.
 */
import { extractEntities } from "../../tools/extractEntities";
import { mergeEvents, type TimelineEventMerged } from "../../tools/mergeEvents";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { SubagentEmit, SubagentResult } from "../shared";

export interface TimelineArtifact {
  kind: "Timeline";
  events: TimelineEventMerged[];
  priority: number;
  language: string;
}

export async function runTimelineBuilder(
  emit: SubagentEmit,
  ctx: {
    runId?: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
  },
): Promise<SubagentResult<TimelineArtifact>> {
  const language = ctx.jurisdictionContext.language;

  const allEvents: Array<{
    fileId: string;
    fileName: string;
    events: Awaited<ReturnType<typeof extractEntities>>;
  }> = [];

  for (const file of ctx.parsedFiles) {
    await emit({
      type: "tool_call",
      tool: "parsePdf",
      args: { fileId: file.fileId, fileName: file.fileName },
      status: "success",
    });
    await emit({
      type: "tool_result",
      tool: "parsePdf",
      resultPreview: `${file.pages.length} pages, ${file.markdown.length.toLocaleString()} chars`,
    });

    await emit({
      type: "tool_call",
      tool: "extractEntities",
      args: { fileId: file.fileId, language },
      status: "running",
    });
    const events = await extractEntities({
      fileId: file.fileId,
      fileName: file.fileName,
      text: file.markdown,
      language,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      emit,
      subagent: "TimelineBuilder",
    });
    await emit({
      type: "tool_result",
      tool: "extractEntities",
      resultPreview: `${events.length} events from ${file.fileName}`,
    });
    allEvents.push({ fileId: file.fileId, fileName: file.fileName, events });

    await emit({
      type: "partial_result",
      data: {
        eventsSoFar: allEvents.reduce((sum, x) => sum + x.events.length, 0),
        latestFile: file.fileName,
        priority: 0.5,
      },
    });
  }

  await emit({
    type: "tool_call",
    tool: "mergeEvents",
    args: { docs: allEvents.length },
    status: "running",
  });
  const merged = mergeEvents(allEvents);
  await emit({
    type: "tool_result",
    tool: "mergeEvents",
    resultPreview: `Merged into ${merged.length} unique events`,
  });

  // Priority heuristic for G17 bento ordering: more events × multi-source
  // anchoring → higher priority.
  const multiSource = merged.filter((e) => e.sources.length > 1).length;
  const priority = Math.min(
    1,
    0.4 + 0.05 * merged.length + 0.05 * multiSource,
  );

  await emit({
    type: "partial_result",
    data: {
      events: merged.length,
      latest: merged[merged.length - 1]?.date ?? null,
      priority,
    },
  });

  return {
    artifact: {
      kind: "Timeline",
      events: merged,
      priority,
      language,
    },
  };
}
