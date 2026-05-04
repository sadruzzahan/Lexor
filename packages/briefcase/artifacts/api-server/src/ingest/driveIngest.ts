/**
 * Drive ingest engine. Reuses the upload route's storage + dedupe primitives
 * so a Drive-sourced file ends up indistinguishable from a hand-uploaded
 * one in `case_files` (FR-023 idempotent ingest on `(caseId, sha256)`).
 *
 * Wire-format note: the schema's `embedding` column is `vector(1536)`. We
 * persist arrays as the pgvector text literal (`[0.1,0.2,...]`) since
 * Drizzle's `vector()` type accepts that string form on insert.
 */
import { db, caseFiles } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { putBytes } from "../lib/storage";
import { embedFileText } from "../lib/embeddings";
import { extractPdfText } from "../lib/pdfText";
import * as drive from "../mcp/workspaceClient";
import type { IngestSseChannel } from "../lib/ingestSse";
import type { DriveFile } from "../mcp/workspaceClient";
import { serializeFile } from "../routes/cases";
import { logger } from "../lib/logger";

/** Subset of `DriveClient` we need; injectable so tests / smoke can stub
 * the network layer. */
export interface DriveClient {
  getFile(userId: string, fileId: string): Promise<DriveFile>;
  downloadFile(userId: string, fileId: string): Promise<Buffer>;
  walkFolder(
    userId: string,
    folderId: string,
    opts?: { maxFiles?: number },
  ): Promise<DriveFile[]>;
}

export const defaultDriveClient: DriveClient = {
  getFile: drive.getFile,
  downloadFile: drive.downloadFile,
  walkFolder: drive.walkFolder,
};

const PDF_MIMES = new Set(["application/pdf"]);

interface IngestOneArgs {
  userId: string;
  caseId: string;
  driveFile: DriveFile;
  channel: IngestSseChannel;
  client: DriveClient;
}

async function ingestOne({
  userId,
  caseId,
  driveFile,
  channel,
  client,
}: IngestOneArgs): Promise<void> {
  channel.emit({
    type: "progress",
    message: `Fetching ${driveFile.name}`,
  });

  // G8 only ingests PDFs. Google-native types (Docs/Sheets) need an
  // `export` round-trip; arbitrary binaries (audio/video/zip/etc.) require
  // their own pipelines. Surface a single consistent skip event for
  // anything that isn't `application/pdf` so the UI can render an
  // "unsupported, skipped" row deterministically.
  if (!PDF_MIMES.has(driveFile.mimeType)) {
    channel.emit({
      type: "error",
      message: `Unsupported Drive type ${driveFile.mimeType} (${driveFile.name}); only PDFs are supported in G8.`,
    });
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await client.downloadFile(userId, driveFile.id);
  } catch (err) {
    channel.emit({
      type: "error",
      message: `Download failed for ${driveFile.name}: ${(err as Error).message}`,
    });
    return;
  }

  const stored = await putBytes(bytes);

  // Dedupe (FR-023): if a file with the same SHA already exists for this
  // case, surface the existing row as `file_ingested` and skip the OCR /
  // embed work.
  const existing = await db
    .select()
    .from(caseFiles)
    .where(
      and(eq(caseFiles.caseId, caseId), eq(caseFiles.sha256, stored.sha256)),
    )
    .limit(1);
  if (existing.length) {
    channel.emit({
      type: "file_ingested",
      file: serializeFile(existing[0]!) as Record<string, unknown>,
      message: "Already ingested (deduped by SHA-256)",
    });
    return;
  }

  let ocrText = "";
  channel.emit({
    type: "progress",
    message: `Extracting text from ${driveFile.name}`,
    progress: 0.4,
  });
  try {
    const parsed = await extractPdfText(bytes);
    ocrText = parsed.text;
  } catch (err) {
    logger.warn({ err, fileId: driveFile.id }, "pdfText extract failed");
  }
  if (!ocrText) {
    channel.emit({
      type: "error",
      message: `${driveFile.name}: no extractable text (image-only PDF). OCR not supported in G8.`,
    });
    // Still record the file row so the run can reference it; downstream
    // agents will see an empty ocr_text.
  }

  let embeddingLiteral: string | null = null;
  if (ocrText) {
    channel.emit({
      type: "progress",
      message: `Embedding ${driveFile.name}`,
      progress: 0.75,
    });
    try {
      const vec = await embedFileText(ocrText);
      if (vec) embeddingLiteral = `[${vec.join(",")}]`;
    } catch (err) {
      logger.warn({ err, fileId: driveFile.id }, "embedding failed");
    }
  }

  const inserted = await db
    .insert(caseFiles)
    .values({
      caseId,
      sourceType: "drive",
      driveFileId: driveFile.id,
      name: driveFile.name,
      mime: driveFile.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      ocrText: ocrText || null,
      // Cast through unknown — Drizzle's vector type expects number[] but
      // accepts the pgvector text literal at SQL-write time.
      embedding: embeddingLiteral as unknown as number[] | null,
    })
    .returning();

  channel.emit({
    type: "file_ingested",
    file: serializeFile(inserted[0]!) as Record<string, unknown>,
  });
}

export async function ingestDriveFile(opts: {
  userId: string;
  caseId: string;
  driveFileId: string;
  channel: IngestSseChannel;
  client?: DriveClient;
}): Promise<void> {
  const client = opts.client ?? defaultDriveClient;
  try {
    const driveFile = await client.getFile(opts.userId, opts.driveFileId);
    if (driveFile.isFolder) {
      opts.channel.emit({
        type: "error",
        message: `${driveFile.name} is a folder; use /from-folder.`,
      });
      opts.channel.emit({ type: "done" });
      return;
    }
    await ingestOne({
      userId: opts.userId,
      caseId: opts.caseId,
      driveFile,
      channel: opts.channel,
      client,
    });
  } catch (err) {
    opts.channel.emit({
      type: "error",
      message: `Drive ingest failed: ${(err as Error).message}`,
    });
  } finally {
    opts.channel.emit({ type: "done" });
    opts.channel.end();
  }
}

export async function ingestDriveFolder(opts: {
  userId: string;
  caseId: string;
  driveFolderId: string;
  channel: IngestSseChannel;
  client?: DriveClient;
  maxFiles?: number;
}): Promise<void> {
  const client = opts.client ?? defaultDriveClient;
  try {
    const files = await client.walkFolder(opts.userId, opts.driveFolderId, {
      maxFiles: opts.maxFiles ?? 50,
    });
    if (files.length === 0) {
      opts.channel.emit({
        type: "progress",
        message: "Folder is empty; nothing to ingest.",
      });
    } else {
      opts.channel.emit({
        type: "progress",
        message: `Found ${files.length} file${files.length === 1 ? "" : "s"} in folder.`,
        progress: 0,
      });
    }
    let i = 0;
    for (const driveFile of files) {
      if (opts.channel.closed) break;
      i += 1;
      opts.channel.emit({
        type: "progress",
        message: `(${i}/${files.length}) ${driveFile.name}`,
        progress: i / Math.max(files.length, 1),
      });
      await ingestOne({
        userId: opts.userId,
        caseId: opts.caseId,
        driveFile,
        channel: opts.channel,
        client,
      });
    }
  } catch (err) {
    opts.channel.emit({
      type: "error",
      message: `Drive folder ingest failed: ${(err as Error).message}`,
    });
  } finally {
    opts.channel.emit({ type: "done" });
    opts.channel.end();
  }
}
