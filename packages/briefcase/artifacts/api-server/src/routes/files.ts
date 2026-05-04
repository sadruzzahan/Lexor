import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Router, type IRouter } from "express";
import multer from "multer";
import { db, cases, caseFiles } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  UploadCaseFileParams,
  UploadCaseFileBody,
  GetCaseFileParams,
  IngestDriveFileParams,
  IngestDriveFileBody,
  IngestDriveFolderParams,
  IngestDriveFolderBody,
} from "@workspace/api-zod";

// The generated multipart body schema includes `file: instanceof(File)` from
// the OpenAPI multipart spec. Since multer handles the binary part out-of-band
// (`req.file` from `upload.single("file")`), we validate only the text-field
// metadata via `.pick(...)` to avoid a redundant File-instance check that
// can't be satisfied in a Node multipart pipeline.
const UploadCaseFileMetadata = UploadCaseFileBody.pick({
  sourceType: true,
  ocrText: true,
  pageCount: true,
});
import { ApiError } from "../lib/errors";
import { requireDemoUser } from "../middlewares/demoUser";
import { putBytes, storageRoot } from "../lib/storage";
import { openIngestSse } from "../lib/ingestSse";
import { ingestDriveFile, ingestDriveFolder } from "../ingest/driveIngest";
import { serializeFile } from "./cases";

const router: IRouter = Router({ mergeParams: true });

router.use(requireDemoUser);

// memoryStorage is fine for the G3 demo flow (single-user, low concurrency)
// but allocates the full upload buffer per request — 50 MB × N concurrent
// uploads in worst case. Pre-production this should switch to disk-backed
// storage (`multer.diskStorage`) so we stream to disk and only hash from
// disk, removing the per-request RAM bound.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB demo cap
});

// R-06 Upload a case file (multipart)
router.post("/:caseId/files", upload.single("file"), async (req, res, next) => {
  try {
    const { caseId } = UploadCaseFileParams.parse(req.params);
    const userId = req.demoUser!.id;

    // Validate the multipart text-field metadata via the generated Zod body
    // schema (the binary part itself is handled by multer above). sourceType
    // is required by the OpenAPI contract; we do NOT default it here so
    // clients can't drift from the spec. The smoke + UI both pass it
    // explicitly.
    // pageCount arrives as a multipart text field — coerce before validating
    // (the generated Zod schema enforces integer/min(1)).
    const rawPageCount = req.body?.pageCount;
    const { sourceType, ocrText, pageCount } = UploadCaseFileMetadata.parse({
      sourceType: req.body?.sourceType,
      ocrText: req.body?.ocrText,
      pageCount:
        rawPageCount === undefined || rawPageCount === ""
          ? undefined
          : Number(rawPageCount),
    });

    if (!req.file) {
      throw new ApiError("validation_error", "Missing file part 'file'");
    }

    // G9: scan uploads carry pre-extracted on-device OCR text in the body.
    // Server skips the parsePdf step (text already provided) but still
    // hashes the image bytes so idempotent ingest (FR-023) keeps working.
    if (sourceType === "scan" && (!ocrText || ocrText.trim().length === 0)) {
      throw new ApiError(
        "validation_error",
        "scan uploads require non-empty 'ocrText'",
      );
    }

    await assertCaseOwned(caseId, userId);

    const stored = await putBytes(req.file.buffer);

    // Idempotent ingest (FR-023): if a file with the same SHA already exists
    // for this case, return the existing row.
    const existing = await db
      .select()
      .from(caseFiles)
      .where(
        and(eq(caseFiles.caseId, caseId), eq(caseFiles.sha256, stored.sha256)),
      )
      .limit(1);

    if (existing.length) {
      res.status(201).json(serializeFile(existing[0]!));
      return;
    }

    const inserted = await db
      .insert(caseFiles)
      .values({
        caseId,
        sourceType,
        name: req.file.originalname || "untitled",
        mime: req.file.mimetype || "application/octet-stream",
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        // Persist the on-device OCR text for scan uploads so parsePdf can
        // serve it without re-parsing. pageCount is informational metadata
        // currently surfaced only to the client; we don't denormalize it
        // into a column yet.
        ...(sourceType === "scan" && ocrText ? { ocrText } : {}),
      })
      .returning();
    void pageCount;

    res.status(201).json(serializeFile(inserted[0]!));
  } catch (err) {
    next(err);
  }
});

