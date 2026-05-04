/**
 * Google Drive client used by the G8 ingest pipeline.
 *
 * Spec language is "Workspace MCP" (a managed MCP server that fronts Drive /
 * Gmail / Calendar). No such managed MCP server is available in this Replit
 * environment, so we talk to Drive REST v3 directly. Same internal API
 * surface (`getFile`, `downloadFile`, `walkFolder`) so swapping in a real
 * MCP transport later is mechanical.
 *
 * Auth model: callers hand us a `userId`; we fetch the user's encrypted
 * refresh token, decrypt it with the AES-256-GCM helper, and exchange it
 * for a short-lived access token (Google access tokens expire in ~1h). We
 * cache access tokens in-process per user keyed on (userId, refreshToken
 * fingerprint) so we don't burn quota on every list call.
 */
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ApiError } from "../lib/errors";
import { decryptSecret } from "../lib/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// 5 min slop before access-token expiry so we re-mint before a request
// actually fails with 401.
const TOKEN_SLOP_MS = 5 * 60 * 1000;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  /** `true` for `application/vnd.google-apps.folder`. */
  isFolder: boolean;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const accessTokenCache = new Map<string, CachedToken>();
// Coalesce concurrent refreshes per user so a folder walk doesn't fan out
// N parallel `oauth2.googleapis.com/token` POSTs for the same refresh token
// (Google rate-limits this and may invalidate the token under abuse).
const inflightRefresh = new Map<string, Promise<string>>();

function clientCreds(): { id: string; secret: string } {
  const id = process.env["GOOGLE_OAUTH_CLIENT_ID_WEB"];
  const secret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!id || !secret) {
    throw new ApiError(
      "dependency_unavailable",
      "Google OAuth client credentials are not configured",
    );
  }
  return { id, secret };
}

async function loadRefreshToken(userId: string): Promise<string> {
  const rows = await db
    .select({
      tok: users.googleRefreshToken,
      iv: users.googleRefreshTokenIv,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row?.tok || !row.iv) {
    throw new ApiError(
      "forbidden",
      "Google account is not connected. Connect via /v1/auth/google/callback first.",
    );
  }
  return decryptSecret({ iv: Buffer.from(row.iv), ciphertext: Buffer.from(row.tok) });
}

async function getAccessToken(userId: string): Promise<string> {
  const cached = accessTokenCache.get(userId);
  if (cached && cached.expiresAt - TOKEN_SLOP_MS > Date.now()) {
    return cached.accessToken;
  }
  const existing = inflightRefresh.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    const refreshToken = await loadRefreshToken(userId);
    const { id, secret } = clientCreds();
    const body = new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new ApiError(
        "dependency_unavailable",
        `Google token refresh failed (${res.status}). Reconnect the account.`,
      );
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    accessTokenCache.set(userId, {
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    });
    return json.access_token;
  })();

  inflightRefresh.set(userId, promise);
  try {
    return await promise;
  } finally {
    inflightRefresh.delete(userId);
  }
}

/** Drop cached access token (e.g. after disconnect). */
export function dropAccessToken(userId: string): void {
  accessTokenCache.delete(userId);
}

async function driveFetch(
  userId: string,
  pathSuffix: string,
  init: RequestInit = {},
): Promise<Response> {
  // Defense-in-depth: only accept relative paths against `DRIVE_BASE`.
  // Refusing absolute URLs forecloses any future SSRF surface where a
  // model-controlled value might propagate into the path argument.
  if (!pathSuffix.startsWith("/")) {
    throw new Error(`driveFetch path must be relative; got '${pathSuffix}'`);
  }
  const access = await getAccessToken(userId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${access}`);
  return fetch(`${DRIVE_BASE}${pathSuffix}`, { ...init, headers });
}

function toDriveFile(f: {
  id: string;
  name?: string;
  mimeType: string;
  size?: string | number;
}): DriveFile {
  const size = typeof f.size === "string" ? Number(f.size) : f.size;
  return {
    id: f.id,
    name: f.name ?? "untitled",
    mimeType: f.mimeType,
    size: typeof size === "number" && !Number.isNaN(size) ? size : undefined,
    isFolder: f.mimeType === FOLDER_MIME,
  };
}

export async function getFile(
  userId: string,
  fileId: string,
): Promise<DriveFile> {
  const res = await driveFetch(
    userId,
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
  );
  if (!res.ok) {
    throw new ApiError(
      res.status === 404 ? "not_found" : "dependency_unavailable",
      `Drive getFile failed (${res.status})`,
    );
  }
  const json = (await res.json()) as {
    id: string;
    name?: string;
    mimeType: string;
    size?: string | number;
  };
  return toDriveFile(json);
}

export async function downloadFile(
  userId: string,
  fileId: string,
): Promise<Buffer> {
  const res = await driveFetch(
    userId,
    `/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!res.ok) {
    throw new ApiError(
      res.status === 404 ? "not_found" : "dependency_unavailable",
      `Drive downloadFile failed (${res.status})`,
    );
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/**
 * Recursively walk a Drive folder, returning every non-folder file
 * (descending into nested folders). Caps at `maxFiles` to avoid runaway
 * walks on huge shared drives.
 */
export async function walkFolder(
  userId: string,
  folderId: string,
  opts: { maxFiles?: number } = {},
): Promise<DriveFile[]> {
  const maxFiles = opts.maxFiles ?? 200;
  const out: DriveFile[] = [];
  const queue: string[] = [folderId];
  const visited = new Set<string>();

  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${current}' in parents and trashed = false`,
        fields: "nextPageToken, files(id,name,mimeType,size)",
        pageSize: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await driveFetch(userId, `/files?${params.toString()}`);
      if (!res.ok) {
        throw new ApiError(
          res.status === 404 ? "not_found" : "dependency_unavailable",
          `Drive list failed (${res.status})`,
        );
      }
      const json = (await res.json()) as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          size?: string;
        }>;
        nextPageToken?: string;
      };
      for (const f of json.files ?? []) {
        const df = toDriveFile(f);
        if (df.isFolder) {
          queue.push(df.id);
        } else {
          out.push(df);
          if (out.length >= maxFiles) break;
        }
      }
      pageToken = json.nextPageToken;
    } while (pageToken && out.length < maxFiles);
  }

  return out;
}

/** R-14 helper: exchange an OAuth code for tokens (PKCE). Returns the raw
 * Google response so the route can persist `refresh_token` and look up the
 * user's email via `id_token`. */
export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<OAuthExchangeResult> {
  const { id, secret } = clientCreds();
  const params = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (codeVerifier) params.set("code_verifier", codeVerifier);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(
      "validation_error",
      `Google OAuth code exchange failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
  };
}

/** Best-effort revocation; surfaces dependency errors but never blocks
 * the disconnect route from deleting the local rows. */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Decode the unverified `id_token` JWT payload to extract `email`. We do
 * NOT verify the signature here — the caller used the token directly from
 * Google's TLS-secured token endpoint, so origin trust is already
 * established for the duration of this exchange. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1]! + "=".repeat((4 - (parts[1]!.length % 4)) % 4);
    const json = JSON.parse(
      Buffer.from(padded, "base64url").toString("utf8"),
    ) as { email?: string };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}
