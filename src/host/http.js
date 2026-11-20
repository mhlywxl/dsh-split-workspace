/**
 * Small HTTP helpers shared by the Host routes: JSON responses, same-origin
 * checks, and the bounded body reader for system-window requests.
 */
import { SESSION_ID_PATTERN } from "./constants.js";

export function respond(res, status, value) {
  try {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  } catch {}
}

/** Allow the application origin and local web clients, never a foreign site. */
export function requestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return true;
  return origin === "dsh-app://app"
    || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu.test(origin);
}

/** Read a bounded JSON body and hand back one validated window request. */
export function readWindowRequest(req, done) {
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
