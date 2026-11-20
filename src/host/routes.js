/**
 * The Host's HTTP routes. Every route is registered through the web server
 * service and disposed with the owning Cordis effect, so disabling the bundle
 * removes the endpoints instead of leaving live handlers behind.
 *
 * Route summary:
 * - `GET /dsv/version` — the on-disk plugin version, so a running page notices
 *   a freshly installed bundle;
 * - `POST /dsv/restart` — quit and relaunch the Desktop app (production builds
 *   expose no in-app restart entry);
 * - `GET /dsv/help/*` — help-card screenshots served same-origin;
 * - `/dsv/system-window` — open/close/list the native system windows;
 * - `GET /dsv/system-window-log` — bounded diagnostics, tokens redacted.
 */
import { readFileSync } from "node:fs";
import {
  HELP_ASSET_DIR,
  HELP_ASSET_PATH,
  HELP_ASSETS,
  NATIVE_WINDOW_CONFIRM,
  NATIVE_WINDOW_LOG,
  NATIVE_WINDOW_LOG_PATH,
  NATIVE_WINDOW_LOG_TAIL_LIMIT,
  NATIVE_WINDOW_PATH,
  RESTART_PATH,
  VERSION_PATH,
} from "./constants.js";
import { readWindowRequest, requestOriginAllowed, respond } from "./http.js";
import { nativeWindowLog, nativeWindowLogTail } from "./log.js";
import { packageVersion } from "./package-version.js";
import { nativeWindowSupported, runningInDesktop } from "./platform.js";
import { scheduleRestart } from "./restart.js";
import {
  closeNativeSystemWindow,
  nativeWindowSessions,
  openNativeSystemWindow,
} from "./system-window.js";

/** Register every Host route; returns one disposer for the whole table. */
export function registerRoutes(webCtx) {
  const disposers = [];

  disposers.push(webCtx.webServer.register({
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
  }));

  disposers.push(webCtx.webServer.register({
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
  }));

  disposers.push(webCtx.webServer.register({
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
  }));

  disposers.push(webCtx.webServer.register({
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
  }));

  disposers.push(webCtx.webServer.register({
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
      // `window.__dshSplitWorkspace.systemWindowLog()` reads this when a window
      // fails, so users never have to find %TEMP% by hand.
      respond(res, 200, {
        ok: true,
        platform: process.platform,
        path: NATIVE_WINDOW_LOG,
        log: nativeWindowLogTail(NATIVE_WINDOW_LOG_TAIL_LIMIT),
      });
    },
  }));

  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch {}
    }
  };
}