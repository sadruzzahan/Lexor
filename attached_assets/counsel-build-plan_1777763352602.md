# Counsel — Complete Build Plan

> **Audience:** Replit Agent executing this build inside an existing pnpm monorepo.
> **Goal:** Ship a winning, world-class consumer legal-help web app. Five features as MVP, three more as stretch. Modern, futuristic, minimal, and *delightful* to a non-lawyer on a $40 phone.
> **Working brand:** **Counsel** (placeholder — single global find-replace if user picks a different name late in the build).

---

## 0. How to use this document (instructions to the Replit Agent)

Read this entire document before writing any code. Do not skip sections.

**Operating rules for the build:**

1. **Build in vertical slices, not horizontal layers.** Ship one feature end-to-end (DB → API → UI → tested) before starting the next. Do not spend time scaffolding all DB schemas first, then all APIs, then all UI. Vertical slices keep the app demoable at every checkpoint.
2. **Test after every feature.** After each vertical slice closes, run the acceptance tests in §11 for that feature using the `testing` skill (`runTest()`). Do not move on until those tests pass. Self-fix failures with up to 3 retries before flagging the user.
3. **Use the existing monorepo.** Add a new artifact `artifacts/counsel-web` (Vite+React frontend) and extend the existing `artifacts/api-server` for the backend. Do **not** spin up a separate server. Re-use existing Drizzle/Postgres setup. Re-use existing OpenAPI codegen pipeline (`pnpm --filter @workspace/api-spec run codegen`).
4. **Ground every legal claim in a real source.** The model never invents a citation. Every statute or case mentioned in any user-facing output must be retrieved from CourtListener / govinfo / OpenLaws / state SOS at request time and cited inline. If grounding fails, the response degrades to "we couldn't verify the citation; please consult an attorney."
5. **Hard-code the legal disclaimer scaffolding from day one.** Do not ship a single user-visible flow without the three-pillar disclaimer + "AI not a lawyer" footer. See §10.
6. **Demo-driven development.** Every feature must look beautiful in a 30-second screen recording. If a feature is functional but ugly, it does not count as done. UI polish is part of acceptance.
7. **Refuse silently, recover loudly.** If an upstream API fails (CourtListener down, OpenAI rate-limited), degrade gracefully with a beautiful inline empty state and a helpful message — never crash, never show a stack trace, never block other features.
8. **Commit after every feature passes acceptance.** Use descriptive commit messages — they form the public commit history that judges may inspect.
9. **No mocks in shipped code.** All data shown to the user must be real. If real data is unavailable for a particular pathway in 24h, hide that pathway behind a "Preview" badge rather than mocking it.
10. **Ask the user only when truly blocked.** Examples of valid blockers: missing API key, missing user-decision (brand color choice), data source down with no fallback. Examples of NOT-blockers: minor design choice, naming a function, picking between two equally-good libraries.

---

## 1. Product vision

**Counsel turns any scary legal letter into power.** Drop in a photo of an eviction notice, a debt-collection letter, or a termination letter. In 30 seconds, the user gets back: what it really means, every law the other side broke writing it, the response letter ready to send, the regulator complaint pre-filed on their behalf, the opposing party's complete litigation history, a public scoreboard pin for every bad actor, and an automatic invitation to join with everyone else who got the same illegal letter. Free. In any language. By voice or WhatsApp if they can't read.

The product collapses the legal system's information asymmetry — the asymmetry that lets landlords, employers, and debt collectors prey on people who don't have $400/hr lawyers. **Every upload makes the network stronger for the next victim.**

---

## 2. Stack decisions (locked, do not bikeshed)

### 2.1 Frontend (artifacts/counsel-web)

| Layer | Choice | Reason |
|---|---|---|
| Framework | **React 19 + Vite 6** | React 19 compiler removes useMemo boilerplate; Actions/useOptimistic simplify upload flows; Vite 6 sub-second HMR |
| Language | **TypeScript 5.6 strict** | End-to-end types via Orval-generated client |
| Styling | **Tailwind CSS v4.2** | Oxide engine; CSS-first `@theme`; native OKLCH; no JS config file |
| Animation (primary) | **Motion v12** (`motion/react`) | React-first; `LazyMotion` for tiny bundles; AnimatePresence + layout animations |
| Animation (accent/scroll) | **GSAP 3.15 + ScrollTrigger + SplitText** | Now 100% free; best-in-class scroll-scrubbed reveals for the hero |
| 3D / shader hero | **React Three Fiber 9 + drei 10** (sparingly, one shader background only) | WebGPU + WebGL2 fallback; one beautiful mesh-gradient background, nothing else |
| Component base | **shadcn/ui** | Already in monorepo via `mockup-sandbox`; accessible, copy-paste |
| Animated primitives | **Magic UI** (Shimmer Button, Animated Gradient Text, Blur Fade, Marquee, Bento Grid) | Tailwind+Motion based; copy-paste, no install |
| "Wow" accents | **Aceternity UI** (Spotlight, Background Beams) | Use 1–2 places only, never everywhere |
| Maps | **MapLibre GL JS v4 + react-map-gl v7** | Open-source, no token lock-in; Carto Dark Matter tiles |
| Data fetching | **TanStack Query v5** | Convention from existing api-client-react |
| Client state | **Zustand v5** | Tiny; for command palette, theme, modal state |
| Forms | **React Hook Form v7 + @hookform/resolvers/zod** | Already have generated Zod schemas |
| Command palette | **cmdk v1** | ⌘K everywhere |
| Toasts | **Sonner v1.5** | Beautiful default styling |
| Icons | **lucide-react v0.460+** | Consistent with shadcn |
| Class merge | `class-variance-authority` + `tailwind-merge` + `clsx` | Standard shadcn pattern |

### 2.2 Backend (extend artifacts/api-server)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js + Express** (existing) | Already there |
| DB | **Postgres + Drizzle ORM** (existing) | Already there |
| Migrations | **Drizzle Kit** (existing) | Already there |
| Validation | **Zod** (via OpenAPI codegen) | Already there |
| Logger | `req.log` + singleton `logger` (existing) | Never `console.log` per pnpm-workspace skill |
| Vector store | **Postgres + pgvector** (extension) | One DB, no extra service |
| Rate limit | `express-rate-limit` | Per-IP for unauthenticated upload; per-user for auth'd |
| Auth | **Clerk** (read `clerk-auth` skill before building) | Default per repo conventions; supports anonymous + claimed sessions |
| Object storage | **App Storage** (read `object-storage` skill) | For uploaded document images/PDFs |
| Background jobs | **In-process queue** (simple promise queue) | 24h scope; no Redis. If anything blocks request thread > 1.5s, push to background. |

### 2.3 AI / external services

