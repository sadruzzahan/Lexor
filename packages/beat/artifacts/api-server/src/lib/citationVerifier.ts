import dns from "node:dns/promises";

// Blocks private, loopback, link-local, and cloud metadata IP ranges
const PRIVATE_IP_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

// Cloud metadata hostname patterns
const METADATA_HOST_RE =
  /^(169\.254\.169\.254|metadata\.google\.internal|metadata\.azure\.com|fd00:ec2::254)$/i;

const SAFE_HEADERS = {
  "User-Agent": "Beat-CitationVerifier/1.0",
  Accept: "text/html,text/plain,application/json",
};

export interface VerifiedCitation {
  url: string;
  title: string;
  snippet: string;
  verified: true;
}

export interface DroppedCitation {
  url: string;
  title: string;
  reason: string;
  verified: false;
}

export type CitationVerificationResult = VerifiedCitation | DroppedCitation;

function isBlockedStaticUrl(url: string): string | null {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "blocked: non-http scheme";
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return "blocked: invalid URL";
  }
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return "blocked: loopback host";
  }
  if (METADATA_HOST_RE.test(hostname)) {
    return "blocked: cloud metadata endpoint";
  }
  if (PRIVATE_IP_RE.test(hostname)) {
    return "blocked: private IP range in hostname";
  }
  return null;
}

async function isBlockedAfterDns(hostname: string): Promise<string | null> {
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    for (const addr of [...addresses, ...addresses6]) {
      if (PRIVATE_IP_RE.test(addr) || addr === "::1" || addr === "127.0.0.1") {
        return `blocked: hostname resolves to private IP (${addr})`;
      }
    }
  } catch {
    // DNS failure — allow the fetch to fail naturally
  }
  return null;
}

