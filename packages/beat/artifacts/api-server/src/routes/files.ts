import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { casesTable, caseFilesTable, chainOfCustodyTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { autoTagPhoto, transcribeAudio } from "../lib/aiClients.js";
import { getActiveSinkForCase } from "../lib/runRegistry.js";
import { objectStorageClient } from "../lib/objectStorage.js";
import ExifReader from "exifreader";
import { requireAuth } from "./auth.js";

type AuthedRequest = Request & { userId: string };

// GCS bucket ID from env
function getBucketId(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  return id;
}

async function uploadToGcs(
  bytes: Buffer,
  mimeType: string,
  ext: string,
): Promise<string> {
  const objectName = `beat-files/${randomUUID()}${ext}`;
  const bucket = objectStorageClient.bucket(getBucketId());
  const file = bucket.file(objectName);
  await file.save(bytes, { contentType: mimeType, resumable: false });
  return objectName;
}

async function streamFromGcs(objectName: string, mimeType: string, res: import("express").Response): Promise<void> {
  const bucket = objectStorageClient.bucket(getBucketId());
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).json({ error: "File data not found in storage" });
    return;
  }
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  const stream = file.createReadStream();
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).json({ error: "Stream error" });
  });
  stream.pipe(res);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router: IRouter = Router();

const VALID_SOURCE_TYPES = ["photo", "audio", "note", "scan", "upload", "drive"] as const;
type SourceType = typeof VALID_SOURCE_TYPES[number];

/**
 * Verify the case exists, is not deleted, and belongs to the authenticated user.
 */
async function assertCaseOwnership(
  caseId: string,
  userId: string,
  res: import("express").Response,
): Promise<typeof casesTable.$inferSelect | null> {
  const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!caseRow || caseRow.deletedAt) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  if (!caseRow.userId || caseRow.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return caseRow;
}

// ── GET /v1/cases/:caseId/files ────────────────────────────────────────────────

router.get("/v1/cases/:caseId/files", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;
    const rawSourceType = req.query.sourceType as string | undefined;
    let query = db.select().from(caseFilesTable).where(eq(caseFilesTable.caseId, caseId));
    if (rawSourceType && VALID_SOURCE_TYPES.includes(rawSourceType as SourceType)) {
      query = db
        .select()
        .from(caseFilesTable)
        .where(
          and(
            eq(caseFilesTable.caseId, caseId),
            eq(caseFilesTable.sourceType, rawSourceType as SourceType),
          ),
        );
    }
    const files = await query;
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: "Failed to list files", details: String(err) });
  }
});

// ── POST /v1/cases/:caseId/files ───────────────────────────────────────────────