| Need | Provider | Reason |
|---|---|---|
| Document understanding (vision) | **Claude Sonnet 4.6** primary, **GPT-4o** fallback | Claude lowest hallucination (0.09%) — critical for legal accuracy; GPT-4o better on handwriting fallback |
| Reasoning + drafting | **Claude Sonnet 4.6** | Same |
| Embeddings | **OpenAI text-embedding-3-large** | Best quality + cheapest |
| AI proxy | **Replit AI Integrations** (read `ai-integrations-anthropic` and `ai-integrations-openai` skills) | No need to manage keys; goes through Replit billing |
| Voice agent (phone) | **OpenAI Realtime API (`gpt-realtime`)** over Twilio Media Streams (g711_ulaw both ends) | Sub-second latency; multilingual; cheapest path to natural voice |
| WhatsApp | **Twilio Sandbox for WhatsApp** | Free to set up, works for demo |
| Telephony | **Twilio Voice + Programmable Messaging** | Industry standard |
| Translation (text fallback) | **Claude inline** | No separate provider needed |
| Search (statutes / case law) | **CourtListener API v4**, **govinfo.gov**, **OpenLaws**, **LegiScan**, **Open States** | All free with keys |
| Entity resolution (opposing party) | **CourtListener party search** + **OpenCorporates** + **SEC EDGAR** | Layered fallback |
| Map tiles | **MapLibre + Carto Dark Matter** (no token) or Mapbox token if user provides | Free path default |

### 2.4 Things explicitly NOT to use

- Create React App (deprecated)
- `framer-motion` package name (renamed to `motion`)
- Tailwind v3 (`tailwind.config.js`)
- Redux / MobX (overkill)
- Material UI / Chakra (visually generic, fights Tailwind)
- Babylon.js / heavy WebGL frameworks (LCP killer)
- Whisper for live voice (too slow; OpenAI Realtime instead)
- A separate Python backend (one Node server, no microservices)

---

## 3. Architecture

### 3.1 High-level dataflow (one upload, end-to-end)

```
[User: photo of eviction notice]
        │
        ▼
[counsel-web: Upload → presigned PUT → App Storage]
        │
        ▼
[api-server: POST /api/cases  (returns caseId immediately, 202)]
        │
        ├──► [Async pipeline]
        │       1. Vision parse (Claude vision) → structured fields
        │       2. Jurisdiction inference (address + court name)
        │       3. Document classification (eviction / wage / debt / other)
        │       4. Rules engine: per-vertical violation detector
        │       5. Statute/case grounding (CourtListener + govinfo)
        │       6. Adversary entity resolution (party name → litigation history)
        │       7. Response letter generation (Claude, grounded)
        │       8. Regulator complaint draft generation (Claude, per-agency template)
        │       9. Anonymized hash for Predator Map + Coalition matching
        │      10. Vector embed of letter for similarity → coalition lookup
        │
        ▼
[counsel-web: subscribes to SSE /api/cases/:id/events]
        - streams progress steps with beautiful animations
        - reveals each layer as it completes
        - final view: tabs for Defense / Counter-attack / Adversary / Coalition / Map
```

### 3.2 Service routing (within existing monorepo)

- `artifacts/counsel-web` → mounted on the artifact's preview path (e.g. `/counsel`)
- `artifacts/api-server` → already on `/api`
- All Counsel API endpoints under `/api/counsel/*` namespace to avoid collisions with any existing routes

### 3.3 Twilio webhook routing

- Twilio inbound voice webhook → `https://<replit-deploy>/api/counsel/voice/incoming`
- Twilio inbound WhatsApp webhook → `https://<replit-deploy>/api/counsel/whatsapp/inbound`
- Twilio Media Streams WebSocket → `wss://<replit-deploy>/api/counsel/voice/stream`
- All publicly addressable; ngrok-style tunnel **not required** because Replit deploys give a public HTTPS URL.

---

## 4. Repo additions

```
artifacts/
  counsel-web/                 ← NEW Vite+React frontend
    src/
      app/                     ← top-level routes
        page-home.tsx
        page-upload.tsx
        page-case.tsx          ← the "results" view, tabbed
        page-map.tsx           ← Predator Map
        page-coalition.tsx     ← Coalition / class-action view
        page-adversary.tsx     ← Adversary Dossier deep dive
        page-voice-info.tsx    ← How to use voice/WhatsApp
        page-rights.tsx        ← Static rights guide (SEO bait)
      components/
        upload/                ← dropzone, file preview, OCR animations
        case/                  ← tabbed result view
        adversary/             ← litigation history viz
        map/                   ← MapLibre wrapper, marker styles
        coalition/             ← class-action listing + bid form
        layout/                ← header, footer, command palette
        ui/                    ← shadcn primitives (auto-generated)
        magic/                 ← Magic UI copy-paste components
        hero/                  ← R3F shader background, hero scene
      lib/
        api.ts                 ← TanStack Query hooks (wraps generated client)
        sse.ts                 ← Server-Sent Events client
        store.ts               ← Zustand stores
        cn.ts                  ← class-name util
        i18n.ts                ← language detect + Spanish strings
      styles/
        index.css              ← Tailwind v4 entry, @theme, design tokens
      main.tsx
      router.tsx               ← TanStack Router or React Router 7
    index.html
    vite.config.ts
    package.json
    tsconfig.json
    .replit-artifact/
      artifact.toml            ← preview path /counsel, port

artifacts/api-server/
  src/
    routes/
      counsel/
        cases.ts               ← POST/GET /cases, SSE
        voice.ts               ← Twilio voice webhooks + Media Streams
        whatsapp.ts            ← Twilio WA webhooks
        adversary.ts           ← /adversary/:partyName
        map.ts                 ← /map (aggregated public data)
        coalition.ts           ← /coalition (class detection + bid)
        regulators.ts          ← /regulators/file
        rights.ts              ← /rights (statute lookup helpers)
    services/
      vision.ts                ← Claude vision wrapper
      llm.ts                   ← Claude reasoning wrapper, retrieval-grounded
      classify.ts              ← document type + jurisdiction inference
      rules/
        eviction.ts            ← per-state just-cause / habitability checklist
        debt.ts                ← FDCPA + Reg F checklist
        wage.ts                ← FLSA + state minimum wage checklist
      grounding/
        courtlistener.ts
        govinfo.ts
        openlaws.ts
        legiscan.ts
        openstates.ts
      entity/
        resolve.ts             ← party-name → entity → litigation history
        opencorporates.ts
        sec.ts
      drafting/
        responseLetter.ts
        regulatorComplaint.ts
      voice/
        realtimeBridge.ts      ← OpenAI Realtime ↔ Twilio Media Streams ws
        prompts.ts
      whatsapp/
        inbound.ts
        outbound.ts
      coalition/
        match.ts               ← embedding similarity + entity match
        notify.ts
      map/
        aggregate.ts
    db/
      schema.ts                ← Drizzle schemas (extend existing)
      migrations/

lib/                            ← (only add if logic is shared between FE and BE)
  legal-types/                  ← shared TS types for case structures, violation IDs, etc.
```

