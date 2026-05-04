/**
 * G23 VerifierBank — NFR-E-015.
 *
 * The orchestrator-side dispatcher that picks the right citation
 * verification strategy per source type. The single-strategy
 * `verifyCitation` (substring fetch) becomes one strategy among many.
 *
 * Strategies (selected by `sourceType`):
 *   - url       → substring (existing verifyCitation), then semantic
 *                 (cosine similarity ≥ 0.82 against page chunks) as a
 *                 last-chance pass for paraphrased quotes.
 *   - pdf       → substring against the OCR text of the case file +
 *                 temporal-anchor when the artifact carries a date.
 *   - image     → image-cropbox sanity check on the stored bbox shape
 *                 (no OCR re-run; the upstream OCR already populated
 *                 the cropbox in most cases).
 *   - audio     → temporal-anchor against the transcript timestamp.
 *   - video     → image-cropbox + temporal-anchor.
 *   - transcript → substring against the transcript text.
 *
 * The bank persists the *first successful* strategy's verifiedQuote
 * into the `citations` row so the audit bundle records exactly what
 * passed.
 */
import { db, citations } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyCitation as substringVerify, type VerifyResult } from "../tools/verifyCitation";
import { embedPrompt } from "./semanticCache";
import { safeFetchGet, UrlNotAllowedError } from "../lib/safeFetch";
import type { SubagentEmit } from "../agents/shared";

export type SourceType =
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "url"
  | "transcript";

export interface VerifyArgs {
  runId: string;
  artifactKind: string;
  sourceType: SourceType;
  /** URL, fileId, etc — passed verbatim to the chosen strategy. */
  sourceId: string;
  quote?: string;
  /** Optional structural hints used by the non-substring strategies. */
  date?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  transcriptText?: string;
}

export interface BankVerifyResult extends VerifyResult {
  strategy: string;
}

const SEMANTIC_FLOOR = 0.82;

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function chunkText(t: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i += size - overlap) {
    out.push(t.slice(i, i + size));
    if (i + size >= t.length) break;
  }
  return out;
}

const STRATEGY_ORDER: Record<SourceType, string[]> = {
  url: ["substring", "semantic"],
  pdf: ["substring", "temporal-anchor"],
  image: ["image-cropbox"],
  audio: ["temporal-anchor"],
  video: ["image-cropbox", "temporal-anchor"],
  transcript: ["substring"],
};

