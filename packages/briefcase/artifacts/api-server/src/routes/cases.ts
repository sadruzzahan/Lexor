import { Router, type IRouter } from "express";
import { db, cases, caseFiles, runs, artifacts as artifactsTable } from "@workspace/db";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  CreateCaseBody,
  ListCasesQueryParams,
  GetCaseParams,
  UpdateCaseParams,
  UpdateCaseBody,
  DeleteCaseParams,
} from "@workspace/api-zod";
import { ApiError } from "../lib/errors";
import { requireDemoUser } from "../middlewares/demoUser";

const router: IRouter = Router();

router.use(requireDemoUser);

// R-01 Create a case
router.post("/", async (req, res, next) => {
  try {
    const body = CreateCaseBody.parse(req.body);
    const inserted = await db
      .insert(cases)
      .values({
        userId: req.demoUser!.id,
        title: body.title,
        description: body.description,
        rolePack: body.rolePack,
        status: "created",
      })
      .returning();

    res.status(201).json(serializeCase(inserted[0]!));
  } catch (err) {
    next(err);
  }
});

// R-03 List cases (paginated, most-recent first)
router.get("/", async (req, res, next) => {
  try {
    const query = ListCasesQueryParams.parse(req.query);

    const userId = req.demoUser!.id;
    const conditions = [eq(cases.userId, userId), isNull(cases.deletedAt)];

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded) {
        // Deterministic tuple comparison: (updatedAt, id) < (cursorTs, cursorId).
        // Avoids skips/dupes when multiple cases share the same updatedAt.
        conditions.push(
          or(
            lt(cases.updatedAt, decoded.updatedAt),
            and(eq(cases.updatedAt, decoded.updatedAt), lt(cases.id, decoded.id)),
          )!,
        );
      }
    }

    const rows = await db
      .select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(desc(cases.updatedAt), desc(cases.id))
      .limit(query.limit + 1);

    const items = rows.slice(0, query.limit).map(serializeCase);
    const nextCursor =
      rows.length > query.limit
        ? encodeCursor(rows[query.limit - 1]!.updatedAt, rows[query.limit - 1]!.id)
        : undefined;

    res.json({ items, ...(nextCursor ? { nextCursor } : {}) });
  } catch (err) {
    next(err);
  }
});

// R-02 Get a case (with files, latestRun, latest artifacts)
router.get("/:caseId", async (req, res, next) => {
  try {
    const { caseId } = GetCaseParams.parse(req.params);
    const userId = req.demoUser!.id;

    const caseRows = await db
      .select()
      .from(cases)
      .where(
        and(eq(cases.id, caseId), eq(cases.userId, userId), isNull(cases.deletedAt)),
      )
      .limit(1);

    if (caseRows.length === 0) {
      throw new ApiError("not_found", "Case not found");
    }

    const caseRow = caseRows[0]!;

    const [files, latestRunRows, artifactRows] = await Promise.all([
      db
        .select()
        .from(caseFiles)
        .where(eq(caseFiles.caseId, caseId))
        .orderBy(asc(caseFiles.createdAt)),
      db
        .select()
        .from(runs)
        .where(eq(runs.caseId, caseId))
        // Order by startedAt DESC NULLS FIRST so a freshly-created `pending`
        // run (startedAt=NULL) surfaces above older started/completed runs.
        // Active-run uniqueness in start-run guarantees at most one
        // pending/running per case, so no further tiebreaker is needed.
        .orderBy(sql`${runs.startedAt} DESC NULLS FIRST`)
        .limit(1),
      db
        .select()
        .from(artifactsTable)
        .innerJoin(runs, eq(artifactsTable.runId, runs.id))
        .where(eq(runs.caseId, caseId))
        .orderBy(desc(artifactsTable.createdAt))
        .limit(20),
    ]);

    res.json({
      case: serializeCase(caseRow),
      files: files.map(serializeFile),
      ...(latestRunRows.length ? { latestRun: serializeRun(latestRunRows[0]!) } : {}),
      artifacts: artifactRows.map((row) => serializeArtifact(row.artifacts)),
    });
  } catch (err) {
    next(err);
  }
});

// R-04 Update (rename) a case
router.patch("/:caseId", async (req, res, next) => {
  try {
    const { caseId } = UpdateCaseParams.parse(req.params);
    const body = UpdateCaseBody.parse(req.body);
    const userId = req.demoUser!.id;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updates["title"] = body.title;
    if (body.description !== undefined) updates["description"] = body.description;

    const updated = await db
      .update(cases)
      .set(updates)
      .where(
        and(eq(cases.id, caseId), eq(cases.userId, userId), isNull(cases.deletedAt)),
      )
      .returning();

    if (updated.length === 0) {
      throw new ApiError("not_found", "Case not found");
    }

    res.json(serializeCase(updated[0]!));
  } catch (err) {
    next(err);
  }
});

// R-05 Soft-delete a case
router.delete("/:caseId", async (req, res, next) => {
  try {
    const { caseId } = DeleteCaseParams.parse(req.params);
    const userId = req.demoUser!.id;

    const updated = await db
      .update(cases)
      .set({ deletedAt: new Date(), status: "deleted" })
      .where(
        and(eq(cases.id, caseId), eq(cases.userId, userId), isNull(cases.deletedAt)),
      )
      .returning({ id: cases.id });

    if (updated.length === 0) {
      throw new ApiError("not_found", "Case not found");
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

function serializeCase(row: typeof cases.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    rolePack: row.rolePack as "defender" | "detective",
    ...(row.jurisdictionContext
      ? { jurisdictionContext: row.jurisdictionContext as Record<string, unknown> }
      : {}),
    ...(row.language ? { language: row.language } : {}),
    status: row.status as
      | "created"
      | "ingesting"
      | "ready"
      | "running"
      | "prepared"
      | "error"
      | "deleted",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeFile(row: typeof caseFiles.$inferSelect) {
  // The CaseFile contract requires sha256 to be a 64-char hex digest; rather
  // than emit a contract-violating empty string for any legacy/null row, fall
  // back to a deterministic zero-digest sentinel so downstream clients can
  // detect "digest not yet computed" without a schema mismatch.
  const sha256 =
    row.sha256 && row.sha256.length === 64 ? row.sha256 : "0".repeat(64);
  return {
    id: row.id,
    caseId: row.caseId,
    sourceType: row.sourceType as "upload" | "drive" | "scan" | "audio",
    ...(row.driveFileId ? { driveFileId: row.driveFileId } : {}),
    name: row.name,
    mime: row.mime ?? "application/octet-stream",
    sizeBytes: Number(row.sizeBytes ?? 0),
    sha256,
    ...(row.detectedLanguage ? { detectedLanguage: row.detectedLanguage } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeRun(row: typeof runs.$inferSelect) {
  return {
    id: row.id,
    caseId: row.caseId,
    rolePack: row.rolePack as "defender" | "detective",
    goal: row.goal ?? "",
    status: row.status as
      | "pending"
      | "running"
      | "completed"
      | "cancelled"
      | "error",
    cancelled: row.cancelled,
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    ...(row.branchedAtIdx != null ? { branchedAtIdx: row.branchedAtIdx } : {}),
  };
}

function serializeArtifact(row: typeof artifactsTable.$inferSelect) {
  return {
    id: row.id,
    runId: row.runId,
    subagent: row.subagent,
    kind: row.kind,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep === -1) return null;
    const iso = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || !id) return null;
    return { updatedAt: d, id };
  } catch {
    return null;
  }
}

export default router;