---

## 5. Database schema (Drizzle)

Add these to `artifacts/api-server/src/db/schema.ts`. Generate migrations with `drizzle-kit generate` and apply.

```ts
// Cases — every uploaded letter
cases:
  id (uuid pk)
  userId (text, nullable — anonymous allowed)
  status (enum: 'queued'|'parsing'|'analyzing'|'drafting'|'complete'|'failed')
  vertical (enum: 'eviction'|'debt'|'wage'|'other')
  jurisdiction (text, ISO state e.g. 'US-CA')
  language (text, BCP-47 e.g. 'en'|'es')
  rawDocumentUrl (text — App Storage URL)
  rawDocumentHash (text — sha256 of normalized text, for coalition match)
  parsed (jsonb — structured extraction)
  violations (jsonb — array of { code, statute, description, severity, citationUrl })
  responseLetter (jsonb — { html, plainText, deliveryHints[] })
  regulatorComplaints (jsonb — array of { agency, draftHtml, filingUrl, status })
  adversaryEntityId (uuid, fk)
  embedding (vector(3072))   -- text-embedding-3-large
  createdAt, updatedAt

// Adversary entities — landlords, employers, debt collectors
entities:
  id (uuid pk)
  normalizedName (text — slugified, lowercased, suffix-stripped)
  displayName (text)
  kind (enum: 'landlord'|'employer'|'debt_collector'|'unknown')
  jurisdictions (text[] — states they operate in)
  registrationData (jsonb — from OpenCorporates / SEC)
  litigationStats (jsonb — { totalCases, winRate, sanctions[], commonViolations[] })
  alternateNames (text[] — shell LLC variants linked via officer overlap)
  pinCount (int — for map visualization)
  lastRefreshedAt (timestamp)
  createdAt

// Predator map markers — anonymized, public
mapMarkers:
  id (uuid pk)
  entityId (uuid, fk → entities)
  caseVertical (enum)
  violationCodes (text[])
  coarseLat, coarseLng (numeric — rounded to 0.01° to anonymize)
  zipCode (text)
  createdAt

// Coalition groups — auto-formed when 5+ matching cases hit one entity
coalitions:
  id (uuid pk)
  entityId (uuid, fk)
  vertical (enum)
  jurisdiction (text)
  letterTemplateHash (text — hash of common letter pattern)
  caseCount (int)
  status (enum: 'forming'|'open'|'matched'|'closed')
  classComplaintDraftHtml (text)
  createdAt

// Coalition members
coalitionMembers:
  coalitionId (uuid, fk)
  caseId (uuid, fk)
  joinedAt
  hasOptedIn (boolean — explicit consent to be part of class)
  primary key (coalitionId, caseId)

// Lawyer bids
lawyerBids:
  id (uuid pk)
  coalitionId (uuid, fk)
  lawyerName, lawyerBarNumber, lawyerEmail, lawyerFirm
  contingencyPercent (numeric)
  notes (text)
  createdAt

// Voice / WhatsApp sessions
sessions:
  id (uuid pk)
  channel (enum: 'voice'|'whatsapp')
  externalId (text — Twilio CallSid / MessageSid root)
  phoneNumber (text — hashed for storage)
  language (text)
  caseId (uuid, fk — nullable until established)
  transcriptJsonl (text — append-only)
  startedAt, endedAt

// Disclosure log — proof we showed the AI/legal disclaimer
disclosures:
  id, userId, sessionId, version (text), shownAt
```

Indexes:
- `cases(rawDocumentHash)` for coalition match
- `cases USING ivfflat (embedding vector_cosine_ops)` for similarity search
- `entities(normalizedName)` unique
- `mapMarkers(zipCode)` and `mapMarkers(entityId)`

---

## 6. API contract (OpenAPI-first)

Add a new tag `counsel` to the OpenAPI spec at `lib/api-spec`. Run `pnpm --filter @workspace/api-spec run codegen` after every change.

Endpoints:

```
POST   /api/counsel/cases                  → { uploadUrl, caseId, headers }    (presigned upload URL)
PATCH  /api/counsel/cases/:id/finalize     → triggers async pipeline
GET    /api/counsel/cases/:id              → full case object
GET    /api/counsel/cases/:id/events       → SSE stream of pipeline events

GET    /api/counsel/adversary/:entityId    → full litigation dossier
GET    /api/counsel/adversary/search?q=    → fuzzy lookup

GET    /api/counsel/map/markers            → public map data, optional bbox/filter
GET    /api/counsel/map/entity/:id         → drill-down

GET    /api/counsel/coalitions             → list
GET    /api/counsel/coalitions/:id         → detail
POST   /api/counsel/coalitions/:id/join    → opt-in (auth required)
POST   /api/counsel/coalitions/:id/bid     → lawyer bid submission

POST   /api/counsel/regulators/file        → submit a complaint draft to an agency
                                              (one of: HUD, CFPB, FTC, EEOC, state AG)

POST   /api/counsel/voice/incoming         → Twilio voice webhook (TwiML)
WS     /api/counsel/voice/stream           → Twilio Media Streams ↔ OpenAI Realtime bridge
POST   /api/counsel/whatsapp/inbound       → Twilio WA webhook
GET    /api/counsel/whatsapp/qrcode        → WA join sandbox QR
```

All response shapes are defined in OpenAPI; React hooks are auto-generated by Orval into `lib/api-client-react`. **Do not write fetch by hand.**

---

## 7. The 8 features — detailed specs

### Feature 1 — Defend + Counter-attack (MVP)

**What it does:**
The user uploads a letter (image, PDF, or pasted text). Counsel returns four things, layered:
1. **Plain-language explanation** of what the letter says.
2. **Your rights** in your jurisdiction, with citations.
3. **A response letter** ready to send (downloadable PDF + copyable email body).
4. **Their violations** — every law the *other side* broke writing this letter, with the regulator complaint pre-drafted (HUD/CFPB/FTC/EEOC/state AG depending on vertical).

**Three verticals, same flow:** eviction, debt, wage. Routed by document classifier.

**Pipeline:**
1. Upload → App Storage.
2. Vision parse (Claude Sonnet 4.6) → structured JSON: `{ sender, recipient, sender_address, recipient_address, date, deadlines, monetary_amounts, statutes_cited, key_claims, signatures }`. Schema enforced via Zod.
3. Document classifier (Claude, low temp) → vertical + sub-type (e.g. `eviction.no_cause` vs `eviction.nonpayment` vs `eviction.nuisance`).
4. Jurisdiction inference: extract address → US state via simple regex + zip lookup. If ambiguous, ask in the UI before continuing.
5. Rules engine for the matched vertical:
   - **Eviction:** check just-cause statute citation present (CA AB 1482, NY HSTPA, etc.); check notice period meets state minimum; check service method legality; check warranty-of-habitability defense applicability.
   - **Debt:** FDCPA + Reg F checklist — call frequency, validation notice timing, false statements, threats of legal action without intent, postdated check abuse.
   - **Wage:** FLSA minimum wage compliance, OT calc correctness, final-paycheck statute compliance per state, misclassification flags.
