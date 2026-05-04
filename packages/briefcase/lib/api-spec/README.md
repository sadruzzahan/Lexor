# @workspace/api-spec

Canonical OpenAPI 3.1 contract for the JusticeOS engine. The api-server
(`artifacts/api-server`) and the web app both consume this spec through codegen.

## Codegen

```bash
pnpm --filter @workspace/api-spec run codegen
```

Outputs:

- `lib/api-client-react/src/generated/` — React Query hooks + TypeScript types
  (consumed by the web app).
- `lib/api-zod/src/generated/` — Zod runtime schemas (consumed by the api-server
  for request/response validation).

## SSE endpoints — important consumer note

A few endpoints stream Server-Sent Events instead of returning a single JSON
body:

- `GET /v1/runs/{runId}/events` (R-11 — agent event stream)
- `POST /v1/cases/{caseId}/files/from-drive` (R-07 — Drive file ingest)
- `POST /v1/cases/{caseId}/files/from-folder` (R-08 — Drive folder ingest)

OpenAPI/Orval do not model SSE as a first-class transport. The generated
React Query hooks (`useStreamRunEvents`, etc.) call the endpoint via
`customFetch` and resolve once with the full response body — they will **not**
deliver intermediate events.

For real streaming consumption, use the browser's `EventSource` (or
`react-native-sse` for the future mobile build) directly:

```ts
const url = new URL("/api/v1/runs/" + runId + "/events", location.origin);
url.searchParams.set("since", String(lastSeenIdx));
const source = new EventSource(url, { withCredentials: true });
source.addEventListener("agent_event", (e) => {
  const event = JSON.parse(e.data); // matches the generated AgentEvent type
});
```

Use the generated `AgentEvent` (or `IngestEvent`) TypeScript type from
`@workspace/api-client-react` to type the parsed payload. Resume after a
disconnect by passing `?since=<lastIdx>` (or letting the browser auto-send
`Last-Event-ID`); see the description block on R-11 in `openapi.yaml` for full
semantics.

## Adding new endpoints

1. Edit `openapi.yaml`. Keep the `info.title` value as `"Api"` — the path
   transformer in `orval.config.ts` enforces this and downstream import paths
   depend on it.
2. Run `pnpm --filter @workspace/api-spec run codegen` (also runs
   `pnpm -w run typecheck:libs`).
3. Run `pnpm run typecheck` from the workspace root to verify api-server and
   any other consumers still compile.

Engine-only events (`cost_update`, `model_routed`, `cache_hit`,
`tool_progress`, `judge_score`, `policy_drop`, `agent_message`,
`branch_started`, `guardrail_warning`) are intentionally **not** in
`AgentEvent` yet — they are added later by their owning gates (G21–G23).
