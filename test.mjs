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
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeWindowSupported, restartCommand, systemWindowCommand } from "./lib/index.js";
import {
  edgeAppWindowCommand,
  edgeExecutableCandidates,
  findEdgeExecutable,
  redactNativeWindowText,
  windowsPowerShellCandidates,
  windowsPowerShellPath,
} from "./lib/index.js";

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

function statSafe(relative) {
  return statSync(join(ROOT, relative));
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
  "system-window.png",
  "help-session-menu.png",
  "help-footer-menu.png",
  "help-settings.png",
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

test("a rebuilt client bundle can replace itself inside the open page", () => {
  const client = read("lib/client.js");
  // DSH swaps a rebuilt client bundle into the open page: the factory runs
  // again while window.__dshSplitWorkspace still holds the previous run's
  // descriptors. The read-only __test seam is non-configurable, so re-defining
  // it on the inherited object threw "Cannot redefine property: __test" and
  // aborted the whole factory — the footer button, the session menus and the
  // Settings section stayed missing until the page reloaded. Every bundle
  // execution must therefore publish a FRESH public object, install its members
  // through the guarded helper, and never reuse or re-define on the old one.
  assert(client.includes("let publicApiGlobal = null;"),
    "the public API global must be per-execution state");
  assert(client.includes("function pluginPublicApi()"),
    "missing the per-execution public API factory");
  assert(client.includes("window.__dshSplitWorkspace = publicApiGlobal;"),
    "the public API factory must publish the fresh object");
  assert(client.includes("function definePublicMember("),
    "missing the guarded member installer");
  assert(client.includes('definePublicMember("__test"'),
    "__test must be installed through the guarded installer");
  assert(client.includes('definePublicMember("__svc"'),
    "__svc must be installed through the guarded installer");
  assert(!client.includes("Object.defineProperty(window.__dshSplitWorkspace"),
    "diagnostics members must not be redefined on the inherited global");
  assert(!client.includes("Object.assign(window.__dshSplitWorkspace || {}"),
    "the public API object must not be reused across bundle executions");
  // The seam stays read-only for callers, and a refused definition is only a
  // warning (a diagnostics seam may never take the plugin down).
  assert(client.includes("configurable: false,") && client.includes("writable: false,"),
    "the public members must stay read-only");
  assert(client.includes("kept from the previous bundle"),
    "a refused diagnostics definition must degrade to a warning");

test("a failed client setup stays retryable without a reload", () => {
  const client = read("lib/client.js");
  // DSH retries a failed client entry by restarting the fiber on the SAME
  // module exports, so a once-guard set before a throwing statement would turn
  // one bad setup into a plugin that never mounts again (the "restart DSH to
  // get the menus back" symptom). apply() must therefore clear the guard when
  // its setup throws, and the setup must live in its own function.
  assert(client.includes("function install(ctx, slots)"),
    "apply() must delegate its setup to install()");
  assert(/catch \(error\) \{[\s\S]{0,800}appliedOnce = false;[\s\S]{0,80}throw error;/.test(client),
    "apply() must clear the once-guard and rethrow when install() fails");
  assert(client.includes("appliedOnce = false;"),
    "the once-guard must be reset");
});
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
    "menuGroup", "menuIndependentOpen", "menuIndependentClose", "menuNativeOpen", "menuNativeClose",
    "systemWindowOpening", "systemWindowClosing", "systemWindowNativeOpened", "systemWindowEdgeOpened",
    "systemWindowNativeClosed", "systemWindowUnsupported",
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
    "系统设置入口", "设置 → 分屏工作区", "CHANGELOG.md", "进入系统窗口", "分屏插件", "macOS",
    "WebView2", "WebView2 运行时", "native/system-window.ps1",
    "Independent window", "in-app", "Settings entry", "Settings → Split workspace",
  ]) {
    assert(readme.includes(text), `README is missing ${text}`);
  }
  const changelog = read("CHANGELOG.md");
  for (const version of ["0.11.0", "0.10.0", "0.9.0", "0.8.0", "0.5.0", "0.4.3", "0.4.0"]) {
    assert(changelog.includes("[" + version + "]"), `CHANGELOG is missing ${version}`);
  }
});

