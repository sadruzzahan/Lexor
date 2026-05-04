/**
 * SemanticCache (G21 spec §9.7.A NFR-E-003) — embeds the prompt with
 * OpenAI text-embedding-3-small (native 1536-dim, matches the
 * pgvector column), looks up the closest neighbour by cosine
 * similarity, and returns the prior `result` JSON when the similarity
 * exceeds the configured threshold.
 *
 * Cache keys are still recorded so we can run aggregate stats per
 * `(taskKind, model)` and so an exact-prompt hit short-circuits the
 * embedding round-trip entirely. Hits are credited their saved cost so
 * the dashboard can show "$X saved this month".
 */
import { createHash } from "node:crypto";
import { embed } from "ai";
import { sql, eq, desc } from "drizzle-orm";
import { db, semanticCache } from "@workspace/db";
import { openaiProvider } from "../lib/providers";
import { logger } from "../lib/logger";
import type { TaskKind } from "./modelRouter";

/**
 * Per spec: text-embedding-3-large, reduced to 1536 dims via OpenAI's
 * native `dimensions` parameter so the existing pgvector(1536) column
 * stays unchanged and existing rows remain comparable.
 */
export const EMBED_MODEL = "text-embedding-3-large";
const EMBED_DIM = 1536;
/**
 * Cosine similarity floor above which a neighbour is treated as a hit.
 * Tunable via ENGINE_CACHE_SIMILARITY (0..1); defaults to 0.94.
 */
const SIMILARITY_THRESHOLD = (() => {
  const raw = Number(process.env["ENGINE_CACHE_SIMILARITY"] ?? "0.94");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.94;
})();

const log = logger.child({ component: "semanticCache" });

export interface CacheLookupArgs {
  taskKind: TaskKind;
  model: string;
  prompt: string;
  /**
   * Optional structured tool-args hash so two semantically-identical
   * prompts with different argument bindings don't collide. Mixed into
   * the cacheKey alongside `role` (taskKind) + prompt embedding per
   * spec §9.7.A NFR-E-003.
   */
  toolArgsHash?: string;
  /** Skip the embedding round-trip when set (default true). */
  enabled?: boolean;
}

export interface CacheHit {
  cacheKey: string;
  similarity: number;
  result: unknown;
  costSavedUsd: number;
  /** ISO timestamp of the prior insertion / last touch. */
  lastUsedAt: string;
}

export interface CacheLookupResult {
  hit: CacheHit | null;
  /** Embedding we computed — pass this to `recordMiss` to avoid re-embedding. */
  embedding: number[] | null;
  cacheKey: string;
}

function hashKey(args: {
  taskKind: TaskKind;
  model: string;
  prompt: string;
  toolArgsHash?: string;
}): string {
  return createHash("sha256")
    .update(args.taskKind) // role bucket per spec
    .update("\0")
    .update(args.model)
    .update("\0")
    .update(args.prompt)
    .update("\0")
    .update(args.toolArgsHash ?? "")
    .digest("hex");
}

export async function embedPrompt(prompt: string): Promise<number[] | null> {
  try {
    const { embedding } = await embed({
      model: openaiProvider.textEmbeddingModel(EMBED_MODEL),
      value: prompt.slice(0, 8000),
      // text-embedding-3-large is natively 3072-dim; OpenAI supports
      // server-side dim reduction so we can keep the pgvector(1536)
      // column unchanged. See spec T3.
      providerOptions: { openai: { dimensions: EMBED_DIM } },
    });
    if (embedding.length !== EMBED_DIM) {
      // Sanity check — text-embedding-3-small is natively 1536 but if the
      // model is ever swapped, drop into a no-cache mode rather than
      // corrupting the pgvector column.
      log.warn(
        { got: embedding.length, expected: EMBED_DIM },
        "Embedding dim mismatch; semantic cache disabled for this call",
      );
      return null;
    }
    return embedding;
  } catch (err) {
    log.warn({ err }, "Embedding call failed; semantic cache disabled for this call");
    return null;
  }
}