// R-07 Drive file ingest — streams ingest progress as SSE.
router.post("/:caseId/files/from-drive", async (req, res, next) => {
  try {
    const { caseId } = IngestDriveFileParams.parse(req.params);
    const { driveFileId } = IngestDriveFileBody.parse(req.body ?? {});
    const userId = req.demoUser!.id;
    await assertCaseOwned(caseId, userId);

    const channel = openIngestSse(res);
    // Fire-and-forget: the engine catches its own per-file errors and ends
    // the stream. The trailing `.catch` guards against unforeseen rejections
    // (DB connection loss, etc.) so they don't bubble up as
    // unhandledRejection and crash the process.
    ingestDriveFile({ userId, caseId, driveFileId, channel }).catch((err) => {
      req.log?.error({ err }, "from-drive ingest crashed");
      try {
        channel.emit({ type: "error", message: "Internal ingest error" });
        channel.emit({ type: "done" });
        channel.end();
      } catch {
        /* socket already closed */
      }
    });
  } catch (err) {
    next(err);
  }
});

// R-08 Drive folder ingest — recursively walks the folder, ingests each file.
router.post("/:caseId/files/from-folder", async (req, res, next) => {
  try {
    const { caseId } = IngestDriveFolderParams.parse(req.params);
    const { driveFolderId } = IngestDriveFolderBody.parse(req.body ?? {});
    const userId = req.demoUser!.id;
    await assertCaseOwned(caseId, userId);

    const channel = openIngestSse(res);
    ingestDriveFolder({ userId, caseId, driveFolderId, channel }).catch((err) => {
      req.log?.error({ err }, "from-folder ingest crashed");
      try {
        channel.emit({ type: "error", message: "Internal ingest error" });
        channel.emit({ type: "done" });
        channel.end();
      } catch {
        /* socket already closed */
      }
    });
  } catch (err) {
    next(err);
  }
});

// R-09 Get a case file (metadata + signed URL stub)
router.get("/:caseId/files/:fileId", async (req, res, next) => {
  try {
    const { caseId, fileId } = GetCaseFileParams.parse(req.params);
    const userId = req.demoUser!.id;

    await assertCaseOwned(caseId, userId);

    const rows = await db
      .select()
      .from(caseFiles)
      .where(and(eq(caseFiles.caseId, caseId), eq(caseFiles.id, fileId)))
      .limit(1);

    if (rows.length === 0) {
      throw new ApiError("not_found", "File not found");
    }

    const row = rows[0]!;
    const base = `${req.protocol}://${req.get("host") ?? "localhost"}`;
    // G3: the "signed" URL is just the content-addressed path; access is gated
    // by the storageRouter's requireDemoUser + ownership join (case_files →
    // cases.user_id). G6+ will replace this with HMAC-signed, time-bounded
    // URLs so unauthenticated clients (e.g. document viewers) can fetch.
    const signedUrl = `${base}/api/v1/files/storage/${encodeURIComponent(row.sha256 ?? "missing")}`;
    const signedUrlExpiresAt = new Date(Date.now() + 5 * 60_000);

    res.json({
      ...serializeFile(row),
      signedUrl,
      signedUrlExpiresAt: signedUrlExpiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// Serves the bytes referenced by the signedUrl emitted from R-09. Mounted
// alongside the file routes; ownership is enforced by joining case_files →
// cases on the demo user, so a foreign sha256 returns 404.
const storageRouter: IRouter = Router();
storageRouter.use(requireDemoUser);
storageRouter.get("/storage/:sha256", async (req, res, next) => {
  try {
    const sha256 = req.params["sha256"] ?? "";
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new ApiError("validation_error", "Invalid sha256");
    }
    const owned = await db
      .select({ id: caseFiles.id, mime: caseFiles.mime, name: caseFiles.name })
      .from(caseFiles)
      .innerJoin(cases, eq(caseFiles.caseId, cases.id))
      .where(
        and(
          eq(caseFiles.sha256, sha256),
          eq(cases.userId, req.demoUser!.id),
          isNull(cases.deletedAt),
        ),
      )
      .limit(1);
    if (owned.length === 0) throw new ApiError("not_found", "File not found");

    const filePath = path.join(storageRoot(), sha256.slice(0, 2), sha256);
    const stats = await stat(filePath).catch(() => null);
    if (!stats) throw new ApiError("not_found", "File bytes missing");

    res.setHeader("Content-Type", owned[0]!.mime ?? "application/octet-stream");
    res.setHeader("Content-Length", String(stats.size));
    res.setHeader("Cache-Control", "private, max-age=300");
    createReadStream(filePath).on("error", next).pipe(res);
  } catch (err) {
    next(err);
  }
});
export { storageRouter };

async function assertCaseOwned(caseId: string, userId: string): Promise<void> {
  const owned = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(eq(cases.id, caseId), eq(cases.userId, userId), isNull(cases.deletedAt)),
    )
    .limit(1);
  if (owned.length === 0) {
    throw new ApiError("not_found", "Case not found");
  }
}

export default router;
