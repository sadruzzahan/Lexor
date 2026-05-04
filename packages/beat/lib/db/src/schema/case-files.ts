import { pgTable, text, integer, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";

export const fileSourceTypeEnum = pgEnum("file_source_type", ["photo", "audio", "note", "scan", "upload", "drive"]);

export const caseFilesTable = pgTable("case_files", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  caseId: text("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  sourceType: fileSourceTypeEnum("source_type"),
  filename: text("filename").notNull(),
  originalName: text("original_name"),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256"),
  sizeBytes: integer("size_bytes").notNull(),
  storageUrl: text("storage_url").notNull(),
  exif: jsonb("exif"),
  gps: jsonb("gps"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  detectedLanguage: text("detected_language"),
  caption: text("caption"),
  transcript: text("transcript"),
  autoTagJson: jsonb("auto_tag_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCaseFileSchema = createInsertSchema(caseFilesTable).omit({ id: true, createdAt: true });
export const selectCaseFileSchema = createSelectSchema(caseFilesTable);

export type InsertCaseFile = z.infer<typeof insertCaseFileSchema>;
export type CaseFile = typeof caseFilesTable.$inferSelect;
