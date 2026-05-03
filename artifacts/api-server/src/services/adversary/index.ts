import { db, entitiesTable, casesTable } from "@workspace/db";
import { eq, ne, and, sql, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../../lib/logger";
import {
  REGISTRY,
  findCurated,
  normalizeName,
  type CuratedEntity,
} from "./registry";
import type { AdversaryDossier, EntityKind } from "./types";

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Resolve the opposing party from a case to an entity row, creating one if
 * needed. Returns null if there is no usable name on the case.
 *
 * Resolution order (per build plan §7 Feature 2):
 *   1. Curated registry match (REGISTRY in registry.ts).
 *   2. Existing `entities` row by normalized name.
 *   3. New synthesized row with empty stats and source="empty".
 *
 * Drift: build plan §1-2 calls for live CourtListener / OpenCorporates /
 * SEC EDGAR lookups for entity resolution + officer overlap. Without those
 * API integrations we fall back to a curated registry plus an empty/
 * synthesized entry. The live providers can be slotted in here without
 * touching the route or pipeline layer.
 */
export async function resolveAdversaryForCase(opts: {
  rawSenderName: string | null;
  jurisdiction: string | null;
}): Promise<{
  entityId: string;
  source: "curated" | "cached" | "ai_estimated" | "empty";
} | null> {
  const name = opts.rawSenderName?.trim();
  if (!name || name.length < 2) return null;

  const curated = findCurated(name);
  const norm = curated ? curated.slug : normalizeName(name);
  const display = curated ? curated.displayName : name;
  const kind: EntityKind = curated ? curated.kind : "unknown";

  const [existing] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.normalizedName, norm))
    .limit(1);

  const now = new Date();
  if (existing) {
    const stale =
      !existing.lastRefreshedAt ||
      now.getTime() - existing.lastRefreshedAt.getTime() > STALE_AFTER_MS;
    if (curated && stale) {
      // Refresh cached row from the curated registry so any registry edits
      // propagate without a manual flush.
      await db
        .update(entitiesTable)
        .set({
          displayName: curated.displayName,
          kind: curated.kind,
          jurisdictions: curated.jurisdictions,
          alternateNames: curated.alternateNames,
          registrationData: curated.registration,
          litigationStats: curated.litigationStats,
          lastRefreshedAt: now,
        })
        .where(eq(entitiesTable.id, existing.id));
    }
    return { entityId: existing.id, source: curated ? "curated" : "cached" };
  }

  let insertValues;
  let resolvedSource: "curated" | "ai_estimated" | "empty";

  if (curated) {
    insertValues = {
      normalizedName: curated.slug,
      displayName: curated.displayName,
      kind: curated.kind,
      jurisdictions: curated.jurisdictions,
      alternateNames: curated.alternateNames,
      registrationData: curated.registration,
      litigationStats: curated.litigationStats,
      lastRefreshedAt: now,
    };
    resolvedSource = "curated";
  } else {
    // No curated entry — try Anthropic synthesis. The model is asked to be
    // conservative and to mark estimates clearly. Failure falls back to an
    // empty row so the pipeline never blocks on the AI call.
    const synth = await synthesizeUnknownEntity(name, opts.jurisdiction).catch(
      (err) => {
        logger.warn({ err, name }, "adversary synthesis failed");
        return null;
      },
    );
    insertValues = {
      normalizedName: norm || `unknown-${Date.now()}`,
      displayName: synth?.displayName ?? display,
      kind: (synth?.kind ?? kind) as EntityKind,
      jurisdictions: synth?.jurisdictions ?? (opts.jurisdiction ? [opts.jurisdiction] : []),
      alternateNames: synth?.alternateNames ?? [],
      registrationData: null,
      litigationStats: synth?.litigationStats ?? null,
      lastRefreshedAt: now,
    };
    resolvedSource = synth?.litigationStats ? "ai_estimated" : "empty";
  }

  const [created] = await db
    .insert(entitiesTable)
    .values(insertValues)
    .returning({ id: entitiesTable.id });

  if (!created) {
    logger.warn({ name }, "adversary insert returned no row");
    return null;
  }
  return { entityId: created.id, source: resolvedSource };
}

/**
 * Conservative AI synthesis for an unknown adversary. Returns null on any
 * error or invalid output. The model is explicitly told to mark stats as
 * estimates and to refuse if it cannot find anything specific.
 */
