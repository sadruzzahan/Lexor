/**
 * sentencingHistoryQuery — Tavily-bias wrapper that pulls public sentencing
 * data + commission reports for the PleaOutcomeSimulator (G13). Allowed
 * domains are limited to authoritative US/UK/EU sources (Sentencing
 * Commission, BJS, Sentencing Council, Judicial Commission, etc.) so the
 * forecast is anchored on government data rather than ad-hoc web hits.
 *
 * Returns the raw Tavily hits as `DatasetCandidate[]` — verifyCitation must
 * be called on the chosen URL before any quote is rendered to the user.
 */
import { tavilySearch } from "./tavilySearch";

export interface DatasetCandidate {
  title: string;
  url: string;
  snippet: string;
}

const TRUSTED_SENTENCING_DOMAINS: Record<string, string[]> = {
  US: [
    "ussc.gov",
    "bjs.ojp.gov",
    "fjc.gov",
    "supremecourt.gov",
    "uscourts.gov",
    "justice.gov",
  ],
  GB: [
    "sentencingcouncil.org.uk",
    "gov.uk",
    "judiciary.uk",
  ],
  CA: [
    "scc-csc.ca",
    "canlii.org",
    "justice.gc.ca",
  ],
  AU: [
    "judcom.nsw.gov.au",
    "ag.gov.au",
    "austlii.edu.au",
  ],
};

function trustedDomainsFor(iso2: string): string[] {
  return TRUSTED_SENTENCING_DOMAINS[iso2.toUpperCase()] ?? [];
}

export async function sentencingHistoryQuery(args: {
  charge: string;
  jurisdictionIso2: string;
  jurisdictionName: string;
  maxResults?: number;
}): Promise<DatasetCandidate[]> {
  const trusted = trustedDomainsFor(args.jurisdictionIso2);
  // Honesty contract (§10.4): this tool's whole purpose is anchoring a
  // forecast on AUTHORITATIVE government datasets. If we don't have a
  // trusted-domain allowlist for the jurisdiction, return zero candidates
  // rather than letting the LLM cite arbitrary web sources. The caller
  // (PleaOutcomeSimulator) handles the empty case explicitly.
  if (trusted.length === 0) return [];

  const query = `${args.jurisdictionName} sentencing statistics ${args.charge} guidelines plea trial outcomes`;
  const hits = await tavilySearch({
    query,
    allowDomains: trusted,
    maxResults: args.maxResults ?? 6,
  });
  return hits.map((h) => ({
    title: h.title,
    url: h.url,
    snippet: h.content.slice(0, 400),
  }));
}
