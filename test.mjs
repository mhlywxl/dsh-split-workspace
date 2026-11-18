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
import { restartCommand } from "./lib/index.js";

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
    "CHANGELOG.md",
    "LICENSE",
    "locale/en.json",
    "locale/zh.json",
    ...SCREENSHOTS.map((name) => `docs/screenshots/${name}`),
  ];
  for (const file of required) assert(exists(file), `missing ${file}`);
  assert(pkg.files.includes("lib/client.js"), "files must ship lib/client.js");
  assert(pkg.files.includes("CHANGELOG.md"), "files must ship CHANGELOG.md");
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

test("composer-plugin compatibility and drag-performance guards", () => {
  const client = read("lib/client.js");
  for (const token of [
    "installComposerAnchorBridge",
    "data-dsv-composer-card",
    "data-composer-overlay",
    "inLiveReflow",
    "dsv-reflow-settling",
    "data-conversation-scroll",
    "dragPreviewW",
    "ComposerDraftGuard",
    "onSuggestionAccept",
    "SCOPED_GLOBAL_SELECTORS",
    "GLOBAL_COMPOSER_ENTRY_IDS",
  ]) {
    assert(client.includes(token), `missing compatibility/performance guard: ${token}`);
  }
  // The live preview must not animate pane boxes; only the glide-back may.
  const liveBlock = client.slice(client.indexOf(".dsv-canvas.dsv-reflowing .dsv-pane-wrap {"), client.indexOf(".dsv-canvas.dsv-reflowing.dsv-reflow-settling .dsv-pane-wrap"));
  assert(liveBlock.length > 0, "live reflow CSS block is missing");
  assert(!/transition:\s*\n?\s*left/.test(liveBlock), "live drag still transitions left/top/width/height");
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

test("split launcher, pending split and session-menu integration", () => {
  const client = read("lib/client.js");
  for (const token of [
    "SplitLauncherLayer",
    "SplitLauncherMenu",
    "AddSplitDialog",
    "pendingSplitStore",
    "launcherState",
    "installSplitSessionMenu",
    "contextMenus",
    "addSessionToSplit",
    "removeSessionFromSplit",
    "resetSplitEnvironment",
    "clearSplitStorage",
    "dsv-launcher-menu",
    "dsv-modal-backdrop",
    "openAddSplitDialog",
  ]) {
    assert(client.includes(token), `missing launcher feature: ${token}`);
  }
  assert(!client.includes("startSplitFromFooter"), "the old footer auto-split must be gone");
  // The footer button opens the menu instead of starting a split directly.
  assert(/aria-haspopup": "menu"/.test(client), "footer button must declare a menu popup");
  // Reset must wipe every plugin-owned storage key, not just the tree.
  assert(client.includes('SPLIT_STORAGE_PREFIX = "dsh.split-workspace."'), "reset must enumerate plugin storage keys");
  // The session-row actions must come from the host menu service, not DOM patching.
  assert(client.includes('target: "session"'), "session-menu contribution must target the session family");
});

test("locale dictionaries cover the launcher", () => {
  const client = read("lib/client.js");
  for (const key of [
    "menuAddSplit",
    "menuAddToSplit",
    "menuMinimizeSplit",
    "menuResetSplit",
    "addSplitTitle",
    "addSplitConfirm",
    "addSplitCancel",
    "pendingBadge",
    "pendingAdded",
    "resetDone",
  ]) {
    const count = client.split(key + ":").length - 1;
    assert(count >= 2, `locale key ${key} must exist in both dictionaries`);
  }
});

test("README documents the launcher, pending split and reset", () => {
  const readme = read("README.md");
  for (const text of ["添加分屏", "退出分屏", "最小化分屏", "重置分屏", "待分屏", "加入分屏"]) {
    assert(readme.includes(text), `README is missing ${text}`);
  }
  assert(readme.includes("resetAll()"), "README must document resetAll()");
});

test("floating windows, split⇄float switching and persistence hooks", () => {
  const client = read("lib/client.js");
  for (const token of [
    "FLOAT_KEY",
    "floatStore",
    "FloatLayer",
    "FloatWindow",
    "floatSession",
    "dockFloatToSplit",
    "closeFloatWindow",
    "beginFloatGesture",
    "moveFloatGesture",
    "endFloatGesture",
    "acquireComposerAnchorBridge",
    "menuFloatOpen",
    "menuFloatClose",
    "dsv-float-layer",
    "dsv-float-window",
    "dsv-float-resize",
    "data-dsv-float",
  ]) {
    assert(client.includes(token), `missing floating-window feature: ${token}`);
  }
  // Floats and panes are mutually exclusive per session (both directions).
  assert(
    client.includes("floatStore.has(sessionId)) floatStore.remove(sessionId);")
    || client.includes("if (floatStore.has(sessionId)) floatStore.remove(sessionId);"),
    "adding a session to the split must clear any float for it",
  );
  assert(
    client.includes("if (treeStore.leafIds().indexOf(sessionId) !== -1) treeStore.closeLeaf(sessionId);"),
    "entering a float must detach the split pane",
  );
  // Floats persist their geometry and participate in the hard reset.
  assert(client.includes("storageSet(FLOAT_KEY"), "float geometry must persist");
  assert(client.includes("persistNow()"), "the float store must flush geometry on gesture end");
  assert(client.includes("floatStore.clear();"), "resetAll must clear floats");
  // The right-click contribution exposes the new action.
  assert(client.includes('id: "float"'), "session menu must contribute the float action");
  // The float host is the same native pane host, not an iframe.
  assert(/floating: true/.test(client), "floating windows must re-host the native pane");
});

test("locale dictionaries cover floating windows", () => {
  const client = read("lib/client.js");
  for (const key of [
    "menuFloatOpen",
    "menuFloatClose",
    "floatDock",
    "floatClose",
    "floatEntered",
    "floatDocked",
    "floatClosed",
    "floatHint",
  ]) {
    const count = client.split(key + ":").length - 1;
    assert(count >= 2, `locale key ${key} must exist in both dictionaries`);
  }
});

test("README documents floating windows and the native-window limitation", () => {
  const readme = read("README.md");
  for (const text of [
    "浮窗模式",
    "进入浮窗",
    "回到分屏",
    "为什么浮窗不是系统级独立窗口",
    "setWindowOpenHandler",
    "dockFloat(sessionId)",
    "floats()",
    "Floating windows",
    "Why not a real OS-level window",
  ]) {
    assert(readme.includes(text), `README is missing ${text}`);
  }
});

test("performance mode, update prompt and the section split", () => {
  const client = read("lib/client.js");
  for (const token of [
    "PERF_KEY",
    "performanceModeOn",
    "setPerformanceMode",
    "data-dsv-performance",
    "performanceOn",
    "performanceOff",
    "UpdateNotice",
    "UPDATE_POLL_MS",
    "SEEN_VERSION_KEY",
    "reloadClient",
    "/dsv/version",
    "domListMinReadMs",
  ]) {
    assert(client.includes(token), `missing performance/update feature: ${token}`);
  }
  const host = read("lib/index.js");
  assert(host.includes("/dsv/version"), "the Host half must serve the on-disk plugin version");
  assert(host.includes("packageVersion"), "the Host version route must read package.json");
  // Observers that used to run on every streaming token are gated by the mode.
  assert(client.includes("perfTimer = performanceMode ? window.setInterval(schedule, 1500) : 0"),
    "the per-pane composer observer fallback must be perf-gated");
  // Performance mode is the shipped default; only an explicit "0" opts out.
  assert(client.includes('return storageGet(PERF_KEY) !== "0";'),
    "performance mode must default to on");
  // This mode renders no floating drag preview at all (no clone, no rAF).
  assert(client.includes("if (performanceModeOn()) return;"),
    "performance mode must skip the drag-preview thumbnail");
  assert(client.includes("runtime.performance === true ? 3500 : 1000"),
    "geometry polling must slow down in performance mode");
  assert(client.includes("performanceModeOn() ? 1000 : DOM_LIST_MIN_READ_MS"),
    "sidebar scraping must slow down in performance mode");
  for (const section of ["00-preamble.js", "02-styles.js", "04-tree.js", "09-pane-renderers.js", "17-api-apply.js"]) {
    assert(exists("src/client/" + section), `missing source section: ${section}`);
  }
  assert(exists("scripts/build-client.mjs"), "missing the client build script");
});

test("locale dictionaries cover performance mode and the update prompt", () => {
  const client = read("lib/client.js");
  for (const key of ["performanceMode", "performanceOn", "performanceOff", "reloadClient", "updateReady", "reloadNow", "updatedToast", "restartApp", "restartTitle", "restartBody", "restartNow", "restarting", "restartFailed", "restartUnsupported", "fallbackLauncher"]) {
    const count = client.split(key + ":").length - 1;
    assert(count >= 2, `locale key ${key} must exist in both dictionaries`);
  }
});

test("README documents performance mode, reload and the source split", () => {
  const readme = read("README.md");
  for (const text of ["性能模式", "性能模式默认开启", "性能模式与卡顿排查", "刷新界面", "重启 DSH", "兜底", "工程结构", "源码拆分", "Performance mode", "Performance mode is ON by default", "Restart DSH", "fallback split", "Source layout", "build-client.mjs"]) {
    assert(readme.includes(text), `README is missing ${text}`);
  }
});

test("lib/client.js is generated from the ordered src/client sections", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "scripts", "build-client.mjs"), "--check"], { encoding: "utf8" });
  assert(out.includes("is current"), "build check did not confirm a current bundle");
});

