// dsh-split-workspace — browser half (module-loader bundle)
//
// ARCHITECTURE MAP (top → bottom):
//   constants + locale / stylesheet / icons
//   split-tree store (persistence, activation gate: isActive = >= 2 panes)
//   root standard faces (harvested from this plugin's shell.overlay seat)
//   session list sources (0.1.x store / 0.2.0 bounded DOM adapter)
//   0.2.0 session bindings + pane readiness
//   slot capture & re-host kit (prepareNative, renderers, PaneBoundary)
//   native pane components (transcript / header / composer / TUI line)
//   fallback transcript + composer (zero-capture renderers)
//   pane frame + drop zones + canvas/dividers
//   rail/session picker, focus resolution, global chords (ctx-effect owned)
//   inactive-mode drag bridge (split entry while the overlay is off)
//   WorkspaceApp (activation-gated overlay) + plugin apply()
//
// ACTIVATION MODEL (v1.4.0): the workspace is SPLIT-ONLY. With zero or one
// pane the plugin renders NOTHING — the stock conversation view keeps the
// viewport, every stock control (workspace chooser, agent-preset hero) stays
// reachable, and no observer/session-staging exists. The overlay takes over
// only with two or more panes, is constrained to the measured conversation
// column (all four edges, fail-closed), and hands the viewport back when the
// second-to-last pane closes. Entry points: drag a conversation from the
// sidebar onto the conversation column (drag bridge), drop onto a pane edge,
// or the pane-header split buttons.
//
// Panes re-host the REAL native UI: the plugin captures the registered slot
// entries (the stock ChatView, the stock InputBar, the keyed chat-node
// renderers, the model/plan/attachment seats, and plugin contributions like
// the results-only toggle and the stats line) through ctx.slots.entries(),
// then re-composes their props per pane. The ui-conversation inject faces
// are (sessionId) => ... factories, so every pane gets its own real input
// machine (inputHub.shell(sessionId)), real tool rows, real model chip, and
// real plugin chrome — the composer behaves exactly like the main window's,
// including Enter/steer semantics, notices, slash menu, and attachments.
// Every captured render sits behind an error boundary with a built-in
// fallback renderer, so an upstream change degrades gracefully instead of
// crashing the workspace.
//
// RESOURCE CONTRACT (v1.4.0): while INACTIVE the plugin's steady-state cost
// is zero observers, zero session staging, zero DOM scraping. While ACTIVE,
// every observer path is bounded — the DOM session-list adapter throttles to
// >=200ms with rAF coalescing and textContent (never innerText), the
// composer-geometry settle loops exit on stable geometry, TUI panes mount no
// measurement observers, and the Lexical editor-root guard is rate-limited
// with a circuit breaker so a contested root can never ping-pong the editor
// DOM into a freeze.
//
// Session faces come from ctx.sessions.binding(id).session (+ the `open()`
// staging bridge documented in multiple-chat-panels' FUTURE_UPSTREAM.md).
// The split tree (horizontal + vertical, recursive) persists to
// localStorage. All side effects ride ctx.effect disposers.

window.__ModuleLoader__.load({
  id: "dsh-split-workspace",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let React = require("react");
    if (React === null || typeof React !== "object") {
      throw new Error("dsh-split-workspace: react is unavailable");
    }
    if (React.useState === undefined && React.default !== undefined && typeof React.default === "object") {
      React = React.default;
    }
    const h = React.createElement;

    const P = require("@deepseek-ai/dsh-client-ui-primitives") || {};

