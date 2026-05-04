/**
 * PleaOutcomeSimulator (G13) — probabilistic forecast of trial vs plea
 * outcomes anchored on cited public sentencing data + Monte Carlo
 * resampling. GPT-5 mini drafts a charge-aware outcome distribution
 * grounded in `sentencingHistoryQuery` hits; each cited dataset MUST
 * pass `verifyCitation` before it is rendered.
 *
 * Spec §10.4 honesty contract:
 *   - REFUSES to surface a single point estimate. The artifact ships
 *     mean + p10/p50/p90 + 24-bin histogram, never one number alone.
 *   - Every dataset citation is verified; unverifiable hits are dropped.
 *   - Hard-coded UI disclaimer: "for client conversation, not a guarantee".
 *     (Enforced by the Plea screen until G22 ConstitutionalGate lands.)
 *
 * On-demand only — not part of the baseline planner pack.
 */
import { z } from "zod";
import { callLLM } from "../../engine";
import { logger } from "../../lib/logger";
import {
  sentencingHistoryQuery,
  type DatasetCandidate,
} from "../../tools/sentencingHistoryQuery";
import { verifyUrlCitation } from "../../engine/verifierBank";
import { monteCarlo, type MonteCarloResult } from "../../tools/monteCarlo";
import { db, citations } from "@workspace/db";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { SubagentEmit, SubagentResult } from "../shared";

const OutcomeOptionSchema = z.object({
  label: z.string(),
  weight: z.number().min(0).max(100),
  sentenceMonthsLow: z.number().min(0),
  sentenceMonthsHigh: z.number().min(0),
});

const ScenarioSchema = z.object({
  charge: z.string().describe("Most likely top charge inferred from the file set."),
  trialOutcomes: z.array(OutcomeOptionSchema).min(1),
  pleaOutcomes: z.array(OutcomeOptionSchema).min(1),
  /**
   * Each dataset cited MUST point at one of the candidate URLs and include
   * a verbatim 8-25 word quote. Anything else is dropped.
   */
  datasetCitations: z.array(
    z.object({
      label: z.string(),
      url: z.string().url(),
      quote: z.string(),
    }),
  ),
  summaryForClient: z
    .string()
    .describe(
      "2-4 sentence summary that AVOIDS a single point estimate and frames the choice as a range with uncertainty.",
    ),
});

export interface PleaForecastArtifact {
  kind: "PleaForecast";
  charge: string;
  trial: MonteCarloResult;
  plea: MonteCarloResult;
  datasetCitations: Array<{ label: string; url: string; verifiedQuote: string }>;
  summaryForClient: string;
  /** Hard-coded copy enforced by the screen until G22 lands. */
  disclaimer: string;
  priority: number;
  language: string;
}

const DISCLAIMER =
  "For client conversation, not a guarantee. This is a probabilistic rehearsal grounded on cited public data — outcomes vary based on facts, counsel, and judge.";

function inferCharge(parsedFiles: ParsedPdf[], goal: string): string {
  const blob = (
    goal +
    " " +
    parsedFiles.map((f) => f.markdown.slice(0, 600)).join(" ")
  ).toLowerCase();
  if (/firearm|handgun|unlawful possession of (a )?weapon/.test(blob))
    return "unlawful possession of a firearm";
  if (/cannabis|marijuana|cocaine|fentanyl|narcotic|drug/.test(blob))
    return "drug possession / distribution";
  if (/assault|battery|aggravated/.test(blob)) return "aggravated assault";
  if (/burglary|theft|larceny/.test(blob)) return "theft / burglary";
  return "the charged offense";
}

