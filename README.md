# Lexor

**Lexor** is a consumer-facing, legal-adjacent “counsel” experience built as a **pnpm monorepo** under the parent brand **zexorex**. It combines a **Vite + React** web app (`lexor-web`), an **Express 5** API (`api-server`), optional **demo video** and **mockup** artifacts, and shared **PostgreSQL (Drizzle)** and **OpenAPI → Orval/Zod** libraries.

> **Not legal advice.** This codebase is suitable for demos, product exploration, and engineering practice—not a substitute for licensed legal software or professional counsel.

---

## Repository layout

| Path | Purpose |
|------|--------|
| `artifacts/lexor-web` | Main SPA: case intake, defense/counter-attack flows, map, adversary dossier UI, settings, etc. |
| `artifacts/api-server` | REST API, webhooks (Twilio voice/WhatsApp), SSE streaming for the counsel pipeline, Clerk auth. |
| `artifacts/lexor-demo-video` | Media/demo artifact package. |
| `artifacts/mockup-sandbox` | UI sandbox / mockups. |
| `lib/db` | Drizzle schema, migrations, Postgres helpers (including pgvector setup script). |
| `lib/api-zod` / `lib/api-spec` | OpenAPI spec and generated Zod types. |
| `lib/integrations-anthropic-ai` | Anthropic client used by vision, drafting, and related flows. |
| `scripts` | Workspace scripts (e.g. smoke tests, acceptance harnesses). |

---

## Tech stack

- **Node.js** 24 · **pnpm** workspaces · **TypeScript** ~5.9  
- **API**: Express 5, Pino logging, Zod validation  
- **Auth**: Clerk (`@clerk/express`)  
- **DB**: PostgreSQL + Drizzle ORM; pgvector-related schema/setup scripts in `lib/db`  
- **AI / media**: Anthropic (primary model path in repo); optional integrations per `DEPLOY.md` (voice, STT/TTS, etc.)  
- **Web**: Vite 7, React 19, Tailwind 4, TanStack Query, MapLibre, Radix/shadcn-style UI  

---

## Core product behavior (high level)

1. **Feature 1 — Defend + Counter-attack**  
   A synchronous-feel, **async pipeline** streamed to the client (e.g. SSE): vision → classify → grounding → rules → draft → complaints → embedding → adversary → coalition.

2. **Adversary dossier**  
   Curated adversary registry plus conservative AI-backed synthesis when unknown; API and `/entity/:id` UI surface dossier data with privacy-conscious handling of cross-case metadata (`otherCases` is anonymized per `replit.md`).

3. **Regulator tooling**  
   Guided flows for complaints (deep-links and copy-ready text); tiered filing behavior is **documented as not direct-submit** to federal portals until legally reviewed.

4. **Operational surfaces**  
   Map endpoints, inbox/Gmail-oriented flows (when configured), coalitions, trials/coach-related routes, Twilio voice and WhatsApp ingress, object storage hooks.

For **intentional product vs. build-plan drift** (statute corpus, embeddings placeholder, PDF generation, vision second-pass vendor, etc.), see **`replit.md`** in the repo root—that file is the canonical “what we actually shipped vs. what the plan assumed” notes.

---

## Prerequisites

- **Node.js 24**  
- **pnpm** (required; root `preinstall` rejects other package managers)  
- **PostgreSQL** for full API/local development  
- Environment variables: start from `artifacts/api-server/.env` (local) and **`DEPLOY.md`** for production-oriented secret inventory.

---

## Common commands

From the repository root:

```bash
pnpm run typecheck    # all workspace typechecks
pnpm run build        # typecheck + build packages that define build

pnpm --filter @workspace/api-spec run codegen   # regenerate client + Zod from OpenAPI
pnpm --filter @workspace/db run push            # push schema (development; see DEPLOY.md for prod)
pnpm --filter @workspace/api-server run dev     # build + run API locally
```

Web app (typical local flow):

```bash
pnpm --filter @workspace/lexor-web run dev
```

Smoke testing (against a deployed URL):

```bash
LEXOR_PROD_URL=https://<your-host> pnpm --filter @workspace/scripts run smoke-test
```

---

## Deployment and secrets

**`DEPLOY.md`** describes Replit-oriented publish flow, required/optional secrets (Anthropic, Twilio, optional map keys, etc.), Twilio webhook URLs, and database publish behavior. Follow it for anything touching billing, production DB, or live telephony.

---

## License

MIT (see root `package.json` `license` field).
