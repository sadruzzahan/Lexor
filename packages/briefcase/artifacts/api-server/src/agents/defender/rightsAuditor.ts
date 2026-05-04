/**
 * RightsAuditor — surfaces breaches of the client's procedural and
 * substantive rights (Fourth/Fifth/Sixth Amendment in the US, ECHR
 * Art. 5/6/8 elsewhere) that the uploaded record either documents or
 * makes plausible.
 *
 * Honesty contract (§10.4): every finding MUST cite a real legal
 * authority. We send each candidate authority through `verifyCitation`
 * (substring match against the live URL) and silently drop any
 * finding whose authority does not verify. Findings without an
 * authority claim are dropped wholesale — the rights pane never ships
 * unsupported allegations.
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

const FindingSchema = z.object({
  rightCategory: z
    .string()
    .describe(
      "Short label, e.g. 'Fourth Amendment — warrantless search' or 'ECHR Art. 5 — arbitrary detention'",
    ),
  severity: z.enum(["low", "medium", "high"]),
  /** What in the record indicates the breach. */
  factualBasis: z.string(),
  sourceFileName: z.string(),
  sourceQuote: z
    .string()
    .describe("Verbatim 5-30 word quote from sourceFileName that grounds the finding"),
  authority: z.object({
    label: z.string().describe("Citation, e.g. 'Mapp v. Ohio, 367 U.S. 643 (1961)'"),
    url: z.string().url(),
    quote: z.string().describe("Verbatim 8-25 word quote from the authority page"),
  }),
  /** Suggested remedy (motion to suppress / Miranda challenge / etc.). */
  suggestedRemedy: z.string(),
});

const FindingsSchema = z.object({
  findings: z.array(FindingSchema),
});

export interface RightsFindingsArtifact {
  kind: "RightsFindings";
  findings: Array<{
    rightCategory: string;
    severity: "low" | "medium" | "high";
    factualBasis: string;
    source: { fileName: string; quote: string };
    authority: { label: string; url: string; verifiedQuote: string };
    suggestedRemedy: string;
  }>;
  priority: number;
  language: string;
}

const SEVERITY_WEIGHT = { low: 0.08, medium: 0.18, high: 0.32 } as const;

export async function runRightsAuditor(
  emit: SubagentEmit,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<RightsFindingsArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const trusted = trustedDomainsFor(ctx.jurisdictionContext.iso2);

  // Step 1: jurisdiction-biased rights authorities
  const rightsQuery = `criminal procedure rights search seizure interrogation ${ctx.jurisdictionContext.country}`;
  await emit({
    type: "tool_call",
    tool: "tavilySearch",
    args: { query: rightsQuery, allowDomains: trusted },
    status: "running",
  });
  const hits = await tavilySearch({
    query: rightsQuery,
    ...(trusted.length ? { allowDomains: trusted } : {}),
    maxResults: 6,
    runId: ctx.runId,
    emit,
    subagent: "RightsAuditor",
  });
  await emit({
    type: "tool_result",
    tool: "tavilySearch",
    resultPreview: `${hits.length} rights-authority hits${trusted.length ? ` from trusted domains` : ""}`,
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

  const prompt = `You are RightsAuditor for a criminal-defense run.
Jurisdiction: ${ctx.jurisdictionContext.country} (${ctx.jurisdictionContext.iso2}, ${ctx.jurisdictionContext.legalSystem}).
Defender's goal: ${ctx.goal}
Output language: ${language}.

Identify breaches of the client's procedural or substantive rights that
the uploaded record makes plausible. For each finding return:
  - rightCategory: short label (e.g. "Fourth Amendment — warrantless search")
  - severity: low | medium | high
  - factualBasis: what in the record indicates the breach (one sentence)
  - sourceFileName + sourceQuote: a verbatim 5-30 word anchor from one of
    the uploaded files
  - authority: {label, url, quote} — the legal authority that says this
    conduct is unlawful. The url MUST be one of the AUTHORITY candidates
    below, and the quote MUST be a verbatim 8-25 word string present at
    that url.
  - suggestedRemedy: one sentence

DO NOT invent quotes or URLs. If you cannot ground a finding in both an
uploaded document AND a verifiable authority, omit it.

UPLOADED RECORD
${fileBundle}

AUTHORITY CANDIDATES
${authorityBundle || "(no hits — return an empty findings list)"}`;

  let drafted: z.infer<typeof FindingsSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: FindingsSchema,
      prompt,
      runId: ctx.runId,
      subagent: "RightsAuditor",
      emit,
    });
    drafted = object;
  } catch (err) {
    logger.warn({ err }, "RightsAuditor LLM failed");
    drafted = { findings: [] };
  }

  await emit({
    type: "partial_result",
    data: {
      drafted: drafted.findings.length,
      verifying: drafted.findings.length,
      priority: 0.5,
    },
  });

  // Mandatory verifier — silently drop on failure (§10.4).
  const verified: RightsFindingsArtifact["findings"] = [];
  for (const f of drafted.findings) {
    const v = await verifyUrlCitation({
      runId: ctx.runId,
      artifactKind: "RightsFindings",
      sourceUrl: f.authority.url,
      quote: f.authority.quote,
      emit,
      subagent: "RightsAuditor",
      label: f.authority.label,
    });
    if (!v.verified) continue;
    verified.push({
      rightCategory: f.rightCategory,
      severity: f.severity,
      factualBasis: f.factualBasis,
      source: { fileName: f.sourceFileName, quote: f.sourceQuote },
      authority: {
        label: f.authority.label,
        url: f.authority.url,
        verifiedQuote: f.authority.quote,
      },
      suggestedRemedy: f.suggestedRemedy,
    });
    try {
      await db.insert(citations).values({
        runId: ctx.runId,
        artifactKind: "RightsFindings",
        sourceType: "url",
        sourceId: f.authority.url,
        span: { quote: f.authority.quote },
        verifiedQuote: f.authority.quote,
        verifiedAt: new Date(),
      });
    } catch (err) {
      logger.warn(
        { err, runId: ctx.runId, sourceUrl: f.authority.url },
        "Failed to persist RightsAuditor citation (continuing)",
      );
    }
  }

  const priority = Math.min(
    1,
    0.4 + verified.reduce((s, v) => s + SEVERITY_WEIGHT[v.severity], 0),
  );

  return {
    artifact: {
      kind: "RightsFindings",
      findings: verified,
      priority,
      language,
    },
  };
}
