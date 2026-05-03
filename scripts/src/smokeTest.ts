/**
 * Public-URL smoke test for the deployed Lexor app.
 *
 * Hits the user-facing landing/upload/map/voice pages and the public API
 * health surface, asserting status codes and that the served HTML is the
 * Lexor shell (not a 5xx page). Intended to be run against a deployed
 * `*.replit.app` (or custom domain) URL after publishing.
 *
 * Usage:
 *   LEXOR_PROD_URL=https://your-app.replit.app \
 *     pnpm --filter @workspace/scripts run smoke-test
 *
 * Exits non-zero on any failure.
 */
export {};

const BASE = (process.env.LEXOR_PROD_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error(
    "[smoke] FAIL — set LEXOR_PROD_URL=https://<your-deployed-host> before running.",
  );
  process.exit(2);
}

interface Check {
  name: string;
  url: string;
  expectStatus?: number[];
  expectBodyIncludes?: string[];
  method?: "GET" | "POST";
}

const CHECKS: Check[] = [
  {
    name: "landing renders Lexor shell",
    url: `${BASE}/lexor/`,
    expectStatus: [200],
    expectBodyIncludes: ["<title>", "Lexor"],
  },
  {
    name: "upload page loads",
    url: `${BASE}/lexor/upload`,
    expectStatus: [200],
    expectBodyIncludes: ["Lexor"],
  },
  {
    name: "map page loads",
    url: `${BASE}/lexor/map`,
    expectStatus: [200],
    expectBodyIncludes: ["Lexor"],
  },
  {
    name: "voice page loads",
    url: `${BASE}/lexor/voice`,
    expectStatus: [200],
    expectBodyIncludes: ["Lexor"],
  },
  {
    name: "disclaimer page loads",
    url: `${BASE}/lexor/legal/disclaimer`,
    expectStatus: [200],
    expectBodyIncludes: ["Lexor"],
  },
  {
    name: "API healthz responds",
    url: `${BASE}/api/counsel/healthz`,
    expectStatus: [200],
  },
  {
    name: "API diagnostics responds",
    url: `${BASE}/api/counsel/diagnostics`,
    expectStatus: [200],
  },
  {
    name: "voice info advertises Twilio config",
    url: `${BASE}/api/counsel/voice/info`,
    expectStatus: [200],
    expectBodyIncludes: ["whatsappNumber"],
  },
  {
    name: "map summary returns JSON",
    url: `${BASE}/api/counsel/map/summary`,
    expectStatus: [200],
    expectBodyIncludes: ["totalPins"],
  },
];

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

async function runOne(c: Check): Promise<Result> {
  const t0 = Date.now();
  try {
    const res = await fetch(c.url, {
      method: c.method ?? "GET",
      redirect: "follow",
    });
    const ms = Date.now() - t0;
    const expected = c.expectStatus ?? [200];
    if (!expected.includes(res.status)) {
      return {
        name: c.name,
        ok: false,
        detail: `status=${res.status} (want ${expected.join("/")}) in ${ms}ms`,
      };
    }
    if (c.expectBodyIncludes && c.expectBodyIncludes.length > 0) {
      const body = await res.text();
      for (const needle of c.expectBodyIncludes) {
        if (!body.includes(needle)) {
          return {
            name: c.name,
            ok: false,
            detail: `body missing "${needle}" (status=${res.status}, ${ms}ms)`,
          };
        }
      }
    }
    return { name: c.name, ok: true, detail: `${res.status} in ${ms}ms` };
  } catch (err) {
    return {
      name: c.name,
      ok: false,
      detail: `fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function main(): Promise<void> {
  console.log(`[smoke] target = ${BASE}\n`);
  const results: Result[] = [];
  for (const c of CHECKS) {
    const r = await runOne(c);
    results.push(r);
    const tag = r.ok ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${r.name} — ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[smoke] ${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] unexpected error:", err);
  process.exit(2);
});
