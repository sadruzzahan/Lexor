#!/usr/bin/env node
/**
 * Copy Tesseract.js worker + core wasm files from node_modules into
 * `public/tesseract/` so the app can run OCR fully on-device without
 * fetching anything from a CDN at runtime. `eng.traineddata.gz` is
 * checked into the repo (large binary asset) and is not overwritten
 * if it already exists.
 *
 * Wired into the package `postinstall` hook so a fresh `pnpm install`
 * always lands the right asset bytes alongside the resolved package
 * versions.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const dst = resolve(appRoot, "public", "tesseract");
mkdirSync(dst, { recursive: true });

function tryResolve(specifier) {
  try {
    return require.resolve(specifier, { paths: [appRoot] });
  } catch {
    return null;
  }
}

// Use createRequire so this works as an ES module while still tapping
// Node's package resolver.
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);

function pkgDir(name) {
  try {
    return dirname(req.resolve(`${name}/package.json`, { paths: [appRoot] }));
  } catch {
    return null;
  }
}

const tessJsDir = pkgDir("tesseract.js");
const tessCoreDir = pkgDir("tesseract.js-core");

if (!tessJsDir || !tessCoreDir) {
  console.warn(
    "[copy-tesseract-assets] tesseract.js / tesseract.js-core not installed; skipping.",
  );
  process.exit(0);
}

const sources = [
  resolve(tessJsDir, "dist", "worker.min.js"),
  resolve(tessCoreDir, "tesseract-core.wasm.js"),
  resolve(tessCoreDir, "tesseract-core.wasm"),
  resolve(tessCoreDir, "tesseract-core-simd.wasm.js"),
  resolve(tessCoreDir, "tesseract-core-simd.wasm"),
  resolve(tessCoreDir, "tesseract-core-lstm.wasm.js"),
  resolve(tessCoreDir, "tesseract-core-lstm.wasm"),
  resolve(tessCoreDir, "tesseract-core-simd-lstm.wasm.js"),
  resolve(tessCoreDir, "tesseract-core-simd-lstm.wasm"),
];

let copied = 0;
for (const src of sources) {
  if (!existsSync(src)) {
    console.warn(`[copy-tesseract-assets] missing source: ${src}`);
    continue;
  }
  const out = resolve(dst, src.split("/").pop());
  copyFileSync(src, out);
  copied += 1;
}

const lang = resolve(dst, "eng.traineddata.gz");
if (!existsSync(lang)) {
  console.warn(
    `[copy-tesseract-assets] eng.traineddata.gz missing at ${lang}. ` +
      `Download from https://github.com/naptha/tessdata/raw/gh-pages/4.0.0_fast/eng.traineddata.gz`,
  );
}

console.log(`[copy-tesseract-assets] copied ${copied} file(s) → ${dst}`);
void tryResolve;