test("closing the second-to-last pane clears the ended split state", () => {
  const client = read("lib/client.js");
  for (const token of [
    "endSplitBecauseTooSmall",
    "before.length >= 2 && leafOf(next, []).length < 2",
    "leafOf(root, []).length < 2",
  ]) {
    assert(client.includes(token), `missing the end-of-split cleanup: ${token}`);
  }
  // The old one-pane leftovers must be gone: closeFocused and float extraction
  // may not keep a hidden one-pane tree that still tags a session "in split".
  assert(!client.includes("if (ids.length === 1) return { exit: true, remaining: 0 };"),
    "closeFocused must not report an exit while keeping the tree");
  assert(!client.includes("if (remaining.length > 0 && remaining.length < 2) treeStore.reset();")
    || client.includes("endSplitBecauseTooSmall"), "float extraction must clear stale one-pane trees");
});

test("independent window: in-app surface, no browser route", () => {
  const client = read("lib/client.js");
  for (const token of [
    "menuSystemWindow",
    "openSystemWindow",
    "openIndependentWindow",
    "openAppWindow",
    "IndependentSessionWindow",
    "AppWindowLayer",
    "AppWindowChip",
    "appWindow",
    "detachSessionForSystemWindow",
    "dsv-app-window",
    "dsv-app-window-chip",
    "standaloneFullscreen",
    "independentMinimize",
    "independentRestore",
    "independentClose",
  ]) {
    assert(client.includes(token), `missing independent-window feature: ${token}`);
  }
  const host = read("lib/index.js");
  assert(!host.includes("/dsv/system-window"), "the browser system-window route must be gone");
  assert(!host.includes("authenticatedUrl"), "the Host must not mint browser URLs for a system window");
  assert(!client.includes("dsvWindow"), "the browser standalone hash marker must be gone");
  // Pane-header drag is armed from the mousedown target instead of keeping the
  // whole header draggable: a draggable header swallowed the ✕ click whenever
  // the pointer moved a few pixels between press and release.
  assert(client.includes("header.draggable = !interactive"), "the pane header must arm drag only from non-interactive areas");
  assert(!client.includes('className: "dsv-pane-header", draggable: true'), "a permanently draggable pane header breaks button clicks");
});

