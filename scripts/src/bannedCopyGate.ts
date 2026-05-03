/**
 * Banned-copy grep gate. Fails if any FTC/DoNotPay-aligned banned phrase
 * (build plan §10.2) appears in user-visible code under artifacts/lexor-web,
 * AND — when a build is present — in the bundled output under
 * artifacts/lexor-web/dist. The bundle scan catches regressions that arrive
 * via dependencies or build-time string composition.
 *
 * Run with: pnpm --filter @workspace/scripts run banned-copy-gate
 */
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

const BANNED: ReadonlyArray<RegExp> = [
  /\bAI\s+lawyer\b/i,
  /\brobot\s+lawyer\b/i,
  /\byour\s+AI\s+attorney\b/i,
  /\boperates?\s+like\s+a\s+lawyer\b/i,
  /\blegally\s+valid\s+documents?\b/i,
  /\breplaces?\s+a\s+lawyer\b/i,
  /\bwin\s+your\s+case\b/i,
];

const ROOTS = [
  "artifacts/lexor-web/src",
  "artifacts/lexor-web/index.html",
];

const BUNDLE_ROOT = "artifacts/lexor-web/dist/public";
const BUNDLE_EXTS = [".html", ".js", ".css", ".txt", ".json"];

function listFiles(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    try {
      const cmd = `git ls-files -- ${root}`;
      const stdout = execSync(cmd, { encoding: "utf8" });
      for (const line of stdout.split("\n")) {
        const f = line.trim();
        if (!f) continue;
        if (
          f.endsWith(".ts") ||
          f.endsWith(".tsx") ||
          f.endsWith(".css") ||
          f.endsWith(".html") ||
          f.endsWith(".md")
        ) {
          out.push(f);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function listBundleFiles(): string[] {
  const root = join(process.cwd(), BUNDLE_ROOT);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (BUNDLE_EXTS.some((ext) => name.endsWith(ext))) {
        out.push(relative(process.cwd(), full));
      }
    }
  };
  walk(root);
  return out;
}

interface Hit {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  const files = [...listFiles(), ...listBundleFiles()];
  for (const f of files) {
    let body: string;
    try {
      body = readFileSync(join(process.cwd(), f), "utf8");
    } catch {
      continue;
    }
    const lines = body.split("\n");
    lines.forEach((line, idx) => {
      // Skip self-references in the gate script and the build-plan attached asset
      if (f.endsWith("bannedCopyGate.ts")) return;
      for (const re of BANNED) {
        if (re.test(line)) {
          hits.push({
            file: relative(process.cwd(), f),
            line: idx + 1,
            text: line.trim(),
            pattern: re.source,
          });
        }
      }
    });
  }
  return hits;
}

function main(): void {
  const bundlePresent = existsSync(join(process.cwd(), BUNDLE_ROOT));
  const requireBundle = process.env.BANNED_COPY_REQUIRE_BUNDLE === "1";
  if (requireBundle && !bundlePresent) {
    console.error(
      `[banned-copy] FAIL — BANNED_COPY_REQUIRE_BUNDLE=1 but no built bundle at ${BUNDLE_ROOT}. Run \`pnpm --filter @workspace/lexor-web run build\` first.`,
    );
    process.exit(1);
  }
  const hits = scan();
  if (hits.length === 0) {
    const where = bundlePresent
      ? `source + ${BUNDLE_ROOT}`
      : `source only (no ${BUNDLE_ROOT} found — run \`pnpm --filter @workspace/lexor-web run build\` for full coverage, or set BANNED_COPY_REQUIRE_BUNDLE=1 to require it)`;
    console.log(`[banned-copy] PASS — no banned marketing copy found (${where}).`);
    process.exit(0);
  }
  console.error(`[banned-copy] FAIL — ${hits.length} banned phrase(s):`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  /${h.pattern}/`);
    console.error(`    ${h.text}`);
  }
  process.exit(1);
}

main();
