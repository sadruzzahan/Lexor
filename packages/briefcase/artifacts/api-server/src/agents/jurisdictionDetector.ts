/**
 * JurisdictionDetector — universal first subagent (spec §9.3 + §9.7.A).
 *
 * Reads first ~2 pages of up to 4 case files, runs the langDetect heuristic
 * for a deterministic floor, then asks GPT-5-mini for a structured
 * JurisdictionContext. Result is cached on `cases.jurisdictionContext` so
 * subsequent runs short-circuit and return immediately.
 *
 * Per spec: "jurisdiction is never displayed as 'unknown' — the detector
 * provides a confidence and a fallback." We default to US/en at low
 * confidence rather than failing the run.
 */
import { z } from "zod";
import { db, cases } from "@workspace/db";
import { eq } from "drizzle-orm";
import { callLLM } from "../engine";
import { langDetect } from "../tools/langDetect";
import { logger } from "../lib/logger";
import type { JurisdictionContext } from "../lib/jurisdictions";
import type { ParsedPdf } from "../tools/parsePdf";
import type { SubagentEmit } from "./shared";

const JurisdictionSchema = z.object({
  country: z
    .string()
    .describe("Full English country name (e.g. 'United States', 'Germany')"),
  iso2: z
    .string()
    .length(2)
    .describe("ISO 3166-1 alpha-2 country code (e.g. 'US', 'DE')"),
  region: z
    .string()
    .nullable()
    .describe("Region/state if identifiable, else null"),
  legalSystem: z.enum(["common_law", "civil_law", "mixed", "unknown"]),
  language: z
    .string()
    .describe("BCP-47 2-letter language code matching the documents"),
  confidence: z.number().min(0).max(1),
});

export interface JurisdictionDetectorResult {
  context: JurisdictionContext;
  cached: boolean;
}

export async function runJurisdictionDetector(args: {
  caseId: string;
  parsedFiles: ParsedPdf[];
  runId?: string;
  emit?: SubagentEmit;
}): Promise<JurisdictionDetectorResult> {
  // Cache hit on the case row → skip the LLM call entirely.
  const existing = await db
    .select({ jurisdictionContext: cases.jurisdictionContext })
    .from(cases)
    .where(eq(cases.id, args.caseId))
    .limit(1);
  const cached = existing[0]?.jurisdictionContext as JurisdictionContext | null;
  if (cached && cached.iso2) {
    return { context: cached, cached: true };
  }

  // Deterministic floor: heuristic over the first 2 pages of up to 4 files.
  const sampledText = args.parsedFiles
    .slice(0, 4)
    .map((f) => f.pages.slice(0, 2).map((p) => p.text).join("\n"))
    .join("\n---\n");
  const heuristic = langDetect(sampledText);

  let context: JurisdictionContext;
  try {
    const { object } = await callLLM({
      taskKind: "structured-classification",
      schema: JurisdictionSchema,
      runId: args.runId,
      subagent: "JurisdictionDetector",
      emit: args.emit,
      prompt: `You are the JurisdictionDetector for a criminal-defense case
preparation system. Given excerpts from the user's uploaded case files, decide
the country (ISO2), legal system, and primary language. Use the language
heuristic floor as a hint: ${heuristic.language} (script ${heuristic.script}).

If you cannot determine the country with confidence > 0.5, output the most
likely candidate with a low confidence — never refuse. Default fallback is
{country:"United States", iso2:"US", legalSystem:"common_law", language:"en"}.

Excerpts:
---
${sampledText.slice(0, 6000)}`,
    });
    context = {
      country: object.country,
      iso2: object.iso2.toUpperCase(),
      ...(object.region !== null && object.region !== undefined
        ? { region: object.region }
        : {}),
      legalSystem: object.legalSystem,
      language: object.language || heuristic.language || "en",
      confidence: object.confidence,
    };
  } catch (err) {
    logger.warn(
      { err, caseId: args.caseId },
      "JurisdictionDetector LLM failed; using heuristic fallback",
    );
    context = {
      country: "United States",
      iso2: "US",
      legalSystem: "common_law",
      language: heuristic.language === "und" ? "en" : heuristic.language,
      confidence: 0.3,
    };
  }

  // Cache on the case row so subsequent runs skip detection.
  await db
    .update(cases)
    .set({ jurisdictionContext: context, language: context.language })
    .where(eq(cases.id, args.caseId));

  return { context, cached: false };
}
