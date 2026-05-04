import { z } from "zod";
import {
  GetCaseResponse,
  ListCasesResponse,
  UpdateCaseResponse,
  GetRunResponse,
  GetCaseFileResponse,
} from "@workspace/api-zod";

const StartRunResponseSchema = z.object({
  runId: z.string().uuid(),
  idempotent: z.boolean(),
});

const CaseFileSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  sourceType: z.enum(["upload", "drive", "scan", "audio"]),
  driveFileId: z.string().optional(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number(),
  sha256: z.string().length(64),
  detectedLanguage: z.string().optional(),
  createdAt: z.coerce.date(),
});

type SseEvent = { id: number; data: { type: string; idx?: number } & Record<string, unknown> };

// Structural shape every persisted/streamed agent event must satisfy. We don't
// import a single `AgentEvent` schema from api-zod (it isn't a discriminated
// union there yet — that lands with G6/G7 when the real Mastra event payloads
// arrive); for G3 we assert each event carries the canonical envelope and is
// one of the known type strings emitted by mockOrchestrator.
const KNOWN_EVENT_TYPES = new Set([
  "run_started",
  "planner_step",
  "subagent_started",
  "subagent_completed",
  "tool_call",
  "tool_result",
  "partial_result",
  "final_result",
  "done",
  "error",
]);
const AgentEventEnvelope = z
  .object({
    type: z.string(),
    idx: z.number().int().nonnegative(),
  })
  .passthrough();

const BASE = process.env["API_BASE"] ?? "http://localhost:8080";
const HDRS = { "x-demo-user": "demo_user_pd" };

let pass = 0;
let fail = 0;
function ok(msg: string): void {
  pass++;
  console.log(`  ok  ${msg}`);
}
function bad(msg: string, err?: unknown): void {
  fail++;
  console.error(`  FAIL ${msg}${err ? `\n      ${String(err)}` : ""}`);
}

async function jsonReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...HDRS,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function streamSse(
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<SseEvent[]> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...HDRS, accept: "text/event-stream", ...extraHeaders },
  });
  if (!res.body) throw new Error("no body on SSE response");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
  let currentId = -1;
  let currentData = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (currentData) {
          const parsed: unknown = JSON.parse(currentData);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "type" in parsed &&
            typeof (parsed as { type: unknown }).type === "string"
          ) {
            const event = parsed as SseEvent["data"];
            events.push({ id: currentId, data: event });
            if (event.type === "done") {
              await reader.cancel();
              return events;
            }
          }
        }
        currentId = -1;
        currentData = "";
        continue;
      }
      if (line.startsWith("id:")) currentId = Number(line.slice(3).trim());
      else if (line.startsWith("data:")) currentData += line.slice(5).trim();
    }
  }
  return events;
}

