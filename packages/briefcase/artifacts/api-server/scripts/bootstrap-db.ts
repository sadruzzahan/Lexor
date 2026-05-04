/**
 * Bootstrap a fresh database for Briefcase: enables every Postgres extension
 * the schema relies on (currently `vector` / pgvector). Idempotent — safe to
 * re-run before `drizzle-kit push`.
 *
 * Run: pnpm --filter @workspace/api-server run db:bootstrap
 */
import { pool } from "@workspace/db";

const REQUIRED_EXTENSIONS = ["vector"] as const;

async function main(): Promise<void> {
  for (const ext of REQUIRED_EXTENSIONS) {
    // Identifier is from a fixed allowlist above — safe to interpolate.
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
    const { rows } = await pool.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = $1",
      [ext],
    );
    // eslint-disable-next-line no-console
    console.log(`[OK] extension ${ext} v${rows[0]?.extversion ?? "?"}`);
  }
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("bootstrap failed:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
