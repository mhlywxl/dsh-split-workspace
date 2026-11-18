/**
 * Host half of dsh-split-workspace.
 *
 * The split workspace itself lives entirely in the browser. This half adds the
 * one thing a renderer cannot build on its own: a URL for a REAL separate
 * window that shows a single conversation.
 *
 * Why a URL and not a BrowserWindow: DSH Desktop runs this Host in a Node child
 * process (no Electron APIs), and its main window denies `window.open` except
 * for http/https, which it forwards to the system browser. The Host therefore
 * returns the authenticated Web GUI URL (`?token=…`) with a `#dsvWindow=<id>`
 * marker; the renderer opens it, and the client half renders only that one
 * conversation inside the new system window. In the Web profile the same route
 * works and `window.open` opens a normal browser window.
 *
 * It also serves the on-disk plugin version so a running page can notice a
 * freshly installed bundle, and it can close and reopen the Desktop app: DSH
 * production builds have no in-app restart entry, so the split menu's
 * "Restart DSH" action asks this Host to perform the OS-level quit and
 * relaunch (the Host is a Node child of the Electron shell).
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_PATH = "/dsv/system-window";
const VERSION_PATH = "/dsv/version";
const RESTART_PATH = "/dsv/restart";
const MAX_BODY_BYTES = 64 * 1024;
/** The Desktop app has no in-app restart entry in production builds; this
    route recreates that one action at the OS level. */
const RESTART_COOLDOWN_MS = 15000;
let lastRestartAt = 0;
const SESSION_ID = /^[A-Za-z0-9._:@+-]+$/;
const MAX_SESSION_ID_LENGTH = 256;

/** The plugin version currently on disk (not the one this process loaded). */
function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : null;
  } catch {
    return null;
  }
}

/** Read and JSON-parse a small request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text === "" ? {} : JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
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
  const getService = (name) => {
    try {
      return typeof ctx.get === "function" ? ctx.get(name) : undefined;
    } catch {
      return undefined;
    }
  };

  /** The current authenticated Web GUI URL with the standalone-window marker. */
  const standaloneUrl = (sessionId) => {
    const app = getService("webApp");
    const connection = getService("connection");
    const origin = app !== null && app !== undefined && typeof app.getAdvertisedUrl === "function"
      ? app.getAdvertisedUrl()
      : null;
    if (typeof origin !== "string" || origin === "") return null;
    let base = origin;
    if (connection !== null && connection !== undefined && typeof connection.authenticatedUrl === "function") {
      const authenticated = connection.authenticatedUrl(origin);
      if (typeof authenticated === "string" && authenticated !== "") base = authenticated;
    }
    const url = new URL(base);
    url.hash = "dsvWindow=" + encodeURIComponent(sessionId);
    return url.href;
  };

  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() => {
      const disposeWindow = webCtx.webServer.register({
        kind: "exact",
        path: ROUTE_PATH,
        handler: async (req, res) => {
          if (req.method !== "POST") {
            respond(res, 405, { ok: false, error: "method" });
            return;
          }
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            respond(res, 400, { ok: false, error: "body" });
            return;
          }
          const sessionId = body !== null && typeof body === "object" ? body.sessionId : undefined;
          if (typeof sessionId !== "string" || sessionId === "" || sessionId.length > MAX_SESSION_ID_LENGTH || !SESSION_ID.test(sessionId)) {
            respond(res, 400, { ok: false, error: "session" });
            return;
          }
          try {
            const url = standaloneUrl(sessionId);
            if (url === null) {
              respond(res, 503, { ok: false, error: "unavailable" });
              return;
            }
            respond(res, 200, { ok: true, url });
          } catch (error) {
            respond(res, 500, { ok: false, error: String(error !== null && error !== undefined && error.message !== undefined ? error.message : error).slice(0, 200) });
          }
        },
      });
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
        try { disposeWindow(); } catch {}
        try { disposeVersion(); } catch {}
        try { disposeRestart(); } catch {}
      };
    }, "split-workspace: host routes");
  });
}