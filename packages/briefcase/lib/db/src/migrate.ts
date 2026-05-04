/**
 * Apply Drizzle migrations from `lib/db/migrations/` to the database
 * pointed at by `DATABASE_URL`. Run with:
 *   pnpm --filter @workspace/db run migrate
 *
 * Use this in dev. In production, Replit's Publish flow diffs and
 * applies the schema automatically — do not invoke this on prod.
 */
import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run migrations");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../migrations");

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  // eslint-disable-next-line no-console
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  // eslint-disable-next-line no-console
  console.log("[migrate] done");
  await pool.end();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed:", err);
  process.exit(1);
});
