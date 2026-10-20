# dsh-split-workspace

**Split screen for DeepSeek Harness (DSH) Desktop — open as many conversations
as you need, side by side, stacked, or in a 2×2 / automatic grid.**

`dsh-split-workspace` turns the DeepSeek Harness conversation area into a native
multi-pane workspace, including in the **Desktop app** (`dsh-app://` shell). Each
pane is a real session with its own composer, streaming, Stop, queue, todos,
attachments, `/` commands, `ask_user_question`, approvals and view tabs.

**中文简介**：把 DeepSeek Harness 的对话区拆成任意数量的原生窗格，支持左右分屏、
上下分屏、田字 2×2 和自动网格；每个窗格都是真实会话，拥有自己的输入框、流式输出、
停止、队列、待办、附件、斜杠命令、审批和视图页。适用于 DSH 桌面端。

**Search terms / 搜索关键词**：split screen, split view, split pane, multi-pane,
multi-session, multi-window, tiled workspace, unlimited panes, DSH Desktop,
分屏, 分屏插件, 多窗格, 多窗口, 多会话, 左右分屏, 上下分屏, 并排, 田字布局.

The pane engine is derived from
[dsh-split-screen](https://github.com/YEYEYEYESHIFU/dsh-split-screen) 1.7.0
(MIT). This package adapts it for the Desktop shell and adds the automatic
layout, the unlimited pane count, rename/copy/maximize and the compact toolbar.

## Screenshots

| 左右两列 · Side by side | 上下两列 · Stacked | 田字 · 2×2 grid |
| :-: | :-: | :-: |
| [![DeepSeek Harness split screen with two conversations side by side](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-side-by-side.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-side-by-side.png) | [![DeepSeek Harness split screen with two stacked conversations](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-stacked.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-stacked.png) | [![DeepSeek Harness 2×2 grid with four conversations](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-grid-2x2.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-grid-2x2.png) |
| 2 panes · automatic columns | 2 panes · dragged into rows | 4 panes · automatic 2×2 田字 |

Drag a pane by its header to re-arrange it — the dashed hole previews where it
will land:

![Dragging a DeepSeek Harness split pane by its header to create a stacked split](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/drag-pane.gif)

## Features

- **Unlimited native panes** — no four-pane cap; add as many conversations as
  the window can show.
- **Automatic layout** — 2 panes as columns, 3 as an L, 4 as a 2×2 田字, and
  5+ as a balanced row-major grid.
- **Any arrangement by drag** — drag a pane header left, right, above or below
  another pane; stack a pair or build columns by hand.
- **Native sessions, not iframes** — each pane re-hosts the stock conversation
  primitives, so composer, streaming, Stop, queue, todos, approvals and view
  tabs all work.
- **Desktop-ready** — built for the DSH Desktop shell (`dsh-app://`), where the
  preload only runs in the top frame.
- **Shared sidebar** — the stock sidebar follows the focused pane; drag a
  conversation onto the split to add or replace a pane.
- **Right sidebar control** — open and close with distinct icon states; the
  split toolbar owns the toggle.
- **Minimize / restore** — hide the split without losing the pane tree.
- **Persistent tree** — the layout you left comes back after a restart.

## Start

- Click the split icon in the sidebar footer (beside Settings) — it starts a
  split with the current conversation and the next listed one.
- Or drag a conversation from the sidebar onto the conversation column: the
  dropped conversation becomes the second pane.
- Once split, drag another conversation onto a pane to replace it, or use a
  pane header's split buttons to choose the session for a new pane.
- While a sidebar conversation is dragged over a pane edge, the panes lay
  themselves out as they will after the drop and a dashed placeholder names the
  incoming conversation — release to commit exactly that layout.

## Layout

- The automatic policy: 2 panes side by side, 3 as an L, 4 as a 2×2 grid, and
  5+ as a balanced row-major grid that grows by about `sqrt(n)` columns. There
  is no mode menu — adding or closing a pane simply re-fits the grid. For a
  stacked pair, drag the second pane's header over the first, then move down
  to the bottom edge; a deliberate drag is kept, and the automatic grid is
  only the starting point.
- Drag the dividers to resize.
- Drag a pane by its header to move it: the pane's slot closes immediately (the
  other panes fill the space) and a dashed hole opens where it will land — left,
  right, above or below the pane under the cursor, following the direction of
  the gesture. Release to drop; release over the pane's own slot, or press Esc,
  to cancel. The preview is geometry-only, so the live conversations are not
  remounted while you drag.
- Double-click a pane header (or use the ⤢ button) to maximize / restore.
- No fixed pane cap: add as many conversations as the window can show (the
  per-pane header compacts itself as panes get narrower).
- While a split exists the shared stock sidebar follows the focused pane; click
  a conversation to load it into that pane, or drag a conversation onto the
  split area to add/replace a pane.
- The pane tree persists across reloads and reopens with the layout you left
  (including a hand-made stacked or L-shaped arrangement). Adding or closing a
  pane re-fits the automatic grid; restarting does not.
- **Minimize** (toolbar) hides the split and shows the stock single-session
  view while keeping the pane tree. A "restore split" chip brings it back.
  Clicking **New Session** or a plugin/skills/settings panel minimizes the
  split automatically (so the new view is never covered); restoring returns to
  the focused pane's conversation.
- One title per pane: the pane header owns the title; the stock header keeps its
  view tabs and actions without repeating the breadcrumb. The close control is
  a drawn **✕** in a red-tinted button, not a low-contrast dot.
- If `dsh-prompt-history` is installed, its draggable **会话目录 (☰)** grip is
  shown **once per live pane, on the pane's left edge and vertically centered**.
  Every split adjustment (add, close, re-arrange, divider drag, maximize or a
  right-sidebar push) re-homes the affected grips to the left edge and the
  vertical center of their pane; a pane whose box did not change keeps a
  deliberate vertical drag. The copies mounted by the hidden stock conversation
  and by non-pane views are hidden, so the grips no longer stack on top of each
  other.
- The split toolbar's right-sidebar control has **two states**: a right chevron
  while the panel is closed (opens it) and an accent, left-chevron state while
  it is open (collapses it). A repair watcher catches the stock
  open/collapse buttons after a split is torn down, so a stale sidebar-right
  store can no longer swallow the click or hide the way back into the panel.
- Pane headers deliberately do **not** mount the stock per-pane rightbar seat
  (the split toolbar owns the toggle). That seat is session-scoped and carries
  its own store handle; mounting it inside every pane created a second
  sidebar-right store for the same session, which made the shared panel's tab
  icons look dead. The stock header keeps the single store.

## Why not one iframe per pane?

The Desktop app serves the client from `dsh-app://app/` and injects the boot
graph (`__DSH_BOOT__`, `__DSH_TRANSPORT__`, …) through the Electron preload.
That preload runs only in the top frame, so a same-origin iframe stays at
“Loading plugins…” forever. The pane engine therefore runs **in the top
client**, re-hosting the stock conversation primitives per session — the same
architecture the upstream plugin uses.

## Desktop use

The package targets the **desktop** profile (`dsh.client.platform: "web"` is the
platform the Desktop client loads). Install it into the desktop profile and
restart the app so the new client bundle is scanned.

## Commands

- `window.__dshSplitWorkspace.health()` — version, host, panes, geometry,
  persisted tree, crash guard.
- `window.__dshSplitWorkspace.split(sessionId)` — add a session as a pane.
- `window.__dshSplitWorkspace.arrange("auto")` — re-fit the automatic layout
  (legacy mode names are accepted and ignored).
- `window.__dshSplitWorkspace.focusChat()`, `closeFocused()`.
- `window.__dshSplitWorkspace.reflow()` — live pane-drag preview state
  (diagnostics for the hole/collapse behaviour).
- `window.__dshSplitWorkspace.setEnabled(false)` — kill switch.
- `window.__dshSplitWorkspace.reset()` — clear the saved layout.

## Keyboard

- `Alt+T` — toggle the compact TUI composer in the focused pane.
- `Alt+Shift+←/→/↑/↓` — move focus between panes.

## Limits

- No pane-count cap; the persisted tree is validated (unique sessions, depth)
  and a corrupt tree is discarded instead of reactivating a broken workspace.
- The persisted recursion depth is capped at 32 levels as a stack-safety guard
  for hand-edited payloads, not as a pane limit.
- The hidden stock conversation still streams under the overlay; panes re-host
  the native composer, so a pane's own composer owns its session's editor.
- Pane rename refuses blank sessions (the stock rename dialog does the same).

MIT. See `THIRD-PARTY-NOTICES.md`.

<!-- author-tools:start -->

<!-- generated by scripts/sync-readmes.mjs from projects.json -->

## More plugins by the same author

- **[DSH coding sound](https://github.com/mhlywxl/dsh-coding-sound)** (`dsh-coding-sound`) — Generative background music and notification chimes for DeepSeek Harness: hear whether the agent is thinking, still working, or waiting for you.

## Support the author

If this project saved you some screen time, you can buy the author a coffee ☕ or top up the author's battery ⚡. Any amount is welcome — the thought counts.

<p align="center">
  <img src="https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/sponsor/alipay.jpg" alt="Alipay QR code" width="180" />
  <img src="https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/sponsor/wechat.png" alt="WeChat Pay QR code" width="180" />
</p>
<p align="center"><sub>Alipay · WeChat Pay</sub></p>

<!-- author-tools:end -->
