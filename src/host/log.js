/**
 * The Host's append-only diagnostic log. Launch tokens are redacted here, so a
 * bug report or the diagnostics route can never persist a live token.
 */
import { appendFileSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  NATIVE_WINDOW_ARTIFACT_TTL_MS,
  NATIVE_WINDOW_EDGE_PROFILE_PREFIX,
  NATIVE_WINDOW_HELPER_LOG_PREFIX,
  NATIVE_WINDOW_LOG,
  NATIVE_WINDOW_LOG_MAX_BYTES,
  NATIVE_WINDOW_LOG_TAIL_LIMIT,
} from "./constants.js";

/** Last `limit` characters of a text file, or "" when it is unavailable. */
export function readTextTail(path, limit) {
  try {
    const text = readFileSync(path, "utf8");
    return text.slice(Math.max(0, text.length - limit));
  } catch {
    return "";
  }
}

/** Long base64/base64url runs are launch tokens: never persist them in the log.
    DSH mints tokens with the URL-safe alphabet (`-`/`_` as well as `+`/`/`), so
    a standard-base64-only pattern would leave ~73% of tokens partly readable. */
export function redactNativeWindowText(text) {
  return String(text).replace(/[A-Za-z0-9+/_-]{40,}={0,2}/gu, "<redacted>");
}

/** Append one diagnostic line; never include the tokenized URL. */
export function nativeWindowLog(level, message) {
  try {
    appendFileSync(NATIVE_WINDOW_LOG, `[${new Date().toISOString()}] ${level} ${message}\n`);
  } catch {}
}

/** The Host log tail used by the diagnostics route and failure details. */
export function nativeWindowLogTail(limit = NATIVE_WINDOW_LOG_TAIL_LIMIT) {
  return redactNativeWindowText(readTextTail(NATIVE_WINDOW_LOG, limit)).trim();
}

/** A unique helper trace path, so concurrent windows keep separate traces. */
export function helperLogPath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 40);
  return resolve(tmpdir(), NATIVE_WINDOW_HELPER_LOG_PREFIX + safe + "-" + Date.now().toString(36) + ".log");
}

/** Keep the append-only Host log bounded; the tail is the useful history. */
export function trimNativeWindowLog() {
  try {
    if (statSync(NATIVE_WINDOW_LOG).size > NATIVE_WINDOW_LOG_MAX_BYTES) {
      const text = readFileSync(NATIVE_WINDOW_LOG, "utf8");
      writeFileSync(NATIVE_WINDOW_LOG, text.slice(-NATIVE_WINDOW_LOG_TAIL_LIMIT));
    }
  } catch {}
}

/** Delete profiles and traces left behind by force-killed windows. */
export function sweepNativeWindowArtifacts(live = new Set()) {
  const deadline = Date.now() - NATIVE_WINDOW_ARTIFACT_TTL_MS;
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
