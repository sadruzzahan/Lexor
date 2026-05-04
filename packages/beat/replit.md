# Workspace

## Overview

pnpm workspace monorepo using TypeScript. This is **Beat** — a Detective Field Kit web app with multi-agent investigation workflows, SSE streaming, and a 4-pane live agent dashboard.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec → `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite (`artifacts/beat/`)
- **AI**: Anthropic, Gemini, OpenAI via Replit AI Integrations (keys auto-provisioned)
- **File uploads**: multer (disk storage → `/tmp/beat-uploads`)

## Architecture

```
artifacts/
  api-server/          Express 5 API, port 8080, served at /api
    src/routes/
      health.ts        GET /api/healthz (DB ping + dependency checks)
      users.ts         CRUD /api/v1/users
      cases.ts         CRUD /api/v1/cases
      files.ts         Multipart upload /api/v1/cases/:id/files
      runs.ts          Runs + SSE /api/v1/cases/:id/run + /api/v1/runs/:id/events
      drafts.ts        Statement drafts /api/v1/cases/:id/draft
      artifacts.ts     Run artifacts /api/v1/runs/:id/artifacts
  beat/                React + Vite frontend at previewPath "/"
    src/
      pages/
        welcome.tsx    / — welcome with demo sign-in
        investigations.tsx  /investigations — case list
        new-investigation.tsx  /investigations/new — voice + text input
        beat-view.tsx  /investigations/:id — 4-pane agent dashboard
        agent-inspector.tsx  /investigations/:id/agent — raw event log
        settings.tsx   /me — profile, tier, sub-processors
      components/
        AgentPane.tsx      — pane with halo animation + contextual empty states + error retry
        BottomNav.tsx      — bottom navigation bar (aria-labels, aria-current)
        TierBanner.tsx     — fixed amber "Free tier · Not for evidentiary use" strip above nav
        RecordingIndicator.tsx — global fixed red pill shown while MediaRecorder is active
        CitationChip.tsx   — inline citation badges + SourceModal
        CameraCapture.tsx  — dialog for camera/photo upload
        AudioRecorder.tsx  — dialog for audio recording + auto-upload on stop
        PhotoGallery.tsx   — scrollable photo thumbnails under SceneCaptureTagger pane
        RecordingConsentModal.tsx — consent gate (sessionStorage key)
      contexts/
        RecordingContext.tsx — global isRecording state; consumed by AudioRecorder + RecordingIndicator
      hooks/
        useAgentRun.ts     — SSE EventSource hook for live agent state management
        useRunReplay.ts    — 4× speed replay hook (fetches stored events, replays via setInterval)
        useFileUpload.ts   — multipart upload hook with retry logic
  mockup-sandbox/      Vite component preview server

lib/
  api-spec/            OpenAPI 3.1 spec + Orval config → codegen
  api-zod/             Generated Zod validators (from codegen)
  api-client-react/    Generated React Query hooks (from codegen)
  db/                  Drizzle ORM schema + migration config
    src/schema/
      users.ts         users table (tier: free|agency)
      cases.ts         cases table (uuid PK, status enum, soft-delete)
      case-files.ts    case_files table (multer disk storage, sha256, storageUrl)
      runs.ts          runs table (status enum, timestamps, cost)
      run-events.ts    run_events table (SSE event log, idx ordering)
      artifacts.ts     artifacts table (per-agent outputs, kind enum)
      drafts.ts        drafts table (case-level statement drafts)
      chain-of-custody.ts  chain-of-custody audit log
      citations.ts     citations table
