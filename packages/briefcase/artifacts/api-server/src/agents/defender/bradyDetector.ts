/**
 * BradyDetector — diffs the prosecution's disclosure index against the
 * canonical Brady/discovery checklist for the active jurisdiction and
 * surfaces what should be in disclosure but isn't. Each gap ships with
 * a verifiable rule citation (Brady, Giglio, Kyles, Rule 16, IL R.412,
 * CPIA s.3, etc., per `disclosureChecklist`).
 *
 * Two-step: (1) parse the disclosure index out of the uploaded files —
 * any file whose name/contents mention "disclosure", "discovery",
 * "production", or that lists numbered items is treated as a
 * disclosure index; (2) ask the LLM to mark each baseline item as
 * `present | missing | unknown` and to add jurisdiction-specific items
 * the baseline doesn't already cover. Anything cited gets verified;
 * unverifiable items are dropped silently.
 *
 * Empty-state contract: if no disclosure-style file is found, the
 * subagent still ships a clean explanation rather than nothing — the
 * defender needs to know "we cannot audit Brady because no disclosure
 * index was produced."
 */
import { z } from "zod";
import { callLLM } from "../../engine";
import { logger } from "../../lib/logger";
import {
  disclosureChecklist,
  type DisclosureItem,
} from "../../tools/disclosureChecklist";
import { verifyUrlCitation } from "../../engine/verifierBank";
import { db, citations } from "@workspace/db";
import type { JurisdictionContext } from "../../lib/jurisdictions";
import type { ParsedPdf } from "../../tools/parsePdf";
import type { SubagentEmit, SubagentResult } from "../shared";

const GapSchema = z.object({
  itemId: z.string(),
  label: z.string(),
  status: z.enum(["missing", "unknown"]),
  rationale: z
    .string()
    .describe("One sentence on why this is missing or cannot be confirmed"),
  authority: z.object({
    label: z.string(),
    url: z.string().url(),
    quote: z.string(),
  }),
});

const AuditSchema = z.object({
  disclosureIndexDetected: z.boolean(),
  detectedFromFile: z.string().nullable(),
  gaps: z.array(GapSchema),
  presentItems: z
    .array(z.string())
    .describe("itemIds the disclosure index DOES cover, for the UI's positive list"),
});

export interface DisclosureGapsArtifact {
  kind: "DisclosureGaps";
  disclosureIndexDetected: boolean;
  detectedFromFile: string | null;
  gaps: Array<{
    itemId: string;
    label: string;
    status: "missing" | "unknown";
    rationale: string;
    authority: { label: string; url: string; verifiedQuote: string };
  }>;
  presentItems: string[];
  /** The full checklist the auditor was working from, for transparency. */
  checklist: DisclosureItem[];
  priority: number;
  language: string;
}

const DISCLOSURE_HINT_RE =
  /\b(disclosure|discovery|production|tendered|412|brady)\b/i;

function looksLikeDisclosureIndex(f: ParsedPdf): boolean {
  return (
    DISCLOSURE_HINT_RE.test(f.fileName) ||
    DISCLOSURE_HINT_RE.test(f.markdown.slice(0, 1500))
  );
}

function inferChargeFamily(parsedFiles: ParsedPdf[], goal: string): string {
  const blob = (
    goal +
    " " +
    parsedFiles.map((f) => f.markdown.slice(0, 600)).join(" ")
  ).toLowerCase();
  if (/firearm|handgun|gun|weapon/.test(blob)) return "weapons";
  if (/cannabis|marijuana|narcotic|drug|cocaine|fentanyl/.test(blob))
    return "drug";
  if (/assault|battery|homicide|murder/.test(blob)) return "violent";
  return "general";
}

