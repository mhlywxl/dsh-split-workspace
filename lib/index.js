/**
 * Host half of dsh-split-workspace.
 *
 * DSH Desktop runs this Host in a Node child process with no Electron APIs, and
 * its main window denies `window.open` (http/https goes to the system browser).
 * No plugin-facing BrowserWindow API exists, so the Host cannot open a native
 * Electron window; the one-conversation "independent window" therefore lives in
 * the client as a first-class in-app surface.
 *
 * This half adds the actions a renderer cannot perform alone:
 * - it serves the on-disk plugin version, so a running page notices a freshly
 *   installed bundle;
 * - it closes and reopens the Desktop app, because production DSH builds have
 *   no in-app restart entry (the split menu and update chip call this);
 * - it opens a real, independent OS window: an AppKit NSWindow hosted by the
 *   system WebView on macOS (osascript), or a WinForms window hosting the
 *   WebView2 control on Windows. Both load the Host's authenticated web client
 *   with a hash marker; the renderer never receives the launch token. When the
 *   Windows helper cannot start, an Edge app-mode window (chromeless, own
 *   process) opens the same client, and the failure reasons are logged.
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATH = "/dsv/version";
const RESTART_PATH = "/dsv/restart";
const NATIVE_WINDOW_PATH = "/dsv/system-window";
/** Diagnostics: serve this Host's system-window log (launch tokens redacted). */
const NATIVE_WINDOW_LOG_PATH = "/dsv/system-window-log";
/** Help-card screenshots shipped in docs/screenshots and served same-origin. */
const HELP_ASSET_PATH = "/dsv/help";
const HELP_ASSET_DIR = new URL("../docs/screenshots/", import.meta.url);
const HELP_ASSETS = {
  "session-menu.png": "help-session-menu.png",
  "footer-menu.png": "help-footer-menu.png",
  "settings.png": "help-settings.png",
};
/** Header a same-page action must send; blocks cross-site form posts. */
const NATIVE_WINDOW_CONFIRM = "x-dsv-system-window";
const NATIVE_WINDOW_SCRIPT = fileURLToPath(new URL("../native/system-window.jxa", import.meta.url));
/** Windows counterpart: a WinForms window hosting the WebView2 control. */
const NATIVE_WINDOW_SCRIPT_WIN = fileURLToPath(new URL("../native/system-window.ps1", import.meta.url));
/** Vendored WebView2 SDK assets (BSD-3-Clause; see THIRD-PARTY-NOTICES.md). */
const NATIVE_WINDOW_WEBVIEW2_DIR = fileURLToPath(new URL("../native/webview2", import.meta.url));
/** How long a Windows helper may take to put a visible window on screen.
    Windows PowerShell itself can need seconds to start on a cold machine, and
    the answer the user sees must be "the window is really there", not "the
    process has not died yet" (0.14.2 reported success for an invisible window). */
const NATIVE_WINDOW_VISIBLE_MS = 20000;
/** Microsoft Edge needs longer than the helper: it boots a full browser. */
const NATIVE_WINDOW_EDGE_STARTUP_MS = 3000;
/** The Host's append-only diagnostic log (shared by every window attempt). */
const NATIVE_WINDOW_LOG = resolve(tmpdir(), "dsh-split-workspace-system-window.log");
/** The Windows helper writes its own trace here; it survives a broken stderr. */
const NATIVE_WINDOW_HELPER_LOG_PREFIX = "dsh-split-workspace-system-window-helper-";
/** Temp WebView2 profiles and Edge app-window profiles share this prefix. */
const NATIVE_WINDOW_PROFILE_PREFIX = "dsh-split-workspace-system-window-";
/** Edge app-window profiles: one per window, deleted when that window closes. */
const NATIVE_WINDOW_EDGE_PROFILE_PREFIX = "dsh-split-workspace-edge-window-";
/** Artifacts older than this are leftovers from force-killed windows. */
const NATIVE_WINDOW_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
/** How much of the Host log the diagnostics route returns. */
const NATIVE_WINDOW_LOG_TAIL_LIMIT = 16000;
/** Rotate the append-only Host log once it grows past this size. */
const NATIVE_WINDOW_LOG_MAX_BYTES = 512 * 1024;
/** The Desktop app has no in-app restart entry in production builds; this
    route recreates that one action at the OS level. */
const RESTART_COOLDOWN_MS = 15000;
/** Client and Host agree on this session-id alphabet (see src/client/04-tree.js). */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,160}$/;
let lastRestartAt = 0;
/** Live osascript helper processes by session id, so a Host shutdown also
    closes the windows and the menu can offer enter/exit state. */
const nativeWindows = new Map();
let nativeWindowExitHook = false;

/** The plugin version currently on disk (not the one this process loaded). */
function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : null;
  } catch {
    return null;
  }
}

function respond(res, status, value) {
  try {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  } catch {}
}

