/**
 * One-shot CLI script: enables the pgvector extension before drizzle-kit
 * push/migrate runs. Scripts are exempt from the no-console rule that
 * applies to long-running server code; we still prefer stdout/stderr
 * directly so we don't pull in a logger dependency for a single-use tool.
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    process.stdout.write("[setup-pgvector] vector extension ready\n");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[setup-pgvector] failed: ${String(err)}\n`);
  process.exit(1);
});
