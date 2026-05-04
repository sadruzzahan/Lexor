import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { casesTable } from "@workspace/db/schema";
import { isNull, and, lt, sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  scheduleTestCaseCleanup();
});

// ── Scheduled cleanup: soft-delete orphaned test cases older than 24h ─────────

const TEST_TITLE_PATTERN = "^(E2E|@api|Capture pipeline|Audio-during-run)";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

async function purgeOldTestCases(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);
    const deleted = await db
      .update(casesTable)
      .set({ deletedAt: new Date() })
      .where(
        and(
          isNull(casesTable.deletedAt),
          lt(casesTable.createdAt, cutoff),
          sql`${casesTable.title} ~ ${TEST_TITLE_PATTERN}`,
        ),
      )
      .returning({ id: casesTable.id });
    if (deleted.length > 0) {
      logger.info({ count: deleted.length }, "Scheduled cleanup: soft-deleted orphaned test cases");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled cleanup: failed to purge test cases");
  }
}

function scheduleTestCaseCleanup(): void {
  // Run once 5 minutes after startup to catch stale cases from dev restarts
  setTimeout(() => { void purgeOldTestCases(); }, 5 * 60 * 1_000);
  // Then run every 24 hours
  setInterval(() => { void purgeOldTestCases(); }, CLEANUP_INTERVAL_MS);
}
