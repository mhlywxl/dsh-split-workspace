/**
 * Native system windows: an AppKit NSWindow hosted by the system WebView on
 * macOS (osascript), or a WinForms window hosting the WebView2 control on
 * Windows. When the Windows helper cannot show a window, an Edge app-mode
 * window opens the same authenticated client instead.
 *
 * Every helper runs with its own per-window profile/trace; the authenticated
 * URL is handed to a same-user local process and never returned to the renderer.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NATIVE_WINDOW_EDGE_PROFILE_PREFIX,
  NATIVE_WINDOW_EDGE_STARTUP_MS,
  NATIVE_WINDOW_LOG,
  NATIVE_WINDOW_SCRIPT,
  NATIVE_WINDOW_SCRIPT_WIN,
  NATIVE_WINDOW_VISIBLE_MS,
  NATIVE_WINDOW_WEBVIEW2_DIR,
  SESSION_ID_PATTERN,
} from "./constants.js";
import { respond } from "./http.js";
import {
  helperLogPath,
  nativeWindowLog,
  readTextTail,
  redactNativeWindowText,
  sweepNativeWindowArtifacts,
  trimNativeWindowLog,
} from "./log.js";
import { nativeWindowSupported } from "./platform.js";

/** Live helper processes by session id, so a Host shutdown closes the windows. */
const nativeWindows = new Map();
let nativeWindowExitHook = false;

/** Session ids that currently have a live native window. */
export function nativeWindowSessions() {
  const sessions = [];
  for (const [sessionId, child] of nativeWindows) {
    if (child.exitCode === null && child.signalCode === null) sessions.push(sessionId);
  }
  return sessions;
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

/** Directories of windows that are still alive; their artifacts must survive. */
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
export function openNativeSystemWindow(webCtx, res, sessionId) {
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
  sweepNativeWindowArtifacts(liveNativeWindowArtifacts());
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
export function closeNativeSystemWindow(res, sessionId) {
  const child = nativeWindows.get(sessionId);
  if (child === undefined) {
    respond(res, 200, { ok: true, mode: "native", closed: false });
    return;
  }
  nativeWindows.delete(sessionId);
  respond(res, 200, { ok: true, mode: "native", closed: killNativeWindow(child) });
}

/** Close every live helper; installed once per Host process by apply(). */
export function installNativeWindowExitHook() {
  if (nativeWindowExitHook) return;
  nativeWindowExitHook = true;
  process.once("exit", () => {
    for (const child of nativeWindows.values()) {
      try { killNativeWindow(child); } catch {}
    }
  });
}
