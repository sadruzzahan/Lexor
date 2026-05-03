import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { ObjectStorageService } from "../../lib/objectStorage";
import { runPipeline } from "../pipeline";
import { pipelineQueue } from "../../lib/queue";
import {
  openSession,
  appendTranscript,
  attachCaseToSession,
} from "../voice/session";
import { transcribeAudio } from "./whisper";

/**
 * Handle a single Twilio WhatsApp inbound webhook payload. The handler is
 * synchronous up to "case created", then async pipeline + outbound reply
 * happen in the background via the pipeline queue.
 *
 * Returns the empty TwiML response string to satisfy Twilio. Any reply we
 * want to send back to WhatsApp is sent through the REST API after the
 * pipeline completes (TwiML can only send one immediate message and we
 * want the explainer + PDF together).
 */
export interface WaInboundPayload {
  From: string; // "whatsapp:+14155552671"
  To?: string;
  MessageSid: string;
  Body?: string;
  NumMedia?: string;
  /**
   * Twilio appends MediaUrl0..N and MediaContentType0..N for media items.
   * We expose them as a parsed array.
   */
  media: Array<{ url: string; contentType: string }>;
}

export function parseInboundPayload(
  body: Record<string, string | undefined>,
): WaInboundPayload {
  const numMedia = Number(body.NumMedia ?? "0") || 0;
  const media: Array<{ url: string; contentType: string }> = [];
  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`];
    const ct = body[`MediaContentType${i}`];
    if (url && ct) media.push({ url, contentType: ct });
  }
  return {
    From: body.From ?? "",
    To: body.To,
    MessageSid: body.MessageSid ?? `unknown-${Date.now()}`,
    Body: body.Body,
    NumMedia: body.NumMedia,
    media,
  };
}

async function fetchTwilioMedia(url: string): Promise<Buffer | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) {
      logger.warn({ status: res.status, url }, "twilio media fetch failed");
      return null;
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch (err) {
    logger.warn({ err, url }, "twilio media fetch threw");
    return null;
  }
}

/**
 * Process one inbound WA webhook. Returns the caseId once a pipeline run
 * has been kicked off, or null if no actionable content was found (caller
 * sent a sticker, an empty message, etc.).
 *
 * Calls `onComplete(caseId)` once the pipeline finishes so the route can
 * push the explainer + PDF back over WhatsApp REST.
 */
export async function handleWhatsAppInbound(
  payload: WaInboundPayload,
  hooks: {
    onComplete: (caseId: string, fromPhone: string) => Promise<void>;
  },
): Promise<{ caseId: string | null; sessionId: string }> {
  const fromPhone = payload.From.replace(/^whatsapp:/, "");
  const session = await openSession({
    channel: "whatsapp",
    externalId: payload.MessageSid,
    phoneNumber: fromPhone,
    language: "en",
  });
  if (payload.Body) {
    await appendTranscript(session.id, {
      role: "caller",
      text: payload.Body,
    });
  }

  // Resolve the inbound content into "letter text" — either pasted text,
  // an uploaded image/PDF, or a transcribed voice note.
  let inlineText: string | null = null;
  let imageBytes: { buffer: Buffer; contentType: string } | null = null;

  if (payload.media.length > 0) {
    const m = payload.media[0]!;
    const buf = await fetchTwilioMedia(m.url);
    if (!buf) {
      return { caseId: null, sessionId: session.id };
    }
    if (m.contentType.startsWith("audio/")) {
      const text = await transcribeAudio(buf, "voicenote.ogg");
      if (!text) return { caseId: null, sessionId: session.id };
      inlineText = text;
      await appendTranscript(session.id, { role: "caller", text });
    } else if (
      m.contentType === "application/pdf" ||
      m.contentType.startsWith("image/")
    ) {
      imageBytes = { buffer: buf, contentType: m.contentType };
    } else {
      // Unsupported media type
      return { caseId: null, sessionId: session.id };
    }
  } else if (payload.Body && payload.Body.trim().length >= 20) {
    inlineText = payload.Body;
  } else {
    return { caseId: null, sessionId: session.id };
  }

  // Create the case row.
  let rawDocumentUrl: string;
  if (imageBytes) {
    const storage = new ObjectStorageService();
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    // PUT the bytes into the presigned URL.
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": imageBytes.contentType },
      body: new Uint8Array(imageBytes.buffer),
    });
    if (!putRes.ok) {
      logger.warn({ status: putRes.status }, "wa media upload failed");
      return { caseId: null, sessionId: session.id };
    }
    rawDocumentUrl = objectPath;
  } else {
    const enc = Buffer.from(inlineText ?? "", "utf8").toString("base64");
    rawDocumentUrl = `/text/${enc}`;
  }

  const [row] = await db
    .insert(casesTable)
    .values({
      userId: null,
      language: "en",
      status: "queued",
      vertical: "other",
      rawDocumentUrl,
    })
    .returning({ id: casesTable.id });
  if (!row) return { caseId: null, sessionId: session.id };

  await attachCaseToSession(session.id, row.id);

  pipelineQueue
    .enqueue(`pipeline:${row.id}`, () => runPipeline(row.id))
    .then(() => hooks.onComplete(row.id, fromPhone))
    .catch((err) => logger.error({ err, caseId: row.id }, "wa pipeline failed"));

  return { caseId: row.id, sessionId: session.id };
}
