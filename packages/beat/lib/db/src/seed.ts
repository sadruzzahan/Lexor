import { db } from "./index";
import { usersTable } from "./schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding Beat database...");

  // Enable pgvector extension
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("  ✓ pgvector extension enabled");
  } catch (err) {
    console.warn("  ⚠ pgvector not available (OK if not installed):", String(err).split("\n")[0]);
  }

  // Seed demo detective user
  const DEMO_ID = "demo_user_detective";
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, DEMO_ID));

  if (existing) {
    console.log("  ✓ demo_user_detective already exists");
  } else {
    await db.insert(usersTable).values({
      id: DEMO_ID,
      displayName: "Detective Demo",
      email: "detective@beat.local",
      tier: "agency",
    });
    console.log("  ✓ demo_user_detective seeded");
  }

  console.log("✅ Seed complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
