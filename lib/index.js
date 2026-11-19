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
 *   with a hash marker; the renderer never receives the launch token.
 */

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATH = "/dsv/version";
const RESTART_PATH = "/dsv/restart";
const NATIVE_WINDOW_PATH = "/dsv/system-window";
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
/** How long a Windows helper may run before the window counts as opening. */
const NATIVE_WINDOW_STARTUP_MS = 1500;
const NATIVE_WINDOW_LOG = resolve(tmpdir(), "dsh-split-workspace-system-window.log");
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

/**
 * The detached helper command for one system window. The authenticated URL is
 * handed to a same-user local process (an osascript argument on macOS, a
 * base64 argument on Windows) and is never returned to the renderer.
 */
export function systemWindowCommand(platform, authenticatedUrl, sessionId) {
  if (typeof authenticatedUrl !== "string" || authenticatedUrl === "") return null;
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
  const target = authenticatedUrl + "#dsv-system-window=" + encodeURIComponent(sessionId);
  if (platform === "darwin") {
    return {
      command: "/usr/bin/osascript",
      args: ["-l", "JavaScript", NATIVE_WINDOW_SCRIPT, target],
    };
  }
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", NATIVE_WINDOW_SCRIPT_WIN,
        "-UrlB64", Buffer.from(target, "utf8").toString("base64"),
        "-WebView2Dir", NATIVE_WINDOW_WEBVIEW2_DIR,
      ],
    };
  }
  return null;
}

/** Resolve true only when the helper dies before its window is up. */
function waitForEarlyExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    child.once("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    });
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
    respond(res, 200, { ok: true, mode: "native", platform: process.platform, reused: true });
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
  const command = systemWindowCommand(process.platform, url, sessionId);
  if (command === null) {
    nativeWindowLog("warn", "unsupported system window command on " + process.platform);
    respond(res, 500, { ok: false, error: "spawn" });
    return;
  }
  let child;
  try {
    const logFd = openSync(NATIVE_WINDOW_LOG, "a");
    try {
      child = spawn(command.command, command.args, {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", logFd, logFd],
      });
    } finally {
      closeSync(logFd);
    }
  } catch (error) {
    nativeWindowLog("warn", "could not spawn the system window: " + String(error));
    respond(res, 500, { ok: false, error: "spawn" });
    return;
  }
  nativeWindows.set(sessionId, child);
  child.once("exit", (code) => {
    if (nativeWindows.get(sessionId) === child) nativeWindows.delete(sessionId);
    if (code !== 0) nativeWindowLog("warn", "system window exited with code " + String(code));
  });
  child.once("error", (error) => {
    if (nativeWindows.get(sessionId) === child) nativeWindows.delete(sessionId);
    nativeWindowLog("warn", "system window process error: " + String(error));
  });
  child.unref();
  if (process.platform !== "win32") {
    respond(res, 200, { ok: true, mode: "native", platform: process.platform });
    return;
  }
  // The Windows helper has to start PowerShell and load WebView2: a missing
  // Runtime or broken helper exits within the startup window, and the user
  // deserves the reason instead of a success toast.
  waitForEarlyExit(child, NATIVE_WINDOW_STARTUP_MS).then((exited) => {
    if (exited === true) {
      respond(res, 200, {
        ok: false,
        error: child.exitCode === 3 ? "webview2" : "window-failed",
        platform: process.platform,
      });
      return;
    }
    respond(res, 200, { ok: true, mode: "native", platform: process.platform });
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
      return () => {
        try { disposeVersion(); } catch {}
        try { disposeRestart(); } catch {}
        try { disposeHelpAssets(); } catch {}
        try { disposeNativeWindow(); } catch {}
      };
    }, "split-workspace: host routes");
  });
}
