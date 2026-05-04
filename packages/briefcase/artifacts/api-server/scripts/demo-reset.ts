/**
 * G11 — Demo reset script.
 *
 * Wipes runs (and, via ON DELETE CASCADE, run_events / artifacts /
 * citations / prep_items linked to those runs) for the canonical
 * "State v. Johnson" demo case, so each rehearsal of the 90-second
 * demo journey starts from a known clean slate.
 *
 * Does NOT delete the case row or its case_files — those are
 * re-created by `seed:state-v-johnson` and live across rehearsals.
 *
 * Run: pnpm --filter @workspace/api-server run demo:reset
 */
import { db, runs, cases } from "@workspace/db";
import { DEMO_USER_ID } from "@workspace/db/demo";
import { and, eq } from "drizzle-orm";

const CASE_ID = "00000000-0000-0000-0000-0000000a0001" as const;

async function main(): Promise<void> {
  // Defensive ownership check — the demo CASE_ID is hard-coded, but a
  // future schema change that drops the cascade or moves the case
  // shouldn't silently nuke another user's data.
  const ownership = await db
    .select({ id: cases.id, userId: cases.userId })
    .from(cases)
    .where(eq(cases.id, CASE_ID))
    .limit(1);

  if (ownership.length === 0) {
    console.log(
      `demo case ${CASE_ID} not found — nothing to reset (run seed:state-v-johnson first).`,
    );
    process.exit(0);
  }
  if (ownership[0]!.userId !== DEMO_USER_ID) {
    throw new Error(
      `refusing to reset: case ${CASE_ID} is owned by ${ownership[0]!.userId}, not the demo user`,
    );
  }

  const deleted = await db
    .delete(runs)
    .where(and(eq(runs.caseId, CASE_ID)))
    .returning({ id: runs.id });

  console.log(
    `demo:reset complete — wiped ${deleted.length} run(s) for case ${CASE_ID}.`,
  );
  console.log("(case row + case_files preserved; re-run seed to refresh PDFs)");
  process.exit(0);
}

main().catch((err) => {
  console.error("demo:reset failed:", err);
  process.exit(1);
});
