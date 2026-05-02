#!/usr/bin/env bash
# Lexor — banned-marketing-copy gate.
# Fails the build if any forbidden phrase appears in src/.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$HERE/src"

PATTERNS=(
  "AI lawyer"
  "robot lawyer"
  "replaces a lawyer"
  "win your case"
  "legally valid documents"
)

EXIT=0
for p in "${PATTERNS[@]}"; do
  if grep -RInF --color=never "$p" "$TARGET" >/dev/null 2>&1; then
    echo "BANNED PHRASE found: \"$p\""
    grep -RInF --color=never "$p" "$TARGET" || true
    EXIT=1
  fi
done

if [ "$EXIT" -eq 0 ]; then
  echo "lexor: banned-copy gate passed (0 forbidden phrases)."
fi
exit "$EXIT"