6. For each detected violation: pull the exact statute text from CourtListener / govinfo / state SOS via OpenLaws, attach citation URL, attach severity.
7. Response letter generation (Claude with retrieval-grounded prompt, system prompt forbids inventing citations) — outputs both an HTML/PDF version and a plain-text email version; includes proper signature block, certified-mail recommendation, deadline reminder.
8. For each detected violation that has a regulator: generate the complaint draft pre-populated for that agency's portal/form. (HUD form 903 for housing discrimination, CFPB online complaint portal, FTC ReportFraud, EEOC charge form, state AG complaint forms.) Output: draft + filing URL + step-by-step submission guide.
9. Stream all of the above to the client via SSE as each step completes (animated reveal — see §8).

**Auto-File path** (the click-to-file capability):
- For Tier 1 portals (CFPB, FTC ReportFraud, state AGs with email intake) we can submit directly: user reviews draft, clicks "File this complaint," we POST to the agency's intake form/email a pre-formatted complaint with cover sheet "filed by user under their own name via Counsel."
- For Tier 2 portals (HUD, EEOC) we generate the filled PDF, give one-click download, and a deep-link to the agency's submission page with instructions overlay.
- Disclaimer overlay: "You are filing this complaint personally. Counsel is preparing the document at your direction. Confirm the contents are accurate before filing."

**Acceptance:**
- Upload 3 real eviction notices (one each from CA, TX, NY) — all parsed correctly, jurisdiction detected, ≥1 violation found, response letter cites real statute, regulator complaint generated.
- Upload 3 real debt collection letters — FDCPA violations detected where present, validation notice timing checked.
- Upload 3 real termination/wage letters — FLSA / state wage law issues flagged.
- Pipeline completes in ≤45 seconds for any input.
- Every cited statute URL resolves to a real page on CourtListener/govinfo/state SOS.
- Response letter passes a manual review for "would I send this?" — well-formatted, polite-but-firm, cites only verified law.

---

### Feature 2 — Adversary Dossier (MVP)

**What it does:**
On the case results page, a tab labeled "Know your opponent." Counsel pulls the opposing party's complete history:
- Total cases filed
- Win/loss record
- Most-common defenses that beat them
- Sanctions on record
- Names linked via officer/registered-agent overlap (shell-LLC detection)
- A timeline of major actions
- Specific past plaintiffs Counsel can connect you with (if they uploaded too)

**Pipeline:**
1. Normalize the party name (strip LLC/Inc/L.P., dba splits) — use `cleanco`-style rules.
2. Look up in `entities` table by `normalizedName`. If hit and < 30 days old, return cached.
3. If miss or stale:
   - CourtListener `/parties/?name=...` and `/search/?type=r&q=...` for federal docket history.
   - OpenCorporates Reconciliation API for entity resolution + officers + registered agent.
   - SEC EDGAR for parent-company resolution (REIT landlords, large debt buyers).
   - Cross-link via officer-name overlap → mark alternate names.
   - Aggregate stats: count, common motion types, sanctions records, win-rate (defined as: dismissals + tenant/defendant judgments / total resolved).
   - Cache to `entities` + `litigationStats`.
4. Return dossier to client.

**UI:**
- A clean profile-card hero with the entity's name, suffix, "filed N cases since YYYY," win-rate ring chart.
- Below: a horizontal timeline of major filings, hover for case name + outcome.
- "Defenses that have worked against them" — a curated list of arguments derived from successful dismissal opinions, each with one-tap "use this defense in my response."
- "Other people fighting them" — anonymized list of other Counsel users with cases against the same entity, with a "form a coalition" button.

**Acceptance:**
- For a known entity (e.g. a real PE-owned landlord like Greystar), the dossier returns >100 cases with a coherent win-rate.
- Officer overlap detects at least one shell-LLC link in test data.
- Page loads in ≤2 seconds (with cached entities) or ≤6 seconds (cold).
- "Use this defense" button injects the chosen argument into the user's response letter draft.

---

### Feature 3 — Predator Map (MVP)

**What it does:**
A public, browsable, beautiful dark map of the US (later world). Every uploaded case contributes one anonymized pin to the map, attributed to the responsible entity. Hover any building / employer / debt collector → see violation count, types, recency.

**Pipeline:**
1. After case completes, server inserts a row into `mapMarkers` with `coarseLat/coarseLng` (rounded to 0.01° ≈ 1km, plus jitter) and ZIP code.
2. Public read endpoint serves aggregated GeoJSON with bbox filter; entity-level rollups are server-side.
3. Client renders MapLibre with Carto Dark Matter tiles, custom heatmap layer + cluster layer.

**UI:**
- Full-bleed dark map with subtle vignette.
- Right-side filter panel: vertical (eviction/debt/wage), violation type, time window.
- Click a cluster → zoom; click a pin → side-sheet with entity dossier preview + "view full dossier."
- Top-of-page stat ticker: "X illegal letters reported nationwide this week" with a Motion-animated counter.
- Top-10 leaderboard of worst entities, animated marquee.

**Acceptance:**
- Map renders 60fps on a mid-tier laptop with 5,000 markers.
- Anonymization: no marker resolves to a single building (always ≥3 markers per coarse cell, otherwise hidden).
- Filter changes update the map in <300ms.
- Clicking a pin opens the entity drill-down sheet.

---

### Feature 4 — Voice + WhatsApp Mode (MVP)

**What it does:**
A user with no smartphone or no English literacy can still get the full Defend+Counter flow by:
- Calling a US phone number, talking to Counsel in Spanish/English/Hindi/Bangla/Arabic
- OR messaging Counsel on WhatsApp with a photo of the letter

**Voice:**
- Twilio number's "incoming call" webhook returns TwiML with `<Connect><Stream url="wss://.../voice/stream"/></Connect>`.
- The WS bridge:
  1. Accepts Twilio Media Streams (μ-law 8k base64 frames).
  2. Opens an OpenAI Realtime WS configured for `g711_ulaw` in/out.
  3. Forwards Twilio media → `input_audio_buffer.append`.
  4. Forwards OpenAI `response.audio.delta` → Twilio media frames.
  5. On `input_audio_buffer.speech_started` → send `response.cancel` + Twilio `clear` (barge-in).
  6. The Realtime session has tools: `take_letter_photo` (instructs user to text it), `lookup_jurisdiction(address)`, `submit_case(text)`, `read_response_letter`, `transfer_to_human`.
- Multilingual: system prompt opens with "Detect the user's language and reply only in that language. Supported: English, Spanish, Hindi, Bangla, Arabic, French."
- For the photo: in-call, the AI says "I'll text you a link, please reply with a photo of the letter," sends an SMS with a one-time upload link, polls for upload completion, resumes the call when done.

