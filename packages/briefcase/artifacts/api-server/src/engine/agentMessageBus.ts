/**
 * G23 AgentMessageBus — NFR-E-014.
 *
 * Subagents post messages to other subagents (or broadcast `*`) during
 * a run. Two concerns:
 *
 * 1. **Wire** — emit a `agent_message` SSE event so the Glass Box can
 *    render the bus traffic in real-time.
 * 2. **Persistence** — append to `agent_messages` so the audit bundle
 *    + R-30 history can replay every message after the fact.
 *
 * R-24 (POST /v1/runs/:runId/messages) drives the *forced injection*
 * path used by the ReplayHarness to reproduce historical bus traffic
 * deterministically.
 *
 * Per-(runId, subagent) idx is allocated by max+1 inside a tiny
 * critical section per process. Concurrent inserts can collide; the
 * unique-on-(runId, idx) check raises and we retry with a fresh max.
 */
import { db, agentMessages } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface AgentBusMessage {
  id: string;
  runId: string;
  idx: number;
  from: string;
  to: string;
  body: Record<string, unknown>;
  createdAt: string;
}

type Listener = (msg: AgentBusMessage) => void | Promise<void>;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(runId: string, listener: Listener): () => void {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(runId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listeners.delete(runId);
  };
}

async function nextIdx(runId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number>`coalesce(max(${agentMessages.idx}), -1)` })
    .from(agentMessages)
    .where(eq(agentMessages.runId, runId));
  return (rows[0]?.max ?? -1) + 1;
}

export async function postMessage(args: {
  runId: string;
  from: string;
  to: string;
  body: Record<string, unknown>;
}): Promise<AgentBusMessage> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const idx = await nextIdx(args.runId);
    try {
      const [row] = await db
        .insert(agentMessages)
        .values({
          runId: args.runId,
          idx,
          fromAgent: args.from,
          toAgent: args.to,
          body: args.body,
        })
        .returning();
      if (!row) throw new Error("agent_messages insert returned nothing");
      const msg: AgentBusMessage = {
        id: row.id,
        runId: row.runId,
        idx: row.idx,
        from: row.fromAgent ?? args.from,
        to: row.toAgent ?? args.to,
        body: (row.body as Record<string, unknown>) ?? {},
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      };
      const set = listeners.get(args.runId);
      if (set) {
        for (const l of set) {
          try {
            await l(msg);
          } catch (err) {
            logger.warn({ err }, "agent message listener threw (continuing)");
          }
        }
      }
      return msg;
    } catch (err) {
      lastErr = err;
      // Likely the unique-on-(runId, idx) collision under concurrency.
      // Tiny backoff + retry with a fresh max.
      await new Promise((r) => setTimeout(r, 5 + attempt * 5));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("postMessage exhausted retries");
}

export async function listMessages(runId: string): Promise<AgentBusMessage[]> {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.runId, runId))
    .orderBy(agentMessages.idx);
  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    idx: r.idx,
    from: r.fromAgent ?? "?",
    to: r.toAgent ?? "?",
    body: (r.body as Record<string, unknown>) ?? {},
    createdAt: (r.createdAt ?? new Date()).toISOString(),
  }));
}
