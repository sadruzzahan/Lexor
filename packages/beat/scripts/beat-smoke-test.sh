#!/usr/bin/env bash
# Beat API smoke test — verifies all gate-0 acceptance criteria
set -euo pipefail

BASE="${API_BASE:-http://localhost:8080/api}"
PASS=0
FAIL=0
ERRORS=()

ok() { echo "  ✓ $1"; ((PASS++)) || true; }
fail() { echo "  ✗ $1"; ERRORS+=("$1"); ((FAIL++)) || true; }

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then ok "$label"; else fail "$label (got: $actual, want: $expected)"; fi
}

assert_nonempty() {
  local label="$1" val="$2"
  if [[ -n "$val" && "$val" != "null" ]]; then ok "$label"; else fail "$label (empty/null)"; fi
}

echo ""
echo "=== Beat Smoke Test ==="
echo "Base: $BASE"
echo ""

# ── 1. Health check ─────────────────────────────────────────────────────────
echo "[ 1 ] Health check"
HEALTH=$(curl -sf "$BASE/healthz" 2>/dev/null || echo '{}')
STATUS=$(echo "$HEALTH" | jq -r '.status // "error"')
DB=$(echo "$HEALTH" | jq -r '.db // false')
ANTHROPIC=$(echo "$HEALTH" | jq -r '.anthropic // false')
GEMINI=$(echo "$HEALTH" | jq -r '.gemini // false')
OPENAI=$(echo "$HEALTH" | jq -r '.openai // false')

assert_nonempty "healthz responds" "$STATUS"
assert_eq "db reachable" "$DB" "true"
assert_eq "anthropic proxy configured" "$ANTHROPIC" "true"
assert_eq "gemini proxy configured" "$GEMINI" "true"
assert_eq "openai proxy configured" "$OPENAI" "true"

