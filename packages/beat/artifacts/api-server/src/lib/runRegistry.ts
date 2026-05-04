import type { DbSink } from "./dbSink.js";
import { db } from "@workspace/db";
import { runsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

interface ActiveRunEntry {
  controller: AbortController;
  sink: DbSink;
  caseId: string;
}

const activeRuns = new Map<string, ActiveRunEntry>();

export function registerRun(
  runId: string,
  caseId: string,
  controller: AbortController,
  sink: DbSink,
): void {
  activeRuns.set(runId, { controller, sink, caseId });
}

export function unregisterRun(runId: string): void {
  activeRuns.delete(runId);
}

export function getRunEntry(runId: string): ActiveRunEntry | undefined {
  return activeRuns.get(runId);
}

/** Returns the DbSink for the most recently started active run for a given case, or null. */
export function getActiveSinkForCase(caseId: string): DbSink | null {
  for (const entry of activeRuns.values()) {
    if (entry.caseId === caseId) return entry.sink;
  }
  return null;
}

/**
 * Returns the DbSink for any active run tied to a case.
 * Falls back to DB lookup when no in-memory entry is found
 * (e.g. after a restart where run was already persisted but not re-attached).
 */
export async function getOrResolveSinkForCase(caseId: string): Promise<DbSink | null> {
  const inMemory = getActiveSinkForCase(caseId);
  if (inMemory) return inMemory;

  try {
    const [latestRun] = await db
      .select({ id: runsTable.id, status: runsTable.status })
      .from(runsTable)
      .where(eq(runsTable.caseId, caseId))
      .orderBy(desc(runsTable.createdAt))
      .limit(1);
    if (
      latestRun &&
      (latestRun.status === "running" || latestRun.status === "pending")
    ) {
      return activeRuns.get(latestRun.id)?.sink ?? null;
    }
  } catch {
    // ignore — returning null is safe
  }
  return null;
}
