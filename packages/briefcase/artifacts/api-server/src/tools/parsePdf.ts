/**
 * parsePdf — return parsed text + page metadata for a case file.
 *
 * Spec §9.5 calls for E2B (PyMuPDF + Tesseract fallback). Until the Drive /
 * camera ingest pipelines (G8/G9) populate raw PDFs in object storage we read
 * the pre-OCR'd `case_files.ocr_text` column directly. The contract is the
 * same shape that the E2B-backed implementation will return, so swapping the
 * body of this function later is mechanical.
 *
 * Result is cached in-process per `(caseId, fileId)` for the lifetime of a
 * single run — TimelineBuilder + EvidenceGapAuditor share parses per §9.4.2.
 */
import { db, caseFiles } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { runWithProgress } from "../engine";
import type { SubagentEmit } from "../agents/shared";

export interface ParsedPdf {
  fileId: string;
  fileName: string;
  markdown: string;
  pages: { page: number; text: string }[];
  ocrPages: number[];
  detectedLanguage: string | null;
}

const cache = new Map<string, ParsedPdf>();

function cacheKey(caseId: string, fileId: string): string {
  return `${caseId}::${fileId}`;
}

export async function parsePdf(args: {
  caseId: string;
  fileId: string;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<ParsedPdf> {
  const key = cacheKey(args.caseId, args.fileId);
  const cached = cache.get(key);
  if (cached) return cached;

  return runWithProgress({
    tool: "parsePdf",
    emit: args.emit,
    subagent: args.subagent,
    runId: args.runId,
    meta: { fileId: args.fileId },
    fn: () => parsePdfInner(args, key),
  });
}

async function parsePdfInner(
  args: { caseId: string; fileId: string },
  key: string,
): Promise<ParsedPdf> {
  const rows = await db
    .select({
      id: caseFiles.id,
      name: caseFiles.name,
      ocrText: caseFiles.ocrText,
      detectedLanguage: caseFiles.detectedLanguage,
    })
    .from(caseFiles)
    .where(and(eq(caseFiles.id, args.fileId), eq(caseFiles.caseId, args.caseId)))
    .limit(1);

  if (rows.length === 0) {
    throw new Error(`parsePdf: file ${args.fileId} not found on case`);
  }
  const row = rows[0]!;
  const text = row.ocrText ?? "";

  // Naive page split — real PyMuPDF will give us true page boundaries.
  // We split on form-feed (the conventional page break in OCR'd plain text)
  // and fall back to ~3000-char chunks so downstream span citations stay
  // page-bounded.
  const pages = splitIntoPages(text);
  const result: ParsedPdf = {
    fileId: row.id,
    fileName: row.name,
    markdown: text,
    pages,
    ocrPages: pages.map((_, i) => i + 1), // assume all pages are OCR-derived for now
    detectedLanguage: row.detectedLanguage,
  };
  cache.set(key, result);
  return result;
}

function splitIntoPages(text: string): { page: number; text: string }[] {
  if (!text) return [];
  if (text.includes("\f")) {
    return text.split("\f").map((t, i) => ({ page: i + 1, text: t.trim() }));
  }
  // Soft-split for OCR text without page markers.
  const chunkSize = 3000;
  const out: { page: number; text: string }[] = [];
  for (let i = 0, p = 1; i < text.length; i += chunkSize, p++) {
    out.push({ page: p, text: text.slice(i, i + chunkSize) });
  }
  return out;
}

export function clearParseCache(): void {
  cache.clear();
}
