/**
 * crossDocDiff — given two document parses, ask Claude to extract pairwise
 * factual contradictions. Spec §9.5 calls for E2B Python (sentence
 * transformers + rule-based scoring); the LLM-judged variant has the same
 * input/output contract and is the demo-quality stand-in until the E2B
 * sandbox lands.
 */
import { z } from "zod";
import { callLLM, runWithProgress } from "../engine";
import { logger } from "../lib/logger";
import type { SubagentEmit } from "../agents/shared";

const ContradictionSchema = z.object({
  claim: z.string().describe("Short statement of what is disputed"),
  sourceA: z.object({
    fileName: z.string(),
    quote: z.string().describe("Verbatim quote from doc A"),
    page: z.number().int().min(1).optional(),
  }),
  sourceB: z.object({
    fileName: z.string(),
    quote: z.string().describe("Verbatim quote from doc B"),
    page: z.number().int().min(1).optional(),
  }),
  severity: z.enum(["low", "medium", "high"]),
  type: z
    .enum(["timestamp", "identity", "sequence", "fact"])
    .describe("Kind of mismatch"),
  explanation: z.string().describe("One sentence on why these contradict"),
});

const ResultSchema = z.object({
  contradictions: z.array(ContradictionSchema),
});

export type Contradiction = z.infer<typeof ContradictionSchema>;

export async function crossDocDiff(args: {
  docA: { fileName: string; text: string };
  docB: { fileName: string; text: string };
  language?: string | null;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<Contradiction[]> {
  if (!args.docA.text.trim() || !args.docB.text.trim()) return [];

  const prompt = `You are an evidence-gap auditor for a criminal-defense case.
Compare the two documents below and list every factual contradiction with
direct legal relevance. Output language: ${args.language ?? "match the documents"}.

For each contradiction return:
  - claim: short statement of what is disputed
  - sourceA / sourceB: verbatim quote (5-25 words) from each doc, page if known
  - severity: low | medium | high
  - type: timestamp | identity | sequence | fact
  - explanation: one sentence on why these contradict

If no genuine contradictions exist, return {"contradictions": []}.

DOC A — ${args.docA.fileName}
---
${args.docA.text.slice(0, 8000)}

DOC B — ${args.docB.fileName}
---
${args.docB.text.slice(0, 8000)}`;

  try {
    return await runWithProgress({
      tool: "crossDocDiff",
      emit: args.emit,
      subagent: args.subagent,
      runId: args.runId,
      meta: { docA: args.docA.fileName, docB: args.docB.fileName },
      fn: async () => {
        const result = await callLLM({
          taskKind: "legal-reasoning",
          schema: ResultSchema,
          prompt,
          runId: args.runId,
          subagent: args.subagent,
          emit: args.emit,
        });
        return result.object.contradictions;
      },
    });
  } catch (err) {
    logger.warn(
      { err, docA: args.docA.fileName, docB: args.docB.fileName },
      "crossDocDiff failed; returning empty list",
    );
    return [];
  }
}