export async function runBradyDetector(
  emit: SubagentEmit,
  ctx: {
    runId: string;
    parsedFiles: ParsedPdf[];
    jurisdictionContext: JurisdictionContext;
    goal: string;
  },
): Promise<SubagentResult<DisclosureGapsArtifact>> {
  const language = ctx.jurisdictionContext.language;
  const chargeFamily = inferChargeFamily(ctx.parsedFiles, ctx.goal);

  await emit({
    type: "tool_call",
    tool: "disclosureChecklist",
    args: {
      chargeFamily,
      jurisdictionIso2: ctx.jurisdictionContext.iso2,
    },
    status: "running",
  });
  const checklist = disclosureChecklist({
    chargeFamily,
    jurisdictionIso2: ctx.jurisdictionContext.iso2,
  });
  await emit({
    type: "tool_result",
    tool: "disclosureChecklist",
    resultPreview: `${checklist.length} baseline items for ${ctx.jurisdictionContext.iso2}/${chargeFamily}`,
  });

  const indexCandidates = ctx.parsedFiles.filter(looksLikeDisclosureIndex);

  // Empty-state branch: no disclosure-style file in the upload set. We
  // still emit every baseline item as `unknown` (so the defender can
  // see what they SHOULD be receiving) and mark
  // disclosureIndexDetected = false.
  if (indexCandidates.length === 0) {
    const verified = await verifyChecklist(ctx.runId, checklist, emit);
    await emit({
      type: "partial_result",
      data: {
        disclosureIndexDetected: false,
        unknownItems: verified.length,
        priority: 0.45,
        note: "No disclosure index found in uploads — flagged every baseline item as unknown.",
      },
    });
    return {
      artifact: {
        kind: "DisclosureGaps",
        disclosureIndexDetected: false,
        detectedFromFile: null,
        gaps: verified.map((v) => ({
          itemId: v.id,
          label: v.label,
          status: "unknown" as const,
          rationale:
            "No disclosure index was produced; defender cannot confirm production.",
          authority: {
            label: v.authority,
            url: v.authorityUrl,
            verifiedQuote: v.authorityQuote,
          },
        })),
        presentItems: [],
        checklist,
        priority: 0.45,
        language,
      },
    };
  }

  // Normal branch: ask the LLM to diff the disclosure-index files
  // against the baseline checklist.
  const indexBundle = indexCandidates
    .map(
      (f) =>
        `### ${f.fileName}\n${f.markdown.slice(0, 5000)}${f.markdown.length > 5000 ? "…" : ""}`,
    )
    .join("\n\n");
  const checklistBundle = checklist
    .map(
      (it) =>
        `- id=${it.id} | ${it.label}\n  authority: ${it.authority} (${it.authorityUrl})\n  quote: ${it.authorityQuote}`,
    )
    .join("\n");

  const prompt = `You are BradyDetector for a criminal-defense run.
Jurisdiction: ${ctx.jurisdictionContext.country} (${ctx.jurisdictionContext.iso2}).
Output language: ${language}.

Compare the prosecution's DISCLOSURE INDEX against the BASELINE
CHECKLIST and produce {disclosureIndexDetected, detectedFromFile, gaps,
presentItems}.

For each baseline item:
  - if the index plainly covers it, add itemId to presentItems
  - if the index does NOT cover it, add a gap entry with status="missing"
  - if the index is ambiguous, add a gap entry with status="unknown"

You may add NEW gap entries for items the baseline doesn't list, as
long as you can cite a real authority (label + url + verbatim 8-25
word quote) the verifier can confirm. Otherwise, do not invent items.

BASELINE CHECKLIST
${checklistBundle}

DISCLOSURE INDEX (uploaded)
${indexBundle}`;

  let audited: z.infer<typeof AuditSchema>;
  try {
    const { object } = await callLLM({
      taskKind: "legal-reasoning",
      schema: AuditSchema,
      prompt,
      runId: ctx.runId,
      subagent: "BradyDetector",
      emit,
    });
    audited = object;
  } catch (err) {
    logger.warn({ err }, "BradyDetector LLM failed");
    audited = {
      disclosureIndexDetected: true,
      detectedFromFile: indexCandidates[0]!.fileName,
      gaps: [],
      presentItems: [],
    };
  }

  await emit({
    type: "partial_result",
    data: {
      disclosureIndexDetected: audited.disclosureIndexDetected,
      candidateGaps: audited.gaps.length,
      presentItems: audited.presentItems.length,
      priority: 0.5,
    },
  });

  // Verify the cited authority for every gap. Drop silently on failure.
  const verifiedGaps: DisclosureGapsArtifact["gaps"] = [];
  for (const g of audited.gaps) {
    const v = await verifyUrlCitation({
      runId: ctx.runId,
      artifactKind: "DisclosureGaps",
      sourceUrl: g.authority.url,
      quote: g.authority.quote,
      emit,
      subagent: "BradyDetector",
      label: g.authority.label,
    });
    if (!v.verified) continue;
    verifiedGaps.push({
      itemId: g.itemId,
      label: g.label,
      status: g.status,
      rationale: g.rationale,
      authority: {
        label: g.authority.label,
        url: g.authority.url,
        verifiedQuote: g.authority.quote,
      },
    });
  }

  const priority = Math.min(1, 0.4 + verifiedGaps.length * 0.12);

  return {
    artifact: {
      kind: "DisclosureGaps",
      disclosureIndexDetected: audited.disclosureIndexDetected,
      detectedFromFile: audited.detectedFromFile,
      gaps: verifiedGaps,
      presentItems: audited.presentItems,
      checklist,
      priority,
      language,
    },
  };
}

/**
 * Empty-state helper: verify every baseline checklist authority once so
 * the unknown-items list we ship is fully auditable. Items whose
 * authority can't be verified are dropped (consistent with §10.4).
 */
async function verifyChecklist(
  runId: string,
  checklist: DisclosureItem[],
  emit: SubagentEmit,
): Promise<DisclosureItem[]> {
  const out: DisclosureItem[] = [];
  for (const it of checklist) {
    const v = await verifyUrlCitation({
      runId,
      artifactKind: "DisclosureGaps",
      sourceUrl: it.authorityUrl,
      quote: it.authorityQuote,
      emit,
      subagent: "BradyDetector",
      label: it.authority,
    });
    if (!v.verified) continue;
    out.push(it);
  }
  return out;
}
