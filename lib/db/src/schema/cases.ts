import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const caseStatus = pgEnum("case_status", [
  "queued",
  "parsing",
  "analyzing",
  "drafting",
  "complete",
  "failed",
]);

export const caseVertical = pgEnum("case_vertical", [
  "eviction",
  "debt",
  "wage",
  "other",
]);

// Note: text-embedding-3-large can be configured to 1536 dims so the column
// fits pgvector's 2000-dim ivfflat index limit (3072 dims would require
// halfvec/HNSW). We standardize on 1536.
export const casesTable = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    status: caseStatus("status").notNull().default("queued"),
    vertical: caseVertical("vertical").notNull().default("other"),
    jurisdiction: text("jurisdiction"),
    language: text("language").notNull().default("en"),
    rawDocumentUrl: text("raw_document_url"),
    rawDocumentHash: text("raw_document_hash"),
    parsed: jsonb("parsed"),
    violations: jsonb("violations"),
    responseLetter: jsonb("response_letter"),
    regulatorComplaints: jsonb("regulator_complaints"),
    adversaryEntityId: uuid("adversary_entity_id").references(
      () => entitiesTable.id,
      { onDelete: "set null" },
    ),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cases_raw_document_hash_idx").on(t.rawDocumentHash),
    index("cases_user_id_idx").on(t.userId),
    index("cases_adversary_entity_id_idx").on(t.adversaryEntityId),
    index("cases_embedding_ivfflat_cosine_idx")
      .using("ivfflat", sql`embedding vector_cosine_ops`)
      .with({ lists: 100 }),
  ],
);

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectCaseSchema = createSelectSchema(casesTable);
export type Case = typeof casesTable.$inferSelect;
export type InsertCase = z.infer<typeof insertCaseSchema>;