test("native system window: Host route, macOS helper and client entry", () => {
  const host = read("lib/index.js");
  for (const token of [
    "/dsv/system-window",
    "x-dsv-system-window",
    "authenticatedUrl",
    "system-window.jxa",
    "unsupported-platform",
    "SESSION_ID_PATTERN",
    "requestOriginAllowed",
    "nativeWindowSessions",
    "closeNativeSystemWindow",
    "readWindowRequest",
    "nativeWindows = new Map",
    "systemWindowCommand",
    "nativeWindowSupported",
    "system-window.ps1",
    "native/webview2",
    "taskkill.exe",
    "redactNativeWindowText",
    "helper exit",
    "opening session=",
    " present=",
    "detail:",
  ]) {
    assert(host.includes(token), `missing native system window Host support: ${token}`);
  }
  // The tokenized client URL must stay inside the Host: the renderer only
  // learns whether the window opened.
  assert(!/ok:\s*true[^}]*\burl:/u.test(host), "the native window URL must not be returned to the renderer");
  const helper = read("native/system-window.jxa");
  for (const token of [
    "NSWindow", "WKWebView", "NSApplication", "loadRequest",
    "NSWindowStyleMaskTitled", "terminate", "isVisible",
  ]) {
    assert(helper.includes(token), `missing native helper support: ${token}`);
  }
  const client = read("lib/client.js");
  for (const token of [
    "menuGroup", "menuIndependentOpen", "menuIndependentClose", "menuNativeOpen", "menuNativeClose",
    "requestSystemWindow", "openNativeWindow(", "closeNativeWindow", "nativeWindows(",
    "nativeWindowStore", "appWindowSnapshot", "runtimeStore",
    "/dsv/system-window", "x-dsv-system-window", "dsv-system-window",
    "bootSystemWindow", "zeroSystemWindowSidebarTrack", "data-dsv-system-window",
    "installAnchorFallback", "cssAnchorPositioningSupported", "anchorPanelInsets",
    "data-anchor-side", "data-anchor-align", "dsvAnchorFallback",
  ]) {
    assert(client.includes(token), `missing native system window client support: ${token}`);
  }
  assert(pkg.files.includes("native/system-window.jxa"), "the native helper must ship in the npm package");
  assert(pkg.files.includes("native/system-window.ps1"), "the Windows helper must ship in the npm package");
  assert(pkg.files.includes("native/webview2/**"), "the vendored WebView2 assets must ship in the npm package");
});

test("Windows system window: PowerShell + WebView2 helper assets", () => {
  const helper = read("native/system-window.ps1");
  for (const token of [
    "System.Windows.Forms",
    "Microsoft.Web.WebView2.WinForms.WebView2",
    "EnsureCoreWebView2Async",
    "CoreWebView2InitializationCompleted",
    "GetAvailableBrowserVersionString",
    "WEBVIEW2_USER_DATA_FOLDER",
    "CoreWebView2CreationProperties",
    "UserDataFolder",
    "SetDllDirectory",
    "WebView2Loader.dll",
    "UrlB64",
    "Application]::Run",
    "helper enter",
    "assets ok, WebView2 runtime",
    "window created, entering the message loop",
    "Write-DsvLog",
    "AppendAllText",
    "add_UnhandledException",
    "add_ThreadException",
    "LogPath",
    "DSV_HELPER_LOG",
    "SetUnhandledExceptionMode",
    "exiting code=5",
  ]) {
    assert(helper.includes(token), `missing Windows helper support: ${token}`);
  }
  // A continuation line that STARTS with a binary operator is a PowerShell
  // parse error (0.14.1 shipped one and could never execute the script).
  assert(!/^\s*\+/mu.test(helper), "the helper must not start a line with a binary operator");
  // A non-interactive helper must never open a modal dialog: it would hang
  // invisibly and the Host would report a success while no window appeared.
  assert(!helper.includes("[System.Windows.Forms.MessageBox]"), "the Windows helper must not open modal dialogs");
  // The helper must keep its diagnostics and its failure codes distinct: the
  // Host maps exit code 3 to the "install the WebView2 Runtime" hint.
  assert(helper.includes("[Environment]::Exit($Code)"), "the helper must exit with explicit codes");
  assert(helper.includes("is not installed"), "the helper must report a missing WebView2 Runtime");
  for (const asset of [
    "native/webview2/Microsoft.Web.WebView2.Core.dll",
    "native/webview2/Microsoft.Web.WebView2.WinForms.dll",
    "native/webview2/x64/WebView2Loader.dll",
    "native/webview2/arm64/WebView2Loader.dll",
    "native/webview2/LICENSE.txt",
    "native/webview2/NOTICE.txt",
  ]) {
    assert(exists(asset), `missing vendored WebView2 asset ${asset}`);
    assert(statSafe(asset).size > 1024, `vendored WebView2 asset is empty: ${asset}`);
  }
});

