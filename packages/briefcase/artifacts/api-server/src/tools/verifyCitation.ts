/**
 * verifyCitation — the on-stage citation verifier (spec §10.4 honesty
 * guarantee). Fetches the source URL, normalizes whitespace, and confirms
 * a substring match for the claimed quote. PrecedentFinder + CrossExamGen
 * silently drop any item that does not pass.
 *
 * Spec §9.5 calls for E2B (fetch + parse + substring); we run the same
 * substring matcher in-process with native fetch. URL fetch is bounded by
 * a 10s timeout and 1MB byte cap so a single bad source can't stall a run.
 */
import { logger } from "../lib/logger";
import { safeFetchGet, UrlNotAllowedError } from "../lib/safeFetch";
import { runWithProgress } from "../engine";
import type { SubagentEmit } from "../agents/shared";

export interface VerifyResult {
  verified: boolean;
  evidence?: string; // the matched neighborhood
  reason?: string;
}

const MAX_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripHtml(s: string): string {
  // Cheap text extraction: drop scripts/styles, then tags. Good enough for
  // substring matching on .gov / .edu pages without pulling a real parser.
  const noScript = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/gi, "");
  return noStyle.replace(/<[^>]+>/g, " ");
}

export async function verifyCitation(args: {
  sourceUrl: string;
  quote: string;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<VerifyResult> {
  const wantedRaw = args.quote.trim();
  if (!wantedRaw) return { verified: false, reason: "empty quote" };
  // Use a window of the quote so verbatim drift in punctuation/case still
  // matches. We require the largest window that's still discriminating.
  const wanted = normalize(wantedRaw);
  if (wanted.length < 10) return { verified: false, reason: "quote too short" };

  return runWithProgress<VerifyResult>({
    tool: "verifyCitation",
    emit: args.emit,
    subagent: args.subagent,
    runId: args.runId,
    meta: { url: args.sourceUrl.slice(0, 120) },
    fn: () => verifyCitationInner(args, wanted),
  });
}

async function verifyCitationInner(
  args: { sourceUrl: string; quote: string },
  wanted: string,
): Promise<VerifyResult> {
  try {
    const r = await safeFetchGet(args.sourceUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; BriefcaseVerifier/0.1; +https://replit.com)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    if (!r.ok) {
      return { verified: false, reason: `HTTP ${r.status}` };
    }
    const text = normalize(stripHtml(r.body.toString("utf8")));
    if (text.includes(wanted)) {
      const idx = text.indexOf(wanted);
      const evidence = text.slice(Math.max(0, idx - 60), idx + wanted.length + 60);
      return { verified: true, evidence };
    }
    return { verified: false, reason: "quote not found in source" };
  } catch (err) {
    if (err instanceof UrlNotAllowedError) {
      // Don't log the URL — it's model output that may be hostile.
      logger.warn({ reason: err.message }, "verifyCitation: blocked URL");
      return { verified: false, reason: "url not allowed" };
    }
    logger.warn(
      { err, sourceUrl: args.sourceUrl },
      "verifyCitation: fetch error → unverified",
    );
    return {
      verified: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