/** True when this Host was spawned by the DSH Desktop shell. */
function runningInDesktop() {
  return typeof process.versions.electron === "string" && process.versions.electron !== "";
}

/** Allow the application origin and local web clients, never a foreign site. */
function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return true;
  return origin === "dsh-app://app"
    || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu.test(origin);
}

/** Append one diagnostic line; never include the tokenized URL. */
function nativeWindowLog(level, message) {
  try {
    appendFileSync(NATIVE_WINDOW_LOG, `[${new Date().toISOString()}] ${level} ${message}\n`);
  } catch {}
}

/** The Host log tail used by the diagnostics route and failure details. */
function nativeWindowLogTail(limit = NATIVE_WINDOW_LOG_TAIL_LIMIT) {
  return redactNativeWindowText(readTextTail(NATIVE_WINDOW_LOG, limit)).trim();
}

/** Session ids that currently have a live native window. */
function nativeWindowSessions() {
  const sessions = [];
  for (const [sessionId, child] of nativeWindows) {
    if (child.exitCode === null && child.signalCode === null) sessions.push(sessionId);
  }
  return sessions;
}

/** Platforms that can host a real, independent OS window from the plugin. */
export function nativeWindowSupported(platform) {
  return platform === "darwin" || platform === "win32";
}

/** The hash marker that switches the loaded client into system-window mode. */
export function systemWindowTarget(authenticatedUrl, sessionId) {
  return authenticatedUrl + "#dsv-system-window=" + encodeURIComponent(sessionId);
}

/**
 * Windows PowerShell candidates, most specific first. The absolute System32
 * path wins so a stray `powershell.exe` on PATH (or a missing PATH entry in an
 * Electron-launched Host) cannot change which shell starts the helper.
 */
export function windowsPowerShellCandidates(env = process.env) {
  const candidates = [];
  const root = env.SystemRoot !== undefined && env.SystemRoot !== "" ? env.SystemRoot : env.windir;
  if (typeof root === "string" && root !== "") {
    candidates.push(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  }
  candidates.push("powershell.exe");
  return candidates;
}

export function windowsPowerShellPath(env = process.env, exists = existsSync) {
  const candidates = windowsPowerShellCandidates(env);
  for (const candidate of candidates) {
    if (candidate === "powershell.exe" || exists(candidate) === true) return candidate;
  }
  return "powershell.exe";
}

/** Microsoft Edge installs: machine-wide first, then the per-user copy. */
export function edgeExecutableCandidates(env = process.env) {
  const candidates = [];
  for (const key of ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]) {
    const root = env[key];
    if (typeof root !== "string" || root === "") continue;
    const candidate = join(root, "Microsoft", "Edge", "Application", "msedge.exe");
    if (candidates.indexOf(candidate) === -1) candidates.push(candidate);
  }
  return candidates;
}

export function findEdgeExecutable(env = process.env, exists = existsSync) {
  for (const candidate of edgeExecutableCandidates(env)) {
    if (exists(candidate) === true) return candidate;
  }
  return null;
}

/**
 * The detached helper command for one system window. The authenticated URL is
 * handed to a same-user local process (an osascript argument on macOS, a
 * base64 argument on Windows) and is never returned to the renderer.
 */
export function systemWindowCommand(platform, authenticatedUrl, sessionId, options = {}) {
  if (typeof authenticatedUrl !== "string" || authenticatedUrl === "") return null;
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
  const target = systemWindowTarget(authenticatedUrl, sessionId);
  if (platform === "darwin") {
    return {
      command: "/usr/bin/osascript",
      args: ["-l", "JavaScript", NATIVE_WINDOW_SCRIPT, target],
    };
  }
  if (platform === "win32") {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-Sta",
      "-ExecutionPolicy", "Bypass",
      "-File", NATIVE_WINDOW_SCRIPT_WIN,
      "-UrlB64", Buffer.from(target, "utf8").toString("base64"),
      "-WebView2Dir", NATIVE_WINDOW_WEBVIEW2_DIR,
    ];
    // The helper appends its own stage trace here. That trace survives a broken
    // stderr, which is the only reliable way to see why PowerShell died.
    if (typeof options.helperLog === "string" && options.helperLog !== "") {
      args.push("-LogPath", options.helperLog);
    }
    return { command: windowsPowerShellPath(options.env, options.exists), args };
  }
  return null;
}

/** Chromeless Microsoft Edge "app mode" flags: one independent OS window. */
const EDGE_APP_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-mode",
  "--disable-sync",
  "--disable-extensions",
  "--disable-component-update",
  "--disable-features=Translate,OptimizationHints,MediaRouter",
];

/**
 * Fallback system window: Edge in app mode. It is a real, independent OS window
 * with no address bar or tab strip, driven by the same authenticated URL and
 * hash marker as the WebView2 helper. A per-window `--user-data-dir` keeps Edge
 * from reusing an already-running browser process (which would exit instantly
 * and keep the window in the wrong process), so the spawned process owns the
 * window and exits when the user closes it.
 */
