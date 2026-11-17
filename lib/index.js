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
 * freshly installed bundle and offer "reload interface" instead of requiring a
 * full DSH restart.
 */

import { readFileSync } from "node:fs";

const ROUTE_PATH = "/dsv/system-window";
const VERSION_PATH = "/dsv/version";
const MAX_BODY_BYTES = 64 * 1024;
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
      return () => {
        try { disposeWindow(); } catch {}
        try { disposeVersion(); } catch {}
      };
    }, "split-workspace: host routes");
  });
}