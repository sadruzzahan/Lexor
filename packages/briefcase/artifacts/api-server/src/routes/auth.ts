import { Router, type IRouter } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GoogleOauthCallbackBody } from "@workspace/api-zod";
import { ApiError } from "../lib/errors";
import { requireDemoUser } from "../middlewares/demoUser";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import {
  exchangeOAuthCode,
  revokeRefreshToken,
  emailFromIdToken,
  dropAccessToken,
} from "../mcp/workspaceClient";

const router: IRouter = Router();

router.use(requireDemoUser);

const SESSION_COOKIE = "briefcase_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d

function defaultRedirectUri(): string {
  // The web client supplies its own `redirect_uri` to Google; we accept it
  // out-of-band via env so server-side exchange uses the same value Google
  // received, otherwise the token endpoint rejects with `redirect_uri_mismatch`.
  const fromEnv = process.env["GOOGLE_OAUTH_REDIRECT_URI"];
  if (!fromEnv) {
    throw new ApiError(
      "dependency_unavailable",
      "GOOGLE_OAUTH_REDIRECT_URI is not configured",
    );
  }
  return fromEnv;
}

/**
 * R-14 Google OAuth callback.
 *
 * Flow (per spec §5.4 SD-01):
 *   1. Web client opens Google's OAuth consent with PKCE; receives `code`.
 *   2. Client POSTs `{code, codeVerifier, state?}` here.
 *   3. We exchange for an access + refresh token, encrypt the refresh token
 *      at rest with AES-256-GCM (KEK derived from SESSION_SECRET via HKDF),
 *      persist it on the user row, and set an HttpOnly session cookie.
 */
router.post("/google/callback", async (req, res, next) => {
  try {
    const body = GoogleOauthCallbackBody.parse(req.body ?? {});
    const userId = req.demoUser!.id;

    const tokens = await exchangeOAuthCode(
      body.code,
      defaultRedirectUri(),
      body.codeVerifier,
    );
    if (!tokens.refreshToken) {
      throw new ApiError(
        "validation_error",
        "Google did not return a refresh_token. The client must request " +
          "`access_type=offline&prompt=consent` so we can refresh later.",
      );
    }

    const enc = encryptSecret(tokens.refreshToken);
    const email = emailFromIdToken(tokens.idToken);

    await db
      .update(users)
      .set({
        googleRefreshToken: enc.ciphertext,
        googleRefreshTokenIv: enc.iv,
        ...(email ? { email } : {}),
      })
      .where(eq(users.id, userId));

    // Drop any stale access-token cache for this user so the next Drive
    // call re-mints with the fresh refresh token.
    dropAccessToken(userId);

    res.cookie(SESSION_COOKIE, userId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      maxAge: SESSION_MAX_AGE_MS,
      path: "/",
    });

    res.json({ connected: true, ...(email ? { email } : {}) });
  } catch (err) {
    next(err);
  }
});

/**
 * R-15 Disconnect Google account: best-effort revoke at Google, then hard
 * delete both the encrypted token and IV columns on the user row.
 */
router.post("/google/disconnect", async (req, res, next) => {
  try {
    const userId = req.demoUser!.id;
    const rows = await db
      .select({
        tok: users.googleRefreshToken,
        iv: users.googleRefreshTokenIv,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    if (row?.tok && row.iv) {
      try {
        const refreshToken = decryptSecret({
          iv: Buffer.from(row.iv),
          ciphertext: Buffer.from(row.tok),
        });
        await revokeRefreshToken(refreshToken);
      } catch {
        // Decrypt failures are non-fatal — we still want to wipe local rows.
      }
    }
    await db
      .update(users)
      .set({ googleRefreshToken: null, googleRefreshTokenIv: null })
      .where(eq(users.id, userId));
    dropAccessToken(userId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
