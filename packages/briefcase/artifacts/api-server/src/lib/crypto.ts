/**
 * Server-side AES-256-GCM encryption for sensitive secrets at rest
 * (currently: Google OAuth refresh tokens stored on the `users` row).
 *
 * Design (per spec R-14):
 *   - Master secret: `SESSION_SECRET` (env, never logged).
 *   - KEK: derived via HKDF-SHA256 from `SESSION_SECRET` with a fixed
 *     application info string. We never use `SESSION_SECRET` directly so the
 *     same env var can also back signed-cookie HMACs without sharing key
 *     material.
 *   - Per-record IV: random 12 bytes (GCM standard).
 *   - Stored shape: `iv (12B)` + `ciphertext` + `authTag (16B)`. The DB has
 *     two `bytea` columns (`google_refresh_token`, `google_refresh_token_iv`)
 *     so we keep the IV separate; the ciphertext column stores
 *     `ciphertext || authTag` so the auth tag is verified on decrypt.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;
const HKDF_INFO = Buffer.from("justiceos.kek.v1");
const HKDF_SALT = Buffer.from("justiceos.kek.salt.v1");

let cachedKek: Buffer | null = null;

function getKek(): Buffer {
  if (cachedKek) return cachedKek;
  const sessionSecret = process.env["SESSION_SECRET"];
  if (!sessionSecret) {
    throw new Error(
      "SESSION_SECRET is not set; refusing to encrypt at rest without a key.",
    );
  }
  // hkdfSync returns ArrayBuffer; wrap in Buffer for ergonomics.
  const derived = hkdfSync(
    "sha256",
    Buffer.from(sessionSecret, "utf8"),
    HKDF_SALT,
    HKDF_INFO,
    KEY_BYTES,
  );
  cachedKek = Buffer.from(derived);
  return cachedKek;
}

export interface EncryptedSecret {
  /** Random 12-byte IV (store in `*_iv` column). */
  iv: Buffer;
  /** Ciphertext || 16-byte GCM auth tag. */
  ciphertext: Buffer;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const kek = getKek();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

export function decryptSecret(payload: EncryptedSecret): string {
  const kek = getKek();
  const { iv, ciphertext } = payload;
  if (iv.length !== IV_BYTES) {
    throw new Error(`Bad IV length ${iv.length}, expected ${IV_BYTES}`);
  }
  if (ciphertext.length < TAG_BYTES) {
    throw new Error("Ciphertext shorter than GCM auth tag");
  }
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const enc = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/** For tests only — drops the cached KEK so a new SESSION_SECRET takes effect. */
export function __resetKekForTests(): void {
  cachedKek = null;
}
