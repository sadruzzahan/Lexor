#!/usr/bin/env node
/**
 * G10 + G17 — `no-linear-easing` lint rule, extended for MotionSystem (M10).
 *
 * Scans `artifacts/briefcase-app/src` for transitions that bypass the
 * MotionSystem tokens defined in `src/theme/motion.ts`. Reports:
 *
 *   - `Easing.linear` references (G10's original ban)
 *   - `transition: ... linear` declarations in CSS-in-JS / Tailwind strings
 *   - hard-coded `cubic-bezier(...)` strings
 *   - `transitionTimingFunction: 'linear'` style props
 *
 * Allow-list:
 *   - `src/theme/motion.ts` (the canonical easing definitions)
 *   - `src/index.css` (the design-system CSS that resolves tokens)
 *   - any file whose first line is the literal "lint-motion-allow"
 *
 * Exits non-zero on any violation so it can be wired into CI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..");
const srcRoot = join(root, "src");

const ALLOWLIST = new Set(
  [
    join("src", "theme", "motion.ts"),
    join("src", "theme", "tokens.ts"),
    join("src", "index.css"),
  ].map((p) => p.split("/").join(sep)),
);

const PATTERNS = [
  {
    name: "Easing.linear",
    re: /\bEasing\.linear\b/,
    hint: "Use MotionSystem.{whisper,soft,bouncy,elastic,snap,dramatic} from '@/theme/motion'",
  },
  {
    name: "transition: ... linear",
    re: /transition:[^;\n]*\blinear\b/,
    hint: "Use MotionCss.<preset>(properties) from '@/theme/motion'",
  },
  {
    name: "cubic-bezier literal",
    re: /cubic-bezier\(/,
    hint: "Use cssEasing.<preset> from '@/theme/motion'",
  },
  {
    name: "transitionTimingFunction: 'linear'",
    re: /transitionTimingFunction:\s*['\"]linear['\"]/,
    hint: "Use MotionSystem.<preset> from '@/theme/motion'",
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "build") continue;
      yield* walk(full);
    } else if (
      name.endsWith(".ts") ||
      name.endsWith(".tsx") ||
      name.endsWith(".css")
    ) {
      yield full;
    }
  }
}

const violations = [];
for (const file of walk(srcRoot)) {
  const rel = relative(root, file);
  if (ALLOWLIST.has(rel)) continue;
  const content = readFileSync(file, "utf8");
  if (content.startsWith("/* lint-motion-allow */")) continue;
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        violations.push({ file: rel, line: i + 1, name: p.name, hint: p.hint, src: line.trim() });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("FAIL no-linear-easing: " + violations.length + " violation(s)\n");
  for (const v of violations) {
    console.error("  " + v.file + ":" + v.line + "  [" + v.name + "]");
    console.error("    " + v.src);
    console.error("    -> " + v.hint + "\n");
  }
  process.exit(1);
}

console.log("OK no-linear-easing: 0 violations across " + srcRoot);
