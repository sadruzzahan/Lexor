/**
 * AuditBundle (G22 spec §9.7.B NFR-E-008) — package every artefact of
 * a run into a signed zip so the lawyer can hand a complete provenance
 * record to opposing counsel / a court.
 *
 * Contents (one entry per file):
 *   - manifest.json — bundle metadata + signature info
 *   - events.json — full agent_event stream
 *   - artifacts.json — final subagent artifacts
 *   - citations.json — verified citations
 *   - cost-ledger.json — agent_costs snapshot
 *   - model-decisions.json — model_routing_decisions for the run
 *   - prompts.json — placeholder until G23 PromptRegistry lands
 *
 * Signing: HMAC-SHA256 over the canonical JSON of the manifest +
 * sha256 of every file. Key derived from `SESSION_SECRET` via HKDF
 * with the application info string `briefcase-audit-bundle/v1`. Key
 * IDs rotate quarterly so an old signature can still be verified
 * after a key rotation.
 */
import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import {
  db,
  runs,
  runEvents,
  artifacts as artifactsTable,
  citations as citationsTable,
  agentCosts,
  modelRoutingDecisions,
  auditBundles,
} from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";

const log = logger.child({ component: "auditBundle" });

const APP_INFO = "briefcase-audit-bundle/v1";

function quarterKeyId(d: Date = new Date()): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}Q${q}`;
}

/**
 * Derive the signing key for a given keyId. The keyId (e.g. "2026Q2")
 * is mixed into the HKDF `info` so each rotation period produces a
 * distinct key — and crucially, verification works *against the keyId
 * recorded in the manifest*, not the current quarter. Bundles signed
 * last quarter still verify next quarter without storing the raw key.
 */
function deriveKey(keyId: string = quarterKeyId()): { key: Buffer; keyId: string } {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set; refusing to sign an audit bundle without a key.",
    );
  }
  const salt = Buffer.from("briefcase-audit-salt-v1", "utf8");
  const info = Buffer.from(`${APP_INFO}/${keyId}`, "utf8");
  const okm = hkdfSync("sha256", Buffer.from(secret, "utf8"), salt, info, 32);
  return { key: Buffer.from(okm), keyId };
}

interface BundleResult {
  zipBytes: Uint8Array;
  signature: string;
  signingKeyId: string;
  sizeBytes: number;
  manifest: Record<string, unknown>;
}

/**
 * Build the signed bundle for `runId`. Returns the raw zip bytes (so
 * the route can stream it back as application/zip) plus the manifest +
 * signature persisted into `audit_bundles`.
 */
export async function buildAuditBundle(runId: string): Promise<BundleResult> {
  const [runRow] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!runRow) {
    throw new Error(`AuditBundle: run ${runId} not found`);
  }

  const [events, artifactRows, citationRows, costRows, decisionRows] =
    await Promise.all([
      db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.idx)),
      db.select().from(artifactsTable).where(eq(artifactsTable.runId, runId)),
      db.select().from(citationsTable).where(eq(citationsTable.runId, runId)),
      db.select().from(agentCosts).where(eq(agentCosts.runId, runId)).limit(1),
      db
        .select()
        .from(modelRoutingDecisions)
        .where(eq(modelRoutingDecisions.runId, runId))
        .orderBy(asc(modelRoutingDecisions.idx)),
    ]);

  const files: Record<string, Uint8Array> = {
    "events.json": strToU8(JSON.stringify(events, null, 2)),
    "artifacts.json": strToU8(JSON.stringify(artifactRows, null, 2)),
    "citations.json": strToU8(JSON.stringify(citationRows, null, 2)),
    "cost-ledger.json": strToU8(JSON.stringify(costRows[0] ?? {}, null, 2)),
    "model-decisions.json": strToU8(JSON.stringify(decisionRows, null, 2)),
    // Placeholder until G23 PromptRegistry lands.
    "prompts.json": strToU8(JSON.stringify({ note: "PromptRegistry lands in G23" }, null, 2)),
  };

  // Per-file sha256 list goes into the signed manifest so a tampered
  // file inside the zip is detectable independent of the zip CRC.
  const fileHashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    fileHashes[name] = createHash("sha256").update(bytes).digest("hex");
  }

  const { key, keyId } = deriveKey();
  const manifest = {
    version: "1.0.0",
    runId,
    rolePack: runRow.rolePack,
    goal: runRow.goal,
    status: runRow.status,
    startedAt: runRow.startedAt?.toISOString() ?? null,
    completedAt: runRow.completedAt?.toISOString() ?? null,
    bundledAt: new Date().toISOString(),
    nonce: randomBytes(8).toString("hex"),
    files: fileHashes,
    signature: { algorithm: "HMAC-SHA256", keyId, info: APP_INFO },
  };
  // Canonical-ish JSON: deterministic key order via JSON.stringify on
  // a sorted object. Good enough for HMAC verification (the same
  // function on the server produces the same bytes).
  const canonical = JSON.stringify(sortKeys(manifest));
  const signature = createHmac("sha256", key).update(canonical).digest("hex");
  (manifest.signature as Record<string, unknown>)["value"] = signature;

  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  const zipBytes = zipSync(files);
  const sizeBytes = zipBytes.byteLength;

  // Persist the bundle metadata (not the bytes — the zip is regenerated
  // on every download to guarantee freshness against schema evolution).
  try {
    await db.insert(auditBundles).values({
      runId,
      bundleUri: null,
      signature,
      signingKeyId: keyId,
      sizeBytes,
    });
  } catch (err) {
    log.warn({ err, runId }, "audit_bundles persist failed (continuing)");
  }

  return { zipBytes, signature, signingKeyId: keyId, sizeBytes, manifest };
}

/**
 * Verify a previously-emitted bundle's manifest + signature. Used by
 * the audit-bundle integration test to assert HMAC roundtrip.
 */
export function verifyManifest(manifest: Record<string, unknown>): boolean {
  const sigField = manifest["signature"];
  if (!sigField || typeof sigField !== "object") return false;
  const { value, keyId } = sigField as { value?: string; keyId?: string };
  if (!value || !keyId) return false;
  // Re-derive the key from the manifest's *recorded* keyId so bundles
  // signed in a prior rotation period still verify.
  const { key } = deriveKey(keyId);
  const stripped = sortKeys({ ...manifest, signature: { ...sigField, value: undefined } }) as Record<string, unknown>;
  // Drop the undefined to mirror the original signing input exactly.
  delete (stripped["signature"] as Record<string, unknown>)["value"];
  const canonical = JSON.stringify(stripped);
  const expected = createHmac("sha256", key).update(canonical).digest("hex");
  return safeEqual(expected, value);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}
