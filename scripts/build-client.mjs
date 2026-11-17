#!/usr/bin/env node
/**
 * Assemble `lib/client.js` from the ordered source sections in `src/client/`.
 *
 * The DSH client bundle is loaded as ONE module (`window.__ModuleLoader__.load`),
 * so the sections intentionally share one closure and are concatenated in
 * dependency order. Keeping the entry artifact generated lets the source stay
 * reviewable without adding a runtime bundler or npm build dependency.
 *
 * Usage: node scripts/build-client.mjs [--check]
 *   --check  exit 1 when lib/client.js is stale (used by `npm test`)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "src", "client");
const OUTPUT = join(ROOT, "lib", "client.js");

/** Order matters: every section shares the entry's module-loader closure. */
const SECTIONS = [
  "00-preamble.js",
  "01-constants.js",
  "02-styles.js",
  "03-runtime.js",
  "04-tree.js",
  "05-pending-float-store.js",
  "06-drag-reflow.js",
  "07-faces.js",
  "08-pane-kit.js",
  "09-pane-renderers.js",
  "10-pane-frame.js",
  "11-canvas-navigation.js",
  "12-chrome.js",
  "13-drag-bridge.js",
  "14-launcher.js",
  "15-float-window.js",
  "16-standalone.js",
  "17-api-apply.js",
];

const BANNER = [
  "// GENERATED FILE — edit src/client/*.js and run `npm run build`.",
  "// The sections share one module-loader closure; their order matters.",
  "",
].join("\n");

function assemble() {
  const parts = [BANNER];
  for (const name of SECTIONS) parts.push(readFileSync(join(SOURCE_DIR, name), "utf8"));
  return parts.join("");
}

const check = process.argv.includes("--check");
const next = assemble();
let current = null;
try {
  current = readFileSync(OUTPUT, "utf8");
} catch {
  current = null;
}

if (check) {
  if (current !== next) {
    console.error("lib/client.js is stale — run `npm run build`.");
    process.exit(1);
  }
  console.log(`lib/client.js is current (${SECTIONS.length} sections, ${next.length} bytes)`);
} else {
  writeFileSync(OUTPUT, next);
  console.log(`built lib/client.js from ${SECTIONS.length} sections (${next.length} bytes)`);
}