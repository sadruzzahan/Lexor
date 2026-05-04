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

## Briefcase / JusticeOS

Briefcase is an AI copilot for criminal defense lawyers, backed by the JusticeOS TypeScript engine. The full spec lives at `attached_assets/BRIEFCASE_1777747949561.md`. The build is broken into gates G0–G24 — see `.local/tasks/g00-foundation.md` through `g24-animation-tier-a.md`.

**Scope pivot (2026-05-02):** The user opted for a **web-only** build (no native iOS / Android shells). The Expo-mobile gates from the original plan (G4 mobile scaffold, G5 4-pane streaming UI, G9 camera ingest, G14 courtroom mode, G17 design system, G18/G20/G24 animation gates) need to be re-targeted at React + Vite before they start. Treat any "mobile" wording in those plan files as "web app" until the plans are updated.

### Briefcase web artifact (G4, 2026-05-02)

The web client is at `artifacts/briefcase-app/` (slug `briefcase-app`, `previewPath: /briefcase-app`, port 18258). Built with React + Vite + Wouter + TanStack Query, calling the generated `@workspace/api-client-react` hooks. Stack mapping (Expo → web equivalents) and gate scope are documented in `artifacts/briefcase-app/README.md`.

- Demo identity: `src/lib/api.ts` injects `x-demo-user: demo_user_pd` into every generated-hook request via `apiRequestOptions`.
- Onboarding gate: `src/App.tsx` checks `localStorage["briefcase.demoLawyer"]` (helpers in `src/lib/auth.ts`); the welcome screen sets the flag and routes to `/cases`.
- Cases home: `src/pages/Cases.tsx` calls `useListCases({}, { request })` and renders `CaseCard` items with a no-op FAB. The empty-state copy "No cases yet — tap + to start" is shown when the API returns no cases _or_ errors (G3 backend lands later).
- The base path served by Vite is `/briefcase-app/` (BASE_PATH env), so router base = `import.meta.env.BASE_URL.replace(/\/$/, "")`.

### G17 design system (2026-05-02)

The "modern visual language" tokens live under `artifacts/briefcase-app/src/theme/` and are imported via the barrel `@/theme`:

- `tokens.ts` — colors (Linear-violet `#7C6AF7`, holographic `#A99CFF`), spacing, radii, variable-font weight axis, glass elevations (small/medium/large blur tiers), 5-layer depth model + max gyro tilt.
- `motion.ts` — `MotionSystem.{whisper,soft,bouncy,elastic,snap,dramatic}` (framer-motion `Transition` objects) and `MotionCss.<preset>(properties)` for raw CSS transitions. **All transitions must resolve through these tokens** — `scripts/lint-motion.mjs` (run via `pnpm --filter @workspace/briefcase-app lint:motion`) blocks `Easing.linear`, raw `cubic-bezier(...)` literals, and `transition: ... linear` strings outside `theme/motion.ts`.
- `haptics.ts` — `HapticSystem.{selection,success,warning,error,impactLight,...}` over `navigator.vibrate`; respects reduced-motion + global mute.
- `sounds.ts` — `SoundSystem.play(event)` over `HTMLAudioElement`; opt-in via Settings; G18 will drop the actual files into `public/sounds/`.
- `glass.ts` — `liquidGlass(elevation)` / `liquidGlassClass(elevation)` for the M1 surface treatment. Floating chrome (sheets, popovers, dialogs, FAB tray) uses the `.glass`/`.glass-sm`/`.glass-md`/`.glass-lg` utilities defined in `index.css`, which fall back to opaque tints under `prefers-reduced-transparency: reduce`.

Hooks: `useReducedMotion`, `useOledTrueBlack` (M4 — flips `--background` to `#000` and oscillates `--accent-violet-l` ±8% on activity), `useGyroTilt` (M6 — clamped to ±4°), `useMagneticSnap` (M7), `useVariableFontWeight` (M3 — animates `font-variation-settings: "wght"`).

