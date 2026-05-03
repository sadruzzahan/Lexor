import { randomBytes } from "crypto";
import { db, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "../../lib/objectStorage";
import { sendSms } from "./twilioClient";
import { runPipeline } from "../pipeline";
import { pipelineQueue } from "../../lib/queue";
import { logger } from "../../lib/logger";

/**
 * Mid-call upload bridge.
 *
 * Flow when the Realtime agent invokes `take_letter_photo`:
 *   1. Server creates a placeholder case + presigned upload URL.
 *   2. Server texts a short URL to the caller — they tap, snap, upload.
 *   3. The voice tool returns a `pollKey` to the agent. The agent loops
 *      `wait_for_upload(pollKey)` (model-side polling) until we resolve.
 *   4. Once the file lands and finalize fires, the pipeline runs and the
 *      promise resolves with the caseId so the agent can read the letter.
 *
 * This module owns the in-memory map of pending upload tokens. It is
 * intentionally not persisted: a server restart cancels in-flight calls,
 * which is the correct behavior for an ephemeral phone session.
 */

interface PendingUpload {
  caseId: string;
  uploadURL: string;
  objectPath: string;
  /** Resolves once the case finalizes + pipeline completes. */
  promise: Promise<string>;
  resolve: (caseId: string) => void;
  reject: (err: Error) => void;
  createdAt: number;
}

const pending = new Map<string, PendingUpload>();
const PENDING_TTL_MS = 15 * 60 * 1000;

function newToken(): string {
  return randomBytes(8).toString("hex");
}

setInterval(() => {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [k, v] of pending) {
    if (v.createdAt < cutoff) {
      v.reject(new Error("upload window expired"));
      pending.delete(k);
    }
  }
}, 60 * 1000).unref();

/**
 * Build the public URL the caller will visit to upload their photo.
 * In production this points at the deployed lexor-web /upload page,
 * which already handles presigned PUT against object storage.
 */
function buildUploadPageUrl(token: string): string {
  // We embed the token in the URL hash — the upload page will POST a
  // create-case with that token so the server can wire the resulting
  // case id back to the right pending pickup.
  const hosts = (process.env.REPLIT_DOMAINS ?? "").split(",");
  const host = hosts.find((h) => h.trim().length > 0)?.trim();
  const base = host ? `https://${host}` : process.env.PUBLIC_BASE_URL ?? "";
  return `${base}/upload#voice=${token}`;
}

/**
 * Initiate the SMS upload bridge. Returns a token the agent will poll on.
 */
export async function startSmsUpload(opts: {
  toPhone: string;
  language: string;
}): Promise<{ token: string; smsSent: boolean }> {
  const storage = new ObjectStorageService();
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);

  const [row] = await db
    .insert(casesTable)
    .values({
      userId: null,
      language: opts.language,
      status: "queued",
      vertical: "other",
    })
    .returning({ id: casesTable.id });
  if (!row) throw new Error("could not create voice-bridge case");

  const token = newToken();
  let resolveFn!: (caseId: string) => void;
  let rejectFn!: (err: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  pending.set(token, {
    caseId: row.id,
    uploadURL,
    objectPath,
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    createdAt: Date.now(),
  });

  const link = buildUploadPageUrl(token);
  const body =
    opts.language === "es"
      ? `Lexor: toca aquí para enviar la foto de tu carta — ${link}`
      : `Lexor: tap to send the photo of your letter — ${link}`;
  let smsSent = false;
  try {
    const sid = await sendSms({ to: opts.toPhone, body });
    smsSent = Boolean(sid);
  } catch (err) {
    logger.warn({ err }, "sms send failed");
  }
  return { token, smsSent };
}

/**
 * Lookup helper used by the upload page when it sees `#voice=<token>`.
 * Returns null if the token is unknown or expired.
 */
export function getPendingUpload(token: string): {
  caseId: string;
  uploadURL: string;
  objectPath: string;
} | null {
  const p = pending.get(token);
  if (!p) return null;
  return { caseId: p.caseId, uploadURL: p.uploadURL, objectPath: p.objectPath };
}

/**
 * Marks the token's case as finalized and runs the pipeline to completion,
 * resolving the agent-side promise with the case id.
 */
export async function completeSmsUpload(
  token: string,
  finalize: { rawDocumentUrl: string; rawDocumentHash?: string },
): Promise<string> {
  const p = pending.get(token);
  if (!p) throw new Error("unknown upload token");
  await db
    .update(casesTable)
    .set({
      rawDocumentUrl: finalize.rawDocumentUrl,
      rawDocumentHash: finalize.rawDocumentHash ?? null,
      updatedAt: new Date(),
    })
    .where(eq(casesTable.id, p.caseId));

  pipelineQueue
    .enqueue(`pipeline:${p.caseId}`, () => runPipeline(p.caseId))
    .then(() => p.resolve(p.caseId))
    .catch((err) => p.reject(err instanceof Error ? err : new Error(String(err))));

  // The agent awaits this promise via wait_for_upload tool.
  return p.promise.then((caseId) => {
    pending.delete(token);
    return caseId;
  });
}

export function awaitUpload(token: string): Promise<string> {
  const p = pending.get(token);
  if (!p) return Promise.reject(new Error("unknown upload token"));
  return p.promise;
}