test("system window helper command targets macOS and Windows", () => {
  assert(nativeWindowSupported("darwin") === true, "macOS must support the system window");
  assert(nativeWindowSupported("win32") === true, "Windows must support the system window");
  assert(nativeWindowSupported("linux") === false, "Linux must not claim system window support");
  assert(systemWindowCommand("linux", "http://127.0.0.1:1/", "s1") === null, "Linux must have no helper command");
  const mac = systemWindowCommand("darwin", "http://127.0.0.1:1/?t=a", "s1");
  assert(mac.command === "/usr/bin/osascript", "macOS must run the JXA helper through osascript");
  assert(mac.args.includes("system-window.jxa") || mac.args.some((arg) => arg.endsWith("system-window.jxa")), "macOS must pass the JXA helper");
  assert(mac.args[mac.args.length - 1].endsWith("#dsv-system-window=s1"), "macOS must append the system window marker");
  // Empty env keeps this assertion platform-independent: on a Windows dev box
  // the resolver would legitimately return the absolute System32 powershell.exe.
  const win = systemWindowCommand("win32", "http://127.0.0.1:1/?t=a&b=c", "s1", { env: {} });
  assert(win.command === "powershell.exe", "Windows must run the PowerShell helper");
  const args = win.args.join(" ");
  for (const token of ["-File", "system-window.ps1", "-UrlB64", "-WebView2Dir", "webview2"]) {
    assert(args.includes(token), `Windows helper command is missing ${token}`);
  }
  assert(args.includes("-ExecutionPolicy Bypass"), "Windows must not be blocked by the execution policy");
  const encoded = win.args[win.args.indexOf("-UrlB64") + 1];
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  assert(decoded === "http://127.0.0.1:1/?t=a&b=c#dsv-system-window=s1", "the Windows helper must receive the marker URL verbatim");
  assert(systemWindowCommand("win32", "http://x/", "bad id!") === null, "invalid session ids must be rejected before spawning");
  // The helper appends its own trace to the file the Host reads back.
  const traced = systemWindowCommand("win32", "http://x/", "s1", { helperLog: join(ROOT, "tmp-helper.log") });
  assert(traced.args.includes("-LogPath"), "the Windows helper must receive -LogPath");
  assert(traced.args[traced.args.indexOf("-LogPath") + 1] === join(ROOT, "tmp-helper.log"), "the helper log path must be passed verbatim");
});

