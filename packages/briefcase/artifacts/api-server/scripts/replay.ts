/**
 * G23 ReplayHarness CLI — walks every saved replay_cases row, executes
 * runReplay() against the persisted run_events history, and exits
 * non-zero on the first failure so it slots into CI as a regression
 * suite.
 *
 *   pnpm --filter @workspace/api-server run replay
 */
import { listReplayCases, runReplay } from "../src/engine";
import { logger } from "../src/lib/logger";

async function main(): Promise<number> {
  const cases = await listReplayCases();
  if (cases.length === 0) {
    logger.info("replay: no fixtures yet (run a demo-quality run first)");
    return 0;
  }
  let failed = 0;
  for (const c of cases) {
    const result = await runReplay(c.id);
    if (result.passed) {
      logger.info({ id: c.id, label: c.label }, "replay: PASS");
    } else {
      failed += 1;
      logger.error({ id: c.id, label: c.label, diff: result.diff.items }, "replay: FAIL");
    }
  }
  logger.info({ total: cases.length, failed }, "replay: complete");
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error({ err }, "replay: unhandled error");
    process.exit(2);
  });
