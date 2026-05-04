/**
 * G14 Courtroom Mode routes — Live Objection Copilot.
 *
 *   R-30  POST   /v1/courtroom/sessions
 *   R-31  POST   /v1/courtroom/sessions/:sessionId/audio   (multipart audio chunk)
 *   R-32  GET    /v1/courtroom/sessions/:sessionId/events  (SSE — ObjectionEvent)
 *   R-33  POST   /v1/courtroom/sessions/:sessionId/end
 *
 * Privacy posture (FR-G14-PRIV):
 *   - Suggestions live in `engine/courtroomBus` (in-memory) and are
 *     dropped at end-of-session unless the session was created with
 *     `consentTranscript: true` AND the end call sets `saveTranscript: true`.
 *   - Audio chunks are NEVER persisted; they're handed straight to
 *     transcribeStream() and dropped.
 */
import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod";
import { db, courtroomSessions, objectionEvents, cases } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { ApiError } from "../lib/errors";
import { requireDemoUser } from "../middlewares/demoUser";
import {
  subscribeObjections,
  snapshotObjections,
  dropCourtroomSession,
  type ObjectionEventPayload,
} from "../engine";
import { processCourtroomChunk } from "../agents/defender/courtroomCopilot";
import type { Jurisdiction } from "../tools/objectionRulesLookup";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireDemoUser);

// 5 MB cap per chunk — MediaRecorder typically emits 8-32 KB/sec for
// opus, so this gives 60+ seconds of headroom per chunk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const CreateSessionInput = z.object({
  caseId: z.string().uuid().nullable().optional(),
  jurisdictionCountry: z.enum(["US", "UK", "IN"]).default("US"),
  consentTranscript: z.boolean().default(false),
});

async function loadOwnedSession(sessionId: string, userId: string) {
  const rows = await db
    .select()
    .from(courtroomSessions)
    .where(and(eq(courtroomSessions.id, sessionId), eq(courtroomSessions.userId, userId)))
    .limit(1);
  const s = rows[0];
  if (!s) throw new ApiError("not_found", "Courtroom session not found");
  return s;
}

router.post("/sessions", async (req, res, next) => {
  try {
    const body = CreateSessionInput.parse(req.body);
    const userId = req.demoUser!.id;

    if (body.caseId) {
      const owns = await db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, body.caseId), eq(cases.userId, userId), isNull(cases.deletedAt)))
        .limit(1);
      if (owns.length === 0) throw new ApiError("not_found", "Case not found");
    }

    const [row] = await db
      .insert(courtroomSessions)
      .values({
        userId,
        caseId: body.caseId ?? null,
        jurisdictionCountry: body.jurisdictionCountry,
        consentTranscript: body.consentTranscript,
        transport: "http_chunks",
      })
      .returning();

    res.status(201).json({
      id: row!.id,
      caseId: row!.caseId,
      jurisdictionCountry: row!.jurisdictionCountry,
      consentTranscript: Boolean(row!.consentTranscript),
      transport: row!.transport,
      startedAt: row!.startedAt,
    });
  } catch (err) {
    next(err);
  }
});

const SessionParams = z.object({ sessionId: z.string().uuid() });

const audioHandler: import("express").RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = SessionParams.parse(req.params);
    const session = await loadOwnedSession(sessionId, req.demoUser!.id);
    if (session.endedAt) {
      throw new ApiError("conflict", "Session already ended");
    }
    if (!req.file) {
      throw new ApiError("validation_error", "audio chunk missing (multipart field 'audio')");
    }

    // Fire-and-forget per spec: return 202 immediately so the client
    // MediaRecorder can keep streaming without waiting on the LLM.
    void processCourtroomChunk({
      sessionId,
      jurisdiction: session.jurisdictionCountry as Jurisdiction,
      consentTranscript: Boolean(session.consentTranscript),
      audio: req.file.buffer,
      mime: req.file.mimetype || "audio/webm",
      language: typeof req.body?.language === "string" ? req.body.language : undefined,
    }).catch((err) => {
      logger.warn({ err, sessionId }, "courtroom chunk processing failed");
    });

    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

const eventsHandler: import("express").RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = SessionParams.parse(req.params);
    await loadOwnedSession(sessionId, req.demoUser!.id);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 3000\n\n`);

    const sinceRaw = Number.parseInt(String(req.query.since ?? "-1"), 10);
    const since = Number.isFinite(sinceRaw) ? sinceRaw : -1;
    const sentSinceStart = new Set<number>();

    const writeEvent = (ev: ObjectionEventPayload) => {
      if (sentSinceStart.has(ev.idx)) return;
      sentSinceStart.add(ev.idx);
      res.write(
        `id: ${ev.idx}\nevent: objection_event\ndata: ${JSON.stringify(ev)}\n\n`,
      );
    };

    // Replay any buffered events past `since` (Courtroom buffer caps at 50).
    for (const ev of snapshotObjections(sessionId)) {
      if (ev.idx > since) writeEvent(ev);
    }

    const unsub = subscribeObjections(sessionId, writeEvent);

    const ka = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 25_000);

    req.on("close", () => {
      clearInterval(ka);
      unsub();
    });
  } catch (err) {
    next(err);
  }
};

const EndSessionInput = z.object({
  saveTranscript: z.boolean().default(false),
});

const endHandler: import("express").RequestHandler = async (req, res, next) => {
  try {
    const { sessionId } = SessionParams.parse(req.params);
    const session = await loadOwnedSession(sessionId, req.demoUser!.id);
    const body = EndSessionInput.parse(req.body ?? {});

    const buffered = snapshotObjections(sessionId);
    const wantsSave = body.saveTranscript && Boolean(session.consentTranscript);

    if (wantsSave && buffered.length > 0) {
      await db.insert(objectionEvents).values(
        buffered.map((ev) => ({
          sessionId,
          idx: ev.idx,
          transcript: ev.transcriptSnippet,
          suggestion: ev.suggestion,
          ruleCitation: { ruleKey: ev.ruleKey, label: ev.ruleLabel, citation: ev.citation, severity: ev.severity },
          capturedAt: new Date(ev.ts),
        })),
      );
    }

    await db
      .update(courtroomSessions)
      .set({ endedAt: new Date(), eventCount: buffered.length })
      .where(eq(courtroomSessions.id, sessionId));

    // Always drop the in-memory bus — privacy-by-default.
    dropCourtroomSession(sessionId);

    res.json({
      sessionId,
      eventCount: buffered.length,
      saved: wantsSave,
    });
  } catch (err) {
    next(err);
  }
};

// Canonical paths.
router.post("/sessions/:sessionId/audio", upload.single("audio"), audioHandler);
router.get("/sessions/:sessionId/events", eventsHandler);
router.post("/sessions/:sessionId/end", endHandler);

// Short-form aliases per spec: `/v1/courtroom/:sessionId/...` (no `/sessions/`).
// Express matches literal segments before `:param` patterns, so the canonical
// `/sessions/...` routes above still take precedence for `/sessions/...` URLs.
router.post("/:sessionId/audio", upload.single("audio"), audioHandler);
router.get("/:sessionId/events", eventsHandler);
router.post("/:sessionId/end", endHandler);

export default router;
