# Lexor — Replit10 Buildathon Submission

**Tag:** `#replit10-buildathon`
**Tagline:** Drop in any scary letter. Get your power back in 30 seconds.
**Built on Replit by:** zexorex

---

## What it is

Lexor is a free, AI-powered legal-help assistant for the people most likely to be on the
receiving end of an eviction notice, a debt-collection letter, or a stolen paycheck. Drop a
photo of any letter and Lexor explains it in plain language, finds the laws on your side,
and drafts your response — in about 30 seconds. It speaks any language by phone or
WhatsApp, so you don't need an account, a desktop, or English to use it.

Behind the scenes, Lexor pairs Anthropic Claude (case analysis + drafting) with OpenAI's
Realtime API (voice), Deepgram + ElevenLabs (hearing coach), and a small army of public
legal data sources (CourtListener, LegiScan, OpenStates, OpenLaws, regulations.gov) to
return a Defense + Counter-attack strategy with citations. Uploaded letters get pinned —
anonymized — to a city-level map so the next person dealing with the same landlord or
debt collector starts the fight already winning.

The product is intentionally narrow: three verticals (housing, debt, wage theft), three
clear actions per case, one disclaimer that never lets the user forget Lexor isn't a law
firm. Every screen, every animation, and every API response was tuned around a single
question: *will this still feel obvious to someone reading it on a $40 phone, in their
second language, at 11pm, the night before they have to respond?*

---

## What worked

- **End-to-end case pipeline.** Upload → OCR → Claude classify → Defense + Counter-attack
  + draft response in a single streamed turn, persisted to Postgres + pgvector.
- **Inbox Sentinel.** Gmail integration auto-scans incoming mail for legal threats and
  surfaces them with the same Defense/Counter-attack triage. Acceptance harness passes 3/3.
- **Hearing Coach.** Live Deepgram → Claude → ElevenLabs loop that role-plays a judge or
  opposing counsel so users can rehearse before court.
- **Live abuser map.** Anonymized, k-anonymity-gated pin grid with a real-time top-3
  ticker. Every upload makes the network stronger for the next person.
- **Voice-first design.** WhatsApp + phone bridges share the same Claude tool layer the web
  uses, so the answer is identical whether you typed, spoke, or sent a photo.
- **Polish pass.** Word-stagger reveals on long-copy, global focus-visible outlines, full
  `prefers-reduced-motion` fallback, and a banned-marketing-copy gate in CI.

## What's next

- Real case-law citations + per-jurisdiction confidence scoring (currently a heuristic).
- Per-user Gmail OAuth tokens (currently a single workspace integration).
- Twilio outbound voice handoff for the "Talk to a licensed attorney" CTA.
- Spanish-language drafting parity (UI is multilingual; drafts are English-only today).
- Real-PDF response export (currently HTML-printable).
- Tighter neighborhood resolution on the map once we cross the k-anonymity threshold in
  more cities.

---

## 70-second demo shot list

| t | Visual | Voiceover |
|---|---|---|
| 0–5s | **01-landing.jpg** — hero, "Drop in any scary letter…" | "Lexor turns any scary legal letter into a 30-second action plan." |
| 5–14s | **02-upload.jpg** — drag-drop a sample eviction notice | "Drop a photo. Or paste it. Or send it on WhatsApp." |
| 14–28s | Live case page (Defense tab) | "Lexor reads it, explains it in plain language, and finds the laws on your side." |
| 28–38s | Counter-attack tab + draft response | "Then it drafts your response and shows you what to file back." |
| 38–48s | **03-map.jpg** — live abuser map ticker | "Every upload is pinned — anonymously — so the next person walks in already winning." |
| 48–60s | **04-voice.jpg** — Voice + WhatsApp panel | "And it speaks any language by phone or WhatsApp. No account, no app, no English required." |
| 60–68s | **06-disclaimer.jpg** quick fade + **07-mobile-landing.jpg** | "Lexor is a self-help tool, not a law firm — built for the $40 phone in someone's pocket." |
| 68–70s | **05-about.jpg** — "Every upload makes the network stronger." | "Lexor. By zexorex. #replit10-buildathon" |

Screenshots are in `attached_assets/screenshots/` (1440×810, plus one 375×667 mobile).

### Animated demo

The 65-second animated demo is built as a video artifact at
`artifacts/lexor-demo-video/`. It plays from the workspace preview pane at
`/lexor-demo-video/` and is exported via the video-js export pipeline. The
shareable export URL will be appended here once the recording is downloaded
and re-hosted (the export step happens outside the build environment).

---

## Stack

- **Web** — Vite + React 19 + Tailwind v4 + Framer Motion + GSAP (`artifacts/lexor-web`)
- **API** — Express 5 + Drizzle + Postgres + pgvector + Clerk (`artifacts/api-server`)
- **AI** — Anthropic Claude (case analysis), OpenAI Realtime (voice), Deepgram (STT),
  ElevenLabs (TTS)
- **Voice surface** — Twilio Voice + WhatsApp bridges sharing the Claude tool layer
- **Data** — CourtListener, LegiScan, OpenStates, OpenLaws, regulations.gov, OpenCorporates
- **Hosting** — Replit Autoscale Deployments
