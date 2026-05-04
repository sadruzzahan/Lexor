import { createHash } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.resolve(
  process.cwd(),
  process.env["FILE_STORAGE_ROOT"] ?? ".local/storage/case-files",
);

export interface StoredObject {
  sha256: string;
  sizeBytes: number;
  storagePath: string;
}

export function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Content-addressed local storage. Writes `<root>/<sha256[0:2]>/<sha256>` so
 * duplicate uploads dedupe naturally (FR-023). Safe to call concurrently —
 * write is idempotent.
 */
export async function putBytes(buf: Buffer): Promise<StoredObject> {
  const sha256 = sha256Of(buf);
  const dir = path.join(STORAGE_ROOT, sha256.slice(0, 2));
  const storagePath = path.join(dir, sha256);

  await mkdir(dir, { recursive: true });

  let exists = false;
  try {
    await stat(storagePath);
    exists = true;
  } catch {
    /* not present yet */
  }

  if (!exists) {
    await writeFile(storagePath, buf);
  }

  return { sha256, sizeBytes: buf.byteLength, storagePath };
}

export function storageRoot(): string {
  return STORAGE_ROOT;
}
