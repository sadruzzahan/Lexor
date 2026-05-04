/**
 * ProsecutionSimulator (G13) — Claude Sonnet 4.6 with an adversarial system
 * prompt. The model role-plays opposing counsel: it builds a direct-exam
 * outline, lists the strongest arguments the prosecution will press, and
 * delivers a weakness report mapped to the uploaded record so the defender
 * can rehearse against it.
 *
 * Honesty contract (§10.4): every cited precedent in the weakness report
 * must pass `verifyCitation`; unverifiable items are silently dropped.
 *
 * Runs ONLY on user request (post-baseline). Never part of the planner pack.
 */
import { z } from "zod";
import { callLLM } from "../../engine";
import { logger } from "../../lib/logger";
import { tavilySearch } from "../../tools/tavilySearch";
import { verifyUrlCitation } from "../../engine/verifierBank";
import { trustedDomainsFor } from "../../lib/jurisdictions";
import { db, citations } from "@workspace/db";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { SubagentEmit, SubagentResult } from "../shared";

const DirectExamItemSchema = z.object({
  witness: z.string(),
  topic: z.string(),
  pivotalQuestion: z.string(),
  expectedAnswer: z.string(),
});

const ArgumentSchema = z.object({
  thesis: z.string(),
  evidence: z.string().describe("What in the record the prosecution will lean on."),
  rebuttalForDefense: z.string(),
});

const WeaknessSchema = z.object({
  weakness: z.string(),
  recordAnchor: z
    .string()
    .describe("Verbatim 5-30 word quote from the uploaded record."),
  sourceFileName: z.string(),
  citedAuthority: z
    .object({
      label: z.string(),
      url: z.string().url(),
      quote: z.string().describe("Verbatim 8-25 word quote from the authority page."),
    })
    .nullable(),
  defenseCounter: z.string(),
});

const AdversarialSchema = z.object({
  directExamOutline: z.array(DirectExamItemSchema),
  anticipatedArguments: z.array(ArgumentSchema),
  weaknessReport: z.array(WeaknessSchema),
});

export interface AdversarialArtifact {
  kind: "Adversarial";
  directExamOutline: Array<{
    witness: string;
    topic: string;
    pivotalQuestion: string;
    expectedAnswer: string;
  }>;
  anticipatedArguments: Array<{
    thesis: string;
    evidence: string;
    rebuttalForDefense: string;
  }>;
  weaknessReport: Array<{
    weakness: string;
    recordAnchor: string;
    sourceFileName: string;
    citedAuthority: {
      label: string;
      url: string;
      verifiedQuote: string;
    } | null;
    defenseCounter: string;
  }>;
  priority: number;
  language: string;
}