router.post("/v1/cases/:caseId/files", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const fileBytes = req.file.buffer;

    const sha256 = createHash("sha256").update(fileBytes).digest("hex");
    const [existing] = await db
      .select()
      .from(caseFilesTable)
      .where(and(eq(caseFilesTable.caseId, caseId), eq(caseFilesTable.sha256, sha256)));
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    const rawSourceType = req.body.sourceType as string | undefined;
    const sourceType: SourceType = rawSourceType && VALID_SOURCE_TYPES.includes(rawSourceType as SourceType)
      ? (rawSourceType as SourceType)
      : "upload";

    let capturedAt: Date | null = null;
    let gps: { lat: number; lng: number } | null = null;
    if (sourceType === "photo") {
      try {
        const tags = ExifReader.load(fileBytes, { expanded: true });
        const gpsTag = tags.gps;
        if (gpsTag?.Latitude != null && gpsTag?.Longitude != null) {
          gps = { lat: Number(gpsTag.Latitude), lng: Number(gpsTag.Longitude) };
        }
        const exifTags = tags.exif;
        const dtOrig = exifTags?.DateTimeOriginal?.description ?? exifTags?.DateTime?.description;
        if (dtOrig) {
          const normalized = String(dtOrig).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
          const d = new Date(normalized);
          if (!isNaN(d.getTime())) capturedAt = d;
        }
      } catch {
        // EXIF extraction is best-effort
      }
    }

    const ext = req.file.originalname.includes(".")
      ? "." + req.file.originalname.split(".").pop()!
      : "";
    const storageUrl = await uploadToGcs(fileBytes, req.file.mimetype, ext);

    const [created] = await db.insert(caseFilesTable).values({
      caseId,
      sourceType,
      filename: storageUrl.split("/").pop()!,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sha256,
      sizeBytes: req.file.size,
      storageUrl,
      caption: req.body.caption ?? null,
      capturedAt: capturedAt ?? undefined,
      gps: gps ? (gps as unknown as Record<string, unknown>) : undefined,
    }).returning();

    await db.insert(chainOfCustodyTable).values({
      fileId: created.id,
      eventType: "captured",
      actor: "user",
      sha256,
    }).catch(() => {});

    res.status(201).json(created);

    if (sourceType === "photo") {
      const goal = caseRow.goal ?? undefined;
      const mimeType = req.file.mimetype;
      const fileId = created.id;
      const capturedCaseId = caseId;
      const capturedFilename = req.file.originalname;
      const bytesSnap = fileBytes;
      setImmediate(async () => {
        try {
          const activeSink = getActiveSinkForCase(capturedCaseId);
          activeSink?.emit("tool_call", {
            subagent: "SceneCaptureTagger",
            tool: { name: "autoTagCapturedPhoto", args: { fileId, filename: capturedFilename } },
          });
          const result = await autoTagPhoto(bytesSnap, mimeType, goal);
          if (result) {
            await db
              .update(caseFilesTable)
              .set({ caption: result.caption, autoTagJson: result as unknown as Record<string, unknown> })
              .where(eq(caseFilesTable.id, fileId));
            activeSink?.emit("partial_result", {
              subagent: "SceneCaptureTagger",
              data: { text: `[captured photo] ${result.caption} — tags: ${result.tags.join(", ")}`, fileId, tags: result.tags },
            });
            activeSink?.emit("tool_result", {
              subagent: "SceneCaptureTagger",
              tool: { name: "autoTagCapturedPhoto", result: { fileId, caption: result.caption, tags: result.tags } },
            });
          }
        } catch (e) {
          console.error("[autoTagPhoto] background error:", e);
        }
      });
    }

    if (sourceType === "audio") {
      const mimeType = req.file.mimetype;
      const originalName = req.file.originalname;
      const fileId = created.id;
      const bytesSnap = fileBytes;
      const capturedCaseId = caseId;
      setImmediate(async () => {
        try {
          const activeSink = getActiveSinkForCase(capturedCaseId);
          activeSink?.emit("tool_call", {
            subagent: "WitnessMapper",
            tool: { name: "transcribeCapturedAudio", args: { fileId, filename: originalName } },
          });
          const transcript = await transcribeAudio(bytesSnap, originalName, mimeType);
          if (transcript !== null) {
            await db.update(caseFilesTable).set({ transcript }).where(eq(caseFilesTable.id, fileId));
            activeSink?.emit("partial_result", {
              subagent: "WitnessMapper",
              data: { text: transcript, fileId, source: "audio_capture" },
            });
            activeSink?.emit("tool_result", {
              subagent: "WitnessMapper",
              tool: { name: "transcribeCapturedAudio", result: { fileId, transcriptLength: transcript.length } },
            });
          }
        } catch (e) {
          console.error("[transcribeAudio] background error:", e);
        }
      });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to upload file", details: String(err) });
  }
});

// ── GET /v1/cases/:caseId/files/:fileId ───────────────────────────────────────

router.get("/v1/cases/:caseId/files/:fileId", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const fileId = String(req.params.fileId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;
    const [file] = await db.select().from(caseFilesTable).where(eq(caseFilesTable.id, fileId));
    if (!file || file.caseId !== caseId) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: "Failed to get file", details: String(err) });
  }
});

// ── GET /v1/cases/:caseId/files/:fileId/content ───────────────────────────────

router.get("/v1/cases/:caseId/files/:fileId/content", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const fileId = String(req.params.fileId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;
    const [file] = await db.select().from(caseFilesTable).where(eq(caseFilesTable.id, fileId));
    if (!file || file.caseId !== caseId) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    await streamFromGcs(file.storageUrl, file.mimeType, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve file", details: String(err) });
  }
});

// ── DELETE /v1/cases/:caseId/files/:fileId ────────────────────────────────────

router.delete("/v1/cases/:caseId/files/:fileId", requireAuth, async (req, res): Promise<void> => {
  try {
    const caseId = String(req.params.caseId);
    const fileId = String(req.params.fileId);
    const userId = (req as AuthedRequest).userId;
    const caseRow = await assertCaseOwnership(caseId, userId, res);
    if (!caseRow) return;
    const [file] = await db.select().from(caseFilesTable).where(eq(caseFilesTable.id, fileId));
    if (!file || file.caseId !== caseId) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    await db.delete(caseFilesTable).where(eq(caseFilesTable.id, fileId));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete file", details: String(err) });
  }
});

export default router;
