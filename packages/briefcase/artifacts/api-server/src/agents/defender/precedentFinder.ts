/**
 * PrecedentFinder (§9.4.4) — search → cite → verify. Tavily is biased to the
 * jurisdictions[country] trusted-source list (§10.2). Every precedent must
 * pass `verifyCitation` (URL fetch + substring match); failed precedents
 * are dropped SILENTLY per the honesty guarantee (§10.4) — no warning is
 * surfaced to the user about hidden cases.
 *
 * Verified precedents are also persisted to the `citations` table so the
 * audit bundle (G24) can re-emit them.
 */
import { z } from "zod";
import { tavilySearch } from "../../tools/tavilySearch";
import { verifyUrlCitation } from "../../engine/verifierBank";
import { callLLM } from "../../engine";
import { trustedDomainsFor } from "../../lib/jurisdictions";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { SubagentEmit, SubagentResult } from "../shared";
import { db, citations } from "@workspace/db";
import { logger } from "../../lib/logger";

const PrecedentSchema = z.object({
  citation: z.string().describe("Case name + reporter / cite, e.g. 'Brady v. Maryland, 373 U.S. 83 (1963)'"),
  jurisdiction: z.string(),
  holding: z.string(),
  whyRelevant: z.string(),
  sourceUrl: z.string().url(),
  verifiedQuote: z
    .string()
    .describe("Verbatim 8-25 word quote present at sourceUrl that supports the holding"),
});

const PrecedentsSchema = z.object({
  precedents: z.array(PrecedentSchema),
});

export interface PrecedentsArtifact {
  kind: "Precedents";
  cases: Array<{
    citation: string;
    jurisdiction: string;
    holding: string;
    whyRelevant: string;
    sourceUrl: string;
    verifiedQuote: string;
  }>;
  priority: number;
  language: string;
}

export async function runPrecedentFinder(
  emit: SubagentEmit,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<PrecedentsArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const trusted = trustedDomainsFor(ctx.jurisdictionContext.iso2);

  const fileBundle = ctx.parsedFiles
    .map((f) => `### ${f.fileName}\n${f.markdown.slice(0, 2500)}`)
    .join("\n\n")
    .slice(0, 8000);

  // Topic discovery: ask Claude what to search for given the case context.
  const topicQuery = `${ctx.jurisdictionContext.country} criminal defense ${ctx.goal}`;

  await emit({
    type: "tool_call",
    tool: "tavilySearch",
    args: { query: topicQuery, allowDomains: trusted },
    status: "running",
  });
  const hits = await tavilySearch({
    query: topicQuery,
    ...(trusted.length ? { allowDomains: trusted } : {}),
    maxResults: 8,
    runId: ctx.runId,
    emit,
    subagent: "PrecedentFinder",
  });
  await emit({
    type: "tool_result",
    tool: "tavilySearch",
    resultPreview: `${hits.length} candidate sources${trusted.length ? ` from trusted domains` : ""}`,
  });

  const sourceBundle = hits
    .map((h, i) => `[${i + 1}] ${h.title}\nURL: ${h.url}\nSnippet: ${h.content.slice(0, 400)}`)
    .join("\n\n");

  const prompt = `You are PrecedentFinder for a criminal-defense case.
Jurisdiction: ${ctx.jurisdictionContext.country} (${ctx.jurisdictionContext.iso2}, ${ctx.jurisdictionContext.legalSystem}).
Defender's goal: ${ctx.goal}
Output language: ${language}.

Identify 2-5 binding precedents that bear directly on this case. For each:
  - citation: full case name + reporter cite
  - jurisdiction: court name + level
  - holding: 1-2 sentence holding in plain English
  - whyRelevant: 1-2 sentences tying it to THIS case's facts
  - sourceUrl: a URL from the candidates below where the case text lives
  - verifiedQuote: a verbatim 8-25 word quote that exists at sourceUrl

DO NOT invent citations. If the candidates don't include a usable source
for a precedent you'd want, omit that precedent.

UPLOADED CASE EXCERPTS
${fileBundle}

CANDIDATE SOURCES (from Tavily)
${sourceBundle || "(no hits — refuse to invent)"}`;

  let drafted: z.infer<typeof PrecedentsSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: PrecedentsSchema,
      prompt,
      runId: ctx.runId,
      subagent: "PrecedentFinder",
      emit,
    });
    drafted = object;
  } catch (err) {
    logger.warn({ err }, "PrecedentFinder LLM failed");
    drafted = { precedents: [] };
  }

  await emit({
    type: "partial_result",
    data: {
      drafted: drafted.precedents.length,
      verifying: drafted.precedents.length,
      priority: 0.5,
    },
  });

  // Mandatory verifier — silently drop on failure per spec §10.4.
  // "Silent" means TRULY silent: failed candidates emit no SSE events at
  // all (no tool_call, no tool_result, no log line surfaced to the user).
  // Successful verifications emit the standard tool_call/tool_result pair
  // with the verified citation visible in the preview.
  const verified: PrecedentsArtifact["cases"] = [];
  for (const p of drafted.precedents) {
    const v = await verifyUrlCitation({
      runId: ctx.runId,
      artifactKind: "Precedents",
      sourceUrl: p.sourceUrl,
      quote: p.verifiedQuote,
      emit,
      subagent: "PrecedentFinder",
      label: p.citation,
    });
    if (!v.verified) {
      // Internal log only — never streamed.
      continue;
    }
    verified.push(p);
    try {
      await db.insert(citations).values({
        runId: ctx.runId,
        artifactKind: "Precedents",
        sourceType: "url",
        sourceId: p.sourceUrl,
        span: { quote: p.verifiedQuote },
        verifiedQuote: p.verifiedQuote,
        verifiedAt: new Date(),
      });
    } catch (err) {
      logger.warn(
        { err, runId: ctx.runId, sourceUrl: p.sourceUrl },
        "Failed to persist verified citation (continuing)",
      );
    }
  }

  const priority = Math.min(1, 0.45 + verified.length * 0.12);
  return {
    artifact: {
      kind: "Precedents",
      cases: verified,
      priority,
      language,
    },
  };
}
