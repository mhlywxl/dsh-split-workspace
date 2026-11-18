/**
 * Host half of dsh-split-workspace.
 *
 * DSH Desktop runs this Host in a Node child process with no Electron APIs, and
 * its main window denies `window.open` (http/https goes to the system browser).
 * The Host therefore cannot create a native window; the one-conversation
 * "independent window" lives in the client as a first-class in-app surface.
 *
 * This half adds the two actions a renderer cannot perform alone:
 * - it serves the on-disk plugin version, so a running page notices a freshly
 *   installed bundle;
 * - it closes and reopens the Desktop app, because production DSH builds have
 *   no in-app restart entry (the split menu and update chip call this).
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION_PATH = "/dsv/version";
const RESTART_PATH = "/dsv/restart";
/** The Desktop app has no in-app restart entry in production builds; this
    route recreates that one action at the OS level. */
const RESTART_COOLDOWN_MS = 15000;
let lastRestartAt = 0;

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
          const origin = req.headers.origin;
          if (typeof origin === "string" && origin !== "" && origin !== "dsh-app://app"
              && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu.test(origin)) {
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
      return () => {
        try { disposeVersion(); } catch {}
        try { disposeRestart(); } catch {}
      };
    }, "split-workspace: host routes");
  });
}