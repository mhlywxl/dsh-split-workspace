/**
 * Host half of dsh-split-workspace.
 *
 * The whole feature lives in the browser: the top page owns the split shell and
 * re-hosts the stock conversation primitives for each pane's session, in-process.
 * This half exists so the bundle owns a real Loader row, which is what the
 * Plugin Manager and the Settings inventory display.
 */

/** @param {import('@deepseek-ai/cordis').Context} _ctx */
export function apply(_ctx) {}
