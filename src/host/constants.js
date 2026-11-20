/**
 * Host constants: route paths, native-window helper locations and limits, and
 * the session-id alphabet shared with the client (src/client/tree.js).
 */
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION_PATH = "/dsv/version";
export const RESTART_PATH = "/dsv/restart";
export const NATIVE_WINDOW_PATH = "/dsv/system-window";
/** Diagnostics: serve this Host's system-window log (launch tokens redacted). */
export const NATIVE_WINDOW_LOG_PATH = "/dsv/system-window-log";
/** Help-card screenshots shipped in docs/screenshots and served same-origin. */
export const HELP_ASSET_PATH = "/dsv/help";
export const HELP_ASSET_DIR = new URL("../../docs/screenshots/", import.meta.url);
export const HELP_ASSETS = {
  "session-menu.png": "help-session-menu.png",
  "footer-menu.png": "help-footer-menu.png",
  "settings.png": "help-settings.png",
};
/** Header a same-page action must send; blocks cross-site form posts. */
export const NATIVE_WINDOW_CONFIRM = "x-dsv-system-window";
export const NATIVE_WINDOW_SCRIPT = fileURLToPath(new URL("../../native/system-window.jxa", import.meta.url));
/** Windows counterpart: a WinForms window hosting the WebView2 control. */
export const NATIVE_WINDOW_SCRIPT_WIN = fileURLToPath(new URL("../../native/system-window.ps1", import.meta.url));
/** Vendored WebView2 SDK assets (BSD-3-Clause; see THIRD-PARTY-NOTICES.md). */
export const NATIVE_WINDOW_WEBVIEW2_DIR = fileURLToPath(new URL("../../native/webview2", import.meta.url));
/** How long a Windows helper may take to put a visible window on screen.
    Windows PowerShell itself can need seconds to start on a cold machine, and
    the answer the user sees must be "the window is really there", not "the
    process has not died yet" (0.14.2 reported success for an invisible window). */
export const NATIVE_WINDOW_VISIBLE_MS = 20000;
/** Microsoft Edge needs longer than the helper: it boots a full browser. */
export const NATIVE_WINDOW_EDGE_STARTUP_MS = 3000;
/** The Host's append-only diagnostic log (shared by every window attempt). */
export const NATIVE_WINDOW_LOG = resolve(tmpdir(), "dsh-split-workspace-system-window.log");
/** The Windows helper writes its own trace here; it survives a broken stderr. */
export const NATIVE_WINDOW_HELPER_LOG_PREFIX = "dsh-split-workspace-system-window-helper-";
/** Temp WebView2 profiles and Edge app-window profiles share this prefix. */
export const NATIVE_WINDOW_PROFILE_PREFIX = "dsh-split-workspace-system-window-";
/** Edge app-window profiles: one per window, deleted when that window closes. */
export const NATIVE_WINDOW_EDGE_PROFILE_PREFIX = "dsh-split-workspace-edge-window-";
/** Artifacts older than this are leftovers from force-killed windows. */
export const NATIVE_WINDOW_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
/** How much of the Host log the diagnostics route returns. */
export const NATIVE_WINDOW_LOG_TAIL_LIMIT = 16000;
/** Rotate the append-only Host log once it grows past this size. */
export const NATIVE_WINDOW_LOG_MAX_BYTES = 512 * 1024;
/** The Desktop app has no in-app restart entry in production builds; this
    route recreates that one action at the OS level. */
export const RESTART_COOLDOWN_MS = 15000;
/** Client and Host agree on this session-id alphabet (see src/client/tree.js). */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._:@+-]{1,160}$/;
