/**
 * G7 smoke: drive the real defender orchestrator end-to-end via SSE.
 *
 *   pnpm --filter @workspace/api-server run smoke:g7
 *
 * Hits the running api-server, starts a run on the seeded sample case,
 * consumes /events until `done`, and asserts:
 *   - run_started came first
 *   - planner_step landed before any subagent_completed
 *   - all 4 defender subagents emitted subagent_started AND subagent_completed
 *   - final_result + done arrived
 *   - no error events
 *   - wall time < 90s
 */
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const BASE = process.env.API_BASE ?? "http://localhost:80/api/v1";
const SAMPLE_CASE_ID = "00000000-0000-0000-0000-0000000000bb";
const HEADERS = { "x-demo-user": "demo_user_pd", "content-type": "application/json" };
const EXPECTED_SUBAGENTS = new Set([
  "TimelineBuilder",
  "EvidenceGapAuditor",
  "CrossExaminationGenerator",
  "PrecedentFinder",
]);
const HARD_TIMEOUT_MS = 90_000;

interface EventLine {
  type: string;
  data: Record<string, unknown>;
}

async function startRun(): Promise<string> {
  const idempotencyKey = randomUUID();
  const r = await fetch(`${BASE}/cases/${SAMPLE_CASE_ID}/run`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      goal: "Prepare suppression motion on warrantless search",
      idempotencyKey,
    }),
  });
  if (!r.ok) {
    throw new Error(`POST /cases/:id/run -> ${r.status} ${await r.text()}`);
  }
  const json = (await r.json()) as { runId: string };
  console.log(`[smoke] runId=${json.runId}`);
  return json.runId;
}

async function consumeEvents(runId: string): Promise<EventLine[]> {
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), HARD_TIMEOUT_MS).unref();

  const r = await fetch(`${BASE}/runs/${runId}/events`, {
    method: "GET",
    headers: { ...HEADERS, accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  if (!r.ok || !r.body) {
    throw new Error(`SSE ${r.status} ${r.statusText}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const collected: EventLine[] = [];

  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      let evType = "message";
      let dataLine = "";
      for (const ln of block.split("\n")) {
        if (ln.startsWith("event:")) evType = ln.slice(6).trim();
        else if (ln.startsWith("data:")) dataLine += ln.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine);
        const ev: EventLine = { type: evType, data };
        collected.push(ev);
        const inner = (data && typeof data === "object" && "type" in data
          ? (data as { type?: string }).type
          : evType) ?? evType;
        process.stdout.write(`[smoke] ${String(inner).padEnd(22)} `);
        if (inner === "subagent_started" || inner === "subagent_completed") {
          process.stdout.write(` subagent=${(data as { subagent?: string }).subagent ?? "?"}`);
        }
        if (inner === "tool_call" || inner === "tool_result") {
          process.stdout.write(
            ` subagent=${(data as { subagent?: string }).subagent ?? "?"} tool=${(data as { tool?: string }).tool ?? "?"}`,
          );
        }
        process.stdout.write("\n");
        if (inner === "done") {
          clearTimeout(deadline);
          ctrl.abort();
          break outer;
        }
      } catch (err) {
        console.warn("[smoke] failed to parse SSE data:", dataLine, err);
      }
    }
  }
  return collected;
}

function assertContract(events: EventLine[]): void {
  const innerType = (e: EventLine): string =>
    (e.data && typeof e.data === "object" && "type" in e.data
      ? (e.data as { type?: string }).type
      : e.type) ?? e.type;

  const types = events.map(innerType);
  console.log(`[smoke] received ${events.length} events: ${[...new Set(types)].join(", ")}`);

  if (types[0] !== "run_started") throw new Error(`expected run_started first, got ${types[0]}`);
  if (!types.includes("planner_step")) throw new Error("missing planner_step");
  if (!types.includes("final_result")) throw new Error("missing final_result");
  if (!types.includes("done")) throw new Error("missing done");

  const errors = events.filter((e) => innerType(e) === "error");
  if (errors.length) throw new Error(`unexpected error events: ${JSON.stringify(errors)}`);

  const plannerIdx = types.indexOf("planner_step");
  const firstCompletedIdx = types.indexOf("subagent_completed");
  if (firstCompletedIdx >= 0 && firstCompletedIdx < plannerIdx) {
    throw new Error("subagent_completed arrived before planner_step");
  }

  const startedSubs = new Set<string>();
  const completedSubs = new Set<string>();
  for (const e of events) {
    const t = innerType(e);
    const sub = (e.data as { subagent?: string }).subagent;
    if (!sub) continue;
    if (t === "subagent_started" && EXPECTED_SUBAGENTS.has(sub)) startedSubs.add(sub);
    if (t === "subagent_completed" && EXPECTED_SUBAGENTS.has(sub)) completedSubs.add(sub);
  }
  for (const need of EXPECTED_SUBAGENTS) {
    if (!startedSubs.has(need)) throw new Error(`missing subagent_started for ${need}`);
    if (!completedSubs.has(need)) throw new Error(`missing subagent_completed for ${need}`);
  }
  console.log(`[smoke] ✓ all 4 defender subagents started + completed`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const runId = await startRun();
  // Tiny breathing room so the orchestrator has emitted run_started.
  await sleep(50);
  const events = await consumeEvents(runId);
  const wall = Date.now() - t0;
  console.log(`[smoke] wall=${wall}ms`);
  assertContract(events);
  if (wall > HARD_TIMEOUT_MS) throw new Error(`wall ${wall}ms exceeded ${HARD_TIMEOUT_MS}ms`);
  console.log(`[smoke] ✅ G7 contract satisfied`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