**WhatsApp:**
- Twilio Sandbox configured. Users join by texting `join <code>` to the sandbox number.
- Inbound webhook handles text + media. If media is an image/PDF, run the case pipeline; reply with a structured WhatsApp message containing the explainer + a one-click "open full case in Counsel" link.
- Voice notes (audio attachments) → Whisper batch → process as text query.
- Outbound replies use Twilio `messages.create` with `mediaUrl` for the response-letter PDF.

**Acceptance:**
- A live call to the Twilio number connects to the AI within 3 seconds; AI greets in detected language.
- Mid-call language switch (e.g., user says "switch to Spanish") works.
- User can describe a letter verbally; AI asks the right clarifying questions; upload via SMS works; final response letter is read back.
- WhatsApp inbound photo → case complete → outbound PDF arrives within 60s.
- Barge-in: user can interrupt the AI mid-sentence; AI stops within 200ms.

---

### Feature 5 — Coalition Builder (MVP)

**What it does:**
When the system detects N≥5 cases against the same entity with similar letter patterns (cosine similarity > 0.85 on letter embeddings + entity match), it auto-forms a Coalition. All affected users get a notification offering to join the class action. A simple lawyer marketplace lets plaintiff lawyers bid (lowest contingency wins) to represent the class. Counsel takes 0%.

**Pipeline:**
1. After case completes, run nearest-neighbor search on `cases.embedding` filtered by `adversaryEntityId`.
2. If ≥5 cases match within last 90 days and no open coalition exists, create one:
   - Auto-draft a class complaint via Claude grounded in the matched cases' violations.
   - Notify all members via in-app + email + WhatsApp where applicable.
3. Members opt-in via signed disclosure (proof captured in `disclosures`).
4. Lawyers can browse `/coalitions/open`, submit a `bid` with contingency %, brief credentials, sample case experience.
5. Members vote (simple plurality) on which lawyer to retain. Top vote-getter receives all members' contact info (with consent).

**Disclaimer wall (mandatory):**
- "Joining a coalition is not legal advice. Counsel is not a law firm and is not retaining counsel for you. Class actions are complex; consult a lawyer before opting in. By joining, you consent to share your case file with the eventual retained attorney."
- Re-shown on opt-in click and in the email.

**Acceptance:**
- Seed test data with 6 similar eviction notices from one fake landlord → coalition auto-forms.
- Lawyer bid form works; bids are sortable; member voting endpoint works.
- Notifications fire to in-app + email + WA.

---

### Feature 6 — Mirror Trial (Stretch)

**What it does:**
On the case page, a tab labeled "Watch your case." A streamed simulated court hearing:
- Three AI agents play Opposing Counsel, Judge, Your Counsel.
- Opposing Counsel is grounded in the actual past briefs that side has filed (CourtListener docket pulls).
- Judge is grounded in the actual rulings of the judge assigned to your case (if known) — pull their prior opinions from CourtListener.
- The transcript renders typewriter-style with character names.
- At the end: predicted outcome + the 2–3 arguments that swung it.

**Build (when it ships):**
- A multi-agent loop with role prompts; transcript saved to DB and replayable.
- UI: courtroom-style layout, three avatars, animated speech bubbles, gavel-strike sound effect for the verdict.

**Acceptance:**
- For one curated test case, the simulation completes in <45 seconds, predicted outcome aligns with actual disposition (validation: 5 historical cases, ≥3 correct).
- Transcript downloadable as PDF.

---

### Feature 7 — Hearing Coach (Stretch)

**What it does:**
On hearing day, the user opens Counsel on their phone, taps "I'm in court now," wears a single AirPod (or holds the phone discreetly). Counsel listens via mic, transcribes both sides in real time, and whispers tactical guidance via TTS into the earpiece: "Object — leading question." "Cite Brown v. Greenway, paragraph 4." A panic button ("Stop coaching") instantly mutes.

**Build (when it ships):**
- Mobile-friendly PWA page using `MediaRecorder` streaming to Deepgram Flux (live STT).
- Transcript streamed to Claude with the user's full case context preloaded.
- Claude responds with short tactical interjections (≤8 words) gated by a heuristic (only speak if confidence > 0.7 and silence detected on user side).
- ElevenLabs Flash TTS, output to phone speaker (or earpiece if connected).

**Acceptance:**
- End-to-end transcript-to-whisper latency ≤1.5s.
- Panic button mutes instantly.
- Test with a recorded mock-hearing audio file: meaningful interjections fire.

**Disclaimer (CRITICAL for this feature):**
- "Recording court proceedings may be illegal in your state. Counsel does not record audio — it transcribes locally and discards. You are responsible for compliance with your court's rules. Coaching does not constitute legal advice."

---

### Feature 8 — Inbox Sentinel (Stretch)

**What it does:**
User connects Gmail (read-only OAuth). When any incoming email matches a "legally significant" classifier (eviction, court summons, debt, IRS, ICE, employment), Counsel:
1. Within 60 seconds: triggers a phone call to the user's number.
2. Voice agent reads the email's gist and the deadline.
3. Says: "I've drafted your reply — say 'send' to send, or 'review' to read it on screen."

**Build (when it ships):**
- Gmail OAuth via Google integration (read `integrations` skill for setup).
- Pub/Sub watch for new mail.
- Lightweight classifier (Claude with a structured prompt; cache embeddings per sender for cost).
- On hit, enqueue a Twilio outbound call to the user's verified phone, hand to the voice bridge with the email pre-loaded as case context.

**Acceptance:**
- Connecting Gmail works end-to-end.
- A test email with eviction-keywords triggers a call within 60s.
- Voice agent reads the email correctly and offers send/review.

---

## 8. UI / UX system (this section is non-negotiable)

### 8.1 Visual identity

**Aesthetic:** Futuristic-minimal. Dark by default, a single brand accent color, typographic hierarchy carries the design (not heavy graphics).

**Color (OKLCH-first, defined in Tailwind v4 `@theme`):**

```css
@theme {
  /* Base */
  --color-bg:           oklch(0.16 0.012 240);   /* near-black with cool tint */
  --color-bg-elevated:  oklch(0.21 0.014 240);
  --color-fg:           oklch(0.98 0.005 240);
  --color-fg-muted:     oklch(0.72 0.008 240);
  --color-border:       oklch(0.28 0.012 240);

  /* Accent — single signature color */
  --color-accent:       oklch(0.78 0.21 145);    /* electric mint / "verdict green" */
  --color-accent-fg:    oklch(0.16 0.012 240);

  /* Functional */
  --color-violation:    oklch(0.72 0.20 25);     /* warm red for the other side's violations */
  --color-defense:      oklch(0.78 0.21 145);    /* same as accent — your side */
  --color-warning:      oklch(0.82 0.18 75);

  /* Type */
  --font-display:       "Geist", "Inter Display", ui-sans-serif;
  --font-sans:          "Geist", "Inter", ui-sans-serif;
  --font-mono:          "Geist Mono", ui-monospace;

  /* Motion */
  --ease-out-expo:      cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring:        cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Spacing scale (Apple-rhythm) */
  --radius-base:        0.75rem;
  --radius-lg:          1.25rem;
  --radius-xl:          2rem;
}
```