async function main(): Promise<void> {
  console.log(`\n=== G3 contract smoke against ${BASE} ===\n`);

  // R-01 POST /cases — flat Case shape (UpdateCaseResponse mirrors it).
  const created = await jsonReq("POST", "/api/v1/cases", {
    title: "Smoke Test Case",
    description: "contract smoke",
    rolePack: "defender",
  });
  if (created.status !== 201) bad(`POST /cases status ${created.status}`);
  let caseId: string;
  try {
    const parsed = UpdateCaseResponse.parse(created.body);
    caseId = parsed.id;
    ok("POST /cases → UpdateCaseResponse (single Case shape)");
  } catch (e) {
    bad("POST /cases response schema", e);
    return;
  }

  // R-03 GET /cases — list shape.
  const list = await jsonReq("GET", "/api/v1/cases");
  try {
    ListCasesResponse.parse(list.body);
    ok("GET /cases → ListCasesResponse");
  } catch (e) {
    bad("GET /cases response schema", e);
  }

  // R-02 GET /cases/:id — wrapped {case, files, artifacts}.
  const fetched = await jsonReq("GET", `/api/v1/cases/${caseId}`);
  try {
    GetCaseResponse.parse(fetched.body);
    ok("GET /cases/:id → GetCaseResponse");
  } catch (e) {
    bad("GET /cases/:id response schema", e);
  }

  // R-06 POST /cases/:id/files — bare CaseFile.
  const fd = new FormData();
  fd.append("sourceType", "upload");
  fd.append(
    "file",
    new Blob([`smoke ${Date.now()}`], { type: "text/plain" }),
    "smoke.txt",
  );
  const uploadRes = await fetch(`${BASE}/api/v1/cases/${caseId}/files`, {
    method: "POST",
    headers: HDRS,
    body: fd,
  });
  const uploadBody: unknown = await uploadRes.json();
  let fileId: string;
  try {
    const file = CaseFileSchema.parse(uploadBody);
    fileId = file.id;
    ok("POST /cases/:id/files → CaseFile (bare upload contract)");
  } catch (e) {
    bad("upload response schema", e);
    return;
  }

  // R-09 GET /cases/:id/files/:fileId — CaseFileDetail (with signedUrl).
  const fileGet = await jsonReq("GET", `/api/v1/cases/${caseId}/files/${fileId}`);
  let signedUrl: string;
  try {
    const detail = GetCaseFileResponse.parse(fileGet.body);
    signedUrl = detail.signedUrl;
    ok("GET /cases/:id/files/:fileId → GetCaseFileResponse");
  } catch (e) {
    bad("GET file response schema", e);
    return;
  }

  // signedUrl from R-09 must actually serve the bytes (with auth).
  const blobRes = await fetch(signedUrl, { headers: HDRS });
  if (blobRes.status === 200 && (await blobRes.text()).startsWith("smoke ")) {
    ok("signedUrl serves the original bytes");
  } else {
    bad(`signedUrl fetch failed (status ${blobRes.status})`);
  }

  // R-10 POST /cases/:id/run — StartRunResponse. Spec path is singular `/run`
  // and StartCaseRunBody requires idempotencyKey to be a UUID.
  const idemKey = crypto.randomUUID();
  const startRes = await fetch(`${BASE}/api/v1/cases/${caseId}/run`, {
    method: "POST",
    headers: { ...HDRS, "content-type": "application/json" },
    body: JSON.stringify({ goal: "Smoke", idempotencyKey: idemKey }),
  });
  if (startRes.status !== 201) bad(`POST /cases/:id/run status ${startRes.status}`);
  const startBody: unknown = await startRes.json();
  let runId: string;
  try {
    const parsed = StartRunResponseSchema.parse(startBody);
    runId = parsed.runId;
    ok("POST /cases/:id/run → StartRunResponse ({runId, idempotent})");
  } catch (e) {
    bad("start run response schema", e);
    return;
  }

  // R-11 SSE drain (no resume).
  const full = await streamSse(`/api/v1/runs/${runId}/events`);
  if (full.length > 0 && full[full.length - 1]!.data.type === "done") {
    ok(`SSE drain produced ${full.length} events ending in done`);
  } else {
    bad(`SSE drain did not end in done (got ${full.length} events)`);
  }
  if (full.every((e, i) => e.id === i)) ok("SSE ids are monotonic 0..N-1");
  else bad("SSE ids not monotonic 0..N-1");

  // Every event must satisfy the AgentEvent envelope and use a known type.
  let badPayloads = 0;
  for (const ev of full) {
    try {
      const parsed = AgentEventEnvelope.parse(ev.data);
      if (!KNOWN_EVENT_TYPES.has(parsed.type)) {
        badPayloads++;
        bad(`unknown event type "${parsed.type}" at idx ${ev.id}`);
      } else if (parsed.idx !== ev.id) {
        badPayloads++;
        bad(`payload.idx ${parsed.idx} != stream id ${ev.id}`);
      }
    } catch (e) {
      badPayloads++;
      bad(`event idx ${ev.id} failed envelope schema`, e);
    }
  }
  if (badPayloads === 0) ok(`all ${full.length} events match AgentEvent envelope + known types`);

  // R-11 SSE resume via ?since=N.
  const halfIdx = Math.max(0, Math.floor(full.length / 2) - 1);
  const expectTailLen = full.length - 1 - halfIdx;
  const tail = await streamSse(`/api/v1/runs/${runId}/events?since=${halfIdx}`);
  if (tail.length === expectTailLen && tail[0]!.id === halfIdx + 1) {
    ok(`?since=${halfIdx} replayed ${tail.length} tail events from id ${halfIdx + 1}`);
  } else {
    bad(
      `?since=${halfIdx} expected ${expectTailLen} tail events from ${halfIdx + 1}, ` +
        `got ${tail.length} from ${tail[0]?.id}`,
    );
  }

  // R-11 SSE resume via Last-Event-ID header.
  const tail2 = await streamSse(`/api/v1/runs/${runId}/events`, {
    "last-event-id": String(halfIdx),
  });
  if (tail2.length === expectTailLen && tail2[0]!.id === halfIdx + 1) {
    ok(`Last-Event-ID:${halfIdx} replayed ${tail2.length} tail events`);
  } else {
    bad(
      `Last-Event-ID:${halfIdx} expected ${expectTailLen} from ${halfIdx + 1}, ` +
        `got ${tail2.length} from ${tail2[0]?.id}`,
    );
  }

  // R-12 GET /runs/:id — terminal-status convergence.
  const final = await jsonReq("GET", `/api/v1/runs/${runId}`);
  try {
    const run = GetRunResponse.parse(final.body);
    if (run.status === "completed") ok("final GET /runs/:id status=completed");
    else bad(`final GET /runs/:id status=${run.status}`);
  } catch (e) {
    bad("final GET /runs/:id schema", e);
  }

  // R-13 cancel-race: start a fresh run and race the cancel against the
  // orchestrator. Whichever side persists `done` first wins; the SSE stream
  // must end with exactly one `done` event regardless of who wins.
  const raceTrials = 3;
  let raceFailures = 0;
  let parityFailures = 0;
  for (let i = 0; i < raceTrials; i++) {
    const startRaceRes = await fetch(`${BASE}/api/v1/cases/${caseId}/run`, {
      method: "POST",
      headers: { ...HDRS, "content-type": "application/json" },
      body: JSON.stringify({ goal: `race-${i}`, idempotencyKey: crypto.randomUUID() }),
    });
    const startRaceBody = StartRunResponseSchema.parse(await startRaceRes.json());
    const raceRunId = startRaceBody.runId;
    const streamPromise = streamSse(`/api/v1/runs/${raceRunId}/events`);
    // Random jitter so cancel sometimes lands before, sometimes after, the
    // orchestrator has emitted a few events.
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 250)));
    await fetch(`${BASE}/api/v1/runs/${raceRunId}/cancel`, { method: "POST", headers: HDRS });
    const events = await streamPromise;
    const doneEvents = events.filter((e) => e.data.type === "done");
    if (doneEvents.length !== 1) {
      raceFailures++;
      bad(`cancel-race trial ${i}: expected exactly 1 done, got ${doneEvents.length}`);
      continue;
    }
    // Parity: terminal `done.cancelled` must match final run.status.
    const doneCancelled = doneEvents[0]!.data.cancelled === true;
    const finalRes = await fetch(`${BASE}/api/v1/runs/${raceRunId}`, { headers: HDRS });
    const finalRun = GetRunResponse.parse(await finalRes.json());
    const expectedStatus = doneCancelled ? "cancelled" : "completed";
    if (finalRun.status !== expectedStatus) {
      parityFailures++;
      bad(
        `cancel-race trial ${i}: parity violation — done.cancelled=${doneCancelled} but status=${finalRun.status}`,
      );
    }
  }
  if (raceFailures === 0) ok(`cancel-race: ${raceTrials} trials each emitted exactly 1 done`);
  if (parityFailures === 0) ok(`cancel-race: terminal event/status parity holds across ${raceTrials} trials`);

  await fetch(`${BASE}/api/v1/cases/${caseId}`, { method: "DELETE", headers: HDRS });

  console.log(`\n=== ${pass} pass / ${fail} fail ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