test("locale dictionaries cover the independent window and settings page", () => {
  const client = read("lib/client.js");
  for (const key of [
    "menuSystemWindow", "systemWindowOpened", "systemWindowFailed", "standaloneFullscreen",
    "independentMinimize", "independentRestore", "independentClose",
    "settingsNav", "settingsHeading", "settingsDesc", "settingsStatus", "settingsVersion",
    "settingsPanes", "settingsPending", "settingsFloats", "settingsPerformance",
    "settingsPerformanceDesc", "settingsActions",
  ]) {
    const count = client.split(key + ":").length - 1;
    assert(count >= 2, `locale key ${key} must exist in both dictionaries`);
  }
});

test("settings.section entry mirrors the split menu", () => {
  const client = read("lib/client.js");
  for (const token of [
    "settings.section",
    "settings.section.icon",
    "SettingsSection",
    "openAddSplitDialog(\"footer\")",
  ]) {
    assert(client.includes(token), `missing settings entry: ${token}`);
  }
});

test("README documents the independent window, settings entry and changelog", () => {
  const readme = read("README.md");
  for (const text of [
    "独立窗口", "在独立窗口打开", "不依赖浏览器", "openIndependentWindow", "openSystemWindow(sessionId)",
    "系统设置入口", "设置 → 分屏工作区", "CHANGELOG.md",
    "Independent window", "in-app", "Settings entry", "Settings → Split workspace",
  ]) {
    assert(readme.includes(text), `README is missing ${text}`);
  }
  const changelog = read("CHANGELOG.md");
  for (const version of ["0.10.0", "0.9.0", "0.8.0", "0.5.0", "0.4.3", "0.4.0"]) {
    assert(changelog.includes("[" + version + "]"), `CHANGELOG is missing ${version}`);
  }
});

