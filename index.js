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
 *   Windows helper cannot show a window, an Edge app-mode window opens the same
 *   client, and the failure reasons are logged.
 *
 * The implementation lives in `src/host/`: route wiring, HTTP helpers, the
 * native-window engine, logging, restart, and platform facts. This entry keeps
 * the plugin contract (`apply`) and re-exports the helpers that `test.mjs` and
 * external diagnostics use.
 */
import { registerRoutes } from "./src/host/routes.js";
import { installNativeWindowExitHook } from "./src/host/system-window.js";

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  // A Host shutdown should not leave standalone OS windows behind.
  installNativeWindowExitHook();
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() => registerRoutes(webCtx), "split-workspace: host routes");
  });
}

export {
  edgeAppWindowCommand,
  edgeExecutableCandidates,
  findEdgeExecutable,
  nativeWindowSessions,
  systemWindowCommand,
  systemWindowTarget,
  windowsPowerShellCandidates,
  windowsPowerShellPath,
} from "./src/host/system-window.js";
export { nativeWindowSupported } from "./src/host/platform.js";
export { redactNativeWindowText } from "./src/host/log.js";
export { restartCommand } from "./src/host/restart.js";