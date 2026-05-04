/**
 * DB smoke test — opens the Drizzle client, counts rows in every Briefcase
 * table, and prints `[OK] table — N rows` / `[FAIL] table — error`.
 * Exits non-zero on any failure.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/db-smoke.ts
 */
import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

const tables: Array<[string, PgTable]> = Object.entries(schema)
  .filter(
    (entry): entry is [string, PgTable] =>
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      Symbol.for("drizzle:Name") in (entry[1] as object),
  )
  .sort(([a], [b]) => a.localeCompare(b));

let failed = 0;

for (const [exportName, table] of tables) {
  try {
    const rows = await db
      .select({ n: sql<string>`count(*)` })
      .from(table);
    const n = rows[0]?.n ?? "0";
    // eslint-disable-next-line no-console
    console.log(`[OK  ] ${exportName} — ${n} rows`);
  } catch (err) {
    failed++;
    const detail = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.log(`[FAIL] ${exportName} — ${detail}`);
  }
}

// eslint-disable-next-line no-console
console.log(`\n${tables.length} tables checked, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
