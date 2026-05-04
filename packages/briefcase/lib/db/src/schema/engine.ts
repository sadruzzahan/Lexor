import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  bigint,
} from "drizzle-orm/pg-core";

import { runs } from "./core";

export const semanticCache = pgTable(
  "semantic_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: text("cache_key").notNull().unique(),
    promptEmbedding: vector("prompt_embedding", { dimensions: 1536 }),
    result: jsonb("result"),
    hitCount: integer("hit_count").notNull().default(0),
    costSavedUsd: numeric("cost_saved_usd", { precision: 10, scale: 6 }).default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("semantic_cache_key_idx").on(t.cacheKey),
    index("semantic_cache_last_used_idx").on(t.lastUsedAt),
    index("semantic_cache_embedding_idx")
      .using("ivfflat", t.promptEmbedding.op("vector_cosine_ops"))
      .with({ lists: 100 }),
  ],
);

export const modelRoutingDecisions = pgTable(
  "model_routing_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    taskKind: text("task_kind"),
    candidates: jsonb("candidates"),
    chosenModel: text("chosen_model"),
    rationale: text("rationale"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("model_routing_decisions_run_idx").on(t.runId, t.idx)],
);

export const agentCosts = pgTable("agent_costs", {
  runId: uuid("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  totalUsd: numeric("total_usd", { precision: 10, scale: 6 }),
  byModel: jsonb("by_model"),
  byTool: jsonb("by_tool"),
  byPhase: jsonb("by_phase"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const auditBundles = pgTable("audit_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  bundleUri: text("bundle_uri"),
  signature: text("signature"),
  signingKeyId: text("signing_key_id"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const policyDrops = pgTable("policy_drops", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  subagent: text("subagent"),
  rule: text("rule"),
  droppedPayload: jsonb("dropped_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const qualityJudgments = pgTable("quality_judgments", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  subagent: text("subagent"),
  rubric: jsonb("rubric"),
  score: numeric("score", { precision: 3, scale: 2 }),
  rationale: text("rationale"),
  retried: boolean("retried"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptKey: text("prompt_key").notNull(),
    version: text("version").notNull(),
    content: text("content"),
    variant: text("variant"),
    isActive: boolean("is_active").notNull().default(false),
    metrics: jsonb("metrics"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // (key, version, variant) — variant nullable so multiple variants
    // can co-exist for the same logical version (Postgres treats NULLs
    // as distinct in unique indexes, so the canonical row never blocks
    // variant rows).
    uniqueIndex("prompt_versions_key_version_variant_uniq").on(
      t.promptKey,
      t.version,
      t.variant,
    ),
    index("prompt_versions_key_active_idx").on(t.promptKey, t.isActive),
  ],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    fromAgent: text("from_agent"),
    toAgent: text("to_agent"),
    body: jsonb("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // G23 NFR-E-014 — uniqueness on (runId, idx) is the contract that
  // makes postMessage()'s 23505 retry loop the canonical race
  // arbitrator across concurrent subagent posters.
  (t) => [uniqueIndex("agent_messages_run_idx_uniq").on(t.runId, t.idx)],
);

export const speculativeBranches = pgTable("speculative_branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  subagent: text("subagent"),
  speculation: text("speculation"),
  output: jsonb("output"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const replayCases = pgTable("replay_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  fixtureUri: text("fixture_uri"),
  expected: jsonb("expected"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * G23 NFR-E-013 Adaptive planner. Per-(case, subagent) running tally
 * of how many times that subagent has produced an empty artifact in
 * recent runs. The planner consults this table at plan time and skips
 * subagents above the empty-threshold (case-scoped only — never leaks
 * across cases per spec).
 */
export const plannerSkipHistory = pgTable(
  "planner_skip_history",
  {
    caseId: uuid("case_id").notNull(),
    subagent: text("subagent").notNull(),
    emptyCount: integer("empty_count").notNull().default(0),
    runCount: integer("run_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("planner_skip_history_pk").on(t.caseId, t.subagent),
  ],
);

/**
 * G23 NFR-E-016 ReplayHarness. One row per executed replay so the CI
 * harness + R-27 surface can show pass/fail history per fixture.
 */
export const replayRuns = pgTable(
  "replay_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replayCaseId: uuid("replay_case_id").notNull(),
    runId: uuid("run_id"),
    passed: boolean("passed").notNull(),
    diff: jsonb("diff"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("replay_runs_case_idx").on(t.replayCaseId, t.createdAt)],
);

export const costCeilings = pgTable(
  "cost_ceilings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope"),
    scopeId: text("scope_id"),
    monthlyUsd: numeric("monthly_usd", { precision: 10, scale: 2 }),
    hardStop: boolean("hard_stop").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("cost_ceilings_scope_idx").on(t.scope, t.scopeId)],
);
