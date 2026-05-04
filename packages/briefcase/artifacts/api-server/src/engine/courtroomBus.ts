/**
 * G14 CourtroomBus — per-session in-memory pub/sub for ObjectionEvent
 * delivery to the Hush-mode SSE channel.
 *
 * Why not reuse runHub? Courtroom sessions are NOT runs — they have no
 * `run_events` history, no Last-Event-ID resumption guarantees, and
 * (per the privacy contract) suggestions are ephemeral by default.
 * Keeping a separate bus avoids bleeding objection cues into the
 * audit-bundle pipeline.
 *
 * Lifecycle / privacy invariants:
 *   - `dropCourtroomSession(id)` is the explicit teardown — it nukes
 *     buffer + listeners and adds the id to a tombstone set.
 *   - Any `publishObjection` for a tombstoned session is a no-op (so
 *     in-flight async chunks that complete AFTER `/end` cannot
 *     re-introduce data into the live bus).
 *   - Tombstones expire after 10 min so memory does not grow forever.
 */
import { logger } from "../lib/logger";

export interface ObjectionEventPayload {
  idx: number;
  ts: number;
  ruleKey: string;
  ruleLabel: string;
  citation: string;
  severity: "info" | "warn" | "strong";
  /** Snippet of transcript that triggered the cue. May be redacted. */
  transcriptSnippet: string;
  /** Plain-English suggestion for the lawyer. <=140 chars. */
  suggestion: string;
}

type Listener = (ev: ObjectionEventPayload) => void;

interface Session {
  buffer: ObjectionEventPayload[];
  listeners: Set<Listener>;
  nextIdx: number;
}

const sessions = new Map<string, Session>();
const ended = new Map<string, number>(); // sessionId → tombstone-expires-at-ms
const TOMBSTONE_TTL_MS = 10 * 60 * 1000;

function gcTombstones(): void {
  const now = Date.now();
  for (const [id, exp] of ended) {
    if (exp <= now) ended.delete(id);
  }
}

function isEnded(sessionId: string): boolean {
  const exp = ended.get(sessionId);
  if (exp == null) return false;
  if (exp <= Date.now()) {
    ended.delete(sessionId);
    return false;
  }
  return true;
}

function getOrCreate(sessionId: string): Session | null {
  if (isEnded(sessionId)) return null;
  let s = sessions.get(sessionId);
  if (!s) {
    s = { buffer: [], listeners: new Set(), nextIdx: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

export function publishObjection(
  sessionId: string,
  ev: Omit<ObjectionEventPayload, "idx" | "ts">,
): ObjectionEventPayload | null {
  const s = getOrCreate(sessionId);
  if (!s) {
    logger.debug({ sessionId }, "courtroomBus: drop publish for ended session");
    return null;
  }
  const full: ObjectionEventPayload = {
    ...ev,
    idx: s.nextIdx++,
    ts: Date.now(),
  };
  s.buffer.push(full);
  // Trim buffer to last 50 events — Courtroom Mode never replays old
  // events the way runs do; this is a safety cap on memory.
  if (s.buffer.length > 50) s.buffer.splice(0, s.buffer.length - 50);
  for (const l of s.listeners) {
    try {
      l(full);
    } catch (err) {
      logger.warn({ err }, "courtroomBus listener threw");
    }
  }
  return full;
}

export function subscribeObjections(
  sessionId: string,
  listener: Listener,
): () => void {
  const s = getOrCreate(sessionId);
  if (!s) {
    // Session already ended — return a no-op unsubscribe so callers
    // don't have to special-case the race.
    return () => undefined;
  }
  s.listeners.add(listener);
  return () => {
    const cur = sessions.get(sessionId);
    if (!cur) return;
    cur.listeners.delete(listener);
    if (cur.listeners.size === 0 && cur.buffer.length === 0) {
      sessions.delete(sessionId);
    }
  };
}

export function snapshotObjections(sessionId: string): ObjectionEventPayload[] {
  return [...(sessions.get(sessionId)?.buffer ?? [])];
}

export function dropCourtroomSession(sessionId: string): void {
  sessions.delete(sessionId);
  gcTombstones();
  ended.set(sessionId, Date.now() + TOMBSTONE_TTL_MS);
}

export function activeCourtroomCount(): number {
  return sessions.size;
}

/** Test-only — clear all in-memory state. */
export function __resetCourtroomBus(): void {
  sessions.clear();
  ended.clear();
}
