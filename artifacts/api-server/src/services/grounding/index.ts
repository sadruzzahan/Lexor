import { z } from "zod";
import { logger } from "../../lib/logger";
import { findStatutes, type Statute } from "./statutes";

export type { Statute };
export { findStatutes, getStatute, allStatutes } from "./statutes";

/**
 * Citation post-pass guard. Strips any cite that looks like a real
 * case/statute reference but isn't in the verified-source set; replaces
 * with `[citation needed — consult attorney]` per build plan §10.4.
 *
 * Recognized cite shapes:
 *   123 U.S.C. § 4567
 *   Cal. Civ. Code § 1946.2
 *   Brown v. Board, 347 U.S. 483 (1954)
 *
 * We intentionally err on the side of leaving plain-language references
 * alone — only emphasize-and-strip what *looks* like a formal cite.
 */
const CITE_PATTERNS: RegExp[] = [
  /\b\d+\s+U\.?S\.?C\.?\s*§\s*\d+[a-z0-9.()\-]*/gi,
  /\b(Cal|N\.?Y|Tex)\.?\s*(Civ|Lab|Code Civ\. Proc|Real Prop\. Acts|Prop)\.?\s*Code\.?\s*§\s*[\d.]+/gi,
  /\b[A-Z][A-Za-z]+\s+v\.?\s+[A-Z][A-Za-z]+,\s*\d+\s+[A-Z][A-Za-z.]+\s+\d+(\s*\(\d{4}\))?/g,
];

export function stripUnverifiedCites(
  text: string,
  verified: Statute[],
): { cleaned: string; stripped: string[] } {
  const verifiedSet = new Set(
    verified.map((s) => s.code.replace(/[\s.]+/g, "").toLowerCase()),
  );
  const stripped: string[] = [];
  let cleaned = text;

  for (const pattern of CITE_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      const norm = match.replace(/[\s.]+/g, "").toLowerCase();
      const ok = [...verifiedSet].some((v) => norm.includes(v) || v.includes(norm));
      if (ok) return match;
      stripped.push(match);
      return "[citation needed — consult attorney]";
    });
  }

  return { cleaned, stripped };
}

/**
 * Live grounding adapter. Currently CourtListener-only and only when a
 * token is present; otherwise we return null so the caller can fall back
 * to the curated corpus.
 */
const CL_RESULT = z.object({
  results: z
    .array(z.object({ caseName: z.string(), absolute_url: z.string() }))
    .optional(),
});

export async function searchCourtListener(
  query: string,
): Promise<Array<{ caseName: string; url: string }> | null> {
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(
      `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(query)}&type=o`,
      {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!r.ok) return null;
    const parsed = CL_RESULT.safeParse(await r.json());
    if (!parsed.success) return null;
    return (parsed.data.results ?? []).slice(0, 5).map((r) => ({
      caseName: r.caseName,
      url: `https://www.courtlistener.com${r.absolute_url}`,
    }));
  } catch (err) {
    logger.warn({ err }, "CourtListener lookup failed (degrading)");
    return null;
  }
}
