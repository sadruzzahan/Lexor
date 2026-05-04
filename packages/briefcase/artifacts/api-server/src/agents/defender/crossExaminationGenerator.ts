/**
 * CrossExaminationGenerator (§9.4.3) — drafts impeachment cross-exam
 * questions anchored to documents the user actually uploaded. Tavily is
 * used to fetch jurisdiction-aware rules of evidence; verifyCitation runs
 * against any external rule URL we cite. Failed citations are dropped
 * silently per spec §10.4.
 */
import { z } from "zod";
import { tavilySearch } from "../../tools/tavilySearch";
import { verifyUrlCitation } from "../../engine/verifierBank";
import { callLLM } from "../../engine";
import { trustedDomainsFor } from "../../lib/jurisdictions";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { SubagentEmit, SubagentResult } from "../shared";
import { logger } from "../../lib/logger";

const QuestionSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  expectedImpeachment: z.string(),
  sourceFileName: z
    .string()
    .describe("Name of an uploaded document this question pulls from"),
  sourceQuote: z
    .string()
    .describe("Verbatim 5-25 word quote that anchors this question"),
  ruleCitation: z
    .object({
      authority: z.string(),
      sourceUrl: z.string().url(),
      quote: z.string(),
    })
    .nullable()
    .describe("External rule of evidence supporting this line, if any"),
});

const QuestionsSchema = z.object({
  questions: z.array(QuestionSchema),
});

export interface CrossExamSetArtifact {
  kind: "CrossExamSet";
  questions: Array<{
    text: string;
    rationale: string;
    expectedImpeachment: string;
    source: { fileName: string; quote: string };
    ruleCitation?: {
      authority: string;
      sourceUrl: string;
      verifiedQuote: string;
    };
  }>;
  priority: number;
  language: string;
}

export async function runCrossExaminationGenerator(
  emit: SubagentEmit,
  ctx: {
    runId?: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<CrossExamSetArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const trusted = trustedDomainsFor(ctx.jurisdictionContext.iso2);

  // Step 1: pull rules-of-evidence context (jurisdiction-aware)
  const ruleQuery = `rules of evidence cross examination impeachment ${ctx.jurisdictionContext.country}`;
  await emit({
    type: "tool_call",
    tool: "tavilySearch",
    args: { query: ruleQuery, allowDomains: trusted },
    status: "running",
  });
  const ruleHits = await tavilySearch({
    query: ruleQuery,
    ...(trusted.length ? { allowDomains: trusted } : {}),
    maxResults: 4,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    emit,
    subagent: "CrossExaminationGenerator",
  });
  await emit({
    type: "tool_result",
    tool: "tavilySearch",
    resultPreview: `${ruleHits.length} rules-of-evidence hits${trusted.length ? ` from ${trusted.length} trusted domains` : ""}`,
  });

  const fileBundle = ctx.parsedFiles
    .map(
      (f) =>
        `### ${f.fileName}\n${f.markdown.slice(0, 3500)}${f.markdown.length > 3500 ? "…" : ""}`,
    )
    .join("\n\n");
  const ruleBundle = ruleHits
    .map((r) => `- ${r.title} (${r.url})\n  ${r.content.slice(0, 240)}`)
    .join("\n");

  const prompt = `You are CrossExaminationGenerator for a criminal-defense run.
Jurisdiction: ${ctx.jurisdictionContext.country} (${ctx.jurisdictionContext.iso2}, ${ctx.jurisdictionContext.legalSystem}).
Defender's goal: ${ctx.goal}
Output language: ${language}.

Draft 3-7 impeachment-grade cross-examination questions. Each question MUST:
  - quote a real document the defender uploaded (sourceFileName + sourceQuote)
  - state the expected impeachment outcome
  - optionally cite a rule of evidence WITH a real URL + verbatim quote
    we can verify (ruleCitation), or null if no external rule applies

Do NOT invent quotes. If you cannot find a real anchor in the documents,
return fewer questions.

UPLOADED DOCUMENTS
${fileBundle}

RULES-OF-EVIDENCE CONTEXT
${ruleBundle || "(no external hits)"}`;

  let drafted: z.infer<typeof QuestionsSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: QuestionsSchema,
      prompt,
      runId: ctx.runId,
      subagent: "CrossExaminationGenerator",
      emit,
    });
    drafted = object;
  } catch (err) {
    logger.warn({ err }, "CrossExaminationGenerator LLM failed");
    drafted = { questions: [] };
  }

  await emit({
    type: "partial_result",
    data: {
      drafted: drafted.questions.length,
      verifying: drafted.questions.filter((q) => q.ruleCitation).length,
      priority: 0.5,
    },
  });

  // Verify any external rule citation; drop the citation (not the question)
  // when verification fails. Per spec §10.4 the drop is TRULY silent —
  // failed candidates emit no SSE events at all. The cross-exam question
  // itself still ships, just without a ruleCitation.
  const finalized: CrossExamSetArtifact["questions"] = [];
  for (const q of drafted.questions) {
    let verifiedCitation: CrossExamSetArtifact["questions"][number]["ruleCitation"];
    if (q.ruleCitation) {
      const v = await verifyUrlCitation({
        runId: ctx.runId ?? "",
        artifactKind: "CrossExamSet",
        sourceUrl: q.ruleCitation.sourceUrl,
        quote: q.ruleCitation.quote,
        emit,
        subagent: "CrossExaminationGenerator",
        label: q.ruleCitation.authority,
      });
      if (v.verified) {
        verifiedCitation = {
          authority: q.ruleCitation.authority,
          sourceUrl: q.ruleCitation.sourceUrl,
          verifiedQuote: q.ruleCitation.quote,
        };
      }
      // Else: silent — no emit, no log surfaced to user.
    }
    finalized.push({
      text: q.text,
      rationale: q.rationale,
      expectedImpeachment: q.expectedImpeachment,
      source: { fileName: q.sourceFileName, quote: q.sourceQuote },
      ...(verifiedCitation ? { ruleCitation: verifiedCitation } : {}),
    });
  }

  const priority = Math.min(1, 0.4 + finalized.length * 0.1);
  return {
    artifact: {
      kind: "CrossExamSet",
      questions: finalized,
      priority,
      language,
    },
  };
}
