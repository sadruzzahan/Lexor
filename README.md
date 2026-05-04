# Lexor

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-191919?style=flat-square)](https://www.anthropic.com/)
[![Twilio](https://img.shields.io/badge/Twilio-Voice%20%2B%20WhatsApp-F22F46?style=flat-square&logo=twilio&logoColor=white)](https://www.twilio.com/)
[![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?style=flat-square)](https://clerk.com/)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)

> **Lexor** is a consumer-facing **legal-help web app** under the parent brand `zexorex`. Citizens describe a problem (eviction notice, abusive debt collector, unpaid wages, unsafe landlord); Lexor grounds the facts against statute, drafts a response letter, prepares regulator complaints, and — when the case is bigger than one person — helps form a **coalition** of similarly-affected complainants.

---

## What it does

Lexor's "Defend + Counter-attack" pipeline is a synchronous-feel async flow that streams over **SSE** to the client:

```
vision → classify → grounding → rules → draft → complaints → embedding → adversary → coalition
```

Each step has its own observable state and produces structured output. The grounding step matches the case against a curated corpus of CA / TX / NY + federal statutes (FDCPA, FLSA). The complaints step generates regulator-filing drafts for HUD, CFPB, FTC, EEOC, and state DOL_WHD agencies (currently **guided-portal**, with copy-paste-ready text deep-linking to each agency's portal — direct submit is roadmap).

A **Twilio** voice + WhatsApp surface lets users describe their case verbally instead of typing. Embeddings (1024-dim, pgvector ivfflat-indexed) power similarity search and adversary-entity dossier matching across all cases in the system.

---

## Project structure

| Path | Purpose |
|------|---------|
| `artifacts/lexor-web` | Main SPA — case intake, defense flows, map, adversary dossier, coalition organizing, settings |
| `artifacts/api-server` | Express 5 API, Twilio webhooks (voice + WhatsApp), SSE pipeline streaming, Clerk auth |
| `artifacts/lexor-demo-video` | Demo / media artifact |
| `artifacts/mockup-sandbox` | UI sandbox |
| `lib/db` | Drizzle schema, migrations, pgvector setup script — `cases`, `entities`, `coalitions`, `coalitionMembers`, `coalitionVotes`, `disclosures`, `inbox`, `lawyerBids`, `mapMarkers`, `notifications`, `sessions`, `trials` |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | OpenAPI spec + generated React Query hooks + Zod schemas |
| `lib/integrations-anthropic-ai` | Anthropic client used by vision, drafting, and pipeline flows |
| `scripts` | Smoke tests and acceptance harnesses |

---

## Tech stack

- **Node.js** 24 · **pnpm** workspaces · **TypeScript** 5.9 (strict)
- **API:** Express 5, Pino logging, Zod validation, Server-Sent Events
- **Database:** PostgreSQL + Drizzle + **pgvector** (1024-dim embeddings)
- **AI:** Anthropic Claude (vision + drafting), via the workspace `lib/integrations-anthropic-ai` package
- **Telephony:** Twilio voice + WhatsApp webhooks
- **Auth:** Clerk
- **Frontend:** Vite + React, Wouter (per-route)
- **Codegen:** OpenAPI 3.1 → Orval → typed React Query hooks + Zod

---

## Documented behavior & honest scope

- **Statute corpus is curated, not live.** No CourtListener / govinfo fetches; Lexor ships a hand-verified CA/TX/NY + federal FDCPA/FLSA corpus baked into `services/grounding/statutes.ts`. The "grounding" pipeline step is a passthrough that surfaces which corpus the rules engine will draw from. This is intentional — live legal corpora require ongoing curation that is out of scope for a single-developer prototype.
- **Tier-1 regulator filing is guided-portal, not direct submit.** The UI deep-links to each agency portal and provides copy/paste-ready draft text. Lexor does not POST on the user's behalf to HUD / CFPB / FTC / EEOC / DOL_WHD. Tier-2 (state AGs) is PDF + mailing instructions. Direct submit is a roadmap item gated on agency partnerships.
- **Not legal advice.** This codebase is suitable for product exploration, demos, and engineering practice. It is **not** a substitute for licensed legal software or professional counsel.

---

## The Lexor v2 plan

Lexor is the umbrella brand for a planned three-repo unification:

- **Lexor v1 (this repo)** → becomes the `complainant` track (consumer intake, regulator filings, coalitions)
- **[Beat](https://github.com/sadruzzahan/Beat)** → becomes the `detective` track (multi-agent investigation, witness mapping, scene tagging, chain of custody)
- **[Briefcased](https://github.com/sadruzzahan/Briefcased)** → becomes the `defender` track (criminal-defense copilot, Brady review, jury notes, plea paths, courtroom rehearsal)

End-to-end story: **citizen reports a problem → investigator builds the case → defender wins in court.** One database, one auth, one design system, three role packs.

The full architecture, schema unification strategy, and phase-by-phase migration plan is in **[`MERGER_PLAN.md`](./MERGER_PLAN.md)**.

Until the merger lands, **[Briefcased](https://github.com/sadruzzahan/Briefcased)** is the public-facing flagship; Lexor v1 ships as documented above.

---

## License

MIT.
