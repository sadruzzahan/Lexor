# Lexor — Justice Platform Monorepo

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Mastra](https://img.shields.io/badge/Mastra-workflows-7C3AED?style=flat-square)](https://mastra.ai/)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-multi--provider-000000?style=flat-square&logo=vercel&logoColor=white)](https://sdk.vercel.ai/)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](#license)

> **Lexor** is an end-to-end justice platform spanning every role in the legal process — citizen complaint, field investigation, and courtroom defense. Three purpose-built products, now unified in one repository, being merged into a single coherent application.

---

## The three tracks

| Track | Directory | Role | Status |
|---|---|---|---|
| **Complainant** | `artifacts/` (this repo root) | Consumer legal-help — citizen reports a problem (eviction, debt, wage theft), Lexor grounds facts against statute, drafts response letters, files regulator complaints, organises coalitions | ✅ Standalone |
| **Detective** | `packages/beat/` | Field investigation — multi-agent Mastra workflows for scene tagging, witness mapping, suspect research, chain-of-custody, SSE-streamed 4-pane dashboard | ✅ Standalone |
| **Defender** | `packages/briefcase/` | Criminal-defense copilot — Brady review, jury notes, plea-path analysis, adversarial review, courtroom rehearsal, OCR/PDF evidence processing | ✅ Standalone |

The full journey: **citizen reports a problem → investigator builds the case → defender wins in court.**

---

## Repository layout

```
lexor/
├── artifacts/               ← Complainant track (Lexor v1 web app + API)
│   ├── lexor-web/           React + Vite SPA (case intake, defense pipeline, map, coalition)
│   ├── api-server/          Express 5 API + Twilio voice/WhatsApp webhooks + SSE streaming
│   └── lexor-demo-video/    Demo artifact
├── lib/                     ← Lexor v1 shared libraries
│   ├── db/                  Drizzle schema + pgvector (cases, entities, coalitions, …)
│   ├── api-spec/            OpenAPI 3.1 contract
│   ├── api-client-react/    Generated TanStack Query hooks
│   ├── api-zod/             Generated Zod schemas
│   └── integrations-anthropic-ai/  Anthropic client
├── packages/
│   ├── beat/                ← Detective track (Beat full codebase)
│   │   ├── artifacts/       beat SPA + api-server
│   │   └── lib/             db, api-spec, agent-protocol, …
│   └── briefcase/           ← Defender track (Briefcased full codebase)
│       ├── artifacts/       briefcase-app SPA + api-server
│       └── lib/             db (core/engine/wow), api-spec, …
├── MERGER_PLAN.md           ← Architecture & phased integration roadmap
└── README.md                ← This file
```

---

## What each track does

### Complainant track (root `artifacts/`)

Lexor's "Defend + Counter-attack" pipeline streams over SSE:

```
vision → classify → grounding → rules → draft → complaints → embedding → adversary → coalition
```

- **Statute corpus:** curated CA / TX / NY + federal FDCPA / FLSA — grounded, not live-fetched
- **Regulator filing:** guided-portal drafts for HUD, CFPB, FTC, EEOC, DOL_WHD
- **Twilio:** voice + WhatsApp intake for users who prefer not to type
- **pgvector:** 1024-dim Cohere embeddings on cases for similarity search + adversary matching
- **Coalitions:** multi-complainant organizing with votes and member management

### Detective track (`packages/beat/`)

- Multi-agent **Mastra** workflow: jurisdiction detection → parallel scene tagging / witness mapping / suspect background (Tavily + citation verification) → statement draft
- **SSE streaming** with `run_events` replay (monotonic `idx` DbSink pattern)
- **Chain-of-custody** data model; multipart evidence upload; share tokens for co-investigator access
- Multi-AI: Anthropic + Gemini + OpenAI via Replit AI Integrations

### Defender track (`packages/briefcase/`)

- **OCR pipeline:** Tesseract.js (client-side) + pdfjs-dist — extracts text from photos, scans, PDFs
- **Multi-agent AI** via Vercel AI SDK (Anthropic / OpenAI / Gemini)
- **Brady review**, **jury notes**, **plea-path analysis**, **adversarial review**
- **Courtroom rehearsal** — agent plays opposing counsel for cross-exam practice
- **PDF export** (jspdf) + time-limited share tokens for co-counsel
- **E2B sandboxes** for safe code execution; **Tavily** for legal research

---

## Tech stack (unified)

| Layer | Choice |
|---|---|
| **Language** | TypeScript 5.9, strict mode |
| **Frontend** | React 19, Vite 7, Wouter, TanStack Query, Tailwind 4, shadcn-style Radix UI, Framer Motion |
| **Backend** | Express 5, Pino structured logging, Zod validation |
| **Database** | PostgreSQL + Drizzle ORM + pgvector |
| **Auth** | Clerk (complainant + detective) / Google OAuth (defender) → merger standardises on Clerk |
| **AI** | Vercel AI SDK over Replit AI Integrations (Anthropic + OpenAI + Gemini) |
| **Agents** | Mastra workflow engine |
| **Research** | Tavily (web), E2B (sandboxed execution) |
| **Telephony** | Twilio voice + WhatsApp |
| **Client-side processing** | Tesseract.js OCR, pdfjs-dist, jspdf |
| **API contracts** | OpenAPI 3.1 → Orval → typed React Query hooks + Zod schemas |
| **Workspace** | pnpm workspaces |

---

## Running each track

Each track is a self-contained pnpm monorepo. Navigate to its directory and follow its own README:

```bash
# Complainant (Lexor v1) — root
pnpm install && pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/lexor-web run dev

# Detective (Beat)
cd packages/beat
pnpm install && pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/beat run dev

# Defender (Briefcased)
cd packages/briefcase
pnpm install && pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/briefcase-app run dev
```

Each track needs its own `DATABASE_URL` and AI provider keys (`AI_INTEGRATIONS_*`).

---

## The integration roadmap

This repository is at **Stage 1: source consolidation.** All three codebases coexist here but are not yet integrated — each runs against its own database with its own auth and API.

The full architectural integration plan is in **[`MERGER_PLAN.md`](./MERGER_PLAN.md)**:

- **Phase 0** — Bootstrap unified schema + pnpm workspace
- **Phase 1** — Defender track migrated (Briefcased → unified `/defender` routes)
- **Phase 2** — Detective track migrated (Beat → unified `/detective` routes)
- **Phase 3** — Complainant track migrated (Lexor v1 → unified `/complainant` routes)
- **Phase 4** — Cross-track features (case handoff, lawyer bid marketplace, unified inbox)
- **Phase 5** — Polish, E2E tests, production deployment

Estimated effort: 4–7 weeks. Until then, each `packages/*` track ships and runs standalone.

---

## License

MIT.

> **Disclaimer.** Lexor is engineering work suitable for product exploration, demos, and workflow tooling. It is **not** a substitute for licensed legal software, professional legal counsel, or jurisdiction-specific certification.
