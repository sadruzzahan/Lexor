/**
 * Seed the Briefcase demo user + a deterministic sample case with two
 * pre-OCR'd case files so the real defender role pack has something to
 * chew on. The slug → UUID mapping lives in `@workspace/db/demo`.
 *
 * Idempotent — safe to re-run. The seeded MOCK case + files match the
 * deterministic UUIDs the API's MOCK literal route auto-creates, so the
 * `GET /v1/runs/MOCK/events` curl runs end-to-end through the real
 * orchestrator.
 *
 * Run: pnpm --filter @workspace/api-server run seed
 */
import { db, users, cases, caseFiles } from "@workspace/db";
import {
  DEMO_USER_DISPLAY_NAME,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_USER_SLUG,
} from "@workspace/db/demo";
import { sql } from "drizzle-orm";

const MOCK_CASE_ID = "00000000-0000-0000-0000-0000000000bb" as const;
const MOCK_FILE_OFFICER_ID = "00000000-0000-0000-0000-0000000000c1" as const;
const MOCK_FILE_WITNESS_ID = "00000000-0000-0000-0000-0000000000c2" as const;

const OFFICER_REPORT_OCR = `INCIDENT REPORT - OFFICER M. RIVERA, BADGE #4471
Cook County Sheriff's Office, Patrol Division
Case #2024-CR-89117

On August 12, 2024 at approximately 21:55 hours, I initiated a traffic
stop on a 2017 Honda Civic, Illinois plate ABC-1234, traveling
northbound on South Halsted Street near 79th Street. The vehicle was
observed weaving and failed to maintain its lane.

The driver, later identified as the defendant, was the sole occupant.
At 22:02 I detected what I believed to be the odor of cannabis emanating
from the vehicle. I asked the defendant to step out, which he did at
22:04. I requested consent to search the vehicle; the defendant declined.

At 22:14 I commenced a probable-cause search of the vehicle based on the
suspected odor. My body-worn camera was activated for the duration of
the search. Inside a closed gym bag on the rear seat I located a small
quantity of suspected cannabis, weighing approximately 14 grams.

At 22:38 the defendant was placed in the rear of patrol unit 217 and
transported to the 6th District station for booking. Chain of custody on
the suspected cannabis was maintained continuously from the search
through evidence intake at 23:21.

Submitted: M. Rivera 08/13/2024 01:14`;

const WITNESS_STATEMENT_OCR = `WRITTEN STATEMENT OF JANE DOE - 08/14/2024
Cook County Public Defender's Office, intake interview

My name is Jane Doe and I was a passenger in the front seat of the gray
Honda Civic on the night of August 12, 2024. We were pulled over near
79th and Halsted around 9:55 PM. I want to make clear there were two
people in that car, not one - me and the driver.

The officer kept us at the side of the road for a long time. He turned
his bodycam off when we first stopped - I saw the red light go off
before he came up to the driver's window. He didn't turn it back on
until much later, when he started searching the back seat.

He asked the driver if he could search and the driver said no, very
clearly. The officer stood there for several minutes and then said he
smelled marijuana - I didn't smell any marijuana the whole time we were
in the car that day.

The search of the back seat started around 10:25 PM, not 10:14. I know
because I was watching the clock on the dashboard. The officer pulled
out a black gym bag that I had never seen in the car before. I don't
know whose bag that was.

Signed: Jane Doe, 08/14/2024`;

async function main(): Promise<void> {
  // ---- demo user --------------------------------------------------------
  const userResult = await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      displayName: DEMO_USER_DISPLAY_NAME,
      email: DEMO_USER_EMAIL,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: sql`EXCLUDED.display_name`,
        email: sql`EXCLUDED.email`,
      },
    })
    .returning({ id: users.id, email: users.email });

  // eslint-disable-next-line no-console
  console.log(
    `seeded demo user: slug="${DEMO_USER_SLUG}" -> id=${userResult[0]?.id} email=${userResult[0]?.email}`,
  );

  // ---- sample defender case --------------------------------------------
  await db
    .insert(cases)
    .values({
      id: MOCK_CASE_ID,
      userId: DEMO_USER_ID,
      title: "People v. Doe — traffic stop suppression motion",
      description:
        "Cook County, IL. Defender preparing motion to suppress on warrantless vehicle search.",
      rolePack: "defender",
      status: "ready",
    })
    .onConflictDoUpdate({
      target: cases.id,
      set: {
        title: sql`EXCLUDED.title`,
        description: sql`EXCLUDED.description`,
        status: sql`EXCLUDED.status`,
      },
    });
  console.log(`seeded sample case: id=${MOCK_CASE_ID}`);

  // ---- two pre-OCR'd case files ----------------------------------------
  for (const file of [
    {
      id: MOCK_FILE_OFFICER_ID,
      name: "officer_report.txt",
      mime: "text/plain",
      ocrText: OFFICER_REPORT_OCR,
    },
    {
      id: MOCK_FILE_WITNESS_ID,
      name: "witness_statement.txt",
      mime: "text/plain",
      ocrText: WITNESS_STATEMENT_OCR,
    },
  ]) {
    await db
      .insert(caseFiles)
      .values({
        id: file.id,
        caseId: MOCK_CASE_ID,
        sourceType: "upload",
        name: file.name,
        mime: file.mime,
        sizeBytes: file.ocrText.length,
        ocrText: file.ocrText,
        detectedLanguage: "en",
      })
      .onConflictDoUpdate({
        target: caseFiles.id,
        set: {
          name: sql`EXCLUDED.name`,
          ocrText: sql`EXCLUDED.ocr_text`,
          detectedLanguage: sql`EXCLUDED.detected_language`,
        },
      });
    console.log(`seeded case_file: ${file.name} (${file.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("seed failed:", err);
  process.exit(1);
});