export function edgeAppWindowCommand(platform, authenticatedUrl, sessionId, options = {}) {
  if (platform !== "win32") return null;
  if (typeof authenticatedUrl !== "string" || authenticatedUrl === "") return null;
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
  const edge = typeof options.edgePath === "string" && options.edgePath !== ""
    ? options.edgePath
    : findEdgeExecutable(options.env, options.exists);
  if (edge === null) return null;
  const args = ["--app=" + systemWindowTarget(authenticatedUrl, sessionId)];
  if (typeof options.profileDir === "string" && options.profileDir !== "") {
    args.push("--user-data-dir=" + options.profileDir);
  }
  args.push("--window-size=1320,900");
  for (const flag of EDGE_APP_FLAGS) args.push(flag);
  return { command: edge, args, engine: "edge" };
}

/** Last `limit` characters of a text file, or "" when it is unavailable. */
function readTextTail(path, limit) {
  try {
    const text = readFileSync(path, "utf8");
    return text.slice(Math.max(0, text.length - limit));
  } catch {
    return "";
  }
}

/** A unique helper trace path, so concurrent windows keep separate traces. */
function helperLogPath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 40);
  return resolve(tmpdir(), NATIVE_WINDOW_HELPER_LOG_PREFIX + safe + "-" + Date.now().toString(36) + ".log");
}

/** Directories (and trace files) of windows that are still alive. */
function liveNativeWindowArtifacts() {
  const live = new Set();
  for (const child of nativeWindows.values()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (typeof child.dsvProfileDir === "string" && child.dsvProfileDir !== "") {
      live.add(child.dsvProfileDir);
    }
  }
  return live;
}

/** Keep the append-only Host log bounded; the tail is the useful history. */
function trimNativeWindowLog() {
  try {
    if (statSync(NATIVE_WINDOW_LOG).size > NATIVE_WINDOW_LOG_MAX_BYTES) {
      const text = readFileSync(NATIVE_WINDOW_LOG, "utf8");
      writeFileSync(NATIVE_WINDOW_LOG, text.slice(-NATIVE_WINDOW_LOG_TAIL_LIMIT));
    }
  } catch {}
}

/** Delete profiles and traces left behind by force-killed windows. */
function sweepNativeWindowArtifacts() {
  const deadline = Date.now() - NATIVE_WINDOW_ARTIFACT_TTL_MS;
  const live = liveNativeWindowArtifacts();
  let entries = [];
  try { entries = readdirSync(tmpdir()); } catch { return; }
  for (const name of entries) {
    // Only artifacts the Host owns. WebView2 profiles (NATIVE_WINDOW_PROFILE_PREFIX)
    // belong to a running helper and are swept by the helper itself; deleting
    // one here could break a window that has been open for more than a day.
    if (!name.startsWith(NATIVE_WINDOW_EDGE_PROFILE_PREFIX)
      && !name.startsWith(NATIVE_WINDOW_HELPER_LOG_PREFIX)) {
      continue;
    }
    const path = join(tmpdir(), name);
    // A window that has stayed open for days must keep its profile.
    if (live.has(path)) continue;
    try {
      if (statSync(path).mtimeMs < deadline) rmSync(path, { recursive: true, force: true });
    } catch {}
  }
}

/** A per-window Edge profile directory, removed when that window closes. */
function createEdgeProfileDir() {
  try {
    return mkdtempSync(join(tmpdir(), NATIVE_WINDOW_EDGE_PROFILE_PREFIX));
  } catch (error) {
    nativeWindowLog("warn", "could not create the Edge profile directory: " + String(error));
    return null;
  }
}

/** Remove the Edge profile of one closed window (Edge releases it lazily). */
function cleanupNativeWindowProfile(child) {
  const profile = child !== null && child !== undefined ? child.dsvProfileDir : undefined;
  if (typeof profile !== "string" || profile === "") return;
  setTimeout(() => {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }, 1200);
}

/**
 * Track one detached window process: mirror its output into the Host log, log
 * its exit (with the helper's own trace when it has one) and clean up profiles.
 */
