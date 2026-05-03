/**
 * Banned-copy grep gate. Fails if any FTC/DoNotPay-aligned banned phrase
 * (build plan §10.2) appears in user-visible code under artifacts/lexor-web.
 *
 * Run with: pnpm --filter @workspace/scripts run banned-copy-gate
 */
import { readFileSync } from "node:fs";
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

interface Hit {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const f of listFiles()) {
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
  const hits = scan();
  if (hits.length === 0) {
    console.log("[banned-copy] PASS — no banned marketing copy found.");
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
