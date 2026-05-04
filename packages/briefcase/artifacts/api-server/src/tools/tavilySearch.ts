/**
 * tavilySearch — thin wrapper around the Tavily REST API. Used by
 * CrossExaminationGenerator (rules of evidence) and PrecedentFinder (case
 * law biased to jurisdictions[country] trusted domains, see §10.2).
 *
 * Required env: TAVILY_API_KEY.
 */
import { logger } from "../lib/logger";
import { runWithProgress } from "../engine";
import type { SubagentEmit } from "../agents/shared";

export interface TavilyResult {
  title: string;
  url: string;
  content: string; // snippet
  score: number;
}

export async function tavilySearch(args: {
  query: string;
  allowDomains?: string[];
  maxResults?: number;
  runId?: string | undefined;
  emit?: SubagentEmit | undefined;
  subagent?: string | undefined;
}): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    logger.warn("TAVILY_API_KEY missing; tavilySearch returning empty results");
    return [];
  }
  const max = Math.min(Math.max(args.maxResults ?? 6, 1), 10);

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query: args.query,
    search_depth: "basic",
    max_results: max,
    include_answer: false,
    include_raw_content: false,
  };
  if (args.allowDomains && args.allowDomains.length > 0) {
    body.include_domains = args.allowDomains;
  }

  return runWithProgress({
    tool: "tavilySearch",
    emit: args.emit,
    subagent: args.subagent,
    runId: args.runId,
    meta: { query: args.query.slice(0, 80), maxResults: max },
    fn: async () => {
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          logger.warn(
            { status: r.status, query: args.query },
            "tavilySearch non-OK response",
          );
          return [];
        }
        const json = (await r.json()) as { results?: TavilyResult[] };
        return Array.isArray(json.results) ? json.results : [];
      } catch (err) {
        logger.warn({ err, query: args.query }, "tavilySearch failed");
        return [];
      }
    },
  });
}