export async function runPleaOutcomeSimulator(
  emit: SubagentEmit,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<PleaForecastArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const charge = inferCharge(ctx.parsedFiles, ctx.goal);

  await emit({
    type: "tool_call",
    tool: "sentencingHistoryQuery",
    args: { charge, jurisdiction: ctx.jurisdictionContext.iso2 },
    status: "running",
  });
  let candidates: DatasetCandidate[] = [];
  try {
    candidates = await sentencingHistoryQuery({
      charge,
      jurisdictionIso2: ctx.jurisdictionContext.iso2,
      jurisdictionName: ctx.jurisdictionContext.country,
      maxResults: 8,
    });
  } catch (err) {
    logger.warn({ err }, "sentencingHistoryQuery failed");
  }
  await emit({
    type: "tool_result",
    tool: "sentencingHistoryQuery",
    resultPreview: `${candidates.length} candidate datasets`,
  });

  const candidateBundle = candidates
    .map(
      (c, i) => `[D${i + 1}] ${c.title}\nURL: ${c.url}\nSnippet: ${c.snippet}`,
    )
    .join("\n\n");

  const fileBundle = ctx.parsedFiles
    .map((f) => `### ${f.fileName}\n${f.markdown.slice(0, 1500)}`)
    .join("\n\n")
    .slice(0, 5000);

  const prompt = `You are PleaOutcomeSimulator for a criminal-defense rehearsal.
Jurisdiction: ${ctx.jurisdictionContext.country} (${ctx.jurisdictionContext.iso2}).
Inferred top charge: ${charge}
Output language: ${language}.

Produce a TRIAL outcome distribution and a PLEA outcome distribution.
Each outcome has a relative weight (0-100), a label (e.g.
"Acquittal", "Convicted — 24-36 months"), and a sentenceMonths low/high
range (use 0 for acquittal / hung jury).

Anchor your weights on the candidate datasets below — do NOT invent
numbers. For every dataset you actually use, add a datasetCitations
entry with a real URL from the list and a verbatim 8-25 word quote
that exists at that URL. Anything you cannot ground will be dropped.

REFUSE to write a single point estimate. Your summaryForClient must
present the choice as a range, surface uncertainty, and avoid
predictions like "you will get 30 months". Frame as "data shows X% of
similar cases ended in plea-bargained sentences in the Y-Z month
range".

CASE EXCERPTS:
${fileBundle}

CANDIDATE DATASETS:
${candidateBundle || "(no hits — return small generic ranges and an empty datasetCitations list)"}`;

  let drafted: z.infer<typeof ScenarioSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "structured-classification",
      schema: ScenarioSchema,
      prompt,
      temperature: 0.3,
      runId: ctx.runId,
      subagent: "PleaOutcomeSimulator",
      emit,
    });
    drafted = object;
  } catch (err) {
    logger.warn({ err }, "PleaOutcomeSimulator LLM failed");
    drafted = {
      charge,
      trialOutcomes: [
        { label: "Acquittal", weight: 25, sentenceMonthsLow: 0, sentenceMonthsHigh: 0 },
        { label: "Conviction (mid range)", weight: 50, sentenceMonthsLow: 18, sentenceMonthsHigh: 36 },
        { label: "Hung jury", weight: 25, sentenceMonthsLow: 0, sentenceMonthsHigh: 0 },
      ],
      pleaOutcomes: [
        { label: "Negotiated plea (lower)", weight: 60, sentenceMonthsLow: 12, sentenceMonthsHigh: 24 },
        { label: "Negotiated plea (mid)", weight: 40, sentenceMonthsLow: 18, sentenceMonthsHigh: 30 },
      ],
      datasetCitations: [],
      summaryForClient:
        "No public datasets could be retrieved; the model returned generic ranges. Treat as a rehearsal scaffold, not a forecast.",
    };
  }

  await emit({
    type: "partial_result",
    data: {
      charge,
      drafted: {
        trial: drafted.trialOutcomes.length,
        plea: drafted.pleaOutcomes.length,
        cited: drafted.datasetCitations.length,
      },
      priority: 0.5,
    },
  });

  // Verify dataset citations — silently drop unverifiable ones (§10.4).
  const verifiedCites: PleaForecastArtifact["datasetCitations"] = [];
  for (const cite of drafted.datasetCitations) {
    const v = await verifyUrlCitation({
      runId: ctx.runId,
      artifactKind: "PleaForecast",
      sourceUrl: cite.url,
      quote: cite.quote,
      emit,
      subagent: "PleaOutcomeSimulator",
      label: cite.label,
    });
    if (!v.verified) continue;
    verifiedCites.push({
      label: cite.label,
      url: cite.url,
      verifiedQuote: cite.quote,
    });
    try {
      await db.insert(citations).values({
        runId: ctx.runId,
        artifactKind: "PleaForecast",
        sourceType: "url",
        sourceId: cite.url,
        span: { quote: cite.quote },
        verifiedQuote: cite.quote,
        verifiedAt: new Date(),
      });
    } catch (err) {
      logger.warn(
        { err, runId: ctx.runId, sourceUrl: cite.url },
        "Failed to persist PleaOutcome citation (continuing)",
      );
    }
  }

  await emit({
    type: "tool_call",
    tool: "monteCarlo",
    args: { iterations: 10_000, target: "trial" },
    status: "running",
  });
  const trial = await monteCarlo({
    options: drafted.trialOutcomes,
    iterations: 10_000,
    seed: `${ctx.runId}:trial`,
    runId: ctx.runId,
    emit,
    subagent: "PleaOutcomeSimulator",
  });
  await emit({
    type: "tool_result",
    tool: "monteCarlo",
    resultPreview: `trial: mean ${trial.sentenceMonths.mean}mo, p50 ${trial.sentenceMonths.p50}mo (${trial.engine})`,
  });

  await emit({
    type: "tool_call",
    tool: "monteCarlo",
    args: { iterations: 10_000, target: "plea" },
    status: "running",
  });
  const plea = await monteCarlo({
    options: drafted.pleaOutcomes,
    iterations: 10_000,
    seed: `${ctx.runId}:plea`,
    runId: ctx.runId,
    emit,
    subagent: "PleaOutcomeSimulator",
  });
  await emit({
    type: "tool_result",
    tool: "monteCarlo",
    resultPreview: `plea: mean ${plea.sentenceMonths.mean}mo, p50 ${plea.sentenceMonths.p50}mo (${plea.engine})`,
  });

  return {
    artifact: {
      kind: "PleaForecast",
      charge: drafted.charge || charge,
      trial,
      plea,
      datasetCitations: verifiedCites,
      summaryForClient: enforceRangeSummary(drafted.summaryForClient, plea, trial),
      disclaimer: DISCLAIMER,
      priority: 0.75,
      language,
    },
  };
}

