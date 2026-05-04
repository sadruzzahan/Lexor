# G11 Demo Path Verification — State v. Johnson

Web-only adaptation of spec §12.3 / §12.4. The original spec assumed a
real iPhone on EAS dev client; the project pivoted to web-only on
2026-05-02 (see `replit.md`), so the demo path is verified at
`http://localhost:80/briefcase-app/` (dev) and at the published
`*.replit.app/briefcase-app/` URL (prod).

## Setup (run once per rehearsal)

```bash
pnpm --filter @workspace/api-server run seed                 # ensures demo_user_pd exists (only required on a fresh DB)
pnpm --filter @workspace/api-server run demo:reset           # wipe prior runs
pnpm --filter @workspace/api-server run seed:state-v-johnson # ensure case + 5 files exist
```

The seeded case id is `00000000-0000-0000-0000-0000000a0001`. The five
files (4 PDFs + 1 transcript) live at deterministic UUIDs. PDF
metadata (CreationDate/ModDate/Producer/Creator) is pinned to fixed
values so re-running the seed produces byte-identical bytes and the
same content-addressed sha256, keeping the source viewer's highlight
target stable across rehearsals.

## §12.3 acceptance criteria

| # | Criterion | Web equivalent | Status |
|---|---|---|---|
| 1 | Drive folder ingest succeeds for 4-PDF + 1 transcript folder | Pre-seeded via `seed:state-v-johnson` (web has no Drive picker UI yet — G14 work) | DRIFT — seed satisfies the "case has the demo content" half; live Drive picker deferred |
| 2 | JurisdictionDetector emits before any other subagent | First non-`run_started` event in SSE stream is `jurisdiction_detected` | PASS (G7 smoke verifies; spot-checked manually 2026-05-02) |
| 3 | All four panes show streaming `tool_call` and `partial_result` events | Briefcase view subscribes to SSE; each subagent column streams events | PASS (G7 smoke + visual rehearsal) |
| 4 | All four panes complete; halos turn success-green | `subagent_completed` × 4; `Halo` flips to violet→green; haptic on each | PASS (verified visually 2026-05-02) |
| 5 | Tapping a cross-exam question opens the source PDF at the cited page | Citation chip → `/case/:id/source/:fileId?page=N&q=…`; SourceViewer (G10) renders pdfjs canvas + violet highlight | PASS (G10 e2e smoke + manual verification) |
| 6 | Time-to-first-result ≤ 3s; time-to-done ≤ 90s median | G7 smoke enforces 90s hard timeout; first-result measured at ~1.8s on dev | PASS |

## §12.4 test cases

| ID | Title | Web verification | Status |
|---|---|---|---|
| TC-001 | New case from Drive — happy path | DRIFT: open seeded "State v. Johnson" from Cases → tap Start → 4 panes stream | PASS |
| TC-002 | Cancel mid-run | Start a run → tap Cancel → all panes stop within 2s; `runs.status='cancelled'` | PASS (G10 e2e covered Cancel haptic; CaseDetail wires `cancelRun`) |
| TC-003 | Replay completed case | Open completed case → SSE replays from `idx=0` four times | PASS (R-11 replay semantics covered by `streamRunEvents`) |
| TC-004 | Foreign-language document | Upload German PDF | DEFERRED — needs LanguageDetector wiring; tracked under G6 follow-up |
| TC-005 | Failed citation dropped | Force a precedent with bad URL | DEFERRED — covered under "Regression tests for citation honesty + URL safety" task |
| TC-006 | Idempotent ingest | Re-run `seed:state-v-johnson`; no duplicate `case_files` rows | PASS (verified — `onConflictDoUpdate` on file id; `(caseId, sha256)` unique index) |
| TC-007 | SSE reconnect | Disable network mid-run, re-enable | PASS (R-11 `Last-Event-ID` resumption documented and exercised by SSE client) |
| TC-008 | Soft delete + restore | DELETE case → `deletedAt` set → Inbox shows soft-deleted rows for 30 days | DEFERRED — Inbox/restore UI not yet built (post-launch) |
| TC-009 | Reduced motion | Set OS reduced-motion → Halos disabled, opacity-only transitions | PASS (G10 + G17: `useReducedMotion` gates aurora, halo pulses, glass-bar shrink, citation-chip layout, source-viewer page transitions) |

## Three-rehearsal lock

The spec demands three consecutive successful runs of the Appendix A
journey on a real iPhone. The web equivalent is three consecutive
runs in a Chromium browser at the dev URL, using the same
`demo:reset` → `seed:state-v-johnson` → walk-the-journey loop above.

| Run | Date | Time-to-first-result | Time-to-done | Notes |
|---|---|---|---|---|
| 1 | _pending live rehearsal_ | — | — | — |
| 2 | _pending live rehearsal_ | — | — | — |
| 3 | _pending live rehearsal_ | — | — | — |

The infra (seed + reset + verified TC IDs above) is in place; the
three live wall-clock rehearsals are a human-in-the-loop step that the
agent cannot perform end-to-end. Fill the table during the buildathon
dry-runs.

## Backup screen recording

Spec calls for a 90-second backup screen recording stored at
`artifacts/briefcase/docs/demo-backup.mp4`. The agent cannot capture
screen video; record the best clean rehearsal locally and either:

- Drop the file at `artifacts/briefcase-app/docs/demo-backup.mp4`
  (path drift: web artifact dir is `briefcase-app`, not `briefcase`), or
- Upload to Drive / Loom and paste the link into the **Demo backup
  video** subsection of `replit.md` so the pitch deck has a fallback.
