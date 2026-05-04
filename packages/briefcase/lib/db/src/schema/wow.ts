import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  numeric,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { cases, runs } from "./core";

export const contradictions = pgTable(
  "contradictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    claim: text("claim"),
    sourceA: jsonb("source_a"),
    sourceB: jsonb("source_b"),
    severity: text("severity"),
    type: text("type"),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("contradictions_severity_check", sql`${t.severity} in ('low','medium','high')`),
    check(
      "contradictions_type_check",
      sql`${t.type} in ('timestamp','identity','sequence','fact')`,
    ),
    index("contradictions_run_idx").on(t.runId),
  ],
);

export const rightsFindings = pgTable(
  "rights_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    rightCategory: text("right_category"),
    jurisdictionRule: text("jurisdiction_rule"),
    evidenceFromCase: jsonb("evidence_from_case"),
    citedAuthority: jsonb("cited_authority"),
    severity: text("severity"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("rights_findings_severity_check", sql`${t.severity} in ('low','medium','high')`),
    index("rights_findings_run_idx").on(t.runId),
  ],
);

export const disclosureGaps = pgTable(
  "disclosure_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    expectedItem: text("expected_item"),
    basisForExpectation: text("basis_for_expectation"),
    ruleCitation: jsonb("rule_citation"),
    requestStatus: text("request_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "disclosure_gaps_request_status_check",
      sql`${t.requestStatus} in ('not_requested','requested','received','withheld')`,
    ),
    index("disclosure_gaps_run_idx").on(t.runId),
  ],
);

export const jurySimulations = pgTable("jury_simulations", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  jurors: jsonb("jurors"),
  deliberation: jsonb("deliberation"),
  verdictDistribution: jsonb("verdict_distribution"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const courtroomSessions = pgTable("courtroom_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id"),
  caseId: uuid("case_id").references(() => cases.id),
  jurisdictionCountry: text("jurisdiction_country").default("US").notNull(),
  // G14 privacy: consent_transcript=false means transcript text is
  // only kept in-memory for the live session and never persisted to
  // objection_events.transcript at session end.
  consentTranscript: boolean("consent_transcript").default(false).notNull(),
  // G14: transport in use ('webrtc' once G23 is wired, otherwise
  // 'http_chunks' fallback). Stored so audit bundles record it.
  transport: text("transport").default("http_chunks").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  eventCount: integer("event_count").default(0),
});

export const objectionEvents = pgTable(
  "objection_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => courtroomSessions.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    transcript: text("transcript"),
    suggestion: text("suggestion"),
    ruleCitation: jsonb("rule_citation"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
  },
  (t) => [index("objection_events_session_idx").on(t.sessionId, t.idx)],
);

export const pleaSimulations = pgTable("plea_simulations", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  charge: text("charge"),
  jurisdiction: text("jurisdiction"),
  trialDistribution: jsonb("trial_distribution"),
  pleaDistribution: jsonb("plea_distribution"),
  summary: text("summary"),
  datasetCitations: jsonb("dataset_citations"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const prosecutionRuns = pgTable("prosecution_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentRunId: uuid("parent_run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  output: jsonb("output"),
  weaknessReport: jsonb("weakness_report"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const runBranches = pgTable(
  "run_branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentRunId: uuid("parent_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    branchedAtIdx: integer("branched_at_idx"),
    editedInputs: jsonb("edited_inputs"),
    childRunId: uuid("child_run_id").references(() => runs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("run_branches_parent_idx").on(t.parentRunId)],
);

export const agentTraces = pgTable(
  "agent_traces",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    nodePath: text("node_path"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.idx] })],
);
