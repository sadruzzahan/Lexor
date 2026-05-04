import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  email: text("email").unique(),
  googleRefreshToken: bytea("google_refresh_token"),
  googleRefreshTokenIv: bytea("google_refresh_token_iv"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    rolePack: text("role_pack").notNull(),
    jurisdictionContext: jsonb("jurisdiction_context"),
    language: text("language"),
    status: text("status").notNull().default("created"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "cases_role_pack_check",
      sql`${t.rolePack} in ('defender','detective')`,
    ),
    check(
      "cases_status_check",
      sql`${t.status} in ('created','ingesting','ready','running','prepared','error','deleted')`,
    ),
    index("cases_user_updated_idx")
      .on(t.userId, t.updatedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const caseFiles = pgTable(
  "case_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    driveFileId: text("drive_file_id"),
    name: text("name").notNull(),
    mime: text("mime"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: char("sha256", { length: 64 }),
    ocrText: text("ocr_text"),
    detectedLanguage: text("detected_language"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "case_files_source_type_check",
      sql`${t.sourceType} in ('upload','drive','scan','audio')`,
    ),
    uniqueIndex("case_files_case_sha_uniq").on(t.caseId, t.sha256),
    index("case_files_embedding_idx")
      .using("ivfflat", t.embedding.op("vector_cosine_ops"))
      .with({ lists: 100 }),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    rolePack: text("role_pack").notNull(),
    goal: text("goal"),
    idempotencyKey: text("idempotency_key").unique(),
    status: text("status").notNull().default("pending"),
    cancelled: boolean("cancelled").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    parentRunId: uuid("parent_run_id"),
    branchedAtIdx: integer("branched_at_idx"),
  },
  (t) => [
    check(
      "runs_status_check",
      sql`${t.status} in ('pending','running','completed','cancelled','error')`,
    ),
    index("runs_case_started_idx").on(t.caseId, t.startedAt.desc()),
    index("runs_parent_idx").on(t.parentRunId),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("run_events_run_idx_uniq").on(t.runId, t.idx),
    index("run_events_run_idx").on(t.runId, t.idx),
    check("run_events_idx_nonneg", sql`${t.idx} >= 0`),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    subagent: text("subagent").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("artifacts_run_subagent_idx").on(t.runId, t.subagent)],
);

export const prepItems = pgTable("prep_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id, { onDelete: "cascade" }),
  artifactId: uuid("artifact_id")
    .notNull()
    .references(() => artifacts.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const citations = pgTable(
  "citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    artifactKind: text("artifact_kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    span: jsonb("span"),
    verifiedQuote: text("verified_quote"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "citations_source_type_check",
      sql`${t.sourceType} in ('pdf','image','audio','video','url','transcript')`,
    ),
    index("citations_run_kind_idx").on(t.runId, t.artifactKind),
  ],
);