function trackNativeWindow(sessionId, child, engine, logPath) {
  let tail = "";
  let mirrored = 0;
  const capture = (chunk) => {
    const text = redactNativeWindowText(String(chunk));
    tail = (tail + text).slice(-8192);
    // Chromium (the Edge fallback) can be chatty for the window's whole life.
    // Keep the in-memory tail for failure details, but stop mirroring into the
    // shared log after a small budget so it cannot grow unbounded.
    if (mirrored < 8192) {
      mirrored += text.length;
      try { appendFileSync(NATIVE_WINDOW_LOG, text.endsWith("\n") ? text : text + "\n"); } catch {}
    }
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.dsvOutput = () => tail;
  child.dsvEngine = engine;
  nativeWindows.set(sessionId, child);
  child.once("exit", (code, signal) => {
    if (nativeWindows.get(sessionId) === child) nativeWindows.delete(sessionId);
    nativeWindowLog(code === 0 ? "info" : "warn",
      "helper exit session=" + sessionId + " engine=" + engine + " code=" + String(code)
      + " signal=" + String(signal) + (tail.trim() === "" ? " (no output)" : ""));
    if (tail.trim() !== "") {
      nativeWindowLog("warn", "helper output: " + tail.trim().slice(-2000));
    }
    if (typeof logPath === "string" && logPath !== "") {
      const trace = redactNativeWindowText(readTextTail(logPath, 4000)).trim();
      nativeWindowLog("info", "helper trace (" + logPath + "): " + (trace === "" ? "(missing)" : trace.slice(-2000)));
    }
    cleanupNativeWindowProfile(child);
  });
  child.once("error", (error) => {
    if (nativeWindows.get(sessionId) === child) nativeWindows.delete(sessionId);
    nativeWindowLog("warn", "system window process error (" + engine + "): " + String(error));
    cleanupNativeWindowProfile(child);
  });
  child.unref();
  return child;
}


/** Long base64/base64url runs are launch tokens: never persist them in the log.
    DSH mints tokens with the URL-safe alphabet (`-`/`_` as well as `+`/`/`), so
    a standard-base64-only pattern would leave ~73% of tokens partly readable. */
export function redactNativeWindowText(text) {
  return String(text).replace(/[A-Za-z0-9+/_-]{40,}={0,2}/gu, "<redacted>");
}

/** Resolve true when the helper dies before its window is up. Both "exit" and
    "close" count: with piped stdio a surviving grandchild (a WebView2/Edge
    browser process that inherited the handles) can hold the pipes open, so
    "close" alone would report a dead helper as a successful window. */
function waitForEarlyExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(exited);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", () => finish(true));
    child.once("close", () => finish(true));
  });
}

/** Wait until the Windows helper proves its window is on screen.
 *
 * "form shown" only reports WinForms' managed Visible flag. The helper is
 * spawned with windowsHide (STARTF_USESHOWWINDOW|SW_HIDE), and Windows applies
 * that to the process's first ShowWindow, so a created form can be invisible
 * while reporting Visible=True — the 0.14.2 failure. The helper therefore
 * force-shows the window and logs "form displayed osVisible=True|False"; this
 * waits for that line (or for the helper to exit) instead of assuming success
 * after a timer. */
function waitForWindowsWindow(child, logPath, timeoutMs) {
  const trace = () => (typeof logPath === "string" && logPath !== ""
    ? redactNativeWindowText(readTextTail(logPath, 4000))
    : "");
  return new Promise((resolve) => {
    let settled = false;
    let poll = null;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll !== null) clearInterval(poll);
      resolve({ state, trace: trace() });
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    // The helper logs a hidden first show and then its retry a moment later.
    // Give the retry a beat before calling the window hidden, or a poll landing
    // between the two writes would kill a window that is about to recover.
    let hiddenSince = 0;
    const check = () => {
      const text = trace();
      if (/form displayed[^\n]*osVisible=True/u.test(text)) { finish("visible"); return; }
      if (/form displayed[^\n]*osVisible=False/u.test(text)) {
        if (hiddenSince === 0) hiddenSince = Date.now();
        else if (Date.now() - hiddenSince > 400) finish("hidden");
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) finish("exited");
    };
    child.once("exit", () => finish("exited"));
    child.once("close", () => finish("exited"));
    poll = setInterval(check, 100);
    check();
  });
}

/** End one helper process. On Windows the whole tree must go, otherwise the
    WebView2 browser process outlives the window it belonged to. */
function killNativeWindow(child) {
  try {
    if (process.platform === "win32" && typeof child.pid === "number" && child.pid > 0) {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return true;
    }
    return child.kill() === true;
  } catch (error) {
    nativeWindowLog("warn", "could not close the system window: " + String(error));
    return false;
  }
}