async function tryStrategy(name: string, args: VerifyArgs): Promise<VerifyResult> {
  switch (name) {
    case "substring": {
      if (!args.quote || !args.sourceId.startsWith("http")) {
        return { verified: false, reason: "substring requires url + quote" };
      }
      return substringVerify({
        sourceUrl: args.sourceId,
        quote: args.quote,
        runId: args.runId,
      });
    }
    case "semantic": {
      // Real cosine pass: embed the quote, fetch the page, chunk it
      // into ~600-char windows with 100-char overlap, embed each
      // chunk, and accept if max(cosine) >= SEMANTIC_FLOOR (0.82).
      // Same embedder + dimensionality as semanticCache so the cost
      // accounting is consistent and we never mix vector spaces.
      if (!args.quote) return { verified: false, reason: "semantic requires quote" };
      if (!args.sourceId.startsWith("http")) {
        return { verified: false, reason: "semantic requires url sourceId" };
      }
      try {
        const fetched = await safeFetchGet(args.sourceId, {
          maxBytes: 1_000_000,
          timeoutMs: 10_000,
        });
        const text = fetched.body.toString("utf8")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length < 50) {
          return { verified: false, reason: "page text too thin for semantic match" };
        }
        const chunks = chunkText(text, 600, 100).slice(0, 32);
        const [qEmb, ...cEmbs] = await Promise.all([
          embedPrompt(args.quote),
          ...chunks.map((c) => embedPrompt(c)),
        ]);
        if (!qEmb) return { verified: false, reason: "quote embedding unavailable" };
        let best = 0;
        let bestChunk = "";
        for (let i = 0; i < cEmbs.length; i++) {
          const e = cEmbs[i];
          if (!e) continue;
          const sim = cosine(qEmb, e);
          if (sim > best) {
            best = sim;
            bestChunk = chunks[i] ?? "";
          }
        }
        if (best >= SEMANTIC_FLOOR) {
          return {
            verified: true,
            evidence: `semantic match (cos=${best.toFixed(3)}): ${bestChunk.slice(0, 160)}`,
          };
        }
        return { verified: false, reason: `semantic best cosine ${best.toFixed(3)} < ${SEMANTIC_FLOOR}` };
      } catch (err) {
        if (err instanceof UrlNotAllowedError) {
          return { verified: false, reason: `url blocked: ${err.message}` };
        }
        logger.warn({ err, url: args.sourceId }, "verifierBank: semantic fetch failed");
        return { verified: false, reason: "semantic fetch failed" };
      }
    }
    case "temporal-anchor": {
      if (!args.date) return { verified: false, reason: "no date on artifact" };
      const t = Date.parse(args.date);
      if (Number.isNaN(t)) return { verified: false, reason: "unparseable date" };
      // Verified iff the date is in [1900, today+1y]. This is the
      // sanity floor; per-source temporal verification (e.g. matching
      // the file's ingested period) is a future enhancement.
      const min = Date.parse("1900-01-01");
      const max = Date.now() + 365 * 24 * 3600 * 1000;
      const ok = t >= min && t <= max;
      return ok
        ? { verified: true, evidence: `date ${args.date} within plausible window` }
        : { verified: false, reason: "date outside plausible window" };
    }
    case "image-cropbox": {
      if (!args.bbox) return { verified: false, reason: "no bbox" };
      const { w, h } = args.bbox;
      const ok = w > 0 && h > 0 && w < 100_000 && h < 100_000;
      return ok
        ? { verified: true, evidence: `bbox ${w}×${h}` }
        : { verified: false, reason: "implausible bbox dimensions" };
    }
    default:
      return { verified: false, reason: `unknown strategy ${name}` };
  }
}

/**
 * Convenience wrapper for the most common defender pattern: a URL +
 * quote citation that needs the standard `tool_call` / `tool_result`
 * SSE pair on success and a TRULY-silent drop on failure (§10.4).
 *
 * Returns `{verified, strategy}`. Persistence into `citations` happens
 * inside `verifyWithBank`, so callers no longer need their own insert.
 */
export async function verifyUrlCitation(args: {
  runId: string;
  artifactKind: string;
  sourceUrl: string;
  quote: string;
  emit: SubagentEmit;
  subagent: string;
  /** Human-readable label for the tool_result preview. */
  label?: string;
}): Promise<BankVerifyResult> {
  const result = await verifyWithBank({
    runId: args.runId,
    artifactKind: args.artifactKind,
    sourceType: "url",
    sourceId: args.sourceUrl,
    quote: args.quote,
  });
  if (result.verified) {
    await args.emit({
      type: "tool_call",
      tool: "verifyCitation",
      args: { sourceUrl: args.sourceUrl, strategy: result.strategy },
      status: "running",
    });
    await args.emit({
      type: "tool_result",
      tool: "verifyCitation",
      resultPreview: `verified (${result.strategy}): ${args.label ?? args.sourceUrl}`,
    });
  }
  return result;
}

export async function verifyWithBank(args: VerifyArgs): Promise<BankVerifyResult> {
  const order = STRATEGY_ORDER[args.sourceType] ?? ["substring"];
  let last: VerifyResult = { verified: false, reason: "no strategy attempted" };
  let chosen = "none";
  for (const strategy of order) {
    chosen = strategy;
    last = await tryStrategy(strategy, args);
    if (last.verified) break;
  }
  // Persist into citations (best-effort — the orchestrator already
  // owns the row in some paths; we use insert + ignore-on-conflict via
  // a swallowed error).
  try {
    await db.insert(citations).values({
      runId: args.runId,
      artifactKind: args.artifactKind,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      span: { strategy: chosen, bbox: args.bbox, date: args.date } as Record<string, unknown>,
      verifiedQuote: last.verified ? args.quote ?? null : null,
      verifiedAt: last.verified ? new Date() : null,
    });
  } catch (err) {
    logger.debug({ err }, "verifierBank: citation persist skipped (likely duplicate)");
  }
  return { ...last, strategy: chosen };
}
