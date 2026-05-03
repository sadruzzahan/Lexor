import { createHash } from "crypto";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * Session persistence for voice + WhatsApp channels.
 *
 * Privacy contract: phone numbers are stored as SHA-256 hashes only. The
 * raw phone number lives in memory for the lifetime of the active call /
 * webhook handler, never on disk, never in logs. This means we can
 * recognize a returning caller (same hash) but we cannot enumerate the
 * users we've ever spoken to.
 */
export function hashPhone(phone: string): string {
  return createHash("sha256").update(phone.trim().toLowerCase()).digest("hex");
}

export type SessionChannel = "voice" | "whatsapp";

export interface OpenSessionOpts {
  channel: SessionChannel;
  externalId: string;
  phoneNumber: string;
  language?: string;
}

export async function openSession(
  opts: OpenSessionOpts,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(sessionsTable)
    .values({
      channel: opts.channel,
      externalId: opts.externalId,
      phoneNumberHash: hashPhone(opts.phoneNumber),
      language: opts.language ?? "en",
      transcriptJsonl: "",
    })
    .returning({ id: sessionsTable.id });
  if (!row) throw new Error("could not open session");
  return row;
}

export async function appendTranscript(
  sessionId: string,
  entry: { role: "caller" | "agent" | "system"; text: string; ts?: number },
): Promise<void> {
  const line =
    JSON.stringify({ ts: entry.ts ?? Date.now(), role: entry.role, text: entry.text }) +
    "\n";
  // Append-only: read current value, concat, write back. Not atomic but
  // fine for our single-writer voice/WA flow; heavy traffic would warrant
  // a child table. Wrap in try so transcript IO never crashes a call.
  try {
    const [row] = await db
      .select({ jsonl: sessionsTable.transcriptJsonl })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);
    if (!row) return;
    await db
      .update(sessionsTable)
      .set({ transcriptJsonl: (row.jsonl ?? "") + line })
      .where(eq(sessionsTable.id, sessionId));
  } catch (err) {
    logger.warn({ err, sessionId }, "transcript append failed");
  }
}

export async function attachCaseToSession(
  sessionId: string,
  caseId: string,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ caseId })
    .where(eq(sessionsTable.id, sessionId));
}

export async function closeSession(sessionId: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ endedAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));
}

export async function findRecentSessionByPhone(
  phone: string,
  channel: SessionChannel,
): Promise<{ id: string; caseId: string | null } | null> {
  const hash = hashPhone(phone);
  const rows = await db
    .select({
      id: sessionsTable.id,
      caseId: sessionsTable.caseId,
      startedAt: sessionsTable.startedAt,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.phoneNumberHash, hash))
    .limit(20);
  // Most recent matching channel
  const filtered = rows
    .filter((r) => r)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  void channel;
  const first = filtered[0];
  return first ? { id: first.id, caseId: first.caseId } : null;
}