**Type:**
- Display headlines: Geist Display, weight 500–600, tight tracking (`-0.02em`), large (text-7xl on hero).
- Body: Geist 400, generous line-height (1.6).
- Mono only for citations and statute codes.

**Don'ts:**
- No drop shadows below `shadow-md`.
- No more than ONE accent color per page.
- No corporate stock illustrations.
- No emoji as functional icons (use lucide-react).
- No glass-morphism without intent.
- No "hand-drawn" or "playful" anything — this is serious software for serious problems.

### 8.2 Hero scene (landing page)

- Full-bleed R3F shader background: a slow-moving OKLCH gradient mesh in `--color-bg` with a faint `--color-accent` highlight that drifts. Built with one custom GLSL shader (single fragment, ~80 lines). Pauses when tab loses focus.
- Centered headline (Motion blur-fade-in, staggered words):
  > **Drop in any scary letter. Get your power back in 30 seconds.**
- Sub-headline (delayed, lighter weight):
  > Counsel is your free AI lawyer for evictions, debt, and wage theft. Speak any language. No account needed.
- Primary CTA: Magic UI Shimmer Button — "Upload a letter" — opens upload modal.
- Secondary CTA: text link — "Or call +1 (XXX) XXX-XXXX" with a tiny pulsing dot.
- Below the fold: Bento grid showing each feature with a 3-second auto-playing micro-demo (no sound).
- Predator Map preview embedded mid-page: small dark map with live-counter ticker.

### 8.3 Upload flow (the magical 30 seconds)

This is the **single most-watched moment in your demo video**. Engineer it like a stage performance.

1. **Drop zone** — full-screen overlay with subtle scanline animation on the dotted border. "Drop your letter anywhere on this screen."
2. **On drop** — image renders in a beautifully styled "scanned document" frame (slight perspective, soft shadow).
3. **Animated pipeline reveal** — as the SSE stream sends `event: 'step_complete'`, render each step as a card flying in from the right with Motion `AnimatePresence`:
   - Step 1: "Reading your letter…" → ✓ "Recognized: Eviction Notice from Greenway Apartments LLC" (highlight extracted entity name)
   - Step 2: "Locating your rights in California…" → ✓ "Found 3 statutes that protect you"
   - Step 3: "Checking what they did wrong…" → ✓ "**3 violations** detected" (number animates with Motion spring)
   - Step 4: "Drafting your response…" → ✓ "Ready to send"
   - Step 5: "Pulling their record…" → ✓ "1,247 cases. They lose 67% when challenged."
   - Step 6: "Looking for your coalition…" → ✓ "12 others fighting them in your zip code"
4. **Final reveal** — a clean tabbed result card flies into center: `Defense | Counter-attack | Adversary | Coalition`. Default tab: Defense.
5. **Background:** the shader from the hero quietens (less motion, lower brightness) so the result card pops.

### 8.4 Result page tabs

**Defense tab:**
- Letter summary in plain language at top (one paragraph).
- Three big cards: "Your rights" / "What they did" / "Your response."
- The response letter renders inline in a typewriter-style reveal (one Motion `useInView` trigger). Two buttons: "Download PDF" (Magic UI Shimmer) and "Copy email."

**Counter-attack tab:**
- For each violation: a card with the violation name (red accent), the statute citation (mono, link to source), severity badge, and a button "File complaint with [agency]."
- Click → modal preview of the complaint draft → confirm → file (or download for Tier 2 agencies).

**Adversary tab:** see Feature 2.

**Coalition tab:** see Feature 5.

**Map tab:** embeds the Predator Map filtered to this entity.

### 8.5 Command palette (⌘K)

- `cmdk` wrapper, opens with Cmd/Ctrl-K.
- Actions: New case, Find an entity, Open Predator Map, Switch language, Call Counsel, Open my coalitions, Read disclaimers.
- Fuzzy search across recent cases for logged-in users.

### 8.6 Empty / loading / error states

- Every list has a beautiful empty state with a single illustration (Lucide icon enlarged + Motion pulse) and a one-line action.
- Every load >300ms uses skeleton placeholders that mirror the final layout (no spinners except in modals).
- Every error shows a humanized message + a "what to do" CTA, never a stack trace.

### 8.7 Microinteractions checklist

- Every button: hover scale 1.02 with `--ease-out-expo`, 150ms.
- Every card: subtle tilt on cursor (Aceternity 3D Card pattern, sparingly).
- Every number that changes (case counter, violation count): Motion spring count-up.
- Every page transition: `AnimatePresence` cross-fade with 8px Y offset.
- Every long copy block: SplitText word-stagger reveal on first scroll-into-view (GSAP).
- Sound design: optional, one subtle "click" on file submit, off by default.

### 8.8 Mobile

- Mobile-first build. Test at 375×667 (iPhone SE) before declaring any page done.
- Bottom tab bar on small screens: Home / Upload / Map / Voice / Account.
- Upload uses native camera capture (`<input type=file accept="image/*" capture="environment">`).
- All animations honor `prefers-reduced-motion` — replace with simple fades.

### 8.9 Internationalization

- Two locales day-one: `en` and `es`. Strings centralized in `lib/i18n.ts`; no hard-coded strings in JSX after initial pass.
- Language switcher in header + auto-detect from `navigator.language`.
- All AI outputs (response letters, complaints) generated in the user's chosen language; statutes shown in English with translated summary.

---

## 9. Pages / routes

| Route | Purpose |
|---|---|
| `/` | Landing — hero shader, bento, footer |
| `/upload` | Full-screen upload modal route (deep-linkable) |
| `/c/:caseId` | Case results page with the four tabs |
| `/map` | Predator Map full screen |
| `/coalition/:id` | Coalition detail + lawyer marketplace |
| `/entity/:id` | Adversary deep dive |
| `/voice` | "How to call Counsel" page with phone number + WhatsApp QR |
| `/rights/:vertical` | SEO-bait static rights guide per vertical |
| `/about` | Mission + the disclaimer + the team (you) |
| `/legal/disclaimer` | Full legal disclaimers, deep-linked from every footer |

---

## 10. Legal compliance baked in (do this on day one, not at the end)

### 10.1 Persistent UI elements (every page)

- Footer banner: *"Counsel is not a law firm. AI-generated information — not legal advice."*
- First-visit modal (sticky until accepted): the **three-pillar disclosure** verbatim:
  > 1. No attorney-client relationship is formed by your use of this service.
  > 2. Communications with this service are not privileged or confidential.
  > 3. This service is not a substitute for advice from a licensed attorney.