async function verifyInline(
  url: string,
  title: string,
  snippet: string,
  signal: AbortSignal,
): Promise<CitationVerificationResult> {
  const staticBlocked = isBlockedStaticUrl(url);
  if (staticBlocked) return { url, title, reason: staticBlocked, verified: false };

  const hostname = new URL(url).hostname;
  const dnsBlocked = await isBlockedAfterDns(hostname);
  if (dnsBlocked) return { url, title, reason: dnsBlocked, verified: false };

  try {
    const timeoutCtrl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtrl.abort(), 8000);
    const combined = AbortSignal.any
      ? AbortSignal.any([signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: SAFE_HEADERS,
        signal: combined,
        redirect: "error",
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      return { url, title, reason: `http ${res.status}`, verified: false };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/") && !contentType.includes("application/json")) {
      return { url, title, reason: `non-text content: ${contentType}`, verified: false };
    }

    const raw = await res.text();
    const body = raw.slice(0, 51_200).toLowerCase();
    const keyPhrase = snippet.toLowerCase().slice(0, 80).trim();
    const words = keyPhrase.split(/\s+/).filter((w) => w.length > 4);
    const requiredMatches = Math.max(3, Math.floor(words.length * 0.6));
    const matchCount = words.filter((w) => body.includes(w)).length;

    if (matchCount < requiredMatches) {
      return {
        url,
        title,
        reason: `quote not found (${matchCount}/${requiredMatches} keywords matched)`,
        verified: false,
      };
    }

    return { url, title, snippet: snippet.slice(0, 200), verified: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { url, title, reason: `fetch error: ${msg.slice(0, 100)}`, verified: false };
  }
}

async function verifyWithE2B(
  url: string,
  title: string,
  snippet: string,
  signal: AbortSignal,
): Promise<CitationVerificationResult> {
  const staticBlocked = isBlockedStaticUrl(url);
  if (staticBlocked) return { url, title, reason: staticBlocked, verified: false };

  const hostname = new URL(url).hostname;
  const dnsBlocked = await isBlockedAfterDns(hostname);
  if (dnsBlocked) return { url, title, reason: dnsBlocked, verified: false };

  try {
    const { Sandbox } = await import("@e2b/code-interpreter");

    const sbx = await Promise.race([
      Sandbox.create({ timeoutMs: 12000 }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    ]);

    try {
      // Strict no-redirect + private IP filtering inside the sandbox
      const code = `
import urllib.request, json, re, sys, socket
from urllib.error import HTTPError

url = ${JSON.stringify(url)}
snippet = ${JSON.stringify(snippet.slice(0, 200))}

BLOCK_RE = re.compile(
    r'^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|127\\.|0\\.0\\.0\\.0|'
    r'169\\.254\\.|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.)',
)
METADATA_HOST_RE = re.compile(
    r'^(169\\.254\\.169\\.254|metadata\\.google\\.internal|metadata\\.azure\\.com)$',
    re.I,
)

host = urllib.parse.urlparse(url).hostname or ""

if METADATA_HOST_RE.match(host):
    print(json.dumps({"verified": False, "reason": "blocked: cloud metadata endpoint"}))
    sys.exit(0)

# Validate DNS-resolved IP
try:
    resolved_ip = socket.gethostbyname(host)
    if BLOCK_RE.match(resolved_ip) or resolved_ip == "127.0.0.1":
        print(json.dumps({"verified": False, "reason": f"blocked: resolves to private IP {resolved_ip}"}))
        sys.exit(0)
except Exception:
    pass

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, "redirect blocked", headers, fp)

try:
    opener = urllib.request.build_opener(NoRedirectHandler())
    req = urllib.request.Request(url, headers={"User-Agent": "Beat-CitationVerifier/1.0"})
    with opener.open(req, timeout=8) as resp:
        body = resp.read(51200).decode("utf-8", errors="replace").lower()
    words = [w for w in snippet.lower().split() if len(w) > 4]
    required = max(3, int(len(words) * 0.6))
    matched = sum(1 for w in words if w in body)
    if matched >= required:
        print(json.dumps({"verified": True}))
    else:
        print(json.dumps({"verified": False, "reason": f"quote not found ({matched}/{required} keywords)"}))
except HTTPError as e:
    print(json.dumps({"verified": False, "reason": f"http {e.code}"}))
except Exception as e:
    print(json.dumps({"verified": False, "reason": str(e)[:100]}))
`;

      const exec = await Promise.race([
        sbx.runCode(code),
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      ]);

      const output = exec.text?.trim() ?? "{}";
      const result = JSON.parse(output) as { verified: boolean; reason?: string };
      if (result.verified) {
        return { url, title, snippet: snippet.slice(0, 200), verified: true };
      }
      return { url, title, reason: result.reason ?? "unknown", verified: false };
    } finally {
      await sbx.kill().catch(() => undefined);
    }
  } catch (e2bErr) {
    if ((e2bErr as Error)?.name === "AbortError") {
      return { url, title, reason: "cancelled", verified: false };
    }
    console.warn("[citationVerifier] E2B unavailable, falling back to inline:", String(e2bErr).slice(0, 80));
    return verifyInline(url, title, snippet, signal);
  }
}

export async function verifyCitation(
  url: string,
  title: string,
  snippet: string,
  signal: AbortSignal,
): Promise<CitationVerificationResult> {
  if (process.env.E2B_API_KEY) {
    return verifyWithE2B(url, title, snippet, signal);
  }
  return verifyInline(url, title, snippet, signal);
}

export async function verifyCitations(
  candidates: Array<{ url: string; title: string; snippet: string }>,
  signal: AbortSignal,
  concurrency = 3,
): Promise<{ verified: VerifiedCitation[]; dropped: DroppedCitation[] }> {
  const verified: VerifiedCitation[] = [];
  const dropped: DroppedCitation[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    if (signal.aborted) break;
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((c) => verifyCitation(c.url, c.title, c.snippet, signal)),
    );
    for (const r of results) {
      if (r.verified) {
        verified.push(r as VerifiedCitation);
      } else {
        dropped.push(r as DroppedCitation);
      }
    }
  }

  return { verified, dropped };
}