export async function runProsecutionSimulator(
  emit: SubagentEmit,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<AdversarialArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const trusted = trustedDomainsFor(ctx.jurisdictionContext.iso2);

  // Pull jurisdiction-trusted authorities up-front so the adversarial
  // model has a verified candidate list to cite from.
  const authQuery = `${ctx.jurisdictionContext.country} criminal procedure prosecution evidence ${ctx.goal}`;
  await emit({
    type: "tool_call",
    tool: "tavilySearch",
    args: { query: authQuery, allowDomains: trusted },
    status: "running",
  });
  const hits = await tavilySearch({
    query: authQuery,
    ...(trusted.length ? { allowDomains: trusted } : {}),
    maxResults: 6,
    runId: ctx.runId,
    emit,
    subagent: "ProsecutionSimulator",
  });
  await emit({
    type: "tool_result",
    tool: "tavilySearch",
    resultPreview: `${hits.length} prosecution-authority hits`,
  });

  const fileBundle = ctx.parsedFiles
    .map(
      (f) =>
        `### ${f.fileName}\n${f.markdown.slice(0, 3000)}${f.markdown.length > 3000 ? "…" : ""}`,
    )
    .join("\n\n");
  const authorityBundle = hits
    .map(
      (h, i) =>
        `[A${i + 1}] ${h.title}\nURL: ${h.url}\nSnippet: ${h.content.slice(0, 320)}`,
    )
    .join("\n\n");

  const system = `You are role-playing as the lead prosecutor in a criminal trial. Your goal is to be MAXIMALLY ADVERSARIAL to the defense within ethical limits — surface every weakness in their case the defense should rehearse against. You are not attempting to be balanced; the defender is using your output as sparring material. Stay grounded in the uploaded record. Never invent quotes or citations.`;

  const prompt = `Defense goal: ${ctx.goal}
Jurisdiction: ${ctx.jurisdictionContext.country} (${ctx.jurisdictionContext.iso2}).
Output language: ${language}.

Produce three sections:
  1. directExamOutline — ordered list of prosecution witnesses with the
     topic, the single pivotal question, and the expected answer.
  2. anticipatedArguments — the prosecution's strongest closing themes,
     each with the record evidence they'll lean on AND the defense's
     best rebuttal.
  3. weaknessReport — concrete weaknesses in the defense case. For each:
       - recordAnchor: verbatim 5-30 word quote from the uploaded record
       - sourceFileName: which uploaded file the anchor came from
       - citedAuthority: a real authority (label + url + verbatim 8-25
         word quote) from the AUTHORITY CANDIDATES below, or null if
         no candidate is on point. Do NOT invent citations.
       - defenseCounter: one-sentence counter the defense should rehearse.

UPLOADED RECORD
${fileBundle}

AUTHORITY CANDIDATES
${authorityBundle || "(no hits — emit weaknesses with citedAuthority=null)"}`;

  let drafted: z.infer<typeof AdversarialSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: AdversarialSchema,
      system,
      prompt,
      temperature: 0.5,
      runId: ctx.runId,
      subagent: "ProsecutionSimulator",
      emit,
    });
    drafted = object;
  } catch (err) {
    logger.warn({ err }, "ProsecutionSimulator LLM failed");
    drafted = {
      directExamOutline: [],
      anticipatedArguments: [],
      weaknessReport: [],
    };
  }

  await emit({
    type: "partial_result",
    data: {
      direct: drafted.directExamOutline.length,
      arguments: drafted.anticipatedArguments.length,
      weaknesses: drafted.weaknessReport.length,
      priority: 0.5,
    },
  });

  // Mandatory verifier on every cited authority. Unverifiable authorities
  // are reduced to null (the weakness still ships — the citation is
  // dropped, not the finding).
  const verifiedWeaknesses: AdversarialArtifact["weaknessReport"] = [];
  for (const w of drafted.weaknessReport) {
    let verifiedAuthority: AdversarialArtifact["weaknessReport"][number]["citedAuthority"] =
      null;
    if (w.citedAuthority) {
      const v = await verifyUrlCitation({
        runId: ctx.runId,
        artifactKind: "Adversarial",
        sourceUrl: w.citedAuthority.url,
        quote: w.citedAuthority.quote,
        emit,
        subagent: "ProsecutionSimulator",
        label: w.citedAuthority.label,
      });
      if (v.verified) {
        verifiedAuthority = {
          label: w.citedAuthority.label,
          url: w.citedAuthority.url,
          verifiedQuote: w.citedAuthority.quote,
        };
        try {
          await db.insert(citations).values({
            runId: ctx.runId,
            artifactKind: "Adversarial",
            sourceType: "url",
            sourceId: w.citedAuthority.url,
            span: { quote: w.citedAuthority.quote },
            verifiedQuote: w.citedAuthority.quote,
            verifiedAt: new Date(),
          });
        } catch (err) {
          logger.warn(
            { err, runId: ctx.runId, sourceUrl: w.citedAuthority.url },
            "Failed to persist Adversarial citation (continuing)",
          );
        }
      }
    }
    verifiedWeaknesses.push({
      weakness: w.weakness,
      recordAnchor: w.recordAnchor,
      sourceFileName: w.sourceFileName,
      citedAuthority: verifiedAuthority,
      defenseCounter: w.defenseCounter,
    });
  }

  return {
    artifact: {
      kind: "Adversarial",
      directExamOutline: drafted.directExamOutline,
      anticipatedArguments: drafted.anticipatedArguments,
      weaknessReport: verifiedWeaknesses,
      priority: 0.7,
      language,
    },
  };
}
