/**
 * G8 Drive ingest smoke test.
 *
 * Exercises the moving parts that don't require a real Google account:
 *   - AES-256-GCM round-trip via lib/crypto.
 *   - Drive ingest engine driven by an in-memory mock DriveClient.
 *   - SSE event sequencing through the ingest channel.
 *   - Dedupe-on-second-run via the (caseId, sha256) unique index.
 */
import { randomBytes } from "node:crypto";
import { db, cases, caseFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEMO_USER_ID } from "@workspace/db/demo";
import { encryptSecret, decryptSecret } from "../src/lib/crypto";
import {
  ingestDriveFile,
  ingestDriveFolder,
  type DriveClient,
} from "../src/ingest/driveIngest";
import type { IngestEventPayload, IngestSseChannel } from "../src/lib/ingestSse";

function captureChannel(): {
  channel: IngestSseChannel;
  events: Array<IngestEventPayload & { idx: number }>;
} {
  const events: Array<IngestEventPayload & { idx: number }> = [];
  let idx = 0;
  let closed = false;
  const channel: IngestSseChannel = {
    emit(p) {
      if (closed) return;
      events.push({ idx, ...p });
      idx += 1;
    },
    end() {
      closed = true;
    },
    get closed() {
      return closed;
    },
  };
  return { channel, events };
}

// Minimal valid PDF: blank single-page document. Anything pdf-parse accepts
// is fine; the smoke just asserts the pipeline doesn't crash on real bytes.
const TINY_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

async function main(): Promise<void> {
  // 1. Crypto round-trip.
  const original = `refresh-token-${randomBytes(8).toString("hex")}`;
  const enc = encryptSecret(original);
  const dec = decryptSecret(enc);
  if (dec !== original) throw new Error("crypto round-trip failed");
  console.log("✓ crypto round-trip");

  // 2. Spin up a temporary case for ingest.
  const [caseRow] = await db
    .insert(cases)
    .values({
      userId: DEMO_USER_ID,
      title: `g8-smoke-${Date.now()}`,
      rolePack: "defender",
    })
    .returning();
  if (!caseRow) throw new Error("failed to create case");
  const caseId = caseRow.id;
  console.log("✓ created case", caseId);

  // 3. Mock Drive client.
  const FILE_ID = "drive_file_smoke_1";
  const FOLDER_ID = "drive_folder_smoke_1";
  const mockClient: DriveClient = {
    async getFile(_uid, fileId) {
      return {
        id: fileId,
        name: "smoke.pdf",
        mimeType: "application/pdf",
        size: TINY_PDF.length,
        isFolder: false,
      };
    },
    async downloadFile() {
      return TINY_PDF;
    },
    async walkFolder() {
      return [
        {
          id: "folder_child_1",
          name: "child1.pdf",
          mimeType: "application/pdf",
          size: TINY_PDF.length,
          isFolder: false,
        },
      ];
    },
  };

  // 4. from-drive ingest.
  const a = captureChannel();
  await ingestDriveFile({
    userId: DEMO_USER_ID,
    caseId,
    driveFileId: FILE_ID,
    channel: a.channel,
    client: mockClient,
  });
  if (!a.channel.closed) throw new Error("channel not closed");
  if (a.events.at(-1)?.type !== "done") throw new Error("missing done");
  if (!a.events.some((e) => e.type === "file_ingested"))
    throw new Error("missing file_ingested");
  console.log("✓ from-drive ingest emitted", a.events.length, "events");

  // 5. Re-ingest is deduped.
  const b = captureChannel();
  await ingestDriveFile({
    userId: DEMO_USER_ID,
    caseId,
    driveFileId: FILE_ID,
    channel: b.channel,
    client: mockClient,
  });
  const dedup = b.events.find(
    (e) =>
      e.type === "file_ingested" &&
      typeof e.message === "string" &&
      e.message.includes("deduped"),
  );
  if (!dedup) throw new Error("dedupe path not exercised");
  console.log("✓ second ingest deduped on SHA-256");

  // 6. Folder ingest emits per-file progress + done.
  const c = captureChannel();
  await ingestDriveFolder({
    userId: DEMO_USER_ID,
    caseId,
    driveFolderId: FOLDER_ID,
    channel: c.channel,
    client: mockClient,
  });
  if (c.events.at(-1)?.type !== "done") throw new Error("folder: missing done");
  console.log("✓ from-folder ingest emitted", c.events.length, "events");

  // 7. Verify case_files row exists for the deduped file.
  const stored = await db
    .select()
    .from(caseFiles)
    .where(eq(caseFiles.caseId, caseId));
  if (stored.length < 1) throw new Error("expected at least 1 case_files row");
  console.log("✓ persisted", stored.length, "case_files rows");

  // 8. Cleanup.
  await db.delete(cases).where(eq(cases.id, caseId));
  console.log("✓ cleaned up case", caseId);
  console.log("\nALL G8 SMOKE CHECKS PASSED");
}

main().catch((err) => {
  console.error("G8 SMOKE FAILED:", err);
  process.exit(1);
});
