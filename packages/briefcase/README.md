# Briefcased — JusticeOS Web

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://orm.drizzle.team/)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-multi--provider-000000?style=flat-square&logo=vercel&logoColor=white)](https://sdk.vercel.ai/)
[![Tesseract.js](https://img.shields.io/badge/Tesseract.js-OCR-1E1E1E?style=flat-square)](https://tesseract.projectnaptha.com/)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](#license)

> **Briefcased** is a production-grade **case copilot for criminal-defense lawyers**. It ingests evidence (photos, PDFs, transcripts), runs multi-agent AI workflows for **Brady review**, **jury notes**, **plea-path analysis**, and **adversarial argument review**, then walks the lawyer through **courtroom rehearsal** before they ever step into a hearing.
>
> 432 TypeScript/TSX files. 147 pages. 135 components. 5 database migrations. One coherent product.

---

## What it does

Briefcased is built around the way a defense lawyer actually moves through a case:

1. **Intake.** Create a case, attach evidence files. The OCR pipeline (Tesseract.js + pdfjs-dist) extracts text from photos, scanned discovery, and PDFs — fully client-side so sensitive evidence never leaves the browser unless the lawyer chooses to run a cloud agent.

2. **Triage.** A multi-agent run streams over **SSE**. The agent console exposes every prompt, tool call, retrieval result, and verification step in real time — auditable by design.

3. **Brady review.** Dedicated agent surfaces potential Brady material from disclosure documents, flagged with citations back to the source files.

4. **Jury & plea-path analysis.** Generates jury-selection notes and ranked plea-path scenarios with explicit assumptions.

5. **Adversarial review.** A separate agent steel-mans the prosecution's strongest theory of the case, then runs counter-arguments — used to pressure-test the defense before trial.

6. **Courtroom rehearsal.** Simulated cross-examination mode. The agent plays opposing counsel; the lawyer practices their direct, cross, and closing.

7. **Export & share.** Time-limited share tokens for co-counsel; PDF export (jspdf) for paralegal hand-off.

> **Demo mode:** unauthenticated previews use an `x-demo-user` header documented in `artifacts/briefcase-app/README.md` so the agent flows can be exercised without setting up Google OAuth.

---

## Tech stack

| Layer | Choice |
|---|---|
| **Workspace** | pnpm workspaces, TypeScript 5.9, strict mode |
| **Backend** | Express 5, Drizzle ORM + PostgreSQL, Pino structured logging |
| **Frontend** | React 19, Vite 7, Wouter, TanStack Query, Framer Motion (`reducedMotion="user"`) |
| **AI orchestration** | Vercel AI SDK over Replit AI Integrations (Anthropic + OpenAI + Gemini) — see `src/lib/providers.ts` |
| **Tooling** | Tavily (research), E2B (sandboxed code execution), OpenAI transcription |
| **Client-side processing** | Tesseract.js (OCR), pdfjs-dist (PDF parsing), jspdf (PDF export) |
| **Auth** | Google OAuth (encrypted refresh tokens at rest, `bytea` columns) |
| **Streaming** | Server-Sent Events for every agent run; replay supported via `run_events` |

---

## Project structure

```
artifacts/
  briefcase-app/         React 19 + Vite SPA
    src/
      App.tsx            Wouter route table — 147 pages
      components/        135 shared UI components, shadcn-flavored
      lib/               OCR pipeline, PDF utils, agent client
  api-server/            Express 5 API on port 8080
    src/routes/
      auth.ts            Google OAuth + session
      cases.ts           Case CRUD
      files.ts           Multipart evidence upload
      runs.ts            Agent run orchestration + SSE
      courtroom.ts       Rehearsal / cross-exam mode
      observability.ts   Run telemetry
    src/lib/
      providers.ts       Unified Vercel AI SDK provider routing
  mockup-sandbox/        Component preview server
lib/
  db/                    Drizzle schema (core / engine / wow domains, 5 migrations)
  api-spec/              OpenAPI 3.1 (where applicable)
  api-client-react/      Generated TanStack Query hooks
  api-zod/               Generated Zod validators
```

---

## Database

Drizzle schema split across three domain files for readability:

- `core.ts` — `users`, `cases`, files, evidence, share tokens
- `engine.ts` — agent runs, run events, artifacts, citations, observability
- `wow.ts` — courtroom rehearsal sessions, Brady reviews, plea paths, jury notes

Five committed migrations under `lib/db/migrations/` (Drizzle journal + snapshots). Run with:

```bash
pnpm --filter @workspace/db run push
```

The `cases.role_pack` column has a `CHECK` constraint that allows `'defender'` or `'detective'` — Briefcased was built with the planned **Lexor v2 merger** in mind, where it becomes the `defender` track of an end-to-end justice platform. See [`Lexor/MERGER_PLAN.md`](https://github.com/sadruzzahan/Lexor/blob/main/MERGER_PLAN.md) for the consolidation roadmap.

---

## Running locally

```bash
pnpm install
pnpm --filter @workspace/db run push          # migrate
pnpm --filter @workspace/api-server run dev   # API on :8080
pnpm --filter @workspace/briefcase-app run dev # web on :PORT (configured by Replit)
```

Required environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `AI_INTEGRATIONS_*` | Replit AI Integration proxy keys (Anthropic / OpenAI / Gemini) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth |
| `TAVILY_API_KEY` | Web research tool |
| `E2B_API_KEY` | Sandboxed code execution (optional) |
| `SESSION_SECRET` | Session cookie signing |

---

## Status & roadmap

Briefcased is the **public flagship** of a planned three-repo merger into [**Lexor**](https://github.com/sadruzzahan/Lexor). The merger reorganizes Briefcased as the `defender` track alongside `detective` (was [Beat](https://github.com/sadruzzahan/Beat)) and `complainant` (was [Lexor](https://github.com/sadruzzahan/Lexor)) tracks of one unified justice platform. Until that lands, Briefcased ships and runs as a standalone product.

---

## License

MIT.

> **Disclaimer.** Briefcased is engineering work suitable for product exploration, demos, and case-management workflows. It is **not** a substitute for licensed legal software, professional legal counsel, or jurisdiction-specific certification.