/** Spawn the platform helper window (macOS AppKit, Windows WinForms+WebView2). */
function openNativeSystemWindow(webCtx, res, sessionId) {
  if (!nativeWindowSupported(process.platform)) {
    respond(res, 200, { ok: false, error: "unsupported-platform", platform: process.platform });
    return;
  }
  const existing = nativeWindows.get(sessionId);
  if (existing !== undefined && existing.exitCode === null && existing.signalCode === null) {
    // One window per conversation: asking again just reports the open state.
    const engine = existing.dsvEngine
      ?? (process.platform === "darwin" ? "appkit" : "webview2");
    respond(res, 200, { ok: true, mode: "native", platform: process.platform, engine, reused: true });
    return;
  }
  const connection = webCtx.get("connection");
  if (connection === null || connection === undefined || typeof connection.authenticatedUrl !== "function") {
    nativeWindowLog("warn", "connection service is unavailable");
    respond(res, 503, { ok: false, error: "connection" });
    return;
  }
  let url;
  try {
    url = connection.authenticatedUrl(webCtx.webServer.getOrigin() + "/");
  } catch (error) {
    nativeWindowLog("warn", "could not mint the authenticated URL: " + String(error));
    respond(res, 503, { ok: false, error: "web-server" });
    return;
  }
  sweepNativeWindowArtifacts();
  trimNativeWindowLog();
  const helperLog = process.platform === "win32" ? helperLogPath(sessionId) : null;
  const command = systemWindowCommand(process.platform, url, sessionId, { helperLog });
  if (command === null) {
    nativeWindowLog("warn", "unsupported system window command on " + process.platform);
    respond(res, 500, { ok: false, error: "spawn" });
    return;
  }
  const helper = process.platform === "win32" ? "system-window.ps1" : "system-window.jxa";
  const helperPath = process.platform === "win32" ? NATIVE_WINDOW_SCRIPT_WIN : NATIVE_WINDOW_SCRIPT;
  nativeWindowLog("info",
    "opening session=" + sessionId + " platform=" + process.platform + " arch=" + process.arch
    + " helper=" + helper + " present=" + existsSync(helperPath)
    + (helperLog === null ? "" : " helperLog=" + helperLog)
    + " powershell=" + command.command);
  let child;
  try {
    child = spawn(command.command, command.args, {
      // Also hand the trace path through the environment: a TEMP path that
      // contains a quote must not have to survive PowerShell argument parsing.
      env: helperLog === null ? process.env : Object.assign({}, process.env, { DSV_HELPER_LOG: helperLog }),
      // NOT detached on Windows: `detached: true` makes Windows create the
      // child with DETACHED_PROCESS, i.e. with NO console, and CREATE_NO_WINDOW
      // (windowsHide) is ignored in that combination. Windows PowerShell 5.1 is
      // a console host: started console-less it exits 0 without running the
      // script and writes nothing to the inherited pipes — exactly the 0.14.1
      // symptom (code=0, no output, no window); the 0.14.1 helper also had a
      // PowerShell parse error, so it could never run. Windows does not kill
      // children when the parent exits, so detached buys nothing here; taskkill
      // tears the tree down on close. macOS keeps its detached osascript helper.
      detached: process.platform !== "win32",
      // windowsHide is still required (PowerShell is a console host and would
      // otherwise flash a console window), but it also sets
      // STARTF_USESHOWWINDOW|SW_HIDE, which Win32 applies to this process's
      // FIRST ShowWindow: WinForms' own show. The helper therefore force-shows
      // the form and reports the user32 state; see Show-DsvWindow.
      windowsHide: true,
      // Capture instead of inheriting a log fd: Windows fd inheritance is
      // unreliable, and an empty log made a failed helper impossible to debug.
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    nativeWindowLog("warn", "could not spawn the system window: " + String(error));
    if (process.platform === "win32") {
      // PowerShell itself may be unusable (PATH/policy/removed). The Edge app
      // window does not need it, so try that instead of failing outright.
      openEdgeAppWindow(res, sessionId, url,
        "could not start the WebView2 helper (PowerShell): " + String(error), null);
      return;
    }
    respond(res, 500, { ok: false, error: "spawn", detail: redactNativeWindowText(String(error)).slice(0, 400) });
    return;
  }
  trackNativeWindow(sessionId, child, process.platform === "win32" ? "webview2" : "appkit", helperLog);
  if (process.platform !== "win32") {
    respond(res, 200, { ok: true, mode: "native", platform: process.platform, engine: "appkit" });
    return;
  }
  // The Windows helper has to start PowerShell, create the window and load
  // WebView2. The user is only told "opened" once the helper proves the OS
  // window is visible; a window that exists but cannot be seen is a failure,
  // not a success with a silent second process behind it.
  waitForWindowsWindow(child, helperLog, NATIVE_WINDOW_VISIBLE_MS).then((outcome) => {
    const traceText = outcome.trace;
    if (outcome.state === "visible") {
      nativeWindowLog("info", "webview2 window visible session=" + sessionId);
      respond(res, 200, { ok: true, mode: "native", platform: process.platform, engine: "webview2" });
      return;
    }
    if (outcome.state === "hidden" || outcome.state === "timeout") {
      const why = outcome.state === "hidden"
        ? "the WebView2 window was created but the OS reports it as hidden (osVisible=False)"
        : "the WebView2 helper did not report a visible window within "
          + Math.round(NATIVE_WINDOW_VISIBLE_MS / 1000) + "s";
      nativeWindowLog("warn",
        "webview2 window unusable, closing the helper and using the Edge app window: " + why
        + " | trace: " + traceText.slice(-600));
      // Kill the invisible helper first: otherwise its WebView2 browser
      // process would stay behind the fallback window for the whole session.
      try { killNativeWindow(child); } catch {}
      if (nativeWindows.get(sessionId) === child) nativeWindows.delete(sessionId);
      openEdgeAppWindow(res, sessionId, url,
        why + " | helper trace: " + (traceText === "" ? "(missing)" : traceText.slice(-600)),
        child.exitCode === null ? 0 : child.exitCode);
      return;
    }
    // A clean exit after the window was really displayed means the user closed
    // it right away. Opening an Edge window on top of that would be a surprise
    // second window, so report the (short-lived) WebView2 window.
    const reachedLoop = traceText.includes("form displayed osVisible=True")
      && !traceText.includes("closing the form")
      && !traceText.includes("exception at")
      && child.exitCode === 0;
    if (reachedLoop) {
      nativeWindowLog("info", "webview2 window opened and closed immediately session=" + sessionId);
      respond(res, 200, { ok: true, mode: "native", platform: process.platform, engine: "webview2", closed: true });
      return;
    }
    const webview2Why = traceText === ""
      ? "the WebView2 helper exited before its window was up and wrote no trace"
        + " (PowerShell may not have run the script: check -ExecutionPolicy, path and args)"
      : "the WebView2 helper exited before its window was up: " + traceText.slice(-1200);
    nativeWindowLog("warn", "webview2 helper failed, trying the Edge app window: " + webview2Why);
    openEdgeAppWindow(res, sessionId, url, webview2Why, child.exitCode);
  }).catch((error) => {
    // The response must always settle, or the client toast hangs on "opening".
    nativeWindowLog("warn", "could not evaluate the system window startup: " + String(error));
    respond(res, 200, {
      ok: false,
      error: "window-failed",
      platform: process.platform,
      detail: redactNativeWindowText(String(error)).slice(0, 600),
    });
  });
}

/**
 * Windows fallback when the WebView2 helper dies: Microsoft Edge in app mode
 * opens the same authenticated client as a chromeless, independent OS window.
 * Edge ships with Windows 10/11, so this keeps the feature usable on machines
 * where the PowerShell/WebView2 host cannot start.
 */
function openEdgeAppWindow(res, sessionId, authenticatedUrl, webview2Why, webview2Code) {
  const edgePath = findEdgeExecutable();
  nativeWindowLog("info", "trying the Edge app window fallback: edge=" + String(edgePath));
  if (edgePath === null) {
    respond(res, 200, {
      ok: false,
      error: webview2Code === 3 ? "webview2" : "window-failed",
      platform: process.platform,
      detail: (webview2Why + " | Microsoft Edge was not found, so the app-window fallback is unavailable").slice(0, 900),
      engines: ["webview2"],
    });
    return;
  }
  const profileDir = createEdgeProfileDir();
  if (profileDir === null) {
    respond(res, 200, {
      ok: false,
      error: "window-failed",
      platform: process.platform,
      detail: (webview2Why + " | could not create the Edge profile directory").slice(0, 900),
      engines: ["webview2"],
    });
    return;
  }
  const command = edgeAppWindowCommand(process.platform, authenticatedUrl, sessionId, { edgePath, profileDir });
  if (command === null) {
    try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
    respond(res, 200, {
      ok: false,
      error: "window-failed",
      platform: process.platform,
      detail: (webview2Why + " | the Edge app-window command could not be built").slice(0, 900),
      engines: ["webview2"],
    });
    return;
  }
  let child;
  try {
    // Edge is a GUI process, so there is no console to hide — and hiding it
    // would hand it STARTF_USESHOWWINDOW|SW_HIDE, the exact trap that made the
    // WebView2 form invisible. Never hide the window we are trying to open.
    child = spawn(command.command, command.args, {
      detached: false,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
    respond(res, 200, {
      ok: false,
      error: "window-failed",
      platform: process.platform,
      detail: (webview2Why + " | could not start Microsoft Edge: " + String(error)).slice(0, 900),
      engines: ["webview2"],
    });
    return;
  }
  child.dsvProfileDir = profileDir;
  trackNativeWindow(sessionId, child, "edge", null);
  waitForEarlyExit(child, NATIVE_WINDOW_EDGE_STARTUP_MS).then((exited) => {
    if (exited !== true) {
      nativeWindowLog("info", "system window opened through the Edge app-window fallback session=" + sessionId);
      respond(res, 200, {
        ok: true,
        mode: "native",
        platform: process.platform,
        engine: "edge",
        fallback: true,
      });
      return;
    }
    // "exit" can beat the last stderr chunk through the pipes; wait a tick so
    // the failure detail carries Edge's real last words.
    setTimeout(() => {
      const edgeTrace = redactNativeWindowText(String(child.dsvOutput?.() ?? "")).trim();
      respond(res, 200, {
        ok: false,
        error: webview2Code === 3 ? "webview2" : "window-failed",
        platform: process.platform,
        detail: [
          webview2Why,
          "Microsoft Edge exited before its app window was up: "
            + (edgeTrace === "" ? "(no output)" : edgeTrace.slice(-600)),
        ].join(" | ").slice(0, 1200),
        engines: ["webview2", "edge"],
      });
    }, 250);
  }).catch((error) => {
    nativeWindowLog("warn", "could not evaluate the Edge app window startup: " + String(error));
    respond(res, 200, {
      ok: false,
      error: "window-failed",
      platform: process.platform,
      detail: redactNativeWindowText(String(error)).slice(0, 600),
    });
  });
}

/** Close one session's native window, if it is still open. */
function closeNativeSystemWindow(res, sessionId) {
  const child = nativeWindows.get(sessionId);
  if (child === undefined) {
    respond(res, 200, { ok: true, mode: "native", closed: false });
    return;
  }
  nativeWindows.delete(sessionId);
  respond(res, 200, { ok: true, mode: "native", closed: killNativeWindow(child) });
}

/** Read a bounded JSON body and hand back one validated window request. */
function readWindowRequest(req, done) {
  let body = "";
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    done(value);
  };
  req.on("data", (chunk) => {
    if (settled) return;
    body += chunk;
    if (body.length > 8192) {
      finish(undefined);
      try { req.destroy(); } catch {}
    }
  });
  req.on("end", () => {
    if (settled) return;
    let sessionId;
    let action = "open";
    try {
      const parsed = JSON.parse(body === "" ? "{}" : body);
      if (parsed !== null && typeof parsed === "object") {
        if (typeof parsed.sessionId === "string") sessionId = parsed.sessionId;
        if (parsed.action === "close") action = "close";
      }
    } catch {}
    finish(typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId)
      ? { sessionId, action }
      : undefined);
  });
  req.on("error", () => { finish(undefined); });
}

/** POSIX single-quote escaping for one shell word. */
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/**
 * The detached command that closes DSH and opens it again.
 *
 * macOS asks the application to quit through AppleScript, so DSH's own quit
 * confirmation (running tasks) still runs. Windows has no comparable public
 * quit entry, so it closes the main window and then terminates the process;
 * the renderer warns before calling this route.
 */
export function restartCommand() {
  const pid = process.ppid;
  const executable = process.execPath;
  if (process.platform === "darwin") {
    const appBundle = resolve(executable, "../../..");
    return {
      command: "/bin/sh",
      args: ["-c", [
        "sleep 1",
        `osascript -e 'tell application id "com.deepseek.dsh" to quit' >/dev/null 2>&1 || kill -TERM ${pid} 2>/dev/null`,
        `n=0; while kill -0 ${pid} 2>/dev/null && [ $n -lt 120 ]; do n=$((n+1)); sleep 0.5; done`,
        `open ${shellQuote(appBundle)} >/dev/null 2>&1`,
      ].join("; ")],
    };
  }
  if (process.platform === "win32") {
    const script = [
      "Start-Sleep -Milliseconds 900",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      "if ($p) { $p.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 700 }",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      `if ($p) { Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue }`,
      `for ($i = 0; $i -lt 40; $i++) { if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }`,
      `Start-Process -FilePath '${String(executable).replace(/'/g, "''")}'`,
    ].join("; ");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    };
  }
  return {
    command: "/bin/sh",
    args: ["-c", [
      "sleep 1",
      `kill -TERM ${pid} 2>/dev/null`,
      `n=0; while kill -0 ${pid} 2>/dev/null && [ $n -lt 120 ]; do n=$((n+1)); sleep 0.5; done`,
      `setsid ${shellQuote(executable)} >/dev/null 2>&1 &`,
    ].join("; ")],
  };
}

/** Close and reopen the Desktop app without blocking the HTTP response. */
function scheduleRestart() {
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) return false;
  lastRestartAt = now;
  setTimeout(() => {
    try {
      const command = restartCommand();
      spawn(command.command, command.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } catch (error) {
      try { console.warn("[dsh-split-workspace] restart failed:", error); } catch {}
    }
  }, 250);
  return true;
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  // A Host shutdown should not leave standalone OS windows behind.
  if (!nativeWindowExitHook) {
    nativeWindowExitHook = true;
    process.once("exit", () => {
      for (const child of nativeWindows.values()) {
        try { killNativeWindow(child); } catch {}
      }
    });
  }
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() => {
      const disposeVersion = webCtx.webServer.register({
        kind: "exact",
        path: VERSION_PATH,
        handler: (req, res) => {
          if (req.method !== "GET" && req.method !== "HEAD") {
            respond(res, 405, { ok: false, error: "method" });
            return;
          }
          const version = packageVersion();
          if (version === null) {
            respond(res, 503, { ok: false, error: "version" });
            return;
          }
          respond(res, 200, { ok: true, version });
        },
      });
      const disposeRestart = webCtx.webServer.register({
        kind: "exact",
        path: RESTART_PATH,
        handler: (req, res) => {
          if (req.method !== "POST") {
            respond(res, 405, { ok: false, error: "method" });
            return;
          }
          if (!requestOriginAllowed(req)) {
            respond(res, 403, { ok: false, error: "origin" });
            return;
          }
          if (req.headers["x-dsv-restart"] !== "1") {
            respond(res, 403, { ok: false, error: "confirm" });
            return;
          }
          if (!runningInDesktop()) {
            respond(res, 200, { ok: false, mode: "web", error: "not-desktop" });
            return;
          }
          const scheduled = scheduleRestart();
          respond(res, 200, { ok: true, mode: "desktop", platform: process.platform, pending: scheduled !== true });
        },
      });
      const disposeHelpAssets = webCtx.webServer.register({
        kind: "prefix",
        path: HELP_ASSET_PATH,
        handler: (req, res) => {
          if (req.method !== "GET" && req.method !== "HEAD") {
            respond(res, 405, { ok: false, error: "method" });
            return;
          }
          let name = "";
          try {
            name = decodeURIComponent(new URL(req.url, "http://dsh.invalid").pathname.slice(HELP_ASSET_PATH.length)).replace(/^\/+/, "");
          } catch {}
          if (!Object.prototype.hasOwnProperty.call(HELP_ASSETS, name)) {
            respond(res, 404, { ok: false, error: "asset" });
            return;
          }
          try {
            const data = readFileSync(new URL(HELP_ASSETS[name], HELP_ASSET_DIR));
            res.writeHead(200, {
              "content-type": "image/png",
              "content-length": data.length,
              "cache-control": "public, max-age=3600",
            });
            res.end(req.method === "HEAD" ? undefined : data);
          } catch (error) {
            nativeWindowLog("warn", "help asset missing: " + HELP_ASSETS[name]);
            respond(res, 404, { ok: false, error: "asset" });
          }
        },
      });
      const disposeNativeWindow = webCtx.webServer.register({
        kind: "exact",
        path: NATIVE_WINDOW_PATH,
        handler: (req, res) => {
          if (req.method !== "POST" && req.method !== "GET") {
            respond(res, 405, { ok: false, error: "method" });
            return;
          }
          if (!requestOriginAllowed(req)) {
            respond(res, 403, { ok: false, error: "origin" });
            return;
          }
          if (req.headers[NATIVE_WINDOW_CONFIRM] !== "1") {
            respond(res, 403, { ok: false, error: "confirm" });
            return;
          }
          if (!runningInDesktop()) {
            respond(res, 200, { ok: false, mode: "web", error: "not-desktop" });
            return;
          }
          if (req.method === "GET") {
            respond(res, 200, {
              ok: true,
              mode: "native",
              platform: process.platform,
              sessions: nativeWindowSessions(),
            });
            return;
          }
          readWindowRequest(req, (request) => {
            if (request === undefined) {
              respond(res, 400, { ok: false, error: "session" });
              return;
            }
            if (request.action === "close") {
              if (!nativeWindowSupported(process.platform)) {
                respond(res, 200, { ok: false, error: "unsupported-platform", platform: process.platform });
                return;
              }
              closeNativeSystemWindow(res, request.sessionId);
              return;
            }
            openNativeSystemWindow(webCtx, res, request.sessionId);
          });
        },
      });
      const disposeNativeWindowLog = webCtx.webServer.register({
        kind: "exact",
        path: NATIVE_WINDOW_LOG_PATH,
        handler: (req, res) => {
          if (req.method !== "GET" && req.method !== "HEAD") {
            respond(res, 405, { ok: false, error: "method" });
            return;
          }
          if (!requestOriginAllowed(req)) {
            respond(res, 403, { ok: false, error: "origin" });
            return;
          }
          if (req.headers[NATIVE_WINDOW_CONFIRM] !== "1") {
            respond(res, 403, { ok: false, error: "confirm" });
            return;
          }
          // `window.__dshSplitWorkspace.systemWindowLog()` reads this when a
          // window fails, so users never have to find %TEMP% by hand.
          respond(res, 200, {
            ok: true,
            platform: process.platform,
            path: NATIVE_WINDOW_LOG,
            log: nativeWindowLogTail(NATIVE_WINDOW_LOG_TAIL_LIMIT),
          });
        },
      });
      return () => {
        try { disposeVersion(); } catch {}
        try { disposeRestart(); } catch {}
        try { disposeHelpAssets(); } catch {}
        try { disposeNativeWindow(); } catch {}
        try { disposeNativeWindowLog(); } catch {}
      };
    }, "split-workspace: host routes");
  });
}
