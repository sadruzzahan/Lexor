/**
 * G23 PromptRegistry (NFR-E-012).
 *
 * Every system prompt is loaded by (key, version, variant) so we can
 * A/B-test wording, ship hot fixes without redeploying, and aggregate
 * QualityJudge scores per version. Persisted in `prompt_versions`.
 *
 * Resolution order for `loadPrompt(key, ctx)`:
 *   1. Explicit `version` argument wins (admin / replay).
 *   2. Active row matching the variant for this tenant. Variant pick
 *      is sticky-by-tenant so the same tenant always sees the same
 *      A/B arm: `variant = variants[hash(tenantId) % variants.length]`.
 *   3. Active row with no variant (i.e. canonical).
 *   4. File fallback under `prompts/<promptKey>.md` — also lazy-seeded
 *      into prompt_versions so subsequent calls hit the DB path.
 *
 * `recordPromptOutcome` is called by the QualityJudge after each
 * judged artifact so per-version metrics (count, avgScore, totalCostUsd)
 * accumulate without a separate ETL job.
 */
import { db, promptVersions } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { logger } from "../lib/logger";

export interface LoadedPrompt {
  promptKey: string;
  version: string;
  variant: string | null;
  body: string;
}

export interface PromptVersionRow {
  promptKey: string;
  version: string;
  variant: string | null;
  body: string;
  active: boolean;
  metrics: PromptMetrics;
  createdAt: string;
}

export interface PromptMetrics {
  count: number;
  avgScore: number;
  totalCostUsd: number;
}

const EMPTY_METRICS: PromptMetrics = { count: 0, avgScore: 0, totalCostUsd: 0 };

/**
 * Sticky variant pick per tenant. Hash is deterministic so the same
 * tenant always sees the same A/B arm across the run.
 */
function pickVariant(variants: string[], tenantId: string | null): string | null {
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0]!;
  const seed = tenantId ?? "anon";
  const h = createHash("sha256").update(seed).digest();
  // Use first 4 bytes as uint32 for stable mod.
  const idx = h.readUInt32BE(0) % variants.length;
  return variants[idx]!;
}

export async function loadPrompt(
  promptKey: string,
  opts: {
    tenantId?: string | null;
    version?: string;
    fileFallback?: string;
  } = {},
): Promise<LoadedPrompt> {
  const tenantId = opts.tenantId ?? null;

  // (1) Explicit version override (admin / replay path).
  if (opts.version) {
    const rows = await db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.promptKey, promptKey), eq(promptVersions.version, opts.version)))
      .limit(1);
    const row = rows[0];
    if (row && row.content) {
      return {
        promptKey,
        version: row.version,
        variant: row.variant ?? null,
        body: row.content,
      };
    }
  }

  // (2)+(3) Resolve active rows, sticky-pick a variant when more than one.
  const active = await db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.promptKey, promptKey), eq(promptVersions.isActive, true)));

  if (active.length > 0) {
    const variants = Array.from(
      new Set(active.map((r) => r.variant).filter((v): v is string => !!v)),
    );
    const picked = pickVariant(variants, tenantId);
    const winner =
      active.find((r) => r.variant === picked) ??
      active.find((r) => !r.variant) ??
      active[0]!;
    if (winner.content) {
      return {
        promptKey,
        version: winner.version,
        variant: winner.variant ?? null,
        body: winner.content,
      };
    }
  }

  // (4) File fallback. Lazy-seed so subsequent calls hit the DB path
  // and metrics start aggregating immediately.
  if (opts.fileFallback) {
    const seedVersion = "file-1";
    try {
      await db
        .insert(promptVersions)
        .values({
          promptKey,
          version: seedVersion,
          content: opts.fileFallback,
          variant: null,
          isActive: true,
          metrics: EMPTY_METRICS,
        })
        .onConflictDoNothing();
    } catch (err) {
      logger.warn({ err, promptKey }, "promptRegistry: lazy seed failed (continuing with file content)");
    }
    return {
      promptKey,
      version: seedVersion,
      variant: null,
      body: opts.fileFallback,
    };
  }

  throw new Error(`PromptRegistry: no version found for "${promptKey}" and no fileFallback supplied`);
}

/**
 * Aggregate one judged outcome onto the metrics jsonb. Uses a JSON merge
 * via SQL so concurrent updates can't drop counts the way a select-then-
 * update pattern would.
 */
export async function recordPromptOutcome(args: {
  promptKey: string;
  version: string;
  qualityScore: number;
  costUsd?: number;
}): Promise<void> {
  const cost = args.costUsd ?? 0;
  try {
    await db.execute(sql`
      update prompt_versions
         set metrics = jsonb_build_object(
           'count', coalesce((metrics->>'count')::int, 0) + 1,
           'avgScore',
             ((coalesce((metrics->>'avgScore')::float, 0) * coalesce((metrics->>'count')::int, 0))
              + ${args.qualityScore})
             / (coalesce((metrics->>'count')::int, 0) + 1),
           'totalCostUsd', coalesce((metrics->>'totalCostUsd')::float, 0) + ${cost}
         )
       where prompt_key = ${args.promptKey}
         and version = ${args.version}
    `);
  } catch (err) {
    logger.warn({ err, key: args.promptKey, version: args.version }, "recordPromptOutcome failed");
  }
}

export async function listVersions(promptKey: string): Promise<PromptVersionRow[]> {
  const rows = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.promptKey, promptKey));
  return rows.map((r) => ({
    promptKey: r.promptKey,
    version: r.version,
    variant: r.variant ?? null,
    body: r.content ?? "",
    active: r.isActive,
    metrics: (r.metrics as PromptMetrics) ?? EMPTY_METRICS,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
  }));
}

/**
 * Activate (key, version, variant). Within the same (key, variant) only
 * one version can be active at a time so A/B traffic stays well-defined.
 */
export async function activateVersion(args: {
  promptKey: string;
  version: string;
  variant: string;
}): Promise<PromptVersionRow | null> {
  await db
    .update(promptVersions)
    .set({ isActive: false })
    .where(
      and(
        eq(promptVersions.promptKey, args.promptKey),
        eq(promptVersions.variant, args.variant),
      ),
    );
  await db
    .update(promptVersions)
    .set({ isActive: true })
    .where(
      and(
        eq(promptVersions.promptKey, args.promptKey),
        eq(promptVersions.version, args.version),
        eq(promptVersions.variant, args.variant),
      ),
    );
  const rows = await db
    .select()
    .from(promptVersions)
    .where(
      and(
        eq(promptVersions.promptKey, args.promptKey),
        eq(promptVersions.version, args.version),
        eq(promptVersions.variant, args.variant),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    promptKey: r.promptKey,
    version: r.version,
    variant: r.variant ?? null,
    body: r.content ?? "",
    active: r.isActive,
    metrics: (r.metrics as PromptMetrics) ?? EMPTY_METRICS,
    createdAt: (r.createdAt ?? new Date()).toISOString(),
  };
}
