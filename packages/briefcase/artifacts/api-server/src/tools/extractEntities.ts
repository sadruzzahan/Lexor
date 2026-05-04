/**
 * extractEntities — pulls timeline-relevant entities (events with dates +
 * sources) out of free text using Gemini structured output. Used by
 * TimelineBuilder (§9.4.1).
 *
 * Returned events keep a `sourceQuote` substring so the verifier path can
 * later re-anchor them in the original document.
 */
import { z } from "zod";
import { callLLM, runWithProgress } from "../engine";
import { logger } from "../lib/logger";
import type { SubagentEmit } from "../agents/shared";

const TimelineEventSchema = z.object({
  date: z
    .string()
    .describe("ISO 8601 date or datetime; if only a date is known, use YYYY-MM-DD"),
  title: z.string().describe("Short event title in the source language"),
  sourceQuote: z
    .string()
    .describe("Verbatim 5-25 word quote from the document that anchors this event"),
  page: z.number().int().min(1).optional(),
  confidence: z.number().min(0).max(1),
});

const EntitiesSchema = z.object({
  events: z.array(TimelineEventSchema),
});

export type ExtractedEvent = z.infer<typeof TimelineEventSchema>;

export async function extractEntities(args: {
  fileId: string;
  fileName: string;
  text: string;
  language?: string | null;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<ExtractedEvent[]> {
  if (!args.text || args.text.trim().length < 20) return [];

  const prompt = `You are an entity extractor for a criminal-defense case file.
Extract every event with a concrete date or time from the document below.
Output language must match the document's language (${args.language ?? "auto"}).
Skip generic timestamps (file metadata, page numbers); keep only events
with legal relevance: arrests, statements, searches, calls, transfers,
filings, hearings, observations made by witnesses or officers.

Each event needs:
  - "date": ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
  - "title": short factual description in document language
  - "sourceQuote": exact 5-25 word verbatim substring of the document
  - "page": page number if you can identify one
  - "confidence": 0..1

Document name: ${args.fileName}
---
${args.text.slice(0, 12000)}`;

  try {
    return await runWithProgress({
      tool: "extractEntities",
      emit: args.emit,
      subagent: args.subagent,
      runId: args.runId,
      meta: { fileId: args.fileId, fileName: args.fileName },
      fn: async () => {
        const result = await callLLM({
          taskKind: "vision",
          schema: EntitiesSchema,
          prompt,
          runId: args.runId,
          subagent: args.subagent,
          emit: args.emit,
        });
        return result.object.events;
      },
    });
  } catch (err) {
    logger.warn(
      { err, fileId: args.fileId },
      "extractEntities failed; returning empty list",
    );
    return [];
  }
}