test("restart entry: Host route and Desktop OS-level quit/relaunch", () => {
  const host = read("lib/index.js");
  for (const token of ["/dsv/restart", "RESTART_COOLDOWN_MS", "runningInDesktop", "restartCommand", "osascript", "Start-Process", "x-dsv-restart"]) {
    assert(host.includes(token), `missing restart Host support: ${token}`);
  }
  const client = read("lib/client.js");
  for (const token of ["/dsv/restart", "x-dsv-restart", "restartApplication", "openRestartDialog", "RestartDialog", "restartApp()"]) {
    assert(client.includes(token), `missing client restart entry: ${token}`);
  }
});

test("restart helper builds a platform quit+relaunch command", () => {
  const command = restartCommand();
  assert(typeof command.command === "string" && command.command !== "", "restart command is missing");
  assert(Array.isArray(command.args) && command.args.length > 0, "restart arguments are missing");
  const line = command.args.join(" ");
  assert(line.includes(String(process.ppid)), "the restart helper must target the Electron main process");
  if (process.platform === "darwin") {
    assert(line.includes("osascript") && line.includes("com.deepseek.dsh"), "macOS must ask DSH to quit through AppleScript");
    assert(line.includes("open "), "macOS must reopen the app bundle");
  }
  if (process.platform === "win32") {
    assert(command.command === "powershell.exe", "Windows must use PowerShell");
    assert(line.includes("Stop-Process") && line.includes("Start-Process"), "Windows must stop and relaunch the app");
  }
});

test("fallback launcher keeps the split menu reachable without the sidebar footer", () => {
  const client = read("lib/client.js");
  for (const token of ["dsv-fallback-launcher", "LauncherFallback", "fallbackLauncher", "getBoundingClientRect().width > 0"]) {
    assert(client.includes(token), `missing fallback launcher support: ${token}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAILED: ${failure.name}\n${failure.error.stack}`);
  process.exitCode = 1;
}
