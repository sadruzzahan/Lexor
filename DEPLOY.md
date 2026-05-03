# Deploying Lexor

This guide is for the project owner. The agent has prepared everything; the steps below
require your hands because they touch billing, secrets, and external service settings.

## 1 · Set production secrets

Open **Secrets** in the Replit workspace and add the following keys for the deployment
environment. Anything marked *(optional)* can be added later — the app degrades gracefully.

### Required

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Case analysis, drafting, hearing coach planner |
| `OPENAI_API_KEY` | Voice (Realtime) + embeddings for pgvector |
| `DEEPGRAM_API_KEY` | Hearing-coach speech-to-text |
| `ELEVENLABS_API_KEY` | Hearing-coach text-to-speech |
| `TWILIO_ACCOUNT_SID` | Inbound voice + WhatsApp bridge |
| `TWILIO_AUTH_TOKEN` | Inbound voice + WhatsApp bridge |
| `TWILIO_PHONE_NUMBER` | Voice page CTA + outbound SMS uploads (build plan §12.1 calls this `TWILIO_VOICE_NUMBER` — same value, code uses `TWILIO_PHONE_NUMBER`) |
| `TWILIO_WHATSAPP_NUMBER` | WhatsApp QR + replies |
| `COURTLISTENER_TOKEN` | Federal + state case-law lookup |
| `API_DATA_GOV_KEY` | regulations.gov lookups |
| `LEGISCAN_KEY` | Statute search |
| `OPENSTATES_KEY` | State-bill lookup |
| `OPENLAWS_KEY` | Statute fallbacks |
| `SESSION_SECRET` | Express session cookie (already set in dev — generate a fresh one for prod) |

### Optional

| Secret | What you lose without it |
|---|---|
| `OPENCORPORATES_KEY` | Landlord / debt-collector entity enrichment on the map |
| `MAPBOX_TOKEN` | Higher-quality basemap tiles (we fall back to OSS tiles) |

Already configured and re-used in prod automatically: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`,
`PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `DATABASE_URL`, the Clerk keys, and
the Gmail integration token.

## 2 · Publish

Use the **Publish** button in the workspace (the agent will also surface a publish
suggestion). The platform builds both artifacts (`api-server` and `lexor-web`), provisions
TLS, and exposes the app on a `*.replit.app` domain (or your custom domain).

## 3 · Production database schema

Replit's managed Postgres applies the dev schema to the production database
**automatically as part of Publish** — no manual `migrate` step is required.
The Publish flow:

1. Diffs the development DB against production.
2. Surfaces any column/table renames in the Publish UI for you to confirm
   (without confirmation a rename is treated as drop + add and would lose data).
3. Applies the resulting SQL to the production database during the publish.

For Lexor this creates the `cases`, `pins`, `inbox_alerts`, and pgvector
indexes on the live DB the first time you Publish. The pgvector extension
is enabled automatically by `lib/db/scripts/setup-pgvector.ts` whenever
`pnpm --filter @workspace/db run push` runs (which the post-merge setup
script invokes for the dev DB).

If after Publish the deployed app reports `relation does not exist` or a
missing column, re-run Publish — that's the supported way to push schema to
prod. **Do not** run `drizzle-kit migrate` or `pnpm --filter @workspace/db
run migrate` against the production DATABASE_URL by hand; that bypasses the
publish-time diff and rename confirmation and is unsafe.

## 4 · Wire Twilio webhooks

In the Twilio console, point each number at the deployed API:

- **Voice number → A call comes in →** Webhook
  `https://<your-domain>/api/counsel/voice/incoming` (HTTP POST)

  > The Twilio Media Streams WebSocket URL is derived from this host
  > automatically — Twilio opens `wss://<your-domain>/api/counsel/voice/stream`
  > based on the TwiML that `/voice/incoming` returns. You only need to
  > configure the `/voice/incoming` URL in the Twilio console.
- **WhatsApp number → When a message comes in →** Webhook
  `https://<your-domain>/api/counsel/whatsapp/inbound` (HTTP POST)

Replace `<your-domain>` with the value Replit shows on the Deployments page. Both
endpoints verify the Twilio signature server-side, so make sure
`TWILIO_AUTH_TOKEN` is set before pointing real traffic at them.

## 5 · Smoke test

Run the scripted smoke test against the deployed URL — it pings the landing,
upload, map, voice, and disclaimer pages plus the public API surfaces and asserts
each returns 200 with the Lexor shell:

```bash
LEXOR_PROD_URL=https://<your-domain> pnpm --filter @workspace/scripts run smoke-test
```

Then walk the manual checks:

1. Open the production URL, accept the disclaimer, and drag a sample eviction notice onto
   the upload card. Confirm the case page renders Defense + Counter-attack tabs with at
   least one citation.
2. Send a WhatsApp message with a photo to your Twilio WhatsApp number and confirm Lexor
   replies with a one-line explainer + a link to the full case.
3. Call the Twilio voice number and confirm the disclaimer is read in your language and
   you can describe a letter.
4. Open `/map` on the deployed URL and confirm the live ticker is populated. (It will be
   sparse until real uploads accumulate.)
5. Sign in with Clerk, connect Gmail in **Settings**, then run the inbox acceptance
   harness against prod with `INTERNAL_TEST_SECRET` set to a fresh value. Expect 3/3.

## Roll back

If anything goes sideways, the **Rollback** control on the Deployments page reverts to the
previous successful build with no downtime.
