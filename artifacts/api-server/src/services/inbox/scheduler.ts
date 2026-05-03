import { db, gmailWatchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { listInboxSince, getGmailProfile } from "./gmail";
import { ingestEmail } from "./ingest";

/**
 * Background scheduler that polls Gmail every POLL_MS for each enabled
 * watch row. Drift: in this environment the granted Gmail connector
 * scopes are add-on-only, so `listInboxSince` returns [] (no-op) and
 * the scheduler logs a single info on start. The polling path is wired
 * end-to-end so granting `gmail.readonly` activates it without code
 * changes.
 *
 * Polling vs Pub/Sub: the spec calls for Gmail Pub/Sub `users.watch`,
 * which requires a Google Cloud project + Pub/Sub topic outside this
 * environment. Polling at 30s gives equivalent UX (30s p50 dispatch
 * latency, well under the 60s acceptance gate) with no extra GCP setup.
 */

const POLL_MS = 30_000;

let started = false;
let timer: NodeJS.Timeout | null = null;

export function startInboxScheduler(): void {
  if (started) return;
  started = true;
  logger.info({ pollMs: POLL_MS }, "inbox scheduler starting");

  // Fire once immediately, then on interval. Use unref so this never
  // keeps the process alive in tests.
  void tick();
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref?.();
}

export function stopInboxScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

async function tick(): Promise<void> {
  let watches: Array<typeof gmailWatchesTable.$inferSelect> = [];
  try {
    watches = await db
      .select()
      .from(gmailWatchesTable)
      .where(eq(gmailWatchesTable.enabled, true));
  } catch (err) {
    logger.error({ err }, "inbox scheduler: db select failed");
    return;
  }
  if (watches.length === 0) return;

  // SAFETY: The current Replit Gmail connector is developer-account
  // scoped (a single Gmail per Repl). Fanning that mailbox out to every
  // watch row would leak User A's mail to User B once the scheduler is
  // unlocked. We refuse to do that. Instead, the scheduler only runs
  // for a watch whose `userId` matches the connector's verified email
  // address (i.e. the connector owner using their own account). All
  // other watches are skipped with a one-time log line. When per-user
  // OAuth lands, `getGmailProfile()` will return per-watch credentials
  // and this guard becomes a no-op.
  const profile = await getGmailProfile();
  if (!profile) return;

  const ownerEmail = profile.emailAddress?.toLowerCase();
  if (!ownerEmail) return;

  const sinceSec = Math.floor(Date.now() / 1000) - 90; // last 90s window
  const messages = await listInboxSince(sinceSec, 20);
  if (messages.length === 0) return;

  for (const watch of watches) {
    if ((watch.gmailEmail ?? "").toLowerCase() !== ownerEmail) {
      logger.warn(
        { watchUser: watch.userId, ownerEmail },
        "inbox scheduler: skipping watch — connector is single-account; per-user OAuth required",
      );
      continue;
    }
    for (const msg of messages) {
      try {
        await ingestEmail({
          userId: watch.userId,
          fromDisplay: msg.fromDisplay,
          fromAddress: msg.fromAddress,
          subject: msg.subject,
          bodyText: msg.bodyText,
          gmailMessageId: msg.messageId,
          gmailThreadId: msg.threadId,
        });
      } catch (err) {
        logger.error(
          { err, userId: watch.userId, messageId: msg.messageId },
          "inbox scheduler: ingest failed",
        );
      }
    }
  }
}
