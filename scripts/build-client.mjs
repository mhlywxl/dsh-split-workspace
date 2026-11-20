#!/usr/bin/env node
/**
 * Assemble `client.js` from the ordered source modules in `src/client/`.
 *
 * The DSH client bundle is loaded as ONE module (`window.__ModuleLoader__.load`),
 * so the sources intentionally share one closure and are concatenated in
 * dependency order. Keeping the entry artifact generated lets the source stay
 * reviewable without adding a runtime bundler or npm build dependency.
 *
 * `client.js` lives at the package root because that is the artifact the DSH
 * loader loads for the `./client` export; `src/client/*` is authoring source and
 * is not shipped.
 *
 * Usage:
 *   node scripts/build-client.mjs          write client.js
 *   node scripts/build-client.mjs --check  exit 1 when client.js is stale
 *   node scripts/build-client.mjs --watch  rebuild whenever src/client changes
 */
import { existsSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "src", "client");
const OUTPUT = join(ROOT, "client.js");

/**
 * Load order. Every entry is one authoring module; later modules may use every
 * binding declared by earlier ones (single module-loader closure). `entry.js`
 * opens the factory and `apply.js` closes it, so both ends are fixed.
 */
const MODULES = [
  "entry.js",
  "constants.js",
  "styles.js",
  "runtime.js",
  "tree.js",
  "pending.js",
  "drag-reflow.js",
  "faces.js",
  "pane-kit.js",
  "pane-renderers.js",
  "pane-frame.js",
  "navigation.js",
  "chrome.js",
  "drag-bridge.js",
  "launcher.js",
  "float-window.js",
  "standalone.js",
  "apply.js",
];

const BANNER = `/**
 * GENERATED FILE — edit src/client/*.js and run \`node scripts/build-client.mjs\`.
 * The sections share one module-loader closure; their order matters.
 */
`;

function assemble() {
  const parts = [BANNER];
  for (const name of MODULES) {
    const source = readFileSync(join(SOURCE_DIR, name), "utf8").replace(/\r\n/g, "\n").trimEnd();
    parts.push(`//#region src/client/${name}\n${source}\n//#endregion src/client/${name}\n\n`);
  }
  return parts.join("").trimEnd() + "\n";
}

/** Fail loudly when a source module exists but never reaches the bundle. */
function checkManifest() {
  const present = readdirSync(SOURCE_DIR).filter((name) => name.endsWith(".js")).sort();
  const listed = [...MODULES].sort();
  const missing = listed.filter((name) => present.indexOf(name) === -1);
  const unlisted = present.filter((name) => listed.indexOf(name) === -1);
  if (missing.length > 0) throw new Error(`build manifest names missing modules: ${missing.join(", ")}`);
  if (unlisted.length > 0) throw new Error(`src/client has modules missing from the build manifest: ${unlisted.join(", ")}`);
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  checkManifest();
  const write = () => {
    const next = assemble();
    writeFileSync(OUTPUT, next, "utf8");
    console.log(`built client.js from ${MODULES.length} modules (${next.length} bytes)`);
  };
  if (process.argv.includes("--check")) {
    const expected = assemble();
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== expected) {
      console.error("client.js is stale — run `npm run build`.");
      process.exitCode = 1;
    } else {
      console.log(`client.js is current (${MODULES.length} modules, ${expected.length} bytes)`);
    }
  } else if (process.argv.includes("--watch")) {
    write();
    let timer = null;
    watch(SOURCE_DIR, { persistent: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          checkManifest();
          write();
          console.log("refresh the DSH page to pick up the rebuilt bundle");
        } catch (error) {
          console.error(`build: ${error instanceof Error ? error.message : error}`);
        }
      }, 100);
    });
    console.log("watching src/client/ — Ctrl+C stops");
  } else {
    write();
  }
}

export { MODULES, assemble, OUTPUT as target };