test("Windows system window: PowerShell is resolved, Edge app window is the fallback", () => {
  const env = {
    SystemRoot: "C:\\Windows",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
  };
  const system32 = join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  assert(windowsPowerShellCandidates(env)[0] === system32, "the System32 PowerShell must be the first candidate");
  assert(windowsPowerShellPath(env, () => true) === system32, "an installed System32 PowerShell must win over PATH");
  assert(windowsPowerShellPath(env, () => false) === "powershell.exe", "without the absolute file, the command name is used");
  assert(windowsPowerShellPath({}, () => false) === "powershell.exe", "no SystemRoot must not break the command");

  const x86Edge = join(env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe");
  const candidates = edgeExecutableCandidates(env);
  assert(candidates.includes(x86Edge), "Edge under Program Files (x86) must be a candidate");
  assert(findEdgeExecutable(env, (path) => path === x86Edge) === x86Edge, "an installed Edge must be found");
  assert(findEdgeExecutable(env, () => false) === null, "a machine without Edge must report none");

  // The fallback is Windows-only and must never point Edge at the user's own
  // profile: a dedicated --user-data-dir is what makes the spawned process own
  // the window (and its exit means "window closed").
  assert(edgeAppWindowCommand("darwin", "http://x/", "s1", { edgePath: x86Edge }) === null, "macOS must not use the Edge fallback");
  assert(edgeAppWindowCommand("linux", "http://x/", "s1", { edgePath: x86Edge }) === null, "Linux must not use the Edge fallback");
  const profileDir = join(ROOT, "tmp-edge-profile");
  const command = edgeAppWindowCommand("win32", "http://127.0.0.1:1/?t=a", "s1", { edgePath: x86Edge, profileDir });
  assert(command !== null, "Windows must build an Edge app-window command");
  assert(command.command === x86Edge, "the Edge fallback must run the resolved msedge.exe");
  assert(command.args[0] === "--app=http://127.0.0.1:1/?t=a#dsv-system-window=s1", "Edge must load the marker URL in app mode");
  assert(command.args.includes("--user-data-dir=" + profileDir), "the Edge fallback needs its own profile directory");
  assert(command.args.some((arg) => arg.startsWith("--window-size=")), "the Edge app window must get an explicit size");
  assert(command.args.includes("--no-first-run"), "the Edge app window must skip the first-run flow");
  assert(command.args.includes("--disable-background-mode"), "Edge must exit when the window closes");
});

test("system window: launch tokens stay out of diagnostics", () => {
  // DSH mints URL-safe base64 tokens; the standard-base64-only pattern used by
  // 0.14.1 left most of them readable in the log.
  const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfG";
  const redacted = redactNativeWindowText("url?t=" + token + "&x=1");
  assert(!redacted.includes(token), "a URL-safe launch token must be redacted");
  assert(redacted.includes("<redacted>"), "redaction must leave a marker");
  assert(redactNativeWindowText("/tmp/dsh-split-workspace-helper-a1.log") === "/tmp/dsh-split-workspace-helper-a1.log",
    "short hyphenated paths must stay readable");
});

test("Windows system window: no console-less spawn, helper trace and diagnostics route", () => {
  const host = read("lib/index.js");
  // Root cause of 0.14.1: `detached: true` on Windows creates the child with
  // DETACHED_PROCESS, i.e. no console; Windows PowerShell 5.1 then exits 0
  // without running the script and writes nothing to the pipes.
  assert(
    host.includes("detached: process.platform !== \"win32\""),
    "the Windows helper must not be spawned detached (DETACHED_PROCESS removes its console)",
  );
  for (const token of [
    "helperLogPath(", "helper trace", "helperLog=",
    "findEdgeExecutable", "edgeAppWindowCommand", "systemWindowTarget",
    "windowsPowerShellPath", "msedge.exe", "--app=", "--user-data-dir=",
    "edge-window", "engine: \"edge\"", "fallback: true", "engines:",
    "system-window-log", "systemWindowLog", "NATIVE_WINDOW_LOG_TAIL_LIMIT",
    "sweepNativeWindowArtifacts", "cleanupNativeWindowProfile", "trimNativeWindowLog",
    "DSV_HELPER_LOG", "dsvEngine", "form shown",
  ]) {
    assert(host.includes(token), `missing Windows system-window support: ${token}`);
  }
  const client = read("lib/client.js");
  for (const token of ["systemWindowEdgeOpened", "systemWindowLog()", "/dsv/system-window-log"]) {
    assert(client.includes(token), `missing client support: ${token}`);
  }
});


test("system window: anchor fallback places stock menus above their trigger", () => {
  const source = read("src/client/16-standalone.js");
  const start = source.indexOf("// dsv-anchor-math:start");
  const end = source.indexOf("// dsv-anchor-math:end");
  assert(start !== -1 && end > start, "the anchor fallback math is not marked for testing");
  const mathSource = source.slice(source.indexOf("\n", start), end);
  const insets = new Function(mathSource + "\nreturn anchorPanelInsets;")();
  const viewport = { width: 1000, height: 800 };

  // Composer menus open upward with align=end: the panel's bottom sits just
  // above the trigger and its right edge lines up with the trigger's.
  const up = insets({ top: 600, right: 900, bottom: 628, left: 700 }, viewport, "top", "end", 8);
  assert(up.bottom === 208, "side=top must anchor the panel's bottom above the trigger");
  assert(up.right === 100, "align=end must align the panel's right edge with the trigger");
  assert(up.top === null && up.left === null, "side=top/align=end must not set top or left");
  assert(up.maxHeight === 580, "side=top must cap the panel height to the space above");

  // Point-free downward menus align their left edge with the trigger.
  const down = insets({ top: 100, right: 140, bottom: 128, left: 40 }, viewport, "bottom", "start", 4);
  assert(down.top === 132, "side=bottom must anchor the panel's top below the trigger");
  assert(down.left === 40, "align=start must align the panel's left edge with the trigger");
  assert(down.maxHeight === 656, "side=bottom must cap the panel height to the space below");

  // Side submenus follow the trigger instead of the viewport corner.
  const right = insets({ top: 200, right: 300, bottom: 220, left: 200 }, viewport, "right", "start", 4);
  assert(right.left === 304, "side=right must place the submenu beside the trigger");
  assert(right.top === 200, "side=right must align the submenu with the trigger top");
  const left = insets({ top: 200, right: 300, bottom: 220, left: 200 }, viewport, "left", "start", 4);
  assert(left.right === 804, "side=left must place the submenu on the trigger's left");

  // A panel never leaves the layout viewport, even when the trigger does not.
  const clamped = insets({ top: 40, right: 1200, bottom: 68, left: 1100 }, viewport, "top", "end", 4);
  assert(clamped.right === 12, "the panel must stay inside the viewport margin");
  assert(clamped.maxWidth === 976, "the panel width must be capped to the viewport");

  assert(insets({ top: 0, right: 0, bottom: 0, left: 0 }, viewport, "diagonal", "start", 4) === null,
    "unknown anchor sides must not be positioned");
});

test("macOS system window ships a WKWebView anchor fallback check", () => {
  assert(exists("scripts/check-wkwebview-anchor.mjs"), "the WKWebView anchor fallback check is missing");
  assert(exists("scripts/anchor-fallback-run.jxa"), "the WKWebView harness is missing");
  assert(pkg.scripts["check:anchor"] === "node scripts/check-wkwebview-anchor.mjs", "npm run check:anchor must run the check");
  const check = read("scripts/check-wkwebview-anchor.mjs");
  for (const token of [
    "dsv-anchor-fallback:start",
    "dsv-anchor-fallback:end",
    "installAnchorFallback",
    "data-anchor-side",
    "--dsh-model-anchor",
    "document.title",
  ]) {
    assert(check.includes(token), `the WKWebView check is missing ${token}`);
  }
  const harness = read("scripts/anchor-fallback-run.jxa");
  for (const token of ["WKWebView", "loadFileURLAllowingReadAccessToURL", "writeToFileAtomically", "app.terminate"]) {
    assert(harness.includes(token), `the WKWebView harness is missing ${token}`);
  }
});

test("session menu groups the three window surfaces and mirrors their state", () => {
  const client = read("lib/client.js");
  for (const token of [
    'id: "split-plugin"',
    "children: [",
    'id: "split"',
    "splitMember",
    "menuAddToSplit",
    "exitSplit",
    "removeSessionFromSplit(id)",
    "dockFloatToSplit(id)",
    "menuIndependentOpen",
    "menuIndependentClose",
    "menuNativeOpen",
    "menuNativeClose",
    "menuFloatOpen",
    "menuFloatClose",
    "closeAppWindowFor(id)",
    "openAppWindow(id)",
    'mode === "close"',
    "systemWindowNativeClosed",
    'row("help"',
    "openHelp()",
  ]) {
    assert(client.includes(token), `missing grouped window menu support: ${token}`);
  }
  // The menu must observe the live surface stores so closing a window (in-app
  // or native, from inside or from the OS close button) flips Enter → Exit.
  const observe = client.slice(client.indexOf("observe: () => ["), client.indexOf("],", client.indexOf("observe: () => [")) + 2);
  for (const store of ["floatStore", "runtimeStore", "nativeWindowStore"]) {
    assert(observe.includes(store), `the session menu must observe ${store}`);
  }
});

test("help card: same-origin screenshots served by the Host", () => {
  const host = read("lib/index.js");
  for (const token of [
    "/dsv/help",
    "HELP_ASSETS",
    "help-session-menu.png",
    "help-footer-menu.png",
    "help-settings.png",
    "content-type\": \"image/png",
  ]) {
    assert(host.includes(token), `missing help asset Host support: ${token}`);
  }
  const client = read("lib/client.js");
  for (const token of [
    "HELP_SHOTS",
    "/dsv/help/session-menu.png",
    "/dsv/help/footer-menu.png",
    "/dsv/help/settings.png",
    "dsv-help-shots",
    "dsv-help-lightbox",
    "HelpShotLightbox",
    "helpShotsTitle",
    "helpShotZoom",
  ]) {
    assert(client.includes(token), `missing help screenshot client support: ${token}`);
  }
  for (const file of ["help-session-menu.png", "help-footer-menu.png", "help-settings.png"]) {
    assert(exists(`docs/screenshots/${file}`), `missing help screenshot ${file}`);
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


test("split-view sidebar panel entry, main panel and inline picker", () => {
  const client = read("lib/client.js");
  for (const token of [
    'const SPLIT_PANEL_ID = "split-view"',
    'name: "sidebar.panellist"',
    "id: SPLIT_PANEL_ID",
    'name: "main"',
    "key: SPLIT_PANEL_ID",
    "SplitPanelView",
    "PanelSplitPicker",
    "SplitNavIcon",
    "SplitViewGlyph",
    "splitPickableItems",
    "dsv-panel-root",
    "dsv-overlay dsv-warm",
    "WARM_HIDE_MS",
    "warmHold",
    "panelWarm",
    "readChipPos()",
    "writeChipPos(next)",
    "panelPickTitle",
    "panelNeedTwo",
    "panelDisabledTitle",
    "panelEnable",
    "selectSplitPanel",
    "leaveSplitPanel",
    "splitPanelActive",
  ]) {
    assert(client.includes(token), `missing split-view panel support: ${token}`);
  }
  // The canvas is the ONE live pane tree and lives in the overlay seat for both
  // the plain split and the "分屏视图" panel; selecting the panel must not
  // re-create it (that was the panel ⇄ conversation latency).
  assert(client.includes("h(WorkspaceBoundary, { key: \"workspace-\" + runtime.epoch }"),
    "the overlay seat must always mount the workspace canvas");
  assert(!client.includes("panelOwned ? null : h(WorkspaceBoundary"),
    "the panel must not mount a second pane tree");
  // Hidden states keep the canvas warm-mounted instead of unmounting it.
  assert(client.includes("if (warmHold !== true || bounds.ok !== true) return null;"),
    "hidden canvases must stay mounted during the warm window");
  // The minimize chip snaps to the nearest edge only, never to a corner.
  assert(client.includes("nearest === leftDist"), "the minimize chip must snap to the nearest edge");
  assert(!client.includes("base.x + width / 2 < work.left + work.width / 2"),
    "the minimize chip must not snap to one of the four corners");
});

test("locale dictionaries cover the split-view panel", () => {
  const client = read("lib/client.js");
  for (const key of [
    "panelTitle",
    "panelPickTitle",
    "panelPickHint",
    "panelPickConfirm",
    "panelNeedTwo",
    "panelDisabledTitle",
    "panelDisabledBody",
    "panelEnable",
    "panelSafeTitle",
    "panelSafeBody",
    "panelNoSessions",
    "panelMinimizeHint",
  ]) {
    const count = client.split(key + ":").length - 1;
    assert(count >= 2, `locale key ${key} must exist in both dictionaries`);
  }
});

test("launcher icons are drawn, so Windows never shows a mojibake box", () => {
  const client = read("lib/client.js");
  assert(!client.includes('row("restart", "⏻"'), "the restart row must not use the U+23FB power symbol");
  for (const token of [
    "RestartIcon",
    'row("restart", h(RestartIcon',
    "TwoPaneGlyph",
    "FloatPaneGlyph",
    "WindowGlyph",
    "NativeWindowGlyph",
  ]) {
    assert(client.includes(token), `missing drawn launcher glyph: ${token}`);
  }
  // The bottom-left launcher button uses the same glyph as the sidebar row.
  const footer = client.slice(client.indexOf("function FooterSplitButton()"), client.indexOf("/** True while apply()"));
  assert(footer.includes("SplitViewGlyph"), "the footer button must use the split-view glyph");
});

test("session context menu carries icons for the split-plugin group and rows", () => {
  const client = read("lib/client.js");
  for (const token of [
    "CONTEXT_ICON_PANEL",
    "CONTEXT_ICON_SPLIT",
    "CONTEXT_ICON_FLOAT",
    "CONTEXT_ICON_WINDOW",
    "CONTEXT_ICON_NATIVE",
    'slots.inject("contextMenu.icon"',
    "icon: { key: CONTEXT_ICON_PANEL }",
    "icon: { key: CONTEXT_ICON_NATIVE }",
  ]) {
    assert(client.includes(token), `missing session-menu icon support: ${token}`);
  }
});

test("resize responsiveness: layout-busy tracking and settle measurement", () => {
  const client = read("lib/client.js");
  for (const token of [
    "LAYOUT_SETTLE_MS",
    "layoutBusy",
    "onLayoutSettle",
    "notifyLayoutSettle",
    "installWindowResizeTracker",
    "markDividerDrag",
    "data-dsv-resizing",
    "windowResizing",
    "applyCanvasFreeze",
    "clearCanvasFreeze",
    "willChange",
    "setResizeFreeze",
    "resizeFreezeOn",
  ]) {
    assert(client.includes(token), `missing resize-responsiveness support: ${token}`);
  }
  // Pane measurements skip the intermediate resize frames and run on settle.
  assert(client.includes("if (layoutBusy()) return;"), "pane measurements must skip intermediate resize frames");
  assert(client.includes("const offSettle = onLayoutSettle(schedule);"), "pane measurements must re-run when the gesture settles");
  // The composer measurement effect must not be torn down and recreated on
  // every width change of the window.
  assert(!client.includes("}, [paneSize.w, composerMode, performanceMode]);"),
    "composer measurement still re-mounts per width change");
  assert(client.includes("}, [composerMode, performanceMode]);"), "composer measurement must depend only on mode + perf mode");
});


test("switching split ⇄ conversation ⇄ plugin panels keeps the pane tree warm", () => {
  const client = read("lib/client.js");
  for (const token of [
    "const WARM_HIDE_MS = 20000",
    "dsv-overlay dsv-warm",
    "visibility: hidden !important",
    "if (warmHold !== true || bounds.ok !== true) return null;",
  ]) {
    assert(client.includes(token), `missing warm-canvas switch support: ${token}`);
  }
  // One canvas: the overlay seat always mounts it; the panel page never does.
  assert(!client.includes("panelOwned ? null : h(WorkspaceBoundary"),
    "the split-view panel must not mount a second pane tree");
  const restore = client.slice(client.indexOf("function restoreSplit()"), client.indexOf("function SplitNavIcon"));
  // The canvas becomes visible before the covered stock view is aligned: a
  // native openSession in there used to gate the restore for hundreds of ms.
  assert(restore.length > 0, "restoreSplit is missing");
  assert(restore.indexOf("setRuntime({ minimized: false });") !== -1
    && restore.indexOf("setRuntime({ minimized: false });") < restore.indexOf("layout.selectPanel(null);"),
    "restoreSplit must unminimize before switching the covered stock view");
  assert(restore.includes("window.setTimeout(() => {"), "the covered-view session alignment must be deferred");
  assert(restore.includes("currentSessionId() === sid"), "the deferred alignment must be skipped when already aligned");
});


test("a restored canvas is always interactive, so pane header buttons keep working", () => {
  const client = read("lib/client.js");
  const css = read("src/client/02-styles.js");
  // Invariant: warm-hidden canvases are non-interactive by visibility alone.
  assert(/\.dsv-overlay\.dsv-warm\s*\{\s*visibility: hidden !important;\s*\}/.test(css),
    "the warm rule must hide the canvas with visibility:hidden only");
  assert(!/\.dsv-overlay\.dsv-warm\s*\{[^}]*pointer-events/.test(css),
    "the warm rule must not leave pointer-events behind (a stale value makes a restored canvas click-through)");
  // Non-warm canvases are forced visible + clickable, header buttons included.
  for (const token of [
    ".dsv-overlay:not(.dsv-warm) { visibility: visible !important; pointer-events: auto !important; }",
    ".dsv-overlay:not(.dsv-warm) .dsv-pane-header",
    ".dsv-overlay:not(.dsv-warm) .dsv-pane-header .dsv-pane-btn",
    "canvasRepairs",
  ]) {
    assert(css.includes(token) || client.includes(token), "missing restored-canvas interactivity support: " + token);
  }
  // One frame after showing, the canvas self-checks: drop a leftover freeze,
  // restore pointer-events/visibility, clear interrupted-drag transparent panes.
  for (const token of [
    'el.style.setProperty("pointer-events", "auto", "important")',
    'el.style.setProperty("visibility", "visible", "important")',
    "canvasRepairs: runtimeState.canvasRepairs + 1",
    'for (const source of el.querySelectorAll("[data-dsv-source]"))',
  ]) {
    assert(client.includes(token), "missing canvas interactivity self-check: " + token);
  }
});


test("Electron window-drag regions cannot eat pane header clicks", () => {
  const client = read("lib/client.js");
  const css = read("src/client/02-styles.js");
  // The stock conversation stays mounted behind the overlay and keeps its
  // native window-drag region over the top of the column; a covered stock
  // header therefore swallows clicks before the DOM. Our pane header must
  // subtract itself from that region with -webkit-app-region: no-drag.
  const headerRules = [...css.matchAll(/\.dsv-pane-header\s*\{[^}]*\}/g)].map((m) => m[0]);
  assert(headerRules.length > 0, "the pane header rule is missing");
  assert(headerRules.some((rule) => rule.includes("-webkit-app-region: no-drag")),
    "the pane header must opt out of native window-drag regions (covered stock headers swallow clicks otherwise)");
  // Canvas interactivity self-check and the panel-minimize transition.
  for (const token of ["canvasRepairs", "returningTitle", "dsv-panel-loading", "splitPanelMinimizeInFlight"]) {
    assert(client.includes(token) || css.includes(token), "missing restored-canvas support: " + token);
  }
  const panelMin = client.slice(
    client.indexOf("splitPanelMinimizeInFlight = true;"),
    client.indexOf("const finish = () => {"));
  assert(panelMin.length > 0, "the panel minimize branch is missing");
  assert(panelMin.includes("window.requestAnimationFrame(() => {"),
    "panel minimize must switch the main column in its own task, after the canvas hides");
  assert(panelMin.indexOf("splitPanelMinimizeInFlight = false;") !== -1,
    "panel minimize must clear the in-flight flag when the column switch runs");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAILED: ${failure.name}\n${failure.error.stack}`);
  process.exitCode = 1;
}
