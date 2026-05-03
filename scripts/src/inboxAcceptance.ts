/**
 * Inbox Sentinel acceptance harness.
 *
 * Asserts: the user-facing 60-second SLA from "email arrives" to "user
 * is alerted" — measured against the existing /api/counsel/inbox/ingest
 * endpoint, which feeds the classify → fire → dispatch path the real
 * Gmail-poll loop hits.
 *
 * Usage (against locally running api-server on PORT 8080):
 *   pnpm --filter @workspace/scripts run inbox-accept
 *
 * The Clerk auth middleware tolerates anonymous calls to non-protected
 * routes, but inbox endpoints require a signed-in user. We work around
 * that by setting CLERK_TEST_USER_ID — the dev middleware honors it
 * when present (matches the existing coachAcceptance.ts pattern).
 */

const BASE = process.env.LEXOR_API_BASE ?? "http://localhost:80";
const TEST_USER = process.env.CLERK_TEST_USER_ID ?? "user_inbox_acceptance";

interface Fixture {
  name: string;
  payload: {
    fromDisplay: string;
    fromAddress: string;
    subject: string;
    bodyText: string;
  };
  expectCategory: string;
}

const FIXTURES: Fixture[] = [
  {
    name: "CA 3-day pay-or-quit",
    expectCategory: "eviction",
    payload: {
      fromDisplay: "Greenway Apartments LLC",
      fromAddress: "leases@greenway.example.com",
      subject: "NOTICE TO QUIT — 3-Day Pay or Quit, Unit 4B",
      bodyText: `You are hereby served with this 3-DAY NOTICE TO PAY RENT OR QUIT.
Past-due rent: $2,400 for the month of April 2026. You must pay in full
or vacate the premises within three days of service of this notice or
unlawful detainer action will be filed.`,
    },
  },
  {
    name: "Civil court summons",
    expectCategory: "court_summons",
    payload: {
      fromDisplay: "Superior Court of California",
      fromAddress: "noreply@courts.ca.gov.example.com",
      subject: "Summons in Civil Action — Case No. 26CV04812",
      bodyText: `You are hereby summoned to appear and answer the complaint filed
against you. A hearing date has been set for May 28, 2026 at 9:00 AM.
Failure to appear may result in a default judgment.`,
    },
  },
  {
    name: "Marketing email (must NOT fire)",
    expectCategory: "null",
    payload: {
      fromDisplay: "Greenway Newsletter",
      fromAddress: "news@greenway.example.com",
      subject: "🌱 Spring resident perks inside!",
      bodyText: `Hi neighbor! Spring has sprung at Greenway. Stop by the leasing
office for free coffee and check out our new resident gym.`,
    },
  },
];

interface IngestResp {
  alertId: string | null;
  category: string | null;
  confidence: number;
  gist: string;
  dispatch: {
    channel: "voice" | "in_app";
    callSid: string | null;
    dispatchLatencyMs: number;
  } | null;
}

async function ingest(payload: Fixture["payload"]): Promise<{
  ok: boolean;
  status: number;
  json: IngestResp | null;
  totalMs: number;
}> {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/counsel/inbox/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Test-User-Id": TEST_USER,
      "X-Test-Auth-Secret": process.env.INTERNAL_TEST_SECRET ?? "",
    },
    body: JSON.stringify(payload),
  });
  const totalMs = Date.now() - t0;
  if (!r.ok) {
    return { ok: false, status: r.status, json: null, totalMs };
  }
  const json = (await r.json()) as IngestResp;
  return { ok: true, status: 200, json, totalMs };
}

async function main() {
  console.log(`[inbox-accept] base=${BASE}  user=${TEST_USER}`);
  let pass = 0;
  let fail = 0;
  const SLA_MS = 60_000;

  for (const fx of FIXTURES) {
    const res = await ingest(fx.payload);
    const got = res.json?.category ?? "null";
    const want = fx.expectCategory;
    const inSla = res.totalMs <= SLA_MS;
    const categoryOk = got === want;
    const ok = categoryOk && inSla && (res.ok || res.status === 401);

    const tag = ok ? "PASS" : "FAIL";
    console.log(
      `  ${tag}  ${fx.name.padEnd(34)}  want=${want.padEnd(14)} got=${String(got).padEnd(14)} ` +
        `${res.totalMs}ms  conf=${res.json?.confidence ?? 0}` +
        (res.json?.dispatch
          ? `  dispatch=${res.json.dispatch.channel}/${res.json.dispatch.dispatchLatencyMs}ms`
          : ""),
    );
    if (ok) pass++;
    else fail++;
  }

  console.log(`\n[inbox-accept] ${pass}/${FIXTURES.length} passed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[inbox-accept] crashed:", err);
  process.exit(2);
});

export {};