```

## Agent Roster — Mastra Workflow Orchestration

All mock SSE replaced with real Mastra `createWorkflow`/`createStep` + real LLM calls via Replit AI Integrations proxy.

**Workflow topology** (`orchestrator.ts` — `createDetectiveWorkflow`):
- Phase 1 (serial): `JurisdictionDetector` → detects jurisdiction + statutes via `gemini-2.5-flash`
- Phase 2 (parallel): `SceneCaptureTagger` ‖ `WitnessMapper` ‖ `SuspectBackground`
- Phase 3 (serial): `StatementDrafter` reads parallel results via `getStepResult()`

1. **JurisdictionDetector** — `createStep` in Mastra; `gemini-2.5-flash`; persists to `cases.jurisdictionContext`; propagates jurisdiction object to all downstream steps
2. **SceneCaptureTagger** — `createStep`; `gemini-2.5-flash` Vision; emits distinct `tool_call`/`tool_result` events per photo; safe to stream (not OSINT)
3. **WitnessMapper** — `createStep`; `claude-sonnet-4-6`; jurisdiction propagated to prompt; streams partial_result chunks
4. **SuspectBackground** — `createStep`; Tavily OSINT → full LLM buffer (no streaming) → E2B/inline citation verification → only verified citations emitted to client; drops stored in `policy_drops` table
5. **StatementDrafter** — `createStep`; `claude-sonnet-4-6`; artifact stores full markdown `body`; citation markers: `[cite:photo-N]`, `[cite:witness-N]`, `[cite:suspect-N]`, `[cite:audio-N]`

**SSE idx consistency** (`DbSink` is the single idx authority):
- `DbSink.emit()` assigns idx atomically, persists to DB, then calls `SseEmitter.writeIndexed(idx, ...)` with the same idx
- `SseEmitter` has no independent counter; it always writes the DbSink-assigned idx
- Replay path reads idx values from DB — identical to what live clients saw
- Result: DB, live stream, and replay all have identical monotonic idx sequences

**Event types** (distinct per protocol spec):
- `run_started`, `subagent_started` — lifecycle
- `tool_call` / `tool_result` — separate events (not embedded in partial_result)
- `partial_result` — LLM text chunk (safe, verified content only)
- `subagent_completed` — structured result
- `error`, `done` — terminal

Agent source: `artifacts/api-server/src/agents/`
- `orchestrator.ts` — Mastra `createWorkflow`/`createStep`, `.then()/.parallel()/.commit()` graph
- `types.ts` — shared interfaces (`AgentContext`, `JurisdictionContext`, etc.)
- `jurisdictionDetector.ts` / `sceneCaptureTagger.ts` / `witnessMapper.ts` / `suspectBackground.ts` / `statementDrafter.ts`

Sink layer: `artifacts/api-server/src/lib/`
- `dbSink.ts` — sole idx authority + DB writer; forwards via `SseEmitter.writeIndexed()`
- `sseEmitter.ts` — HTTP SSE writer; `writeIndexed(idx, ...)` accepts external idx (no self-increment)
- `eventSink.ts` — `IEventSink` interface
- `citationVerifier.ts` — E2B sandbox (with fallback to inline fetch); SSRF-mitigated

Run cancellation: AbortController per run; cancel via `DELETE /api/v1/runs/:id`; client disconnect also aborts
Completed run replay: `GET /api/v1/runs/:id/events` replays stored events from DB when run is already done

## Design System (Cursor-green)

- Background: `#0A0F0C` → HSL 150 33% 3%
- Surface: `#121814` → HSL 150 14% 8%
- Elevated: `#1A2220` → HSL 150 13% 11%
- Text primary: `#F2FFF8`
- Text secondary: `#8FA89A`
- Accent: `#00FF88` → HSL 151 100% 50%
- Warning: `#F5A623`
- Error: `#FF453A`
- Font: Inter
- Animation: `agent-halo` (radial green glow pulse, 1.6s infinite)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/beat run dev` — run Beat frontend locally

## Compliance & Polish (Task #5)

- **TierBanner** — fixed bottom strip on every page; amber "Free tier · Not for evidentiary use"
- **RecordingIndicator** — global red pill "● Recording" shown whenever MediaRecorder is active; driven by `RecordingContext`
- **Jurisdiction compliance** — Settings/me shows CJIS (US), PACE/CPIA (GB), GDPR/LED (EU), BNSS/DPDPA (IN), or fallback note based on `navigator.language`
- **Draft export** — "Export" button on completed draft downloads `.md` + `.json` sidecar via browser Blob URL (no round-trip)
- **Run replay** — "Replay" button on completed beat-view; `useRunReplay` fetches stored SSE events and replays at 4× speed
- **Empty pane states** — each idle AgentPane shows a contextual icon+hint (Camera, Mic, UserSearch, FileText)
- **Error pane states** — each error AgentPane shows an inline error card with Retry button
- **Accessibility** — aria-label on all icon buttons, role="status"/aria-live on streaming regions, aria-current="page" on BottomNav links
- **Sub-processors** — Settings lists 6 sub-processors with external privacy policy links
- **E2E tests** — `e2e/beat-polish.spec.ts` covers welcome, investigations, new-investigation, beat-view, settings, compliance, accessibility; `e2e/beat-capture.spec.ts` 4 @api tests all pass

## Secrets

- `SESSION_SECRET` — Express session secret
- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — auto-provisioned
- `AI_INTEGRATIONS_GEMINI_BASE_URL` / `AI_INTEGRATIONS_GEMINI_API_KEY` — auto-provisioned
- `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` — auto-provisioned

## Authentication (Clerk — Task #19)

- **Provider**: Replit-managed Clerk (email/password + Google SSO)
- **Frontend**: `@clerk/react` with `ClerkProvider` wrapping the app; branded dark-green appearance matching Beat design system
- **Server**: `@clerk/express` `clerkMiddleware` mounted in `app.ts`; `requireAuth` middleware in `routes/auth.ts`
- **User identity**: Clerk user ID (`user_xxxxx`) is stored directly as the `users.id` (text PK) in the DB — no separate mapping table needed
- **Auto-provisioning**: `GET /api/v1/auth/me` (auth-required) looks up or creates a DB user record on first sign-in, pulling displayName/email from Clerk
- **Route protection**: All case-related endpoints require auth; cases are scoped to the authenticated user's ID (server-side filter)
- **Welcome page**: Replaced demo CTA with "Sign In" + "Create Account" buttons; signed-in users redirected to `/investigations`
- **Settings page**: Shows Clerk user name/email/tier + "Sign out" button
- **Clerk proxy**: `clerkProxyMiddleware` mounted at `/api/__clerk` (active in production only)
- **Auth context**: `AuthContext.tsx` / `useCurrentUser()` provides `{ userId, user, isLoading }` to components

## Clerk Environment Variables (auto-provisioned)

- `CLERK_SECRET_KEY` — server secret
- `CLERK_PUBLISHABLE_KEY` — server publishable key
- `VITE_CLERK_PUBLISHABLE_KEY` — frontend publishable key

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