- Re-shown after 7 days of inactivity (Utah AIPA standard). Logged in `disclosures`.
- "Are you a human/lawyer?" hard-coded answer in voice + chat: *"No, I'm an AI assistant. I cannot give legal advice."*
- Always-visible "Talk to a licensed attorney" link in header → directory of legal-aid orgs by state (LSC).

### 10.2 Marketing-copy bans (FTC / DoNotPay-aligned)

Forbidden words anywhere in the product or marketing:
- "AI lawyer" / "robot lawyer" / "your AI attorney"
- "Operates like a lawyer"
- "Legally valid documents" (use: "drafts" / "templates")
- "Replaces a lawyer"
- "Win your case"

Allowed:
- "Self-help legal tool"
- "AI assistant for legal information"
- "Document templates"
- "Research and drafting assistance"

### 10.3 Output guardrails

Counsel **refuses** these in all flows:
- "Should I fire my attorney?" → directs to a licensed second opinion.
- "What's my deadline?" → outputs the date FOUND IN THE LETTER, prefixed with "the letter says X — verify with the court."
- "Predict my outcome." → returns probability range with a heavy caveat OR refuses outright in high-stakes (custody, criminal, immigration removal).
- Drafting court-filed motions/pleadings → produces a TEMPLATE with `[CONSULT ATTORNEY]` placeholders for legal-judgment fields.
- Picking causes of action / bankruptcy exemptions / strategic legal elections → refuses, hands off.

### 10.4 Citation grounding (anti-Mata-v.-Avianca)

- Every statute or case citation in any user-visible output **must** be retrieved at request time from CourtListener / govinfo / state SOS / OpenLaws.
- The drafting prompt receives the verified citations as context and is instructed to use ONLY those.
- A post-generation pass scans the output for any case-cite pattern (`\d+\s+\w+\s+\d+`) and verifies each appears in the retrieved set; unverified cites are stripped and replaced with a `[citation needed — consult attorney]` note.

### 10.5 Data handling

- Inputs are not used for training. Stated up front and enforced via service config.
- Phone numbers stored as SHA-256 hashes.
- Map markers anonymized (coarse coords, ≥3-cell aggregation).
- User can delete all their data via Settings → Delete (DSAR-style, returns confirmation).

### 10.6 Jurisdiction strategy

- v0 launches with US-CA, US-TX, US-NY full coverage. Other states: cases accepted, results show "we have limited rules coverage in your state — generic federal-law analysis only."
- No EU/UK launch initially (GDPR/AI Act compliance work needed).
- Geofence: detect IP country; if UK/EU, show a banner: "Counsel is currently US-only; EU/UK launch coming soon."

---

## 11. Test loop (per-feature acceptance — run via `runTest()`)

For each feature in §7, after build completes, run an end-to-end test using the `testing` skill. Define the test plan to include:

**Universal smoke (every feature):**
- Page loads without console errors.
- Disclaimer modal appears on first visit.
- Footer disclaimer is visible.
- No banned marketing copy appears in DOM.

**Feature 1 — Defend+Counter:**
- Upload `/test-fixtures/eviction-ca.pdf` → case completes → response letter contains `Civil Code § 1946.2`.
- Upload `/test-fixtures/debt-letter.pdf` → ≥1 FDCPA violation flagged with `15 U.S.C. § 1692` citation.
- Upload `/test-fixtures/wage-termination.pdf` → vertical detected as wage; FLSA section cited.
- Click "File complaint with CFPB" → preview modal opens with pre-filled draft.
- Verify every cite link resolves to a real page (HTTP 200).

**Feature 2 — Adversary Dossier:**
- Visit `/entity/<seeded-real-entity-id>` → page renders complete dossier.
- "Use this defense" button injects the chosen text into a draft response letter.

**Feature 3 — Predator Map:**
- Visit `/map` → MapLibre renders; pins visible.
- Filter by "eviction" → pin count drops appropriately.
- Click cluster → zooms; click pin → side-sheet opens with entity preview.

**Feature 4 — Voice + WhatsApp:**
- Trigger inbound call simulation (recorded test audio piped into the WS handler) → AI greets in <3s.
- Send a Spanish prompt → AI replies in Spanish.
- WhatsApp inbound test message with a fixture image → outbound reply within 60s containing PDF link.

**Feature 5 — Coalition Builder:**
- Seed 6 cases against same fake entity → coalition auto-forms.
- Submit a lawyer bid → bid appears in list.
- Member opt-in records `disclosures` row.

**Stretch features (when built):** corresponding acceptance tests in §7.

**Self-fix loop (Replit Agent — apply this strictly):**
1. Run the feature's test plan.
2. If failures, read the failure output, identify root cause, fix code (not test), re-run.
3. Maximum 3 self-fix iterations. After 3, surface the failure to the user with a concise summary and your best hypothesis.
4. Never adjust the acceptance criteria to make a test pass.
5. After all features pass, run a single full-product end-to-end test simulating the demo video script.

---

## 12. Deploy + demo prep

### 12.1 Deployment