/**
 * Honesty guard (§10.4): refuse to ship a single point-estimate sentence.
 * If the model emits language like "you will get 30 months", we replace it
 * with a deterministic, range-framed summary derived from the Monte Carlo
 * distribution. The check is intentionally narrow — it triggers only when
 * a bare future-tense prediction is paired with a single month figure and
 * no surrounding range vocabulary.
 */
function enforceRangeSummary(
  draft: string,
  plea: MonteCarloResult,
  trial: MonteCarloResult,
): string {
  const text = (draft ?? "").trim();
  // A "range" summary mentions either an explicit M-N month span, a percent
  // probability, or hedge vocabulary. Anything else risks being read as a
  // point estimate and gets rewritten.
  const hasRange = /\d+\s*(?:-|to|–|—)\s*\d+\s*month/i.test(text);
  const hasProbability = /\d+\s*%/.test(text);
  const hasHedge =
    /(range|likely|roughly|approximately|between|distribution|p10|p50|p90|percentile|uncertain|varies)/i.test(
      text,
    );
  const looksLikePrediction =
    /\b(you|the client|defendant)\s+(will|would|is going to|are going to)\s+[^.]*\d+\s*month/i.test(
      text,
    );

  if (text.length === 0 || looksLikePrediction || (!hasRange && !hasProbability && !hasHedge)) {
    return (
      `Plea outcomes cluster between ${plea.sentenceMonths.p10}-${plea.sentenceMonths.p90} months ` +
      `(median ${plea.sentenceMonths.p50}); trial outcomes range ${trial.sentenceMonths.p10}-${trial.sentenceMonths.p90} months ` +
      `(median ${trial.sentenceMonths.p50}). This is a probabilistic rehearsal, not a single-number forecast — ` +
      `outcomes vary based on facts, counsel, and judge. Use it to frame the conversation, not to make the decision.`
    );
  }
  return text;
}
