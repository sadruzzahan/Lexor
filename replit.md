# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Lexor (artifacts/lexor-web + extensions in artifacts/api-server)

Consumer legal-help web app under the parent brand "zexorex". Feature 1
(Defend + Counter-attack) is a synchronous-feel async pipeline:
vision → classify → grounding → rules → draft → complaints → embedding
→ adversary → coalition, streamed to the client over SSE.

### Documented product behavior / drift

- **Statute corpus is curated, not live.** No CourtListener / govinfo
  fetches; we ship a hand-verified CA / TX / NY + federal FDCPA / FLSA
  corpus baked into `services/grounding/statutes.ts`. The "grounding"
  pipeline step is a passthrough that surfaces which corpus the
  rules engine will draw from.
- **Tier-1 regulator filing is guided-portal, not direct submit.** The
  UI deep-links to the agency portal and provides copy/paste-ready
  draft text. We do not POST to HUD/CFPB/FTC/EEOC/DOL_WHD on the
  user's behalf. Tier-2 (state AGs) is PDF + mailing instructions.
  Replace with direct-submit integrations only after legal review.
- **Vision handwriting fallback uses Anthropic for both passes.** Build
  plan §3.2 calls for a GPT-4o second pass; OpenAI integration is not
  wired into this workspace, so both passes run through Anthropic. Swap
  point is isolated to the second `runVisionPass(...)` call in
  `services/vision.ts`.
- **"Download PDF" is HTML print-to-PDF**, not a true PDF binary.
- **Embedding step is a sha256 fingerprint placeholder**; real pgvector
  work lands with the coalition feature.
- **45s fixture latency target is operational, not test-enforced.** No
  automated test gate fails a build that exceeds the budget.

### Feature 2 — Adversary Dossier (Task #4) drift

- **Adversary registry is curated, not live.** No CourtListener / OpenCorporates / SEC
  fetches; `services/adversary/registry.ts` ships a hand-verified set
  (Greystar, Portfolio Recovery, Midland Credit, Amazon Logistics DSP, plus a
  Greenway Apartments demo entry that matches the sample eviction notice).
  Resolution is curated-first; on a miss, `synthesizeUnknownEntity()` calls
  Anthropic to produce a conservative profile (typical violations for the
  entity kind, no fabricated lawsuits) and persists it with
  `source: "ai_estimated"`. Synthesis errors fall through to an empty row so
  the pipeline never blocks on the AI call. Replace with
  CourtListener + OpenCorporates calls behind tokens later.
- **`otherCases` is anonymized.** The dossier endpoint exposes only
  `vertical`, `jurisdiction`, and `createdAt` for other Lexor cases against
  the same adversary — no case ids are returned, even truncated, to avoid
  leaking cross-user case-participation identifiers.
- **Pipeline persists `adversaryEntityId` on the case row** at the adversary
  step (`services/pipeline.ts`); the Adversary tab and `/entity/:id` page hydrate
  via `GET /api/counsel/adversary/:entityId`.
- **Search route is registered before `:entityId`** in
  `routes/counsel/adversary.ts` to avoid Express 5 collision.
- **"Use this defense" injection is client-side only.** Selected defenses
  persist in localStorage via a Zustand store
  (`lib/defenseInjection.ts`) and are appended to the response letter copy /
  print output. The selector uses a stable `EMPTY` sentinel
  (`selectInjectedFor`) — without it zustand's reference-equality check trips
  an infinite render loop in React 19.
- **Standalone `/entity/:id` reuses `DossierView`** with `hideUseDefense`, so
  the dossier renders identically with a Copy button instead of inject buttons.