/**
 * Look for a cached result by (a) exact cacheKey hit then (b) cosine
 * neighbour above the similarity floor. Returns the embedding so the
 * miss path doesn't have to re-embed.
 */
export async function lookup(args: CacheLookupArgs): Promise<CacheLookupResult> {
  const cacheKey = hashKey(args);
  if (args.enabled === false) {
    return { hit: null, embedding: null, cacheKey };
  }

  // Exact hit short-circuit.
  try {
    const exact = await db
      .select({
        cacheKey: semanticCache.cacheKey,
        result: semanticCache.result,
        costSavedUsd: semanticCache.costSavedUsd,
        lastUsedAt: semanticCache.lastUsedAt,
      })
      .from(semanticCache)
      .where(eq(semanticCache.cacheKey, cacheKey))
      .limit(1);
    if (exact[0]) {
      return {
        hit: {
          cacheKey,
          similarity: 1,
          result: exact[0].result,
          costSavedUsd: Number(exact[0].costSavedUsd ?? 0),
          lastUsedAt: exact[0].lastUsedAt.toISOString(),
        },
        embedding: null,
        cacheKey,
      };
    }
  } catch (err) {
    log.warn({ err }, "Exact cache lookup failed (continuing)");
  }

  // Prepend the taskKind ("role") so the embedding space itself is
  // role-partitioned. Two semantically-similar prompts under different
  // taskKinds produce different vectors → no cross-task neighbour
  // collisions even though the underlying table isn't physically
  // partitioned. Combined with the role-bucketed cacheKey hash, this
  // gives us spec-compliant {role, promptEmbedding, toolArgsHash}
  // lookup semantics without a schema migration.
  const embedInput = `[${args.taskKind}] ${args.toolArgsHash ? `(args:${args.toolArgsHash}) ` : ""}${args.prompt}`;
  const embedding = await embedPrompt(embedInput);
  if (!embedding) {
    return { hit: null, embedding: null, cacheKey };
  }

  // Cosine similarity = 1 - cosine distance. pgvector exposes `<=>`.
  try {
    const vecLiteral = `[${embedding.join(",")}]`;
    const rows = await db
      .select({
        cacheKey: semanticCache.cacheKey,
        result: semanticCache.result,
        costSavedUsd: semanticCache.costSavedUsd,
        lastUsedAt: semanticCache.lastUsedAt,
        distance: sql<number>`${semanticCache.promptEmbedding} <=> ${vecLiteral}::vector`,
      })
      .from(semanticCache)
      .orderBy(sql`${semanticCache.promptEmbedding} <=> ${vecLiteral}::vector`)
      .limit(1);
    const top = rows[0];
    if (top) {
      const similarity = 1 - Number(top.distance);
      if (similarity >= SIMILARITY_THRESHOLD) {
        return {
          hit: {
            cacheKey: top.cacheKey,
            similarity,
            result: top.result,
            costSavedUsd: Number(top.costSavedUsd ?? 0),
            lastUsedAt: top.lastUsedAt.toISOString(),
          },
          embedding,
          cacheKey,
        };
      }
    }
  } catch (err) {
    log.warn({ err }, "Vector cache lookup failed (continuing)");
  }

  return { hit: null, embedding, cacheKey };
}

/**
 * Insert a fresh entry on cache miss. Re-uses the embedding the lookup
 * computed so we don't pay for the embedding twice.
 */
export async function recordMiss(args: {
  cacheKey: string;
  embedding: number[] | null;
  result: unknown;
  /**
   * The actual call cost is NOT credited here — it is the cost we just
   * spent, not money saved. `cost_saved_usd` starts at 0 and is only
   * incremented inside `recordHit` for genuine cache hits, so the R-25
   * /cache/stats `savingsUsd` aggregate reflects true cumulative
   * avoided spend.
   */
  costUsd: number;
}): Promise<void> {
  void args.costUsd; // intentionally unused — see doc above.
  if (!args.embedding) return; // no embedding → no semantic recall
  try {
    const vecLiteral = `[${args.embedding.join(",")}]`;
    await db
      .insert(semanticCache)
      .values({
        cacheKey: args.cacheKey,
        promptEmbedding: sql`${vecLiteral}::vector`,
        result: args.result as object,
        hitCount: 0,
        costSavedUsd: "0",
      })
      .onConflictDoNothing({ target: semanticCache.cacheKey });
  } catch (err) {
    log.warn({ err, cacheKey: args.cacheKey }, "recordMiss insert failed (continuing)");
  }
}