- Use Replit Deployments (read `deployment` skill).
- Set up production env vars via Secrets:
  - `ANTHROPIC_API_KEY` (or rely on `ai-integrations-anthropic` proxy)
  - `OPENAI_API_KEY` (or proxy)
  - `COURTLISTENER_TOKEN`
  - `API_DATA_GOV_KEY`
  - `LEGISCAN_KEY`
  - `OPENSTATES_KEY`
  - `OPENLAWS_KEY`
  - `OPENCORPORATES_KEY` (if obtained)
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_NUMBER`, `TWILIO_WHATSAPP_NUMBER`
  - `MAPBOX_TOKEN` (if used; otherwise MapLibre+Carto needs none)
- Run prod migrations: `pnpm --filter @workspace/api-server run db:migrate`.
- Verify Twilio webhook URLs point to the public deploy URL.
- Smoke-test the public URL end-to-end.

### 12.2 Demo video (the single most important deliverable)

Plan the shot list before recording:

1. **Cold open (5s):** A real piece of paper held up to the camera. "This is an eviction notice. Watch what happens when I drop it into Counsel."
2. **Upload + reveal (15s):** Screen recording of the upload → animated pipeline → result card. Music drops on the final reveal.
3. **Counter-attack (10s):** Click the "File CFPB complaint" button. Show the pre-filled form. "One click. Filed."
4. **Adversary (10s):** Tab over to Adversary Dossier. "1,247 cases. Lose 67% when challenged. Here's exactly which arguments worked."
5. **Coalition (10s):** "Other tenants in this building got the same letter. Counsel just formed a class action."
6. **Map (5s):** Cut to the Predator Map zooming out. "Every bad actor on the map, in public, forever."
7. **Voice (10s):** Cut to a phone calling the Twilio number, AI answers in Spanish.
8. **Tagline + CTA (5s):** "Counsel. Your free AI lawyer for evictions, debt, and wage theft. Free, in any language."

Total: ~70 seconds. Submit a 90-120s extended cut for the buildathon.

### 12.3 Submission package

- Title: **Counsel — Free AI legal help for the 5 billion**
- Tagline (one line): "Drop in any scary letter. Get your power back in 30 seconds."
- Long description: 3 paragraphs — what it is, why it matters, what's next.
- Required tag: `replit10-buildathon`.
- Demo video URL (YouTube, public).
- Live URL (Replit deployment).
- Source code link (Replit project).
- Screenshot pack: 6 hero screenshots in 16:9.
- Honest "What worked / what's next" section listing the 3 stretch features as the v1 roadmap.

---

## 13. Decisions still required from the user (ask only these)

1. **Brand name:** confirm "Counsel" or pick from `Standing` / `Brief` / `Plainspeak` / `Letter` / your own.
2. **Twilio number country:** US (default, recommended for demo) or other.
3. **Initial WhatsApp launch number:** Use Twilio sandbox (free, instant) or wait for a verified WABA (slower; not needed for demo).
4. **Two real test letters per vertical** — please collect or designate where to source them (PACER, ACLU samples, sanitized personal). The Agent can scaffold without these but they're required to pass the acceptance tests in §11.

Once these are answered, building begins.

---

## Appendix A — Required environment variables

| Var | Where to get it | Required for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Replit AI Integrations or anthropic.com | All AI |
| `OPENAI_API_KEY` | Replit AI Integrations or openai.com | Voice + embeddings |
| `COURTLISTENER_TOKEN` | courtlistener.com profile | Adversary, citation grounding |
| `API_DATA_GOV_KEY` | api.data.gov | govinfo, congress, regulations |
| `LEGISCAN_KEY` | legiscan.com | State statutes |
| `OPENSTATES_KEY` | openstates.org | State statutes |
| `OPENLAWS_KEY` | openlaws.us | Semantic statute search |
| `TWILIO_ACCOUNT_SID` | twilio.com | Voice + WhatsApp |
| `TWILIO_AUTH_TOKEN` | twilio.com | Voice + WhatsApp |
| `TWILIO_VOICE_NUMBER` | twilio.com purchase | Voice |
| `TWILIO_WHATSAPP_NUMBER` | twilio.com sandbox | WhatsApp |
| `OPENCORPORATES_KEY` (optional) | opencorporates.com | Better entity resolution |
| `MAPBOX_TOKEN` (optional) | mapbox.com | If preferring Mapbox over MapLibre |
| `SESSION_SECRET` | already set | Sessions |

Use the `environment-secrets` skill to request any missing keys from the user; never hardcode.

## Appendix B — External APIs reference (links)

- CourtListener REST v4: `https://www.courtlistener.com/help/api/rest/v4/`
- govinfo: `https://api.govinfo.gov/docs/`
- LegiScan: `https://legiscan.com/legiscan`
- Open States v3: `https://docs.openstates.org/api-v3/`
- OpenLaws: `https://docs.openlaws.us/`
- OpenCorporates: `https://api.opencorporates.com/documentation/API-Reference`
- SEC EDGAR: `https://www.sec.gov/edgar/sec-api-documentation`
- Twilio Voice: `https://www.twilio.com/docs/voice`
- Twilio Media Streams: `https://www.twilio.com/docs/voice/media-streams`
- Twilio WhatsApp Sandbox: `https://www.twilio.com/docs/whatsapp/sandbox`
- OpenAI Realtime: `https://platform.openai.com/docs/guides/realtime`
- Anthropic Claude: `https://docs.anthropic.com/`
- Replit AI Integrations: see `.local/skills/ai-integrations-anthropic/SKILL.md`
- MapLibre GL: `https://maplibre.org/maplibre-gl-js/docs/`
- Carto basemap: `https://carto.com/basemaps/`

## Appendix C — Skills the Agent must read before building

In this order:
1. `pnpm-workspace` — already loaded
2. `artifacts` — for adding the new `counsel-web` artifact
3. `react-vite` — for the frontend
4. `repl_setup` — for proxy & host config
5. `database` — for the Postgres + Drizzle additions
6. `environment-secrets` — for requesting API keys
7. `integrations` — to check for any first-class integrations (Twilio, Clerk, Anthropic) before asking for raw keys
8. `ai-integrations-anthropic` and `ai-integrations-openai` — for AI calls
9. `clerk-auth` — for the auth flow
10. `object-storage` — for uploaded files
11. `workflows` — for service start/restart
12. `testing` — for the per-feature acceptance loop
13. `deployment` — for shipping to production
14. `code_review` — to architect-review at end of build

## Appendix D — Disclaimer copy (canonical, do not paraphrase in product)

**Three-pillar (modal + footer link):**
> Counsel is an AI-powered self-help tool, not a law firm.
>  
> 1. **No attorney-client relationship.** Using Counsel does not create an attorney-client relationship with anyone.
> 2. **No confidentiality.** Anything you share with Counsel is not protected by attorney-client privilege.
> 3. **Not a substitute for an attorney.** Counsel provides legal information and document drafts, not legal advice. For decisions that affect your rights, consult a licensed attorney in your jurisdiction.
>  
> By continuing, you confirm you understand the above.

**Footer (every page):** *Counsel is not a law firm. AI-generated information — not legal advice. © Counsel.*

**Voice / WhatsApp (spoken on session start):** *"Hi, I'm Counsel — an AI assistant, not a lawyer. I can help you understand a letter and draft a response, but anything I say is information, not legal advice. Ready when you are."*

---

## How to start (Replit Agent — start here)

1. Read every skill in Appendix C, in order.
2. Check existing artifacts: confirm `artifacts/api-server` and `artifacts/mockup-sandbox` are running.
3. Ask the user the four decisions in §13. While waiting, scaffold the new `artifacts/counsel-web` Vite+React+Tailwind v4 artifact per the `artifacts` and `react-vite` skills, install all deps from §2.1, set up the design tokens from §8.1, and build the landing-page hero (§8.2).
4. Once user answers, extend OpenAPI spec (§6), run codegen, add Drizzle schema (§5), generate migrations.
5. Build Feature 1 vertical slice end-to-end. Test (§11). Commit.
6. Build Feature 2. Test. Commit.
7. Build Feature 3. Test. Commit.
8. Build Feature 4. Test. Commit.
9. Build Feature 5. Test. Commit.
10. Architect-review via `code_review` skill. Fix severe issues immediately.
11. Build Features 6, 7, 8 in priority order if hours remain. Each one tested before the next.
12. Final polish pass: animations, copy, mobile, accessibility, reduced-motion, empty states.
13. Deploy. Smoke-test prod. Record demo video. Write submission text. Submit.

**Now go build.**
