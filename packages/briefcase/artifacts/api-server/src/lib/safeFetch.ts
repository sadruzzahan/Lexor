/**
 * SSRF guard for the citation verifier (and any other tool that fetches a
 * URL produced by an LLM). Enforces:
 *   - http/https only
 *   - blocks localhost, link-local, loopback, private CIDRs, AWS metadata,
 *     and IPv6 unique-local / link-local ranges
 *   - resolves hostname and blocks if ANY resolved IP is in a private range
 *   - disables automatic redirects; the caller re-validates each hop
 *
 * The verifier is mandatory and runs on every external citation per spec
 * §10.4 — without these guards a model-controlled URL could probe internal
 * services or fetch the cloud metadata endpoint.
 */
import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 3;

class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlNotAllowedError";
  }
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, maskStr] = cidr.split("/");
  if (!base || !maskStr) return false;
  const mask = Number(maskStr);
  const toInt = (s: string) =>
    s.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
  const m = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  return (toInt(ip) & m) === (toInt(base) & m);
}

const IPV4_BLOCK_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10", // CGN
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local + AWS metadata 169.254.169.254
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true; // link-local + ULA
  }
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — recurse on the embedded v4
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isBlockedIPv4(v4);
  }
  return false;
}

function isBlockedIPv4(ip: string): boolean {
  for (const cidr of IPV4_BLOCK_CIDRS) {
    if (ipv4InCidr(ip, cidr)) return true;
  }
  return false;
}

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // unknown family — refuse
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlNotAllowedError("invalid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UrlNotAllowedError(`disallowed protocol ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (!host) throw new UrlNotAllowedError("missing hostname");
  // Reject literal localhost and IP literals upfront.
  if (host === "localhost" || host === "ip6-localhost") {
    throw new UrlNotAllowedError("localhost not allowed");
  }
  if (net.isIP(host)) {
    if (isBlockedIP(host)) throw new UrlNotAllowedError(`blocked IP literal ${host}`);
    return parsed;
  }
  // Resolve and block if ANY answer is in a private range.
  let answers: { address: string; family: number }[];
  try {
    answers = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new UrlNotAllowedError(
      `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const a of answers) {
    if (isBlockedIP(a.address)) {
      throw new UrlNotAllowedError(
        `${host} resolves to blocked address ${a.address}`,
      );
    }
  }
  return parsed;
}

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: Buffer;
}

/**
 * GET a URL with SSRF protections. Redirects are followed manually so we
 * can re-validate every hop. Body is bounded by `maxBytes`.
 */
export async function safeFetchGet(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<SafeFetchResult> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = await assertSafeUrl(currentUrl);
    const r = await fetch(parsed.toString(), {
      method: "GET",
      headers: opts.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) {
        return { ok: false, status: r.status, finalUrl: parsed.toString(), body: Buffer.alloc(0) };
      }
      currentUrl = new URL(loc, parsed).toString();
      continue;
    }
    if (!r.ok || !r.body) {
      return { ok: r.ok, status: r.status, finalUrl: parsed.toString(), body: Buffer.alloc(0) };
    }
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total >= opts.maxBytes) {
          try { await reader.cancel(); } catch { /* ignore */ }
          break;
        }
      }
    }
    return {
      ok: true,
      status: r.status,
      finalUrl: parsed.toString(),
      body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    };
  }
  throw new UrlNotAllowedError("too many redirects");
}

export { UrlNotAllowedError };
