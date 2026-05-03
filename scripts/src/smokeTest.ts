/**
 * Public-URL smoke test for the deployed Lexor app.
 *
 * Walks the user journey end-to-end against the deployed host:
 *   landing → upload (sample inline-text letter) → poll case →
 *   assert Defense + Counter-attack content → map → voice → coalitions.
 *
 * Also pings the public API surfaces (healthz, voice/info, map/stats).
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

const SAMPLE_LETTER = `NOTICE TO QUIT — Three Day Notice to Pay Rent or Quit.
To Tenant: You are hereby notified that the rent in the amount of $2,400 for
the premises located at 123 Example Ave., Apt 4B, is past due. You must pay
the entire amount within three (3) days of service of this notice or surrender
possession of the premises. Failure to do so will result in the commencement
of unlawful detainer proceedings against you. Dated this day by the landlord.`;

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

async function check(
  name: string,
  fn: () => Promise<string>,
): Promise<Result> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail: `${detail} in ${Date.now() - t0}ms` };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `${err instanceof Error ? err.message : String(err)} (${Date.now() - t0}ms)`,
    };
  }
}

async function expectGet(
  url: string,
  expectStatus: number[],
  expectBodyIncludes: string[] = [],
): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!expectStatus.includes(res.status)) {
    throw new Error(`status=${res.status} (want ${expectStatus.join("/")})`);
  }
  if (expectBodyIncludes.length > 0) {
    const body = await res.text();
    for (const needle of expectBodyIncludes) {
      if (!body.includes(needle)) {
        throw new Error(`body missing "${needle}" (status=${res.status})`);
      }
    }
  }
  return `${res.status}`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "follow",
  });
}

async function uploadAndPollCase(): Promise<string> {
  const createRes = await postJson(`${BASE}/api/counsel/cases`, {
    language: "en",
    inlineText: SAMPLE_LETTER,
  });
  if (createRes.status !== 200) {
    throw new Error(`POST /cases status=${createRes.status}`);
  }
  const created = (await createRes.json()) as { caseId?: string };
  const caseId = created.caseId;
  if (!caseId) throw new Error("POST /cases returned no caseId");

  // Poll for terminal status. The pipeline runs Claude + retrieval which
  // can take 20–40s on a cold deploy; allow generous headroom.
  const deadline = Date.now() + 90_000;
  let lastStatus = "queued";
  let lastBody: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${BASE}/api/counsel/cases/${caseId}`);
    if (r.status !== 200) continue;
    lastBody = (await r.json()) as Record<string, unknown>;
    lastStatus = String(lastBody.status ?? "queued");
    if (lastStatus === "complete" || lastStatus === "error") break;
  }
  if (lastStatus !== "complete") {
    throw new Error(`pipeline did not complete (last status=${lastStatus})`);
  }
  // Defense + Counter-attack content lives on the case row as JSON blobs.
  const blob = JSON.stringify(lastBody ?? {}).toLowerCase();
  if (!blob.includes("defense")) {
    throw new Error("case missing Defense content");
  }
  if (!blob.includes("counter")) {
    throw new Error("case missing Counter-attack content");
  }
  return `caseId=${caseId.slice(0, 8)}… status=complete, defense+counter present`;
}

async function main(): Promise<void> {
  console.log(`[smoke] target = ${BASE}\n`);
  const results: Result[] = [];
  results.push(
    await check("landing renders Lexor shell", () =>
      expectGet(`${BASE}/lexor/`, [200], ["<title>", "Lexor"]),
    ),
  );
  results.push(
    await check("upload page loads", () =>
      expectGet(`${BASE}/lexor/upload`, [200], ["Lexor"]),
    ),
  );
  results.push(
    await check("map page loads", () =>
      expectGet(`${BASE}/lexor/map`, [200], ["Lexor"]),
    ),
  );
  results.push(
    await check("voice page loads", () =>
      expectGet(`${BASE}/lexor/voice`, [200], ["Lexor"]),
    ),
  );
  results.push(
    await check("disclaimer page loads", () =>
      expectGet(`${BASE}/lexor/legal/disclaimer`, [200], ["Lexor"]),
    ),
  );
  results.push(
    await check("API healthz responds", () =>
      expectGet(`${BASE}/api/counsel/healthz`, [200]),
    ),
  );
  results.push(
    await check("voice info advertises Twilio config", () =>
      expectGet(`${BASE}/api/counsel/voice/info`, [200], ["whatsappNumber"]),
    ),
  );
  results.push(
    await check("map stats returns JSON", () =>
      expectGet(`${BASE}/api/counsel/map/stats`, [200], ["totalPins"]),
    ),
  );
  results.push(
    await check("coalitions list responds", () =>
      expectGet(`${BASE}/api/counsel/coalitions`, [200]),
    ),
  );
  results.push(
    await check(
      "upload sample letter → case completes with Defense + Counter-attack",
      uploadAndPollCase,
    ),
  );

  for (const r of results) {
    console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.name} — ${r.detail}`);
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