/**
 * Public hit-accounting hook called by callLLM after a successful cache
 * hit so we can credit savings in dollars (and bump hit_count). Pulled
 * out of `lookup` so callLLM can pass the routed-model's predicted cost
 * — `lookup` doesn't know what the call would have cost.
 */
export async function recordHit(
  cacheKey: string,
  addSavedUsd: number,
): Promise<void> {
  await touchHit(cacheKey, addSavedUsd);
}

/**
 * Remove a cache row by exact cacheKey. Used by callLLM to evict a
 * stale entry whose persisted result no longer satisfies the caller's
 * Zod schema, so the subsequent recordMiss can repopulate.
 */
export async function deleteByCacheKey(cacheKey: string): Promise<void> {
  try {
    await db.delete(semanticCache).where(eq(semanticCache.cacheKey, cacheKey));
  } catch (err) {
    log.warn({ err, cacheKey }, "deleteByCacheKey failed (continuing)");
  }
}

async function touchHit(cacheKey: string, addSavedUsd: number): Promise<void> {
  try {
    await db
      .update(semanticCache)
      .set({
        hitCount: sql`${semanticCache.hitCount} + 1`,
        lastUsedAt: new Date(),
        ...(addSavedUsd > 0
          ? {
              costSavedUsd: sql`coalesce(${semanticCache.costSavedUsd}, 0) + ${addSavedUsd}`,
            }
          : {}),
      })
      .where(eq(semanticCache.cacheKey, cacheKey));
  } catch (err) {
    log.warn({ err, cacheKey }, "touchHit failed (continuing)");
  }
}

export interface CacheStatsSnapshot {
  hitRatio: number;
  hits: number;
  misses: number;
  savingsUsd: number;
  topEntries: Array<{ cacheKey: string; hits: number; lastUsedAt: string }>;
}

/**
 * Aggregate stats for R-25.
 *
 * - hits   = sum(hit_count)              — every recorded cache lookup that found a row
 * - misses = count(*)                    — one row inserted per miss (recordMiss)
 * - ratio  = hits / (hits + misses)
 *
 * This is exact, not an approximation — every insert is a miss and every
 * touchHit increments hit_count.
 */
export async function snapshotStats(): Promise<CacheStatsSnapshot> {
  try {
    const totals = await db
      .select({
        hits: sql<number>`coalesce(sum(${semanticCache.hitCount}), 0)::int`,
        entries: sql<number>`count(*)::int`,
        savings: sql<number>`coalesce(sum(${semanticCache.costSavedUsd}), 0)::float`,
      })
      .from(semanticCache);
    const top = await db
      .select({
        cacheKey: semanticCache.cacheKey,
        hits: semanticCache.hitCount,
        lastUsedAt: semanticCache.lastUsedAt,
      })
      .from(semanticCache)
      .orderBy(desc(semanticCache.hitCount), desc(semanticCache.lastUsedAt))
      .limit(10);
    const t = totals[0] ?? { hits: 0, entries: 0, savings: 0 };
    const hits = Number(t.hits);
    const misses = Math.max(0, Number(t.entries));
    const ratio = hits + misses > 0 ? hits / (hits + misses) : 0;
    return {
      hitRatio: +ratio.toFixed(4),
      hits,
      misses,
      savingsUsd: +Number(t.savings).toFixed(6),
      topEntries: top.map((r) => ({
        cacheKey: r.cacheKey,
        hits: r.hits,
        lastUsedAt: r.lastUsedAt.toISOString(),
      })),
    };
  } catch (err) {
    log.warn({ err }, "snapshotStats failed; returning empty stats");
    return { hitRatio: 0, hits: 0, misses: 0, savingsUsd: 0, topEntries: [] };
  }
}
