# Beat — Detective Field Kit

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://orm.drizzle.team/)
[![Mastra](https://img.shields.io/badge/Mastra-workflows-7C3AED?style=flat-square)](https://mastra.ai/)
[![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?style=flat-square)](https://clerk.com/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)

> **Beat** is a "Detective Field Kit" — a multi-agent investigation web app that turns voice/text intake into a structured case file with jurisdiction-aware scene tagging, witness mapping, suspect background research, and a citation-verified statement draft. Every agent run streams over **SSE** to a four-pane live dashboard.

---

## What it does

1. **Sign in with Clerk.** First request to `GET /api/v1/auth/me` provisions a `users` row keyed by Clerk user id.
2. **Create a case.** Title, goal, jurisdiction context (jsonb). Cases default to `rolePack: "detective"`.
3. **Upload evidence.** Multipart upload of photos, audio, notes — stored to disk (`/tmp/beat-uploads`) or object storage.
4. **Kick off a run.** A **Mastra** workflow (`artifacts/api-server/src/agents/orchestrator.ts`) executes:
   - Jurisdiction detection
   - **Parallel** scene tagging + witness mapping + suspect background (Tavily web research with citation verification)
   - Statement drafting
5. **Watch it stream.** `GET /api/v1/runs/:runId/events` is an SSE feed with monotonic `idx` ordering; the four-pane dashboard renders each agent's progress in real time. Completed runs replay from the database with the same ordering guarantees.
6. **Share results.** Time-limited share tokens (`routes/share.ts`) give public read access to a case + draft.

---

## Project structure

```
artifacts/
  api-server/                Express 5 API on /api
    src/routes/
      auth.ts                Clerk auth + provisioning
      cases.ts               Case CRUD
      files.ts               Multipart evidence upload
      runs.ts                Run + SSE
      drafts.ts              Statement drafts
      artifacts.ts           Per-run structured outputs
      share.ts               Share tokens
    src/agents/orchestrator.ts   Mastra workflow definition
  beat/                      React + Vite frontend
    src/pages/
      welcome.tsx            Landing + demo sign-in
      investigations.tsx     Case list
      new-investigation.tsx  Voice + text intake
      beat-view.tsx          4-pane agent dashboard
      agent-inspector.tsx    Raw event log
      settings.tsx           Profile, tier, sub-processors
    src/components/
      AgentPane.tsx          Halo-animated pane with empty/error states
  mockup-sandbox/            Component preview
lib/
  db/                        users, cases, case-files, runs, run-events, artifacts, drafts, citations, chain-of-custody, policy-drops, share-tokens
  api-spec, api-client-react, api-zod
  agent-protocol             Shared agent message contracts
```

---

## Tech stack

- **Workspace:** pnpm, TypeScript 5.9, OpenAPI 3.1 → Orval → typed React Query hooks
- **Backend:** Express 5, Drizzle + PostgreSQL, Pino, multer (disk uploads), `tsx` for dev
- **Frontend:** React 19, Vite 7, Tailwind, shadcn-style components, Framer Motion
- **Agents:** Mastra workflow engine, multi-AI via Replit AI Integrations (Anthropic + Gemini + OpenAI)
- **Research:** Tavily (with citation verification)
- **Auth:** Clerk
- **Streaming:** Server-Sent Events with replay (`run_events` table provides idempotent ordering)
- **E2E tests:** Playwright (`pnpm run test:e2e`)

---

## Database

12 schema files under `lib/db/src/schema/`:

| Table | Purpose |
|---|---|
| `users` | Clerk-provisioned user, with `tier` enum (free / agency) |
| `cases` | Investigation metadata, `rolePack` (default "detective"), `jurisdictionContext` jsonb |
| `case_files` | Uploaded evidence files |
| `runs` | Mastra workflow executions |
| `run_events` | SSE event log with monotonic `idx` (DbSink pattern for replay) |
| `artifacts` | Structured per-sub-agent outputs |
| `drafts` | Case-level statement drafts |
| `citations` | Verified source links from Tavily research |
| `chain_of_custody` | Evidence handling audit trail |
| `share_tokens` | Time-limited public read tokens |
| `policy_drops` | Policy snapshots |

---

## The Lexor merger

Beat is one third of a planned three-repo unification into [**Lexor**](https://github.com/sadruzzahan/Lexor). In the merged product, Beat becomes the **`detective` track** alongside `complainant` (consumer intake, was Lexor v1) and `defender` (criminal-defense copilot, was [Briefcased](https://github.com/sadruzzahan/Briefcased)). One database, one auth, one design system, three role packs.

See [`Lexor/MERGER_PLAN.md`](https://github.com/sadruzzahan/Lexor/blob/main/MERGER_PLAN.md) for the architecture and phase-by-phase migration plan.

Until the merger lands, **[Briefcased](https://github.com/sadruzzahan/Briefcased)** is the public-facing flagship; Beat ships standalone as documented above.

---

## License

MIT.