async function synthesizeUnknownEntity(
  name: string,
  jurisdiction: string | null,
): Promise<{
  displayName: string;
  kind: EntityKind;
  jurisdictions: string[];
  alternateNames: string[];
  litigationStats: AdversaryDossier["litigationStats"] | null;
} | null> {
  const prompt = `You are a legal-research assistant. A consumer received a letter from an entity named "${name}"${jurisdiction ? ` (jurisdiction: ${jurisdiction})` : ""}. Without inventing specific lawsuits, return a CONSERVATIVE JSON profile with these exact keys:
{
  "displayName": string (cleaned-up legal name),
  "kind": one of "landlord" | "debt_collector" | "employer" | "unknown" (use "unknown" for government agencies),
  "jurisdictions": string[] (US state codes like "US-CA"; empty if unknown),
  "alternateNames": string[] (max 3, empty if unknown),
  "litigationStats": null OR {
    "totalCases": integer estimate (0 if unknown),
    "asPlaintiff": integer (0 if unknown),
    "asDefendant": integer (0 if unknown),
    "winRatePctAsDefendant": integer 0-100 (50 if unknown),
    "sanctions": [],
    "commonViolations": string[] (typical violations for this KIND of entity, max 4)
  }
}
Return ONLY JSON, no prose. If you cannot infer anything beyond the kind, return litigationStats: null.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });
  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
    displayName?: string;
    kind?: string;
    jurisdictions?: string[];
    alternateNames?: string[];
    litigationStats?: AdversaryDossier["litigationStats"] | null;
  };
  if (!parsed.displayName) return null;
  const validKinds: EntityKind[] = [
    "landlord",
    "debt_collector",
    "employer",
    "unknown",
  ];
  const k = (parsed.kind ?? "unknown") as EntityKind;
  return {
    displayName: parsed.displayName,
    kind: validKinds.includes(k) ? k : "unknown",
    jurisdictions: Array.isArray(parsed.jurisdictions) ? parsed.jurisdictions : [],
    alternateNames: Array.isArray(parsed.alternateNames)
      ? parsed.alternateNames.slice(0, 3)
      : [],
    litigationStats: parsed.litigationStats ?? null,
  };
}

/**
 * Build the full dossier shape returned by /counsel/adversary/:entityId.
 * Joins the persisted entity row with curated defenses/timeline (if the
 * registry slug matches) and with anonymized "other cases" pulled from
 * the cases table.
 */
export async function buildDossier(
  entityId: string,
): Promise<AdversaryDossier | null> {
  const [row] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!row) return null;

  const curated: CuratedEntity | undefined = REGISTRY.find(
    (r) => r.slug === row.normalizedName,
  );

  // Anonymized "other plaintiffs" — at most 8, just enough for the
  // coalition CTA. We expose only the first 8 chars of the case id and
  // intentionally not the user id.
  // Privacy: omit case ids entirely. Only vertical / jurisdiction /
  // createdAt are exposed so the coalition CTA can render without leaking
  // cross-user case-participation identifiers.
  const others = await db
    .select({
      vertical: casesTable.vertical,
      jurisdiction: casesTable.jurisdiction,
      createdAt: casesTable.createdAt,
    })
    .from(casesTable)
    .where(eq(casesTable.adversaryEntityId, entityId))
    .orderBy(desc(casesTable.createdAt))
    .limit(8);

  const stats = (row.litigationStats ??
    curated?.litigationStats ?? {
      totalCases: 0,
      asPlaintiff: 0,
      asDefendant: 0,
      winRatePctAsDefendant: 0,
      sanctions: [],
      commonViolations: [],
    }) as AdversaryDossier["litigationStats"];

  return {
    entityId: row.id,
    displayName: row.displayName,
    normalizedName: row.normalizedName,
    kind: row.kind as EntityKind,
    jurisdictions: row.jurisdictions ?? [],
    alternateNames: row.alternateNames ?? [],
    registrationData:
      (row.registrationData as Record<string, unknown> | null) ?? null,
    litigationStats: stats,
    defensesThatWorked: curated?.defensesThatWorked ?? [],
    timeline: curated?.timeline ?? [],
    otherCases: others.map((o) => ({
      vertical: o.vertical,
      jurisdiction: o.jurisdiction,
      createdAt: o.createdAt.toISOString(),
    })),
    source: curated
      ? "curated"
      : row.litigationStats
        ? "ai_estimated"
        : "empty",
    sourceNote: curated
      ? "Hand-verified from public CFPB / FTC / state-AG records."
      : "We don't have detailed records on this entity yet. Stats will populate as more cases come in.",
    lastRefreshedAt: row.lastRefreshedAt?.toISOString() ?? null,
  };
}

/** Fuzzy search across registry + persisted entities. */
export async function searchEntities(query: string) {
  const q = query.trim();
  if (q.length === 0) return [];
  const norm = normalizeName(q);

  const fromRegistry = REGISTRY.filter(
    (r) =>
      r.matchPatterns.some((re) => re.test(q) || re.test(norm)) ||
      r.displayName.toLowerCase().includes(q.toLowerCase()) ||
      r.alternateNames.some((a) => a.toLowerCase().includes(q.toLowerCase())),
  );

  const persisted = await db
    .select()
    .from(entitiesTable)
    .where(
      and(
        sql`${entitiesTable.normalizedName} ILIKE ${"%" + norm + "%"}`,
        // De-dupe with the registry by skipping any persisted row whose
        // normalized name matches a registry slug we already include.
        fromRegistry.length > 0
          ? sql`${entitiesTable.normalizedName} NOT IN (${sql.join(
              fromRegistry.map((r) => sql`${r.slug}`),
              sql`, `,
            )})`
          : ne(entitiesTable.id, "00000000-0000-0000-0000-000000000000"),
      ),
    )
    .limit(10);

  return [
    ...fromRegistry.map((r) => ({
      // Registry entries don't have an entityId until they're persisted —
      // expose a stable string the frontend can use to deep-link via
      // /entity/by-name/:slug, but for now the UI uses displayName + slug.
      id: null,
      slug: r.slug,
      displayName: r.displayName,
      kind: r.kind,
      jurisdictions: r.jurisdictions,
      alternateNames: r.alternateNames,
    })),
    ...persisted.map((p) => ({
      id: p.id,
      slug: p.normalizedName,
      displayName: p.displayName,
      kind: p.kind,
      jurisdictions: p.jurisdictions ?? [],
      alternateNames: p.alternateNames ?? [],
    })),
  ];
}