Aurora: `<AuroraCanvas>` (Canvas 2D mesh-gradient, web stand-in for the spec's Skia shader; throttles to 30 fps when `navigator.getBattery()` reports <20%; reduced-motion → single static paint) is mounted by `<AmbientReactor>`, which subscribes to `useAgentRunStore` and modulates intensity / colorDrift on tool-call + citation bursts. Both wired at `App.tsx` via `<VisualChrome>`.

`<SkeletonMorph>` (M9) wraps Cases home and the CaseDetail Briefcase pane grid so loading states cross-fade + scale into real content using `MotionSystem.bouncy`.

### G11 demo path — State v. Johnson (2026-05-02)

The 90-second demo journey (spec Appendix A) runs against a seeded case with deterministic UUIDs so the source viewer's highlight target is byte-stable across rehearsals.

```bash
pnpm --filter @workspace/api-server run demo:reset            # wipe prior runs (keeps case + files)
pnpm --filter @workspace/api-server run seed:state-v-johnson  # 4 PDFs (police_report, bodycam_metadata, lab_report, search_warrant_application) + 1 transcript (client_interview), idempotent
```

- Demo case id: `00000000-0000-0000-0000-0000000a0001` (`State v. Johnson`).
- File ids: `…0a0002` police report (2 pp), `…0a0003` bodycam log (1 p), `…0a0004` lab report (1 p), `…0a0005` warrant application (2 pp), `…0a0006` client interview transcript.
- PDFs are generated with `pdf-lib` + Helvetica at seed time and stored via `putBytes` so the R-09 signedUrl resolves to real bytes the source viewer can render.
- TC-001..TC-009 walk-through + status table lives at `artifacts/briefcase-app/docs/demo-verification.md`.
- **Demo backup video.** Spec asks for `artifacts/briefcase/docs/demo-backup.mp4`; under the web pivot drop the file at `artifacts/briefcase-app/docs/demo-backup.mp4` or paste an external Loom/Drive link below: _(pending — capture during pre-pitch dry runs)_.
- **Drift from spec:** the "Pick from Drive → STATE v. JOHNSON folder" Appendix A step is replaced by "open the seeded State v. Johnson case from Cases home and tap Start" — the live Drive picker UI lands later, and pre-seeding the case files keeps the 90-s journey reproducible without OAuth.

**Slug history.** The original artifact was created with slug `briefcase` and `previewPath = "/briefcase/"`. The platform's port watcher refused to detect that artifact's port no matter what we tried (clean Vite logs, manual `curl` returning 200, all permutations of host bindings, ports, and plugin sets). Re-creating under slug `briefcase-app` with `previewPath = "/briefcase-app"` (no trailing slash on `previewPath`/`paths`, while `BASE_PATH` env keeps its trailing slash so Vite's base resolves correctly) was the only way to get the workflow to register as RUNNING. The original `artifacts/briefcase` registration is orphaned in the platform — `createArtifact` returns `ARTIFACT_PATH_CONFLICT` for `/briefcase/`, and `verifyAndReplaceArtifactToml` cannot change an artifact id, so the path is permanently reserved. New gates should target `artifacts/briefcase-app/`.

### Active integrations (Replit AI proxy — no user API key needed)

- Anthropic — `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
- Gemini — `AI_INTEGRATIONS_GEMINI_BASE_URL` / `AI_INTEGRATIONS_GEMINI_API_KEY`
- OpenAI — `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`

### User-supplied secrets

- `E2B_API_KEY` — sandboxed tool runtime
- `TAVILY_API_KEY` — case-law / web search
- `GOOGLE_OAUTH_CLIENT_ID_WEB`, `GOOGLE_OAUTH_CLIENT_SECRET` — Sign in with Google + Drive ingest (web)
- `GOOGLE_OAUTH_CLIENT_ID_IOS`, `GOOGLE_OAUTH_CLIENT_ID_ANDROID` — present but **unused** under the web-only pivot
- `SESSION_SECRET` — session signing (auto-provisioned)

### Provider smoke test

Verifies every external dependency is reachable:

```bash
pnpm --filter @workspace/api-server run check:providers
```

Source: `artifacts/api-server/scripts/check-providers.ts`. Prints `[OK]` / `[FAIL]` per provider and exits non-zero on any failure.

### Database (G2)

Drizzle schema lives in `lib/db/src/schema/` (re-exported as `@workspace/db` and `@workspace/db/schema`):

- `core.ts` — users, cases, case_files (`vector(1536)` + ivfflat cosine index), runs (with `idempotencyKey UNIQUE`), run_events (`(runId, idx) UNIQUE` + DB trigger `run_events_monotonic_idx_trg` that enforces `idx == max(idx)+1` per run), artifacts, prep_items, citations
- `wow.ts` — contradictions, rights_findings, disclosure_gaps, jury_simulations, courtroom_sessions, objection_events, plea_simulations, prosecution_runs, run_branches, agent_traces (composite PK)
- `engine.ts` — semantic_cache (vector cache), model_routing_decisions, agent_costs, audit_bundles, policy_drops, quality_judgments, prompt_versions, agent_messages, speculative_branches, replay_cases, cost_ceilings

29 tables total. The `vector` (pgvector 0.8.0) extension is created by the **initial migration** (`lib/db/migrations/0000_*.sql` starts with `CREATE EXTENSION IF NOT EXISTS vector;`), so a fresh DB only needs a single `migrate` to be ready.

Two equivalent dev workflows (production schema is applied automatically by Replit's Publish flow — never run these against prod):

```bash
# Migration-based (canonical, matches what Publish does):
pnpm --filter @workspace/db run generate   # author-time: regenerate migrations after schema edits
pnpm --filter @workspace/db run migrate    # apply pending migrations to dev DB (creates pgvector first)

# Quick iteration (no migration files):
pnpm --filter @workspace/api-server run db:bootstrap   # CREATE EXTENSION vector (idempotent)
pnpm --filter @workspace/db run push                   # diff schema → DB

# Then:
pnpm --filter @workspace/api-server run seed           # idempotent demo user
pnpm --filter @workspace/api-server run db:smoke       # SELECT count(*) on every table
```

### Demo identity (`x-demo-user: demo_user_pd`)

The buildathon demo flow sends `x-demo-user: demo_user_pd`. The slug → UUID mapping lives in `lib/db/src/demo.ts` (re-exported as `@workspace/db/demo`) and is the single source of truth — `seed-demo-user.ts`, every middleware, every fixture must call `resolveDemoUserId(slug)`. The seed inserts the demo user under spec UUID `00000000-0000-0000-0000-00000000beef`.