# ── 2. Create investigation case ─────────────────────────────────────────────
echo ""
echo "[ 2 ] Create case"
CASE=$(curl -sf -X POST "$BASE/v1/cases" \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke Test Case","rolePack":"detective","goal":"End-to-end test","language":"en"}' \
  2>/dev/null || echo '{}')
CASE_ID=$(echo "$CASE" | jq -r '.id // ""')
CASE_STATUS=$(echo "$CASE" | jq -r '.status // ""')
CASE_ROLE=$(echo "$CASE" | jq -r '.rolePack // ""')

assert_nonempty "case created with id" "$CASE_ID"
assert_eq "case status is open" "$CASE_STATUS" "open"
assert_eq "case rolePack is detective" "$CASE_ROLE" "detective"

# ── 3. List cases ─────────────────────────────────────────────────────────────
echo ""
echo "[ 3 ] List cases"
LIST=$(curl -sf "$BASE/v1/cases" 2>/dev/null || echo '{}')
TOTAL=$(echo "$LIST" | jq -r '.total // 0')
CASES_LEN=$(echo "$LIST" | jq -r '.cases | length // 0')

assert_nonempty "list returns cases array" "$CASES_LEN"
if [[ "$TOTAL" -ge 1 ]]; then ok "total >= 1"; else fail "total should be >= 1 (got $TOTAL)"; fi

# ── 4. Upload a test file ─────────────────────────────────────────────────────
echo ""
echo "[ 4 ] File upload"
echo "beat-smoke-test-evidence" > /tmp/smoke-evidence.txt
UPLOAD=$(curl -sf -X POST "$BASE/v1/cases/$CASE_ID/files" \
  -F "file=@/tmp/smoke-evidence.txt" \
  -F "sourceType=note" \
  -F "caption=Smoke test evidence" \
  2>/dev/null || echo '{}')
FILE_ID=$(echo "$UPLOAD" | jq -r '.id // ""')
FILE_SHA=$(echo "$UPLOAD" | jq -r '.sha256 // ""')
FILE_SOURCE=$(echo "$UPLOAD" | jq -r '.sourceType // ""')

assert_nonempty "file uploaded with id" "$FILE_ID"
assert_nonempty "sha256 computed" "$FILE_SHA"
assert_eq "sourceType recorded" "$FILE_SOURCE" "note"

# ── 5. Start a run ────────────────────────────────────────────────────────────
echo ""
echo "[ 5 ] Start run"
RUN_RESP=$(curl -sf -X POST "$BASE/v1/cases/$CASE_ID/run" \
  -H "Content-Type: application/json" \
  -d '{}' \
  2>/dev/null || echo '{}')
RUN_ID=$(echo "$RUN_RESP" | jq -r '.runId // ""')

assert_nonempty "run started with runId" "$RUN_ID"

# ── 6. Read SSE events (first 5) ─────────────────────────────────────────────
echo ""
echo "[ 6 ] SSE stream (first 5 events)"
SSE_RAW=$(curl -sf --max-time 15 "$BASE/v1/runs/$RUN_ID/events" 2>/dev/null | head -10)
EVT_COUNT=$(echo "$SSE_RAW" | grep -c '^data:' || true)
FIRST_EVT=$(echo "$SSE_RAW" | grep '^data:' | head -1 | sed 's/^data: //')
FIRST_TYPE=$(echo "$FIRST_EVT" | jq -r '.eventType // ""')
HAS_IDX=$(echo "$FIRST_EVT" | jq -r '.idx // -1')

if [[ "$EVT_COUNT" -ge 5 ]]; then ok "received >= 5 SSE events (got $EVT_COUNT)"; else fail "expected >= 5 SSE events (got $EVT_COUNT)"; fi
assert_eq "first event type is run_started" "$FIRST_TYPE" "run_started"
if [[ "$HAS_IDX" != "-1" ]]; then ok "events have idx field"; else fail "events missing idx field"; fi

# Verify JurisdictionDetector appears in stream
JURIS_EVT=$(echo "$SSE_RAW" | grep '"JurisdictionDetector"' | head -1)
if [[ -n "$JURIS_EVT" ]]; then ok "JurisdictionDetector event present"; else fail "JurisdictionDetector event missing"; fi

# ── 7. Verify run completed ───────────────────────────────────────────────────
echo ""
echo "[ 7 ] Run completion"
sleep 1
RUN_STATUS=$(curl -sf "$BASE/v1/runs/$RUN_ID" 2>/dev/null | jq -r '.status // ""')
assert_eq "run completed" "$RUN_STATUS" "completed"

# ── 8. Draft auto-created ─────────────────────────────────────────────────────
echo ""
echo "[ 8 ] Draft auto-created"
DRAFT=$(curl -sf "$BASE/v1/cases/$CASE_ID/draft" 2>/dev/null || echo '{}')
DRAFT_BODY=$(echo "$DRAFT" | jq -r '.body // ""')
if [[ ${#DRAFT_BODY} -gt 50 ]]; then ok "draft body present (${#DRAFT_BODY} chars)"; else fail "draft body too short or missing"; fi

# ── 9. Patch and soft-delete case ────────────────────────────────────────────
echo ""
echo "[ 9 ] PATCH + DELETE case"
PATCHED=$(curl -sf -X PATCH "$BASE/v1/cases/$CASE_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"closed"}' \
  2>/dev/null || echo '{}')
PATCHED_STATUS=$(echo "$PATCHED" | jq -r '.status // ""')
assert_eq "case patched to closed" "$PATCHED_STATUS" "closed"

DELETE_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE "$BASE/v1/cases/$CASE_ID" 2>/dev/null || echo "000")
assert_eq "soft-delete returns 204" "$DELETE_CODE" "204"

# ── 10. Delete run ────────────────────────────────────────────────────────────
echo ""
echo "[ 10 ] Cancel/delete run"
NEW_RUN=$(curl -sf -X POST "$BASE/v1/cases" \
  -H "Content-Type: application/json" \
  -d '{"title":"Cancel Test"}' \
  2>/dev/null | jq -r '.id // ""')
if [[ -n "$NEW_RUN" ]]; then
  NEW_RUN_RESP=$(curl -sf -X POST "$BASE/v1/cases/$NEW_RUN/run" \
    -H "Content-Type: application/json" -d '{}' 2>/dev/null)
  NEW_RUN_ID=$(echo "$NEW_RUN_RESP" | jq -r '.runId // ""')
  if [[ -n "$NEW_RUN_ID" ]]; then
    DEL_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE "$BASE/v1/runs/$NEW_RUN_ID" 2>/dev/null || echo "000")
    assert_eq "delete run returns 204" "$DEL_CODE" "204"
  else
    fail "could not create run for delete test"
  fi
else
  fail "could not create case for delete test"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "================================"
echo "PASSED: $PASS | FAILED: $FAIL"
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo "Failures:"
  for e in "${ERRORS[@]}"; do echo "  - $e"; done
fi
echo "================================"
echo ""

if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
exit 0
