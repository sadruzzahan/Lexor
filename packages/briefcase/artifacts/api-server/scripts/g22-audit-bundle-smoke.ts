/**
 * G22 AuditBundle signature roundtrip smoke (NFR-E-008).
 *
 * Asserts:
 *   1. buildAuditBundle returns a zip + signature + manifest.
 *   2. verifyManifest accepts the produced manifest (HMAC roundtrip OK).
 *   3. verifyManifest rejects a tampered manifest (file hash flipped).
 *   4. verifyManifest rejects a manifest signed with a different keyId.
 *
 * Runs against any existing run row (uses the most recent completed run
 * if no RUN_ID is supplied via env). Skips gracefully when no run exists
 * yet so first-time CI doesn't fail.
 *
 *   pnpm --filter @workspace/api-server run smoke:g22
 */
import { db, runs } from "@workspace/db";
import { desc } from "drizzle-orm";
import { buildAuditBundle, verifyManifest } from "../src/engine/auditBundle";

async function main(): Promise<void> {
  const runId =
    process.env["RUN_ID"] ??
    (await db.select({ id: runs.id }).from(runs).orderBy(desc(runs.startedAt)).limit(1))[0]?.id;

  if (!runId) {
    console.log("[smoke:g22] no runs in DB yet — skipping (this is OK on a fresh checkout)");
    return;
  }

  console.log(`[smoke:g22] building audit bundle for run ${runId}…`);
  const bundle = await buildAuditBundle(runId);

  // (1) Basic shape
  if (!(bundle.zipBytes instanceof Uint8Array) || bundle.zipBytes.byteLength === 0) {
    throw new Error("audit zip is empty");
  }
  if (!bundle.signature || bundle.signature.length !== 64) {
    throw new Error(`signature looks wrong: ${bundle.signature}`);
  }
  console.log(
    `[smoke:g22] zip=${bundle.sizeBytes}B keyId=${bundle.signingKeyId} sig=${bundle.signature.slice(0, 12)}…`,
  );

  // (2) Roundtrip — the manifest as-built must verify against the
  // recorded keyId via HKDF re-derivation.
  if (!verifyManifest(bundle.manifest)) {
    throw new Error("verifyManifest rejected a freshly-built manifest");
  }
  console.log("[smoke:g22] roundtrip verify OK");

  // (3) Tamper detection — flip a single byte in any file hash and the
  // signature must no longer verify.
  const tampered = JSON.parse(JSON.stringify(bundle.manifest)) as Record<string, unknown>;
  const files = tampered["files"] as Record<string, string>;
  const fileNames = Object.keys(files);
  if (!fileNames.length) throw new Error("manifest has no files to tamper with");
  const first = fileNames[0]!;
  const original = files[first]!;
  files[first] = "0".repeat(original.length);
  if (verifyManifest(tampered)) {
    throw new Error("verifyManifest accepted a manifest with a flipped file hash");
  }
  console.log("[smoke:g22] tamper detection OK (flipped file hash rejected)");

  // (4) Wrong keyId — point the manifest at a non-existent quarter so
  // the HKDF derivation produces a different key. Signature must fail.
  files[first] = original; // restore the file hash first
  const wrongKey = JSON.parse(JSON.stringify(bundle.manifest)) as Record<string, unknown>;
  (wrongKey["signature"] as Record<string, unknown>)["keyId"] = "1999Q1";
  if (verifyManifest(wrongKey)) {
    throw new Error("verifyManifest accepted a manifest with a swapped keyId");
  }
  console.log("[smoke:g22] keyId rotation guard OK (mismatched keyId rejected)");

  console.log("[smoke:g22] ALL CHECKS PASSED ✓");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smoke:g22] FAILED:", err);
    process.exit(1);
  });
