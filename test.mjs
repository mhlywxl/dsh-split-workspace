#!/usr/bin/env node
/**
 * Offline release checks for dsh-split-workspace.
 *
 * The client bundle is shipped as-is, so there is no build output to compare.
 * These tests instead pin the files the npm package must contain, the dsh
 * manifest, the locale metadata, the README's screenshot URLs and the absence
 * of development leftovers or accidentally committed credentials.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`not ok - ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

function exists(relative) {
  return existsSync(join(ROOT, relative));
}

function repoSlug(value) {
  return String(value)
    .replace(/^git\+/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

const REPO = "mhlywxl/dsh-split-workspace";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const SCREENSHOTS = [
  "layout-side-by-side.png",
  "layout-stacked.png",
  "layout-grid-2x2.png",
  "drag-pane.gif",
];

test("package identity and public metadata", () => {
  assert(pkg.name === "dsh-split-workspace", "unexpected package name");
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), "version must be semver");
  assert(pkg.private !== true, "private:true blocks npm publish");
  assert(pkg.author === "mhlywxl", "author must be the public maintainer");
  assert(pkg.license === "MIT", "license must be MIT");
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  assert(repoSlug(repository) === REPO, `repository must point at ${REPO}`);
  assert(typeof pkg.homepage === "string" && pkg.homepage.includes(`github.com/${REPO}`), "homepage is missing");
  assert(pkg.bugs?.url?.includes(`github.com/${REPO}/issues`), "bugs URL is missing");
});

test("description and keywords target split-screen discovery", () => {
  assert(/split-screen/i.test(pkg.description), "description must mention split-screen");
  assert(/unlimited/i.test(pkg.description), "description must mention unlimited panes");
  assert(/desktop/i.test(pkg.description), "description must mention Desktop");
  for (const keyword of ["dsh", "dsh-plugin", "deepseek-harness", "split-screen", "multi-pane", "分屏"]) {
    assert(pkg.keywords.includes(keyword), `missing keyword: ${keyword}`);
  }
});

test("dsh bundle and client manifest", () => {
  assert(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "dsh.bundle.patch must point at cordis.patch.yml");
  assert(pkg.dsh?.client?.platform === "web", "client platform must be web");
  assert(pkg.dsh?.client?.immediately === true, "client must load immediately");
  assert(Array.isArray(pkg.dsh?.client?.inject), "client.inject must be an array");
  for (const service of ["layout", "sidebar", "session", "primitives", "locale"]) {
    assert(pkg.dsh.client.inject.some((entry) => entry.includes(service)), `missing injected service: ${service}`);
  }
});

test("published files exist", () => {
  const required = [
    "lib/index.js",
    "lib/client.js",
    "cordis.patch.yml",
    "icon.svg",
    "README.md",
    "LICENSE",
    "locale/en.json",
    "locale/zh.json",
    ...SCREENSHOTS.map((name) => `docs/screenshots/${name}`),
  ];
  for (const file of required) assert(exists(file), `missing ${file}`);
  assert(pkg.files.includes("lib/client.js"), "files must ship lib/client.js");
  assert(pkg.files.includes("docs/screenshots/*.png"), "files must ship screenshots");
  assert(pkg.files.includes("docs/screenshots/*.gif"), "files must ship the drag GIF");
});

test("client bundle is syntactically valid and current", () => {
  execFileSync(process.execPath, ["--check", join(ROOT, "lib/client.js")], { stdio: "pipe" });
  const client = read("lib/client.js");
  assert(client.includes(`PLUGIN_VERSION = "${pkg.version}"`), "PLUGIN_VERSION must match package.json");
  assert(client.includes("buildArrangedRoot"), "automatic layout helper is missing");
  assert(client.includes("MAX_TREE_DEPTH"), "depth guard is missing");
  assert(!client.includes("MAX_PANES"), "the old pane cap must stay removed");
  assert(client.includes("dsv-layout-bar"), "split toolbar is missing");
});

test("host half and loader patch", () => {
  assert(/export function apply\s*\(/.test(read("lib/index.js")), "host half must export apply()");
  assert(read("cordis.patch.yml").includes("name: 'dsh-split-workspace'"), "loader patch must mount the package");
});

test("locale metadata is current", () => {
  for (const locale of ["en", "zh"]) {
    const data = JSON.parse(read(`locale/${locale}.json`));
    assert(typeof data.meta?.title === "string" && data.meta.title.length > 0, `${locale} title is empty`);
    assert(typeof data.meta?.description === "string" && data.meta.description.length > 0, `${locale} description is empty`);
    assert(!/four[- ]pane|四窗格/i.test(data.meta.description), `${locale} description still says four panes`);
  }
});

test("README documents the layouts, limits and author block", () => {
  const readme = read("README.md");
  for (const name of SCREENSHOTS) assert(readme.includes(`docs/screenshots/${name}`), `README is missing ${name}`);
  assert(readme.includes("<!-- author-tools:start -->"), "missing author-tools start marker");
  assert(readme.includes("<!-- author-tools:end -->"), "missing author-tools end marker");
  assert(/Unlimited native panes/i.test(readme), "README must state the unlimited pane count");
  assert(/任意数量/.test(readme), "README must include the Chinese summary");
  assert(!/up to four|最多四个/i.test(readme), "README still advertises a four-pane cap");
});

test("README image URLs are npm-safe absolute raw URLs", () => {
  const readme = read("README.md");
  assert(!readme.includes("](docs/screenshots/"), "relative screenshot links do not work on npm");
  assert(!readme.includes('src="docs/screenshots/'), "relative screenshot src does not work on npm");
  for (const name of SCREENSHOTS) {
    assert(readme.includes(`${RAW}docs/screenshots/${name}`), `README must link ${name} with a raw GitHub URL`);
  }
});

test("npm tarball contains the release payload only", () => {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const report = JSON.parse(output)[0];
  const files = report.files.map((file) => file.path);
  for (const file of ["package.json", "README.md", "LICENSE", "lib/index.js", "lib/client.js", "cordis.patch.yml"]) {
    assert(files.includes(file), `tarball is missing ${file}`);
  }
  for (const name of SCREENSHOTS) {
    assert(files.includes(`docs/screenshots/${name}`), `tarball is missing docs/screenshots/${name}`);
  }
  const forbidden = files.filter((file) =>
    file.includes(".DS_Store") || file.endsWith(".tgz") || file.startsWith("node_modules/") ||
    file.startsWith(".github/") || file.startsWith(".idea/"));
  assert(forbidden.length === 0, `tarball contains development leftovers: ${forbidden.join(", ")}`);
});

test("no credential-shaped strings in tracked text", () => {
  for (const relative of ["README.md", "package.json", "cordis.patch.yml", "lib/index.js", "lib/client.js", "test.mjs"]) {
    const text = read(relative);
    assert(!/npm_[A-Za-z0-9]{20,}/.test(text), `possible npm token in ${relative}`);
    assert(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), `possible GitHub token in ${relative}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAILED: ${failure.name}\n${failure.error.stack}`);
  process.exitCode = 1;
}
