import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "../../lib/logger";

/**
 * Thin Gmail client over the Replit connector proxy. Token refresh is
 * handled by the SDK; we just shape calls and responses.
 *
 * Drift: this is a developer-account-scoped connection (the Repl owner
 * connects ONE Gmail account); for true per-user OAuth you would either
 * (a) ask each user to connect Gmail in their own Replit account, or
 * (b) build a custom Google OAuth flow in api-server. (a) is out of scope
 * for the demo; (b) is tracked separately if the user requests it.
 */
const connectors = new ReplitConnectors();

export interface GmailMessageMeta {
  messageId: string;
  threadId: string;
  fromDisplay: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  receivedIso: string;
  snippet: string;
  /** Decoded plain text body (best-effort; empty if HTML-only). */
  bodyText: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPayload {
  headers?: GmailHeader[];
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

interface GmailMessageResponse {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}

function header(payload: GmailPayload | undefined, name: string): string {
  if (!payload?.headers) return "";
  const h = payload.headers.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

/**
 * Recursively walk MIME parts to extract the first text/plain body.
 * Falls back to text/html stripped of tags if no plain part exists.
 */
function extractBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  const decode = (b64: string): string => {
    const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
    try {
      return Buffer.from(norm, "base64").toString("utf-8");
    } catch {
      return "";
    }
  };
  const walk = (p: GmailPayload, wantPlain: boolean): string => {
    if (
      p.mimeType === (wantPlain ? "text/plain" : "text/html") &&
      p.body?.data
    ) {
      return decode(p.body.data);
    }
    if (p.parts) {
      for (const part of p.parts) {
        const r = walk(part, wantPlain);
        if (r) return r;
      }
    }
    return "";
  };
  const plain = walk(payload, true);
  if (plain) return plain;
  const html = walk(payload, false);
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseFromHeader(raw: string): {
  fromDisplay: string;
  fromAddress: string;
} {
  // "Display Name" <a@b.com>  |  a@b.com  |  Display Name <a@b.com>
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    return {
      fromDisplay: (m[1] || m[2] || "").replace(/^"+|"+$/g, "").trim(),
      fromAddress: (m[2] || "").trim(),
    };
  }
  return { fromDisplay: raw.trim(), fromAddress: raw.trim() };
}

/** Returns true if the connector responds — used by the Settings status pill. */
export async function isGmailConnected(): Promise<boolean> {
  try {
    const r = await connectors.proxy("google-mail", "/gmail/v1/users/me/profile");
    return r.ok;
  } catch (err) {
    logger.warn({ err }, "gmail connector probe failed");
    return false;
  }
}

export async function getGmailProfile(): Promise<{
  emailAddress: string;
  historyId: string;
} | null> {
  try {
    const r = await connectors.proxy("google-mail", "/gmail/v1/users/me/profile");
    if (!r.ok) return null;
    const j = (await r.json()) as { emailAddress?: string; historyId?: string };
    if (!j.emailAddress) return null;
    return {
      emailAddress: j.emailAddress,
      historyId: j.historyId ?? "0",
    };
  } catch (err) {
    logger.warn({ err }, "getGmailProfile failed");
    return null;
  }
}

/**
 * List recent INBOX messages newer than `afterEpochSec` (Gmail `q`
 * supports `after:<unix-seconds>`). Up to `max` returned. Used by the
 * 30s scheduler when (and only when) the granted scope includes
 * `gmail.readonly`/`gmail.modify`. The current connector's add-on scope
 * does not authorize messages.list; this returns [] in that case
 * (logged once at debug).
 */
export async function listInboxSince(
  afterEpochSec: number,
  max = 20,
): Promise<GmailMessageMeta[]> {
  const q = encodeURIComponent(`in:inbox after:${afterEpochSec}`);
  const path = `/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`;
  const r = await connectors.proxy("google-mail", path);
  if (!r.ok) {
    if (r.status === 403) {
      logger.debug(
        { status: r.status },
        "gmail messages.list not authorized for current connector scope",
      );
      return [];
    }
    logger.warn({ status: r.status }, "gmail messages.list failed");
    return [];
  }
  const list = (await r.json()) as GmailListResponse;
  if (!list.messages?.length) return [];
  const out: GmailMessageMeta[] = [];
  for (const m of list.messages) {
    const meta = await getMessage(m.id);
    if (meta) out.push(meta);
  }
  return out;
}

export async function getMessage(
  messageId: string,
): Promise<GmailMessageMeta | null> {
  const r = await connectors.proxy(
    "google-mail",
    `/gmail/v1/users/me/messages/${messageId}?format=full`,
  );
  if (!r.ok) return null;
  const m = (await r.json()) as GmailMessageResponse;
  const fromHeader = header(m.payload, "From");
  const { fromDisplay, fromAddress } = parseFromHeader(fromHeader);
  const internalMs = m.internalDate ? Number(m.internalDate) : Date.now();
  return {
    messageId: m.id,
    threadId: m.threadId,
    fromDisplay,
    fromAddress,
    toAddress: header(m.payload, "To"),
    subject: header(m.payload, "Subject"),
    receivedIso: new Date(internalMs).toISOString(),
    snippet: m.snippet ?? "",
    bodyText: extractBody(m.payload).slice(0, 8000),
  };
}

/**
 * Send a reply via Gmail. Uses the gmail.send scope which IS granted by
 * the current connector. Returns the new messageId.
 */
export async function sendReply(opts: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string;
}): Promise<{ messageId: string } | null> {
  // Gmail accepts a base64url-encoded RFC 2822 message in `raw`.
  const subj = opts.subject.startsWith("Re:")
    ? opts.subject
    : `Re: ${opts.subject}`;
  const headers = [
    `To: ${opts.to}`,
    `Subject: ${subj}`,
    "Content-Type: text/plain; charset=utf-8",
    opts.inReplyToMessageId ? `In-Reply-To: ${opts.inReplyToMessageId}` : "",
    opts.inReplyToMessageId ? `References: ${opts.inReplyToMessageId}` : "",
  ]
    .filter(Boolean)
    .join("\r\n");
  const rfc = `${headers}\r\n\r\n${opts.body}`;
  const raw = Buffer.from(rfc, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const r = await connectors.proxy(
    "google-mail",
    "/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threadId: opts.threadId }),
    },
  );
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    logger.error({ status: r.status, body: text }, "gmail send failed");
    return null;
  }
  const j = (await r.json()) as { id?: string };
  return j.id ? { messageId: j.id } : null;
}
