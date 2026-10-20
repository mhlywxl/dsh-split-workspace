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

    // ---------------------------------------------------------------------
    // constants + locale
    // ---------------------------------------------------------------------

    const PLUGIN_ID = "dsh-split-workspace";
    const PLUGIN_VERSION = "0.4.0";
    const LOG_PREFIX = "[dsh-split-workspace]";
    const TREE_KEY = "dsh.split-workspace.tree.v1";
    const OPEN_KEY = "dsh.split-workspace.open.v2";
    const RAIL_KEY = "dsh.split-workspace.rail.v1";
    const ENABLED_KEY = "dsh.split-workspace.enabled.v1";
    const HEALTH_KEY = "dsh.split-workspace.health.v1";
    const HINT_KEY = "dsh.split-workspace.hint.v1";
    const MIN_KEY = "dsh.split-workspace.minimized.v1";
    const CHIP_KEY = "dsh.split-workspace.chip.v1";
    function readChipPos() {
      const raw = storageGet(CHIP_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const x = Number(parsed.x);
        const y = Number(parsed.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
      } catch { return null; }
    }
    function writeChipPos(pos) {
      try { storageSet(CHIP_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })); } catch {}
    }
    function readMinimized() {
      return storageGet(MIN_KEY) === "1";
    }
    function writeMinimized(value) {
      storageSet(MIN_KEY, value === true ? "1" : "0");
    }
    /* There is exactly one layout policy: AUTO, derived from the pane count.
       The old per-run mode menu (columns/rows/grid) is gone: it only ever
       produced a hand-picked arrangement that the next add/close immediately
       rewrote, and a persisted manual choice reopened the split "竖排". */
    /** Chat-flow row native DSH renders when a compaction command settles. */
    const COMPACTION_SELECTOR = '[data-chat-flow-kind="manual-compaction"]';
    const MIME_SESSION = "application/x-dsv-session";
    const MIME_PANE = "application/x-dsv-pane";
    /** Session id of the sidebar-row drag currently in flight. The HTML5 DnD
        data store hides `getData` during dragover, so the dragstart capture
        records the id here for the pane hover guard. */
    let externalDragSessionId = null;
    /** The floating "virtual window" that follows the pointer while dragging. */
    let dragPreviewEl = null;
    let dragPreviewFrame = 0;
    let dragPreviewX = 0;
    let dragPreviewY = 0;
    /** A 1x1 transparent canvas: suppresses the browser's opaque drag snapshot
        so only the floating preview is visible. Chromium only honours a drag
        image that is attached and rendered, hence the persistent off-screen
        node. */
    let dragImageCanvas = null;
    function transparentDragImage() {
      try {
        if (dragImageCanvas === null || dragImageCanvas.isConnected !== true) {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          canvas.style.cssText = "position:fixed;left:-32px;top:-32px;width:1px;height:1px;opacity:0;pointer-events:none;";
          canvas.setAttribute("aria-hidden", "true");
          document.body.appendChild(canvas);
          dragImageCanvas = canvas;
        }
        return dragImageCanvas;
      } catch { return null; }
    }
    /** Keep only the conversation rows around the pane's current scroll
        viewport in a drag thumbnail. A long transcript can hold thousands of
        off-screen nodes; laying all of them out made the first preview frame
        cost 500ms+. Rows above the viewport become same-height blanks (so the
        visible rows keep their position); rows below are hidden. */
    function prunePreviewTranscript(pane, clone) {
      try {
        let scroller = null;
        for (const el of pane.querySelectorAll("*")) {
          if (el.clientHeight < 100) continue;
          // No getComputedStyle here: resolving style for every node in a
          // 3000-node conversation took ~1.5s at dragstart. A clipped element
          // with a much taller scrollHeight is the transcript scroller, and the
          // tallest one is the one we want.
          if (el.scrollHeight > el.clientHeight + 80
            && (scroller === null || el.scrollHeight > scroller.scrollHeight)) {
            scroller = el;
          }
        }
        if (scroller === null) return null;
        let column = null;
        let columnNodes = 0;
        for (const child of scroller.children) {
          const count = child.querySelectorAll("*").length;
          if (count > columnNodes) { column = child; columnNodes = count; }
        }
        if (column === null || column.children.length < 2) return null;
        const all = pane.querySelectorAll("*");
        const scrollerIndex = Array.prototype.indexOf.call(all, scroller);
        const columnIndex = Array.prototype.indexOf.call(all, column);
        const cloneAll = clone.querySelectorAll("*");
        const cloneScroller = cloneAll[scrollerIndex];
        const cloneColumn = cloneAll[columnIndex];
        if (cloneScroller === undefined || cloneColumn === undefined) return null;
        const scrollTop = scroller.scrollTop;
        const viewTop = scrollTop;
        const viewBottom = scrollTop + scroller.clientHeight;
        const buffer = 80;
        const columnTop = column.getBoundingClientRect().top;
        const plan = [];
        for (const child of column.children) {
          const rect = child.getBoundingClientRect();
          plan.push({ top: rect.top - columnTop, height: rect.height });
        }
        for (let i = 0; i < plan.length && i < cloneColumn.children.length; i++) {
          const row = plan[i];
          const cloneRow = cloneColumn.children[i];
          // Drop everything outside the viewport instead of preserving the
          // original 10k-pixel scroll height with blank spacers: a short clone
          // lets the browser rasterise the miniature once instead of laying
          // out a full-length transcript inside it.
          if (row.top + row.height < viewTop - buffer || row.top > viewBottom + buffer) {
            cloneRow.style.display = "none";
          }
        }
        cloneScroller.style.overflow = "hidden";
        return { scroller: cloneScroller, scrollTop: 0 };
      } catch { return null; }
    }

    /** Strip live-only hooks from a pane clone used as a drag thumbnail:
        React refs/ids, focusability, duplicated pane identity. Styling classes
        stay, so the clone looks like the real pane. */
    function sanitizePreviewClone(root) {
      try {
        root.removeAttribute("data-dsv-pane");
        root.removeAttribute("data-dsv-leaf");
        root.removeAttribute("id");
        root.removeAttribute("tabindex");
        root.classList.remove("focused");
        root.classList.add("dsv-drag-preview-clone");
        root.setAttribute("inert", "");
        root.setAttribute("aria-hidden", "true");
        const nodes = root.querySelectorAll("*");
        for (const el of nodes) {
          el.removeAttribute("id");
          el.removeAttribute("tabindex");
          el.removeAttribute("contenteditable");
          el.removeAttribute("data-dsv-pane");
          el.removeAttribute("data-dsv-leaf");
          if (el.classList.contains("dsv-drop-ghost")
            || el.classList.contains("dsv-pane-invalid")
            || el.classList.contains("dsv-mode-btn")) {
            el.style.display = "none";
          }
        }
      } catch {}
    }

    /** The live pane element for a session, if that session is open in a pane. */
    function paneElementForSession(id) {
      try {
        const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : String(id).replace(/"/g, "\\\"");
        return document.querySelector('.dsv-pane[data-dsv-pane="' + escaped + '"]');
      } catch { return null; }
    }

    /** Cheap miniature: the actual title plus the visible transcript text in
        a window frame. Few nodes, no layout of the full conversation. */
    function buildMiniPreview(pane, title, width, height) {
      const el = document.createElement("div");
      el.className = "dsv-drag-preview dsv-drag-preview-thumb";
      el.dataset.plugin = PLUGIN_ID;
      el.setAttribute("aria-hidden", "true");
      el.style.width = width + "px";
      el.style.height = height + "px";
      const win = document.createElement("div");
      win.className = "dsv-preview-mini";
      const head = document.createElement("div");
      head.className = "dsv-preview-mini-head";
      for (const tone of ["r", "y", "g"]) {
        const dot = document.createElement("span");
        dot.className = "dsv-preview-mini-dot " + tone;
        head.appendChild(dot);
      }
      const label = document.createElement("span");
      label.className = "dsv-preview-mini-title";
      label.textContent = typeof title === "string" && title !== "" ? title : t("label");
      head.appendChild(label);
      const body = document.createElement("div");
      body.className = "dsv-preview-mini-body";
      // textContent, not innerText: innerText forces a full layout of the
      // transcript (the drag-start stall). The current conversation is at the
      // end of the text, so keep the tail.
      let text = "";
      try {
        // Pick the transcript-ish scroll container by text length (no layout
        // reads), so the preview shows messages instead of the footer/cost
        // metadata that sits at the end of the pane's full text.
        let source = null;
        let sourceLength = 0;
        for (const node of pane.querySelectorAll('[class*="scroll"]')) {
          const length = (node.textContent || "").length;
          if (length > sourceLength) { source = node; sourceLength = length; }
        }
        text = (source !== null ? source.textContent : pane.textContent) || "";
      } catch { text = ""; }
      text = String(text).replace(/\s+/g, " ").trim();
      if (text.length > 1400) text = "…" + text.slice(-1400);
      body.textContent = text;
      const composer = document.createElement("div");
      composer.className = "dsv-preview-mini-composer";
      composer.textContent = t("composerPlaceholder");
      win.appendChild(head);
      win.appendChild(body);
      win.appendChild(composer);
      el.appendChild(win);
      return el;
    }

    function beginDragPreview(title, hint, sourceEl, size) {
      endDragPreview();
      // A pane drag carries a real miniature of the conversation window: clone
      // the live pane, scale it down, and hold the clone as the floating
      // preview. Sidebar drags of an already-open session find their pane the
      // same way; a session that is not open falls back to the title card.
      let pane = null;
      try {
        if (sourceEl !== null && sourceEl !== undefined) {
          pane = typeof sourceEl.closest === "function" ? sourceEl.closest(".dsv-pane") : null;
          if (pane === null && sourceEl.nodeType === 1 && sourceEl.classList && sourceEl.classList.contains("dsv-pane")) pane = sourceEl;
        }
      } catch {}
      const simpleOnly = typeof window !== "undefined" && window.__DSV_SIMPLE_PREVIEW === true;
      const realThumb = typeof window !== "undefined" && window.__DSV_REAL_THUMB === true;
      try {
        if (simpleOnly !== true && pane !== null && pane !== undefined) {
          const naturalW = size !== null && size !== undefined && size.w >= 80 ? size.w : 220;
          const naturalH = size !== null && size !== undefined && size.h >= 80 ? size.h : 165;
          if (realThumb !== true && naturalW >= 80 && naturalH >= 80) {
            const scale = Math.min(280 / naturalW, 240 / naturalH, 0.4);
            const width = Math.max(110, Math.round(naturalW * scale));
            const height = Math.max(80, Math.round(naturalH * scale));
            const el = buildMiniPreview(pane, title, width, height);
            el.style.transform = "translate3d(-9999px,-9999px,0)";
            document.body.appendChild(el);
            dragPreviewEl = el;
            return;
          }
          const rect = pane.getBoundingClientRect();
          if (rect.width >= 80 && rect.height >= 80 && pane.querySelectorAll("*").length <= 8000) {
            const scale = Math.min(280 / rect.width, 240 / rect.height, 0.4);
            const width = Math.max(110, Math.round(rect.width * scale));
            const height = Math.max(80, Math.round(rect.height * scale));
            const el = document.createElement("div");
            el.className = "dsv-drag-preview dsv-drag-preview-thumb";
            el.dataset.plugin = PLUGIN_ID;
            el.setAttribute("aria-hidden", "true");
            el.style.width = width + "px";
            el.style.height = height + "px";
            const clone = pane.cloneNode(true);
            // Keep the reading position visible in the miniature.
            try {
              const sourceNodes = pane.querySelectorAll("*");
              const cloneNodes = clone.querySelectorAll("*");
              const count = Math.min(sourceNodes.length, cloneNodes.length);
              for (let i = 0; i < count; i++) {
                const top = sourceNodes[i].scrollTop;
                const left = sourceNodes[i].scrollLeft;
                if (top || left) {
                  cloneNodes[i].scrollTop = top;
                  cloneNodes[i].scrollLeft = left;
                }
              }
            } catch {}
            const pruned = prunePreviewTranscript(pane, clone);
            sanitizePreviewClone(clone);
            clone.style.width = rect.width + "px";
            clone.style.height = rect.height + "px";
            clone.style.boxSizing = "border-box";
            clone.style.transform = "scale(" + (width / rect.width) + ")";
            clone.style.transformOrigin = "top left";
            clone.style.position = "absolute";
            clone.style.left = "0";
            clone.style.top = "0";
            el.appendChild(clone);
            el.style.transform = "translate3d(-9999px,-9999px,0)";
            document.body.appendChild(el);
            if (pruned !== null) {
              try { pruned.scroller.scrollTop = pruned.scrollTop; } catch {}
            }
            dragPreviewEl = el;
            return;
          }
        }
      } catch {}
      // Fallback: a title-card "window" for sessions that are not rendered.
      try {
        const el = document.createElement("div");
        el.className = "dsv-drag-preview";
        el.dataset.plugin = PLUGIN_ID;
        el.setAttribute("aria-hidden", "true");
        const bar = document.createElement("div");
        bar.className = "dsv-drag-preview-bar";
        for (const tone of ["r", "y", "g"]) {
          const dot = document.createElement("span");
          dot.className = "dsv-drag-preview-dot " + tone;
          bar.appendChild(dot);
        }
        const label = document.createElement("span");
        label.className = "dsv-drag-preview-title";
        label.textContent = typeof title === "string" && title !== "" ? title : t("label");
        bar.appendChild(label);
        const body = document.createElement("div");
        body.className = "dsv-drag-preview-body";
        body.textContent = typeof hint === "string" && hint !== "" ? hint : t("dragHint");
        el.appendChild(bar);
        el.appendChild(body);
        el.style.transform = "translate3d(-9999px,-9999px,0)";
        document.body.appendChild(el);
        dragPreviewEl = el;
      } catch {}
    }

    function moveDragPreview(x, y) {
      if (dragPreviewEl === null) return;
      dragPreviewX = x;
      dragPreviewY = y;
      if (dragPreviewFrame !== 0) return;
      const step = () => {
        dragPreviewFrame = 0;
        const el = dragPreviewEl;
        if (el === null) return;
        try {
          const width = el.offsetWidth || 224;
          const height = el.offsetHeight || 64;
          // The pointer rides the TOP CENTRE of the virtual window, so the
          // thumbnail hangs below the cursor instead of covering it.
          const px = Math.max(6, Math.min(window.innerWidth - width - 6, dragPreviewX - width / 2));
          const py = Math.max(6, Math.min(window.innerHeight - height - 6, dragPreviewY));
          el.style.transform = "translate3d(" + px + "px," + py + "px,0)";
        } catch {}
      };
      if (typeof window.requestAnimationFrame !== "function") { step(); return; }
      dragPreviewFrame = window.requestAnimationFrame(step);
    }

    function endDragPreview() {
      if (dragPreviewFrame !== 0) {
        try { window.cancelAnimationFrame(dragPreviewFrame); } catch {}
        dragPreviewFrame = 0;
      }
      const node = dragPreviewEl;
      dragPreviewEl = null;
      externalDragSessionId = null;
      if (node !== null) {
        try { node.classList.add("leaving"); } catch {}
        setTimeout(() => { try { node.remove(); } catch {} }, 140);
      }
    }

    /** First visible line of a sidebar session row, used as the drag label. */
    function rowDragTitle(row) {
      try {
        const titled = row.querySelector('[class*="_title"], [class*="_name"]');
        if (titled !== null && titled !== undefined) {
          const text = (titled.textContent || "").trim();
          if (text !== "") return text;
        }
        const first = (row.innerText || "").split("\n").map((part) => part.trim()).find((part) => part !== "");
        if (first !== undefined) return first;
      } catch {}
      return t("label");
    }
    const GAP = 10;
    const MIN_PANE_PX = 200;
    // ---- safety-layer limits (documented in README) -----------------------
    /** Persisted trees nested deeper than this are invalid. Pane COUNT is not
        limited; only recursion depth is, so a corrupt payload cannot overflow
        the recursive renderer. */
    const MAX_TREE_DEPTH = 32;
    /** Session ids are opaque short tokens; anything else is invalid input. */
    const MAX_SESSION_ID_LENGTH = 128;
    /** A deliberate activation must stay up this long before it counts healthy. */
    const HEALTHY_AFTER_MS = 9000;
    /** While active, lastHealthyAt is refreshed at most this often. */
    const HEALTHY_REFRESH_MS = 30000;
    /** Boundary error budget: this many catches inside the window => safe mode. */
    const ERROR_BUDGET_COUNT = 3;
    const ERROR_BUDGET_WINDOW_MS = 20000;
    /** Host releases this build has been exercised against. Informational only:
        an untested release still activates (the crash-loop guard protects the
        host); it only gets one console note and a health() flag.
        0.2.1-rc.2 signed off by the release verifier on the isolated real
        0.2.1 desktop host (docs/VERIFICATION-2026-10-19.md). */
    const TESTED_RELEASES = ["0.2.0-rc.2", "0.2.1-rc.2"];
    /** The conversation column must be at least this big to be usable. */
    const COLUMN_MIN_WIDTH = 360;
    const COLUMN_MIN_HEIGHT = 240;

    const EN = {
      label: "Split view",
      openTitle: "Toggle the split view",
      exit: "Exit",
      addCurrent: "Add current conversation",
      layoutLabel: "Layout",
      layoutCount: "panes",
      exitSplit: "Exit split",
      openSplit: "Split view",
      minimizeSplit: "Minimize",
      rightbar: "Right sidebar",
      rightbarOpen: "Open right sidebar",
      rightbarClose: "Collapse right sidebar",
      restoreSplit: "Restore split",
      minimizedTitle: "Split view minimized",
      maximize: "Maximize",
      restore: "Restore",
      renameHint: "Click to rename",
      renameBlank: "A blank conversation cannot be renamed",
      copy: "Copy session id and title",
      copied: "Session id and title copied",
      copyFailed: "Could not copy",
      splitRight: "Split right",
      splitDown: "Split down",
      closePane: "Close pane",
      railSearch: "Search conversations",
      railShow: "Show conversations",
      railHide: "Hide conversations",
      emptyTitle: "No panes yet",
      emptyHint: "Drag a conversation from the left, or add the current one. Drop near a pane edge to split, center to move.",
      dropSplitLeft: "Split left",
      dropSplitRight: "Split right",
      dropSplitTop: "Split top",
      dropSplitBottom: "Split bottom",
      dropMove: "Move here",
      extDropHint: "Release to open in this pane",
      sessionEnded: "Session ended",
      loadingHistory: "Loading history…",
      loadError: "Failed to load history",
      loadOlder: "Load older",
      toBottom: "Jump to latest",
      noMessages: "No conversations",
      emptyTranscript: "No messages yet",
      composerPlaceholder: "Send a message…",
      stop: "Stop",
      send: "Send",
      running: "Deep diving…",
      countSuffix: " panes",
      queuedBadge: "queued",
      helpTitle: "Split view — shortcuts and help",
      helpOpen: "Split view help",
      helpClose: "Close",
      helpShortcuts: "Shortcuts",
      helpGestures: "Drag a conversation from the sidebar onto the page to start a split. Drag a pane by its header to move it: its slot closes and a dashed hole previews where it will land. Drag the dividers to resize. ✕ closes a pane.",
      helpDisable: "Disable split view: run window.__dshSplitWorkspace.setEnabled(false), or set localStorage 'dsh.split-workspace.enabled.v1' to \"0\". Reset the layout: window.__dshSplitWorkspace.reset().",
      helpDiagnostics: "Diagnostics: window.__dshSplitWorkspace.health() — see the README section “Safety, recovery and diagnostics”.",
      tipTitle: "Split view is on",
      tipBody: "Alt+T toggles the compact composer · Alt+Shift+←/→/↑/↓ moves between panes · drag a conversation from the sidebar to split · ✕ closes a pane. To turn split view off, run window.__dshSplitWorkspace.setEnabled(false).",
      compactionDone: "Context compacted — the summary is in the conversation.",
      compactionFailed: "Compaction did not complete — details are in the conversation.",
      safeModeTitle: "Split screen paused after a crash",
      safeModeBody: "The stock view is untouched; your saved layout is kept.",
      retryLabel: "Retry",
      disableLabel: "Disable",
      dismissLabel: "Dismiss",
      blockedTitle: "Split view could not start on this window",
      paneFailed: "This pane failed to render",
      sameSessionBody: "This conversation is already open in a pane.",
      sameSessionCurrent: "This conversation is already open in the workspace.",
      moreActions: "More actions",
      dragHint: "Drop into a pane to split",
      dragHintPane: "Release to place the pane",
      pickerEmpty: "No other conversations available",
    };
    const ZH = {
      label: "分屏视图",
      openTitle: "切换分屏视图",
      exit: "退出",
      addCurrent: "添加当前对话",
      layoutLabel: "布局",
      layoutCount: "窗格",
      exitSplit: "退出分屏",
      openSplit: "分屏视图",
      minimizeSplit: "最小化",
      rightbar: "右侧栏",
      rightbarOpen: "打开右侧边栏",
      rightbarClose: "收起右侧边栏",
      restoreSplit: "恢复分屏",
      minimizedTitle: "分屏已最小化",
      maximize: "最大化",
      restore: "还原",
      renameHint: "点击重命名",
      renameBlank: "空白会话不能重命名",
      copy: "复制会话 id 和标题",
      copied: "已复制会话 id 和标题",
      copyFailed: "复制失败",
      splitRight: "向右分屏",
      splitDown: "向下分屏",
      closePane: "关闭面板",
      railSearch: "搜索对话",
      railShow: "显示对话列表",
      railHide: "隐藏对话列表",
      emptyTitle: "还没有面板",
      emptyHint: "从左侧拖入对话，或添加当前对话。靠近面板边缘释放即分屏，居中释放为移动。",
      dropSplitLeft: "左侧分屏",
      dropSplitRight: "右侧分屏",
      dropSplitTop: "上方分屏",
      dropSplitBottom: "下方分屏",
      dropMove: "移动到此处",
      extDropHint: "松开鼠标，打开到这个位置",
      sessionEnded: "会话已结束",
      loadingHistory: "正在加载历史…",
      loadError: "历史加载失败",
      loadOlder: "加载更早消息",
      toBottom: "回到底部",
      noMessages: "暂无对话",
      emptyTranscript: "暂无消息",
      composerPlaceholder: "发送消息…",
      stop: "停止",
      send: "发送",
      running: "Deep diving…",
      countSuffix: " 个面板",
      queuedBadge: "条排队",
      helpTitle: "分屏视图 — 快捷键与帮助",
      helpOpen: "分屏帮助",
      helpClose: "关闭",
      helpShortcuts: "快捷键",
      helpGestures: "从左侧会话列表把对话拖到页面即可开始分屏；拖住面板标题栏可移动面板：原位置收起，虚线空位预览落点。拖动分隔条可调整大小，✕ 关闭面板。",
      helpDisable: "停用分屏：运行 window.__dshSplitWorkspace.setEnabled(false)，或将 localStorage 'dsh.split-workspace.enabled.v1' 设为 \"0\"。重置布局：window.__dshSplitWorkspace.reset()。",
      helpDiagnostics: "诊断：window.__dshSplitWorkspace.health() — 详见 README“安全性、恢复与诊断”。",
      tipTitle: "分屏视图已开启",
      tipBody: "Alt+T 切换紧凑输入行 · Alt+Shift+←/→/↑/↓ 切换面板 · 从左侧拖入对话可分屏 · ✕ 关闭面板。如需停用，运行 window.__dshSplitWorkspace.setEnabled(false)。",
      compactionDone: "上下文已压缩 — 摘要已写入对话。",
      compactionFailed: "压缩未完成 — 详情见对话。",
      safeModeTitle: "分屏在崩溃后已暂停",
      safeModeBody: "原生界面未受影响，已保存的布局仍然保留。",
      retryLabel: "重试",
      disableLabel: "停用",
      dismissLabel: "忽略",
      blockedTitle: "分屏视图无法在此窗口启动",
      paneFailed: "此面板渲染失败",
      sameSessionBody: "该会话已经在分屏中，不能重复分屏。",
      sameSessionCurrent: "该会话已经在当前工作区中，不能重复打开。",
      moreActions: "更多操作",
      dragHint: "拖入面板即可分屏",
      dragHintPane: "松开即可放置面板",
      pickerEmpty: "没有可用的其他会话",
    };

    /** Fallback translator: every locale wrapper unwraps back to this. */
    const FALLBACK_TRANSLATE = (key) => (EN[key] !== undefined ? EN[key] : key);
    let translate = FALLBACK_TRANSLATE;
    function t(key, vars) {
      let text = translate(key);
      if (vars !== null && vars !== undefined) {
        for (const name of Object.keys(vars)) {
          text = text.split("{" + name + "}").join(String(vars[name]));
        }
      }
      return text;
    }

    // ---------------------------------------------------------------------
    // stylesheet (native ui-conversation rules copied under dsv- names —
    // used by the built-in fallback renderer and the workspace chrome)
    // ---------------------------------------------------------------------

    const DSV_CSS = `
    .dsv-overlay {
      position: fixed; top: 0; bottom: 0; right: 0; z-index: 60;
      animation: dsv-overlay-in .18s ease-out;
      background: var(--dsw-alias-bg-base);
      display: flex; flex-direction: column;
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      /* mirrors the stock ConversationRoot values so panes render the
         composer card and transcript at the same 748px content width
         (CSS has no // comments — a // line here used to swallow this
         declaration and uncapped every composer card in split view) */
      --dsh-chat-content-width: 748px;
      --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
      --dsh-composer-side-clearance: 16px;
      --dsh-composer-dock-inset: 8px;
    }
    .dsv-overlay:focus { outline: none; }
    .dsv-overlay.dsv-leaving { opacity: 0; pointer-events: none; transition: opacity .15s ease; }
    .dsv-minimized-chip { animation: dsv-fade-in .15s ease-out; transition: opacity .15s ease; }
    .dsv-minimized-chip.dsv-leaving { opacity: 0; pointer-events: none; }

    .dsv-topbar {
      flex: none; height: 40px; display: flex; align-items: center; gap: 8px;
      padding: 0 10px 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-base);
    }
    .dsv-topbar-title { font-size: 13px; font-weight: 600; line-height: 18px; }
    .dsv-topbar-count { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-left: 2px; }
    .dsv-topbar-spacer { flex: 1; }
    .dsv-topbar-btn {
      display: inline-flex; align-items: center; gap: 6px; height: 28px;
      padding: 0 8px; border: none; border-radius: 8px; cursor: pointer;
      background: transparent; color: var(--dsw-alias-label-secondary);
      font-size: 12px; line-height: 18px; font-family: inherit;
    }
    .dsv-topbar-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .dsv-topbar-btn.accent { color: var(--dsw-static-deepseek-500); }
    .dsv-topbar-btn.accent:hover { background: color-mix(in srgb, var(--dsw-static-deepseek-500) 10%, transparent); }

    .dsv-body-column { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .dsv-layout-bar {
      position: relative;
      flex: none; height: 32px; display: flex; align-items: center; gap: 8px;
      padding: 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1); user-select: none;
      white-space: nowrap; overflow: hidden;
      -webkit-app-region: drag;
    }
    /* A dedicated drag surface behind every child: the whole bar (including
       the 8px gaps around buttons and the last stretch before 右侧栏) moves the
       window. Buttons and labels sit above it and keep their no-drag hit area. */
    .dsv-layout-dragfill {
      position: absolute; inset: 0; z-index: 0;
      -webkit-app-region: drag;
    }
    .dsv-layout-bar > :not(.dsv-layout-dragfill) { position: relative; z-index: 1; }
    .dsv-layout-bar button { -webkit-app-region: no-drag; }
    /* Labels never wrap: the bar has a fixed 32px height, so a squeezed flex
       item used to stack 布局/右侧栏/最小化 into two or three lines. Every
       fixed child refuses to shrink; only the drag spacer gives width back.
       Very narrow columns switch to the compact variants below. */
    .dsv-layout-title { flex: none; white-space: nowrap; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
    .dsv-layout-count { flex: none; white-space: nowrap; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
    .dsv-layout-bar[data-compact] { gap: 6px; padding: 0 8px; }
    .dsv-layout-bar[data-compact] .dsv-layout-title,
    .dsv-layout-bar[data-compact="2"] .dsv-layout-count { display: none; }
    .dsv-layout-bar[data-compact] .dsv-layout-exit { padding-left: 6px; padding-right: 6px; }
    /* The blank stretch between the layout modes and the right-aligned actions
       is a window-drag handle, like the stock titlebar. pointer-events:none
       makes the BAR the hit target (the span itself is anonymous chrome), so no
       default no-drag child can swallow the gesture. */
    .dsv-layout-spacer {
      flex: 1; align-self: stretch;
      -webkit-app-region: drag;
    }
    .dsv-layout-exit {
      flex: none; white-space: nowrap;
      height: 24px; padding: 0 9px; border: 1px solid transparent; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
      font: 11px/1 inherit; font-family: inherit;
    }
    .dsv-layout-exit:hover { color: #e5484d; background: color-mix(in srgb, #e5484d 10%, transparent); }
    /* Same panel icon + ghost treatment as the stock right-sidebar control
       that the split overlay covers (see the LayoutBar). */
    .dsv-layout-icon {
      flex: none; width: 24px; height: 24px; padding: 0;
      display: grid; place-items: center;
      border: 0; border-radius: 6px; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-secondary);
    }
    .dsv-layout-icon:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
    /* Open state: accent glyph on a tinted seat, so the panel toggle reads as
       ON even before the pointer hovers it. */
    .dsv-layout-icon.is-open {
      color: var(--dsw-static-deepseek-500);
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 12%, transparent);
    }
    .dsv-layout-icon.is-open:hover {
      color: var(--dsw-static-deepseek-500);
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 20%, transparent);
    }
    .dsv-layout-icon svg { display: block; }
    .dsv-footer-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px;
      background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
    }
    .dsv-footer-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    /* One title per pane: the pane header owns it. The stock header keeps its
       view tabs and action rows but not its breadcrumb; the slim header's own
       title span is removed in JSX. */
    .dsv-pane nav[class*="_crumbs"] { display: none !important; }
    .dsv-pane .dsv-slim-title { display: none !important; }
    /* The stock conversation header's action cluster deliberately overhangs a
       16px window gutter (margin-right:-16px) to reach the window edge. A split
       pane has no gutter: overflow:hidden clipped the last icon (open right
       sidebar) by ~15px. Pull the corner back inside the pane so every action
       is fully visible — including in a maximized/fullscreen pane. */
    .dsv-pane [class*="_headerCorner"] { margin-right: 0 !important; }
    /* Every pane re-hosts a stock conversation header, and that header injects
       its own "open right sidebar" affordance from the PANE session's sidebar
       store. The right sidebar is one global column driven by the workspace
       toolbar, so the per-pane copy is both redundant and clipped at the pane
       edge (its stock -16px overhang has no window gutter to land in). The
       split toolbar's 右侧栏 button is the single owner. */
    .dsv-pane [data-sidebar-right-expand] { display: none !important; }
    .dsv-minimized-chip { bottom: 18px; right: 18px; cursor: grab; touch-action: none; user-select: none; }
    .dsv-minimized-chip.dragging { cursor: grabbing; opacity: .96; }
    .dsv-minimized-chip .dsv-chip-text { pointer-events: none; }
    .dsv-minimized-grip {
      flex: none; cursor: grab; user-select: none; pointer-events: auto;
      color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 1;
      letter-spacing: 1px; padding: 0 2px;
    }
    .dsv-minimized-chip.dragging .dsv-minimized-grip { cursor: grabbing; }
    .dsv-pane-title-edit { cursor: text; }
    .dsv-pane-title-edit:hover { color: var(--dsw-static-deepseek-500); }
    .dsv-pane-title-input {
      box-sizing: border-box;
      flex: 0 1 170px; width: 170px; min-width: 80px; max-width: 170px; height: 20px; padding: 0 5px;
      border: 1px solid var(--dsw-static-deepseek-500); border-radius: 5px;
      background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
      font: 12px/1.2 inherit; font-family: inherit; outline: none;
    }
    .dsv-body { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 10px; }

    .dsv-rail {
      flex: none; width: 232px; min-height: 0; display: flex; flex-direction: column;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-layer-1, transparent); overflow: hidden;
    }
    .dsv-rail-search {
      flex: none; margin: 10px 10px 6px; height: 30px; border-radius: 10px;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); padding: 0 10px; font-size: 13px;
      font-family: inherit; outline: none;
    }
    .dsv-rail-search:focus { border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 45%, transparent); }
    .dsv-rail-search::placeholder { color: var(--dsw-alias-label-caption); }
    .dsv-rail-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px 10px; display: flex; flex-direction: column; gap: 2px; }
    .dsv-rail-item {
      display: flex; align-items: center; gap: 8px; padding: 7px 8px;
      border-radius: 10px; cursor: grab; border: none; background: transparent;
      color: inherit; text-align: left; font-family: inherit; width: 100%;
    }
    .dsv-rail-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-rail-item:active { cursor: grabbing; }
    .dsv-rail-item-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; flex: 1; }
    .dsv-rail-item-title { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dsv-rail-item-sub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dsv-rail-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); }
    .dsv-rail-dot.running { background: var(--dsw-static-deepseek-500); animation: dsv-pulse 1.6s ease-in-out infinite; }
    .dsv-rail-dot.open { background: color-mix(in srgb, var(--dsw-static-deepseek-500) 55%, var(--dsw-alias-label-tertiary)); }
    @keyframes dsv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    .dsv-rail-empty { padding: 18px 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }

    .dsv-canvas { flex: 1; min-width: 0; min-height: 0; position: relative; display: flex; }
    .dsv-split { display: flex; min-width: 0; min-height: 0; flex: 1; }
    .dsv-split[data-dir="h"] { flex-direction: row; }
    .dsv-split[data-dir="v"] { flex-direction: column; }
    .dsv-pane-wrap, .dsv-split-wrap { display: flex; min-width: 0; min-height: 0; }
    .dsv-pane-wrap > .dsv-pane { flex: 1; }
    .dsv-split-wrap > .dsv-split { flex: 1; }

    .dsv-divider { flex: none; position: relative; z-index: 3; touch-action: none; }
    .dsv-split[data-dir="h"] .dsv-divider { width: 10px; cursor: col-resize; }
    .dsv-split[data-dir="v"] .dsv-divider { height: 10px; cursor: row-resize; }
    .dsv-divider::after {
      content: ""; position: absolute; border-radius: 999px;
      background: transparent; transition: background .12s ease;
    }
    .dsv-split[data-dir="h"] .dsv-divider::after { top: 20%; bottom: 20%; left: 3px; width: 4px; }
    .dsv-split[data-dir="v"] .dsv-divider::after { left: 20%; right: 20%; top: 3px; height: 4px; }
    .dsv-divider:hover::after, .dsv-divider.active::after {
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 40%, transparent);
    }

    .dsv-pane {
      position: relative; display: flex; flex-direction: column;
      min-width: 0; min-height: 0; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-base);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      transition: box-shadow .18s ease, border-color .18s ease, opacity .15s ease, transform .15s ease;
    }
    .dsv-pane.dsv-pane-closing { opacity: 0; transform: scale(.986); pointer-events: none; }
    /* Split geometry animates when panes are added/closed. Divider drags hand
       the browser a fresh ratio on every pointermove, so transitions are cut
       while a divider is active (otherwise the pane would lag the pointer). */
    .dsv-pane-wrap, .dsv-split-wrap { transition: width .18s ease, height .18s ease; }
    .dsv-canvas:has(.dsv-divider.active) .dsv-pane-wrap,
    .dsv-canvas:has(.dsv-divider.active) .dsv-split-wrap { transition: none; }
    .dsv-pane-wrap { animation: dsv-fade-in .18s ease-out; }
    @keyframes dsv-fade-in { from { opacity: 0; } }
    @keyframes dsv-overlay-in { from { opacity: 0; } }
    @keyframes dsv-preview-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-pane-wrap, .dsv-split-wrap { transition: none; animation: none; }
      .dsv-pane, .dsv-overlay, .dsv-drag-preview { transition: none !important; animation: none !important; }
    }
    /* Light & shadow focus: a thin luminous rim over a modest ambient drop —
       elevation, not a selection rectangle. Deliberately TWO shadow layers
       (1px rim + 12px drop): the old four-layer stack (36px blur + 30px glow)
       read heavy and multiplied GPU compositing cost per focused pane during
       streaming. Single-pane mode never lights up (see the .flush gate below). */
    .dsv-pane.focused {
      border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 24%, var(--dsw-alias-border-l2));
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent),
        0 4px 16px rgba(15, 23, 42, 0.14);
    }
    .dsv-body.flush .dsv-pane.focused {
      border-color: var(--dsw-alias-border-l2);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    @media (prefers-reduced-motion: reduce) {
      .dsv-pane { transition: none; }
    }
    /* A lone pane loses the card chrome entirely: it reads as the stock view. */
    .dsv-pane.bare { border: none; border-radius: 0; box-shadow: none; }
    .dsv-body.flush { padding: 0; gap: 0; }
    .dsv-pane-header {
      flex: none; height: 36px; display: flex; align-items: center; gap: 8px;
      padding: 0 4px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      cursor: grab; user-select: none;
    }
    .dsv-pane-header:active { cursor: grabbing; }
    /* Slim header for narrow panes: one 30px row instead of the tall stock
       header stack (breadcrumb + tabs + actions). */
    .dsv-slim-header {
      flex: none; height: 30px; display: flex; align-items: center; gap: 8px;
      padding: 0 6px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      min-width: 0;
    }
    .dsv-slim-title {
      font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      min-width: 0; flex: 0 1 auto;
      max-width: 40%; cursor: grab; user-select: none;
    }
    .dsv-slim-title:active { cursor: grabbing; }
    .dsv-slim-tabs { display: flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
    /* Re-hosted conversation.session.header.actions (agent-team trigger,
       agent-preset label, cost-meter statistics) for narrow panes. It is a
       container context on purpose: the entries' own CSS collapses their
       labels via @container (width<=480px) — the stock header provides the
       same context, so the entries behave identically here. */
    .dsv-slim-actions {
      display: flex; align-items: center; gap: 2px; flex: none; min-width: 0;
      max-width: 58%; overflow: hidden; justify-content: flex-end;
      margin-left: auto; container-type: inline-size;
    }
    .dsv-slim-header[data-actions] .dsv-slim-tabs { margin-left: 0; }
    .dsv-slim-tab {
      border: none; background: transparent; cursor: pointer; height: 22px;
      padding: 0 8px; border-radius: 6px; font-size: 11.5px; line-height: 22px;
      color: var(--dsw-alias-label-secondary); font-family: inherit; white-space: nowrap;
    }
    .dsv-slim-tab:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
    .dsv-slim-tab.active {
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 14%, transparent);
      color: var(--dsw-static-deepseek-500); font-weight: 600;
    }
    /* TUI composer: a terminal-grade single line wired to the real input
       machine — for short (vertically split) panes. */
    /* the TUI line rides the SAME measured card geometry as the full-mode
       composer (PaneFrame's --dsv-card-* vars) so Alt+T never moves the
       input's edges — the toggle and the send key keep their positions.
       Center alignment puts the prompt arrow, the text line, the send key
       and the toggle on ONE vertical midline between the box's edges. */
    /* the block owns the TUI frame (edges + measured card geometry) so the
       queued-messages line and the input line read as ONE terminal surface;
       with no queue the block renders only the input line — pixel-identical
       to the pre-queue layout. */
    .dsv-tui-block {
      flex: none;
      width: var(--dsv-card-w, calc(100% - 32px));
      max-width: calc(var(--dsh-chat-content-width) + 32px);
      /* auto margins CENTER the line when no card box has been measured. The
         stock card is centred in its own root (.uV2eYG_root sets
         align-items: center; the card itself is width: 100% with
         max-width: var(--dsh-composer-card-max-width)), so a fixed 16px left
         fallback pinned the line to the LEFT of a wide pane — combined with the
         780px cap it read as "the TUI line sits on the left instead of
         centred". A measured box still wins: both vars are published together,
         and an explicit value beats auto. (No backticks in this comment — it
         lives inside a template literal.) */
      margin: 0 var(--dsv-card-right-inset, auto) 0 var(--dsv-card-left, auto);
      border-top: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-base);
    }
    .dsv-tui {
      flex: none; display: flex; align-items: center; gap: 6px;
      /* 14px left = the stock composer card's own text inset (the native
         editor carries padding-left:14px inside the card), so Alt+T keeps the
         line start on the same vertical as the full composer's text; 12px
         right keeps the send key on its previous band. */
      padding: 6px 12px 6px 14px;
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      /* the composer card's type scale, not the bare pane's inherited 16px */
      font-size: var(--dsv-composer-font-size, 14px);
      line-height: var(--dsv-composer-line-height, 24px);
    }
    /* queued-messages badge: one dim monospace line under the block's top
       rule — terminal-adjacent, no card chrome. Count in brand color, first
       queued message as a truncated preview, full list in the tooltip. */
    .dsv-tui-queue {
      display: flex; align-items: baseline; gap: 6px;
      min-width: 0; padding: 5px 12px 0;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
      font-size: 11px; line-height: 15px;
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; user-select: none;
    }
    .dsv-tui-queue-glyph, .dsv-tui-queue-count {
      flex: none; color: var(--dsw-static-deepseek-500); font-weight: 700;
    }
    .dsv-tui-queue-preview {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; opacity: .9;
      border-left: 1px solid var(--dsw-alias-border-l2); padding-left: 7px;
    }
    .dsv-tui-attach {
      flex: none; width: calc(100% - 32px); max-width: calc(var(--dsh-chat-content-width) + 32px);
      margin: 0 auto;
    }
    .dsv-tui-prompt {
      color: var(--dsw-static-deepseek-500); font-weight: 700; user-select: none;
      display: flex; align-items: center;
    }
    .dsv-tui-input {
      flex: 1; min-width: 0; resize: none; border: none; outline: none; background: transparent;
      color: var(--dsw-alias-label-primary);
      /* native caret token (InputBar.module.css), not a brand colour guess */
      caret-color: var(--dsw-alias-state-business-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      /* the composer card's own type scale — a textarea does NOT inherit the
         row's font, so this has to be explicit or the terminal line renders
         at the pane's 16px/normal and visibly larger than the chat */
      font-size: var(--dsv-composer-font-size, 14px);
      line-height: var(--dsv-composer-line-height, 24px);
      /* border-box is REQUIRED for the centered first line: the auto-grow
         effect sets height = scrollHeight, and scrollHeight already includes
         this 4px+4px padding — under the UA-default content-box that height
         grows the box another 8px past the text, leaving dead space at the
         bottom so the glyphs ride high of the TUI band's midline (the flex
         row still centers the box itself, so buttons stayed centered while
         the text did not). border-box makes the box exactly hug the text
         (native editor: padding 4px 8px 0 14px, min-height 36px). */
      box-sizing: border-box;
      padding: 4px 0;
      max-height: 96px;
    }
    .dsv-tui-btn {
      flex: none; border: none; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-secondary); display: grid; place-items: center;
      height: 26px; width: 26px; border-radius: 6px; padding: 0;
      /* bottom 0 puts the button's band exactly on the pinned toggle's
         band (the row's 7px bottom padding doubles as the toggle offset) */
      margin-bottom: 0;
    }
    .dsv-tui-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
    .dsv-tui-btn:disabled { opacity: 0.4; cursor: default; }
    /* one-line dock: a fixed text area mirroring the chat box geometry.
       DockLine pins margin-left/width inline from the LIVE composer box
       (wrapper-anchored via useComposerAlignedRow): the left edge lands on
       the card's left border + 4px buffer, and the right edge 60px short of
       the card's right — 24px+ clear of the pinned toggle. Nothing is ever
       hidden — overflowing cells are revealed by dragging the row. */
    .dsv-dock-line {
      display: flex; align-items: center; min-width: 0;
      margin: 5px 0 0 4px;
      padding: 2px 0;
      border: 1px solid transparent; border-radius: 12px;
      background: var(--dsw-alias-bg-base);
      overflow: hidden; user-select: none; cursor: default;
    }
    /* the native stats root centers itself with 32px side padding for the
       stock layout — inside a dock cell the row owns the geometry, so the
       cell starts flush and the row's buffers decide the edges */
    .dsv-dock-cell > * { max-width: none !important; margin: 0 !important; padding-left: 0 !important; padding-right: 0 !important; text-align: left !important; }
    /* queue strip: the native merge-into-card design. The stock QueueDock
       panel styles itself (radius 12 12 0 0, hairline border top/left/right,
       no bottom) and only needs the card's measured width plus the native
       bottom tuck. */
    .dsv-queue-strip {
      flex: none;
      /* Native geometry, straight from QueueDock.module.css: the dock is
         card − 2×side-clearance(16) − 2×dock-inset(8) = card − 48px wide and
         carries padding 0 8px, so the PANEL inside is card − 64px. The
         earlier card − 16px guess made the queued-message block ~32px wider
         than the input card it merges into (and at wide panes the stock card
         is capped at 780px, so the overhang was much larger than that). */
      box-sizing: border-box;
      width: calc(var(--dsv-card-w, calc(100% - 32px)) - 48px);
      max-width: 100%;
      margin: 0 auto;
      padding: 0 8px;
      min-width: 0;
    }
    /* Native vertical rhythm: the stock dock lives in .composerStack, which
       sets --dsh-composer-stack-gap:6px and gap:6px, and the dock carries
       margin-bottom: calc(0px - stack-gap - 3px) = -9px — so the card overlaps
       the panel's bottom by exactly 3px and its rounded top corners cover that
       edge. The pane's column has no gap, so the net -3px rides the strip.
       :not(:empty) is load-bearing: the wrapper div exists even when QueueDock
       renders nothing, and an unconditional negative margin would lift the
       whole composer card off its stock position while the queue is empty.
       (The old -15px hid the bottom of the 28px edit/remove/steer buttons.) */
    .dsv-queue-strip:not(:empty) { margin-bottom: -3px; }
    .dsv-queue-strip > * {
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
    }
    .dsv-input-dock {
      min-width: 0;
      /* exact card box via the sticky measured vars */
      margin-left: var(--dsv-card-left, 16px);
      width: var(--dsv-card-w, calc(100% - 32px));
    }
    /* Reserve a stable band under the composer card for the pinned TUI
       toggle. Without it the band is only the composer container's ~10px
       bottom padding, so the 26px toggle (centered in that band) rides up
       into the card's bottom-right corner — straight over the send key.
       Dock lines (stats, queue) widen the band when present, which is why
       the overlap appeared and disappeared with the stats line. 22px plus
       the stock padding keeps the toggle fully below the card whether or
       not a dock line renders, so its position stops depending on them. */
    .dsv-pane [data-dsv-composer-card] { margin-bottom: 22px; }
    /* queue dock (card−48/764) and todo panel (card−64/748) carry different
       stock width formulas — neutralize them so every strip spans the strip
       zone (= the measured chat box) edge to edge; vertical margins survive
       so the queue panel keeps its merge-into-card rhythm */
    .dsv-input-dock > * {
      width: 100% !important;
      max-width: none !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
    }
    /* programmatic transcript focus is silent — the UA focus ring here is
       just a white rectangle around the chat area (Alt+Shift+Arrow used to
       leave one behind; the chord now targets the input, and the Esc path
       keeps its silent focus too) */
    .dsv-silent-focus:focus, .dsv-silent-focus:focus-visible { outline: none !important; }
    .dsv-dock-line.overflown { cursor: grab; }
    .dsv-dock-line.dragging { cursor: grabbing; }
    .dsv-dock-inner { display: flex; align-items: center; gap: 12px; flex: none; width: max-content; }
    .dsv-dock-cell { flex: none; white-space: nowrap; }
    /* pinned composer-mode button: absolute bottom-right of the pane, so its
       position is pixel-identical in full and TUI modes — repeated clicks
       never require moving the cursor. */
    .dsv-mode-btn {
      position: absolute; bottom: 4px; z-index: 6;
      width: 26px; height: 26px; border-radius: 8px; padding: 0;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
      display: grid; place-items: center; cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      transition: color .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    .dsv-mode-btn:hover {
      color: var(--dsw-static-deepseek-500);
      border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 40%, var(--dsw-alias-border-l2));
      box-shadow: 0 0 10px color-mix(in srgb, var(--dsw-static-deepseek-500) 25%, transparent);
    }
    /* inline variant: a flex child of the TUI line (no absolute positioning,
       so it can never overlap the send key) */
    .dsv-mode-btn.inline { position: static; }
    /* Fixed title slot: equal panes align their titles (and the cwd after
       them) on the same column. The slot can shrink on a narrow pane, but it
       never hugs the text, so short titles no longer leave a ragged row. */
    .dsv-pane-title {
      flex: 0 1 170px; width: 170px; max-width: 170px; min-width: 0;
      display: flex; align-items: center; overflow: hidden;
    }
    /* The rename target stays content-width INSIDE the slot: blank space
       after a short title still starts a drag, never a rename. */
    .dsv-pane-title-text {
      display: block; min-width: 0; max-width: 100%;
      font-size: 13px; font-weight: 500; line-height: 18px;
      color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-pane.dsv-compact .dsv-pane-title { flex: 1 1 auto; width: auto; max-width: none; }
    .dsv-pane.dsv-compact .dsv-pane-cwd { display: none; }
    /* The blank stretch between the title and the action cluster is a drag
       handle, not part of the rename target. pointer-events:none lets the
       header itself receive the drag. */
    .dsv-pane-header-spacer {
      flex: 1 1 auto; min-width: 8px; align-self: stretch;
      pointer-events: none; user-select: none;
    }
    .dsv-pane-menu {
      position: absolute; top: 36px; right: 6px; z-index: 25;
      min-width: 156px; padding: 4px; display: flex; flex-direction: column; gap: 1px;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      box-shadow: 0 10px 30px rgba(15, 23, 42, .18);
      animation: dsv-fade-in .12s ease-out;
    }
    .dsv-pane-menu-item {
      display: flex; align-items: center; gap: 8px;
      height: 28px; padding: 0 8px; border: 0; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-primary);
      font: 12px/1 inherit; font-family: inherit; text-align: left; cursor: pointer;
    }
    .dsv-pane-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-pane-menu-item.danger { color: #e5484d; }
    .dsv-pane-menu-item.danger:hover { background: color-mix(in srgb, #e5484d 12%, transparent); }
    .dsv-pane-cwd {
      flex: 0 1 auto; min-width: 0; max-width: 130px; font-size: 11px; line-height: 16px;
      color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-pane-running { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-static-deepseek-500); animation: dsv-pulse 1.6s ease-in-out infinite; }
    /* Idle panes keep the dot's slot so titles start on the same column. */
    .dsv-pane-running.idle { background: transparent; animation: none; }
    .dsv-pane-btn {
      flex: none; width: 26px; height: 26px; display: grid; place-items: center;
      border: none; border-radius: 8px; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-secondary); padding: 0;
    }
    .dsv-pane-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    /* Close is a destructive action: tinted at rest so it reads as the
       close control at a glance, not just another ghost icon. */
    .dsv-pane-btn-close {
      color: #e5484d;
      background: color-mix(in srgb, #e5484d 12%, transparent);
      /* an inset ring, not a border: the 26px hit box of every action button
         stays identical, so the header cluster never shifts */
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #e5484d 30%, transparent);
      border-radius: 8px;
    }
    .dsv-pane-btn-close:hover {
      color: #fff; background: #e5484d;
      box-shadow: inset 0 0 0 1px #e5484d;
    }
    .dsv-pane-btn-close svg { display: block; }

    .dsv-drop-ghost {
      position: absolute; z-index: 6; pointer-events: none;
      border-radius: 12px; display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 13%, transparent);
      border: 1.5px dashed color-mix(in srgb, var(--dsw-static-deepseek-500) 65%, transparent);
      transition: all 60ms ease;
    }
    .dsv-drop-label {
      font-size: 12px; line-height: 18px; font-weight: 500;
      color: var(--dsw-static-deepseek-500); background: var(--dsw-alias-bg-base);
      border: 1px solid color-mix(in srgb, var(--dsw-static-deepseek-500) 45%, transparent);
      border-radius: 999px; padding: 2px 10px; white-space: nowrap;
    }
    /* fixed-position variant for the inactive-mode drag bridge (ghost floats
       over the conversation column before any pane exists); inline styles
       carry the pixel box, this only lifts it above the stock chrome */
    .dsv-drop-ghost[data-dsv-fixed] { z-index: 90; }

    /* Live pane reflow (dragging a pane by its header). The wrappers are
       absolutely placed from the split tree for the duration of the drag, so
       the preview can close the dragged pane's slot and open a hole at the
       destination without rebuilding (and remounting) the React tree. The
       split containers become display:contents so the leaf wrappers resolve
       their containing block against the canvas; dividers are hidden. */
    .dsv-canvas.dsv-reflowing .dsv-split-wrap,
    .dsv-canvas.dsv-reflowing .dsv-split { display: contents; }
    .dsv-canvas.dsv-reflowing .dsv-divider { display: none; }
    .dsv-canvas.dsv-reflowing .dsv-pane-wrap {
      position: absolute !important;
      left: var(--dsv-rl, 0px) !important;
      top: var(--dsv-rt, 0px) !important;
      width: var(--dsv-rw, 0px) !important;
      height: var(--dsv-rh, 0px) !important;
      z-index: 1;
      will-change: left, top, width, height;
      transition:
        left .18s cubic-bezier(.22, .61, .36, 1),
        top .18s cubic-bezier(.22, .61, .36, 1),
        width .18s cubic-bezier(.22, .61, .36, 1),
        height .18s cubic-bezier(.22, .61, .36, 1),
        opacity .12s ease;
    }
    .dsv-canvas.dsv-reflowing .dsv-pane-wrap[data-dsv-source] {
      z-index: 0; opacity: 0 !important; pointer-events: none;
    }
    /* The hole is the exact box the drop will fill. It lives on <body> so a
       React commit inside the canvas can never reclaim the node. */
    .dsv-reflow-hole {
      /* Above every stock chrome layer: the stock composer + desktop pet
         are fixed overlays that otherwise paint through an empty slot. */
      position: fixed; z-index: 9998; pointer-events: none;
      left: var(--dsv-rl, 0px); top: var(--dsv-rt, 0px);
      width: var(--dsv-rw, 0px); height: var(--dsv-rh, 0px);
      box-sizing: border-box; border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      /* Opaque: the stock conversation is still mounted underneath the
         split overlay, and an empty slot must not show it through. */
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 6%, var(--dsw-alias-bg-base));
      border: 1.5px dashed color-mix(in srgb, var(--dsw-static-deepseek-500) 55%, transparent);
      box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.04);
      animation: dsv-hole-in .16s ease-out;
      transition:
        left .18s cubic-bezier(.22, .61, .36, 1),
        top .18s cubic-bezier(.22, .61, .36, 1),
        width .18s cubic-bezier(.22, .61, .36, 1),
        height .18s cubic-bezier(.22, .61, .36, 1),
        opacity .12s ease;
    }
    .dsv-reflow-hole[hidden] { display: none; }
    /* External (sidebar → split) hole: names the conversation that will land
       here, so the preview reads as the post-drop pane, not an empty slot. */
    .dsv-ext-hole { flex-direction: column; gap: 4px; padding: 10px; text-align: center; }
    .dsv-hole-title {
      max-width: 92%; font-size: 13px; font-weight: 600; line-height: 18px;
      color: var(--dsw-alias-label-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-hole-sub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
    /* A TOC grip that belongs to the hidden stock conversation, to a
       non-pane view, or to a duplicate pane copy (see tocGripSync). */
    .dsv-toc-hidden { display: none !important; }
    /* While a pane/external drop preview lays the panes out, the grips would
       float over the hole at their old (pre-preview) stops; hide them until
       the layout settles and tocGripSync re-places them. */
    body.dsv-layout-previewing .dsh-ph-toc-grip { display: none !important; }
    @keyframes dsv-hole-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-canvas.dsv-reflowing .dsv-pane-wrap,
      .dsv-reflow-hole { transition: none !important; animation: none !important; }
    }

    /* Virtual window that follows the pointer during a conversation drag. It
       replaces the browser's opaque drag snapshot (setDragImage uses a 1x1
       transparent canvas) so the gesture reads as "carrying a window". */
    .dsv-drag-preview {
      position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none;
      width: 224px; border-radius: 10px; overflow: hidden;
      animation: dsv-preview-in .12s ease-out;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      border: .5px solid var(--dsw-alias-border-l2);
      box-shadow: 0 14px 36px rgba(15, 23, 42, .22), 0 2px 6px rgba(15, 23, 42, .12);
      opacity: .96; will-change: transform; user-select: none;
      contain: strict; backface-visibility: hidden;
      font-family: inherit; color: var(--dsw-alias-label-primary);
      transform: translate3d(-9999px, -9999px, 0);
    }
    /* A cloned conversation can carry hundreds of running animations,
       backdrop filters and shadows; none of them need to repaint inside a
       moving miniature. Killing them keeps the drag at compositor speed. */
    .dsv-drag-preview-clone,
    .dsv-drag-preview-clone * {
      animation: none !important;
      transition: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      box-shadow: none !important;
      text-shadow: none !important;
      filter: none !important;
    }
    .dsv-drag-preview-bar {
      display: flex; align-items: center; gap: 6px; height: 26px;
      padding: 0 9px; background: var(--dsw-alias-bg-layer-2, transparent);
      border-bottom: .5px solid var(--dsw-alias-border-l2);
    }
    .dsv-drag-preview-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; }
    .dsv-drag-preview-dot.r { background: #ff5f57; }
    .dsv-drag-preview-dot.y { background: #febc2e; }
    .dsv-drag-preview-dot.g { background: #28c840; }
    .dsv-drag-preview-title {
      flex: 1; min-width: 0; margin-left: 4px;
      font-size: 11.5px; line-height: 16px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-drag-preview-body {
      padding: 7px 10px 8px; font-size: 11px; line-height: 16px;
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Same-conversation drop guard: a red wash over the pane that cannot take
       the dragged conversation. pointer-events:none keeps HTML5 drag events
       flowing so the wash clears as soon as the pointer leaves. */
    .dsv-pane-invalid[data-dsv-fixed] { position: fixed; inset: auto; z-index: 92; }
    .dsv-drag-preview.leaving { opacity: 0; transition: opacity .12s ease; }
    .dsv-drag-preview.dsv-drag-preview-thumb {
      width: auto; border-radius: 12px;
      background: var(--dsw-alias-bg-base);
      border: 1px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
      box-shadow: 0 18px 44px rgba(15, 23, 42, .26), 0 2px 8px rgba(15, 23, 42, .12);
    }
    /* Lightweight live-text miniature: the real header/title, the visible
       transcript text and a composer strip. A full DOM clone of a long
       conversation cost ~1.7s to rasterise on the first drag frame, so this is
       the default; the full clone remains behind __DSV_REAL_THUMB. */
    .dsv-preview-mini {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      overflow: hidden; background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary); font-family: inherit;
    }
    .dsv-preview-mini-head {
      flex: none; height: 13px; display: flex; align-items: center; gap: 2.5px;
      padding: 0 4px; border-bottom: .5px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, transparent);
    }
    .dsv-preview-mini-dot { flex: none; width: 3px; height: 3px; border-radius: 50%; }
    .dsv-preview-mini-dot.r { background: #ff5f57; }
    .dsv-preview-mini-dot.y { background: #febc2e; }
    .dsv-preview-mini-dot.g { background: #28c840; }
    .dsv-preview-mini-title {
      flex: 1; min-width: 0; margin-left: 2px;
      font-size: 5px; line-height: 1.2; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-preview-mini-body {
      flex: 1 1 auto; min-height: 0; overflow: hidden;
      padding: 3px 5px; color: var(--dsw-alias-label-secondary);
      font-size: 4.2px; line-height: 1.55; white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .dsv-preview-mini-composer {
      flex: none; margin: 3px 4px 4px; height: 13px; box-sizing: border-box;
      display: flex; align-items: center; padding: 0 3px;
      border: .5px solid var(--dsw-alias-border-l2); border-radius: 3px;
      background: var(--dsw-alias-bg-layer-1, transparent);
      font-size: 4px; color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; overflow: hidden;
    }
    .dsv-drag-preview-clone {
      position: absolute; left: 0; top: 0; margin: 0 !important;
      transform-origin: top left; pointer-events: none;
      border-radius: 0 !important; box-shadow: none !important;
    }
    .dsv-pane-invalid {
      position: absolute; inset: 0; z-index: 30; pointer-events: none;
      animation: dsv-fade-in .14s ease-out;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
      border: 1.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 55%, transparent);
      border-radius: inherit;
    }
    .dsv-pane-invalid-card {
      display: flex; align-items: center; gap: 8px;
      max-width: 80%; padding: 8px 13px; border-radius: 10px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-state-error-primary, #e5484d);
      box-shadow: 0 6px 20px rgba(15, 23, 42, .16);
      font-size: 12px; line-height: 18px; font-weight: 500;
    }
    .dsv-pane-invalid-icon { flex: none; font-size: 15px; line-height: 1; }
    .dsv-picker-empty {
      padding: 14px 12px; text-align: center;
      font-size: 12px; line-height: 18px;
      color: var(--dsw-alias-label-tertiary);
    }

    .dsv-empty {
      flex: 1; border: 1.5px dashed var(--dsw-alias-border-l2); border-radius: 16px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; color: var(--dsw-alias-label-tertiary); text-align: center; padding: 20px;
    }
    .dsv-empty-title { font-size: 15px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
    .dsv-empty-hint { font-size: 12px; line-height: 18px; max-width: 420px; }
    .dsv-empty-btn {
      margin-top: 6px; height: 32px; padding: 0 14px; border: none; border-radius: 999px;
      background: var(--dsw-static-deepseek-500); color: #fff; font-size: 13px;
      font-weight: 500; cursor: pointer; font-family: inherit;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .dsv-empty-btn:hover { background: color-mix(in srgb, var(--dsw-static-deepseek-500) 88%, #000); }

    /* ---- fallback transcript (ui-conversation ChatView.module.css) ---- */
    .dsv-chat-root { flex-direction: column; flex: auto; min-height: 0; display: flex; position: relative; }
    .dsv-chat-scroll {
      min-height: 0; padding: 16px calc(var(--dsh-composer-side-clearance) + 12px);
      flex: auto; overflow-y: auto; container-type: inline-size;
    }
    .dsv-chat-column {
      max-width: var(--dsh-chat-content-width); flex-direction: column; gap: 16px;
      width: 100%; margin: 0 auto; display: flex;
    }
    .dsv-flow-item { min-width: 0; }
    .dsv-flow-item:empty { display: none; }
    .dsv-turn-status {
      height: 26px; font: var(--dsw-font-s-strong-14, 600 14px/26px var(--dsw-font-family, system-ui)); white-space: nowrap;
      background: linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);
      color: #0000; -webkit-text-fill-color: transparent; background-position: 100% 0; background-size: 250% 100%;
      -webkit-background-clip: text; background-clip: text; flex: none; align-self: flex-start;
      align-items: center; animation: 1.8s linear infinite dsv-shimmer; display: inline-flex;
    }
    .dsv-turn-status-clock {
      font: var(--dsw-font-xs-13, 400 13px/18px var(--dsw-font-family, system-ui)); font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-caption); -webkit-text-fill-color: var(--dsw-alias-label-caption);
      margin-left: 8px; font-weight: 400;
    }
    @keyframes dsv-shimmer { to { background-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-turn-status { background-position: 0 0; background-size: 100% 100%; animation: none; }
    }
    .dsv-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .dsv-open-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
    .dsv-older { justify-content: center; display: flex; }
    .dsv-older button {
      color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover));
      cursor: pointer; border: none; border-radius: 14px; padding: 4px 12px; font-size: 12px; font-family: inherit;
    }
    .dsv-older button:disabled { cursor: default; opacity: 0.6; }
    .dsv-to-bottom-slot {
      z-index: 8; height: 0; padding-right: 0; pointer-events: none;
      justify-content: flex-end; display: flex; position: sticky; bottom: 12px;
    }
    .dsv-to-bottom {
      border: 1px solid var(--dsw-alias-border-l2); width: 34px; height: 34px;
      color: var(--dsw-alias-label-primary); background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base)));
      box-shadow: var(--dsw-shadow-lv2); cursor: pointer; pointer-events: auto;
      border-radius: 100px; justify-content: center; align-items: center; margin-top: -34px; padding: 0; display: flex;
    }
    .dsv-to-bottom:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover)); }

    /* ---- fallback user bubble (MessageItem.module.css) ---- */
    .dsv-user-row { flex-direction: column; align-items: flex-end; gap: 6px; display: flex; }
    .dsv-user-row[data-pending-steering] { opacity: 0.72; }
    .dsv-user-stack { flex-direction: column; align-items: flex-end; gap: 8px; min-width: 0; max-width: min(525px, 82%); display: flex; }
    .dsv-bubble {
      background: var(--dsw-specific-bubble); max-width: 100%; color: var(--dsw-alias-label-primary);
      border-radius: 22px; padding: 10px 16px; font-size: 16px; line-height: 24px;
      white-space: pre-wrap; overflow-wrap: anywhere;
    }

    /* ---- fallback assistant markdown (AssistantMarkdown.module.css) ---- */
    .dsv-md-root { color: var(--dsw-alias-label-primary); flex-direction: column; font-size: 16px; line-height: 28px; display: flex; }
    .dsv-md-body { flex-direction: column; gap: 16px; display: flex; }
    .dsv-md-stopped {
      background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary);
      border-radius: 6px; align-self: flex-start; padding: 0 6px; font-size: 11px; line-height: 18px;
    }

    /* ---- fallback think row (ReasoningRow.module.css) ---- */
    .dsv-think-root { flex-direction: column; display: flex; }
    .dsv-think-row { position: relative; overflow: hidden; }
    .dsv-think-root[data-state="running"] .dsv-think-row::after {
      content: ""; inset-block: 0; width: 300px; position: absolute; left: 0;
      background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
      pointer-events: none; animation: 2.6s ease-out infinite dsv-row-sweep;
    }
    @keyframes dsv-row-sweep { 0% { left: -300px; } 90%, 100% { left: 100%; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-think-root[data-state="running"] .dsv-think-row::after { animation: none; }
      .dsv-rowcard-root[data-state="running"] .dsv-rowcard-row::after { animation: none; }
    }
    .dsv-think-leading { flex-shrink: 0; }
    .dsv-think-chevron { color: var(--dsw-alias-label-secondary); }
    .dsv-think-title { font-weight: 400; }
    .dsv-think-separator { background: var(--dsw-alias-label-caption); border-radius: 1px; flex: none; width: 2px; height: 2px; margin: 0 8px; }
    .dsv-think-summary { min-width: 0; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; flex: auto; font-size: 14px; line-height: 24px; overflow: hidden; }
    .dsv-think-summary[data-follow-end] { text-overflow: clip; }
    .dsv-think-body { color: var(--dsw-alias-label-tertiary); white-space: pre-wrap; word-break: break-word; padding: 4px 0 4px 22px; font-size: 14px; line-height: 24px; }

    /* ---- fallback command / tool rows (GenericCommandCard.module.css) ---- */
    .dsv-rowcard-root { flex-direction: column; display: flex; }
    .dsv-rowcard-row { position: relative; overflow: hidden; }
    .dsv-rowcard-root[data-state="running"] .dsv-rowcard-row::after {
      content: ""; inset-block: 0; width: 300px; position: absolute; left: 0;
      background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
      pointer-events: none; animation: 2.6s ease-out infinite dsv-row-sweep;
    }
    .dsv-rowcard-leading { flex-shrink: 0; }
    .dsv-rowcard-chevron { color: var(--dsw-alias-label-secondary); }
    .dsv-rowcard-title { font-weight: 400; }
    .dsv-rowcard-separator { background: var(--dsw-alias-label-caption); border-radius: 1px; flex: none; width: 2px; height: 2px; margin: 0 8px; }
    .dsv-rowcard-summary { min-width: 0; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; flex: auto; font-size: 14px; line-height: 24px; overflow: hidden; }
    .dsv-rowcard-summary[data-error] { color: var(--dsw-alias-state-error-primary); }
    .dsv-rowcard-body {
      border: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2)); background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-1, transparent));
      max-height: 260px; color: var(--dsw-alias-label-primary);
      font: var(--dsw-font-markdown-code-block-small, 400 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      white-space: pre-wrap; border-radius: 12px; margin: 4px 0 4px 4px; padding: 12px 16px; overflow: auto;
    }
    .dsv-rowcard-body[data-error] { color: var(--dsw-alias-state-error-primary); }
    .dsv-turn-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; align-self: center; text-align: center; }

    /* ---- fallback composer (InputBar.module.css, simplified) ---- */
    .dsv-composer { flex: none; padding: 0 var(--dsh-composer-side-clearance) 10px; display: flex; flex-direction: column; }
    .dsv-composer-card {
      box-sizing: border-box; width: 100%;
      border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, var(--dsw-alias-border-l2));
      background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, transparent));
      box-shadow: var(--dsw-shadow-lv2); border-radius: 22px;
      flex-direction: column; gap: 8px; padding-top: 10px; font-size: 16px; line-height: 24px; display: flex; position: relative;
    }
    .dsv-composer-text {
      resize: none; width: 100%; color: var(--dsw-alias-label-primary);
      caret-color: var(--dsw-alias-state-business-primary); background: transparent;
      border: none; outline: none; font-family: var(--dsw-font-family, inherit);
      font-size: 16px; line-height: 24px; white-space: pre-wrap; overflow-y: auto;
      padding: 4px 14px 0 16px; max-height: 168px; box-sizing: border-box;
    }
    .dsv-composer-text::placeholder { color: var(--dsw-alias-label-caption); }
    .dsv-composer-text:disabled { cursor: not-allowed; }
    .dsv-composer-row {
      flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;
      min-width: 0; padding: 2px 8px 6px; display: flex;
    }
    .dsv-composer-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); padding-left: 8px; }
    /* The stock hero row (workspace chip + agent-preset chooser) that a pane
       otherwise never renders — see ChatPane's heroBlank note. Geometry rides
       the same clearance/width vars as the composer it sits above, plus the
       card's own 8px text inset on the left, so the seat lines up with the
       workspace chip on the stock page. */
    .dsv-hero-row {
      flex: none; display: flex; align-items: center; gap: 8px; min-width: 0;
      box-sizing: border-box; width: 100%;
      max-width: var(--dsh-composer-card-max-width);
      margin: 0 auto; padding: 0 calc(var(--dsh-composer-side-clearance) + 8px) 6px;
    }
    .dsv-composer-trailing { flex: none; display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .dsv-send {
      background: var(--dsw-alias-button-info-fill, var(--dsw-static-deepseek-500)); color: #fff; cursor: pointer;
      border: none; border-radius: 999px; flex: none; place-items: center; width: 34px; height: 34px;
      transition: background-color .1s; display: grid; transform: translateY(-2px); padding: 0;
    }
    .dsv-send:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--dsw-static-deepseek-500)); }
    .dsv-send:disabled { opacity: 0.4; cursor: default; }
    .dsv-send.stop { background: var(--dsw-alias-state-error-primary); }
    .dsv-send.stop:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 88%, #000); }

    .dsv-visually-hidden { clip: rect(0 0 0 0); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden; }

    /* ---- 1.6.0 safety chrome: every element here is plugin-owned and small,
       fixed to a corner or inside the plugin overlay — it must never cover a
       stock control, and everything respects reduced motion. ---- */
    .dsv-chip {
      position: fixed; right: 12px; bottom: 12px; z-index: 95;
      display: flex; align-items: center; gap: 8px;
      max-width: min(420px, calc(100vw - 24px));
      padding: 8px 10px 8px 12px; border-radius: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      font-size: 12px; line-height: 18px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
    }
    .dsv-chip-text { min-width: 0; }
    .dsv-chip-btn {
      flex: none; height: 24px; padding: 0 10px; border-radius: 7px;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px;
      cursor: pointer;
    }
    .dsv-chip-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-chip-btn.accent { background: var(--dsw-static-deepseek-500); border-color: transparent; color: #fff; }
    .dsv-chip-btn.icon { width: 24px; padding: 0; display: grid; place-items: center; }
    .dsv-help-card, .dsv-tip-card {
      position: absolute; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 9;
      max-width: min(560px, calc(100% - 32px));
      padding: 14px 16px; border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-label-primary);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      font-size: 12px; line-height: 18px;
    }
    .dsv-help-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
    /* fixed variant: used by the inactive "could not start" chip path, where
       the plugin overlay (the card's normal containing block) is not rendered */
    .dsv-help-card-fixed { position: fixed; bottom: 56px; z-index: 95; }
    .dsv-help-row { display: flex; gap: 10px; padding: 2px 0; }
    .dsv-help-keys {
      flex: none; min-width: 150px; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
      color: var(--dsw-static-deepseek-500);
    }
    .dsv-help-body { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
    .dsv-help-actions { display: flex; gap: 8px; margin-top: 10px; }
    .dsv-pane-error {
      flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 8px; padding: 20px; text-align: center;
    }
    .dsv-pane-error-title { font-size: 13px; font-weight: 600; }
    .dsv-pane-error-body { font-size: 11px; color: var(--dsw-alias-label-tertiary); max-width: 90%; overflow-wrap: anywhere; }
    @media (prefers-reduced-motion: reduce) {
      .dsv-drop-ghost { transition: none; }
    }
    `;

    function insertStyle(css) {
      const tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = "split-view";
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    // ---------------------------------------------------------------------
    // icon helpers
    // ---------------------------------------------------------------------

    function PrimIcon(props) {
      const name = props.prim;
      const rest = {};
      for (const key of Object.keys(props)) {
        if (key !== "prim") rest[key] = props[key];
      }
      const C = P[name];
      if (typeof C === "function" || (C !== null && typeof C === "object")) {
        return h(C, rest);
      }
      return h("span", { style: { fontSize: "11px", lineHeight: "12px", opacity: 0.8 } }, "•");
    }

    function SplitIconV({ size }) {
      const s = size || 16;
      return h(
        "svg",
        { viewBox: "0 0 16 16", width: s, height: s, "aria-hidden": true },
        h("rect", { x: 1.5, y: 2.5, width: 5.4, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.4, fill: "none" }),
        h("rect", { x: 9.1, y: 2.5, width: 5.4, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.4, fill: "none" }),
      );
    }
    function SplitIconH({ size }) {
      const s = size || 16;
      return h(
        "svg",
        { viewBox: "0 0 16 16", width: s, height: s, "aria-hidden": true },
        h("rect", { x: 2.5, y: 1.5, width: 11, height: 5.4, rx: 2, stroke: "currentColor", strokeWidth: 1.4, fill: "none" }),
        h("rect", { x: 2.5, y: 9.1, width: 11, height: 5.4, rx: 2, stroke: "currentColor", strokeWidth: 1.4, fill: "none" }),
      );
    }
    /* Close is a plain drawn X. The stock close glyph is not guaranteed to
       exist in every primitives build — a missing primitive falls back to a
       single bullet, which is exactly the "small red dot" the close control
       used to show. The one control that destroys a pane is drawn here. */
    function CloseIcon({ size }) {
      const s = size || 14;
      return h(
        "svg",
        {
          viewBox: "0 0 16 16", width: s, height: s, fill: "none",
          stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round",
          "aria-hidden": true,
        },
        h("path", { d: "M4.4 4.4 11.6 11.6" }),
        h("path", { d: "M11.6 4.4 4.4 11.6" }),
      );
    }

    // ---------------------------------------------------------------------
    // safety layer (1.6.0)
    //
    // The plugin must never leave the user with a broken host. This section
    // owns, before anything else runs:
    //   * the KILL SWITCH   (localStorage dsh.split-workspace.enabled.v1 === "0")
    //   * the CRASH-LOOP GUARD / SAFE MODE
    //                       (localStorage dsh.split-workspace.health.v1, see README)
    //   * the ERROR BUDGET  (boundary catches while the workspace is active)
    //   * host-release compatibility reporting (informational; never blocks)
    //   * the data behind window.__dshSplitWorkspace.health()/retry()/reset()
    // Every storage access is try/catch'd: a throwing localStorage (private
    // mode, storage disabled, quota) degrades to "no persisted state" instead
    // of breaking plugin load. All messages share the [dsh-split-workspace] prefix.
    // ---------------------------------------------------------------------

    function storageGet(key) {
      try { return window.localStorage.getItem(key); } catch { return null; }
    }
    function storageSet(key, value) {
      try { window.localStorage.setItem(key, value); return true; } catch { return false; }
    }
    function storageRemove(key) {
      try { window.localStorage.removeItem(key); return true; } catch { return false; }
    }

    /** Host release from the boot graph the web frontend injects:
        window.__DSH_BOOT__ = { release: { version, commit }, … }. */
    function readHostRelease() {
      try {
        const boot = window.__DSH_BOOT__;
        const release = boot !== null && boot !== undefined ? boot.release : undefined;
        const version = release !== null && release !== undefined ? release.version : undefined;
        return typeof version === "string" && version !== "" ? version : null;
      } catch {
        return null;
      }
    }

    const hostRelease = readHostRelease();
    const testedHost = hostRelease === null ? null : TESTED_RELEASES.indexOf(hostRelease) !== -1;

    /** Persisted crash-loop guard record (dsh.split-workspace.health.v1). */
    function readHealthRecord() {
      const empty = { attempts: 0, lastAttemptAt: 0, lastHealthyAt: 0, safeMode: false, release: null };
      const raw = storageGet(HEALTH_KEY);
      if (raw === null) return empty;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (parsed === null || typeof parsed !== "object") return empty;
      const positive = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
      return {
        attempts: positive(parsed.attempts) > 0 ? Math.min(1000, Math.floor(parsed.attempts)) : 0,
        lastAttemptAt: positive(parsed.lastAttemptAt),
        lastHealthyAt: positive(parsed.lastHealthyAt),
        safeMode: parsed.safeMode === true,
        release: typeof parsed.release === "string" && parsed.release !== "" ? parsed.release : null,
      };
    }

    /** Runtime UI state: one immutable snapshot store for the plugin's own
        chrome and for the diagnostics API. Persisted health fields are mirrored
        here so the API never has to re-read storage. */
    let runtimeState = {
      enabled: storageGet(ENABLED_KEY) !== "0",
      safeMode: false,
      active: false,
      failures: 0,
      lastError: null,
      attempts: 0,
      lastAttemptAt: 0,
      lastHealthyAt: 0,
      epoch: 0,
      generation: 0,
      geometryBlocked: false,
      helpOpen: false,
      tipVisible: false,
      chipDismissed: false,
      geometry: { ok: false, left: 0, right: 0, top: 0, bottom: 0 },
      persistedTree: "unknown",
      maximized: null,
      minimized: readMinimized(),
    };
    const runtimeListeners = new Set();
    function runtimeSnapshot() {
      return runtimeState;
    }
    function runtimeSubscribe(listener) {
      if (listener === undefined || typeof listener !== "function") return () => {};
      runtimeListeners.add(listener);
      return () => { runtimeListeners.delete(listener); };
    }
    function notifyRuntime() {
      for (const listener of [...runtimeListeners]) {
        try { listener(); } catch {}
      }
    }
    function setRuntime(patch) {
      let changed = false;
      for (const key of Object.keys(patch)) {
        if (runtimeState[key] !== patch[key]) { changed = true; break; }
      }
      if (!changed) return runtimeState;
      runtimeState = Object.assign({}, runtimeState, patch);
      notifyRuntime();
      return runtimeState;
    }
    /** The plugin's own state store as a hook (safe before apply() runs). */
    function useRuntime() {
      return React.useSyncExternalStore(runtimeSubscribe, runtimeSnapshot, runtimeSnapshot);
    }

    /** True only when the workspace may take over the viewport at all. The
        `geometryBlocked` flag closes the diagnosis's "invisible active" hole:
        a persisted split whose column cannot be measured must NOT eat the
        user's Alt+T / Alt+Shift+Arrow chords or claim drags while it renders
        nothing (the chrome chip explains the state instead). */
    function dsvOperational() {
      return runtimeState.enabled === true && runtimeState.safeMode !== true
        && runtimeState.geometryBlocked !== true && runtimeState.minimized !== true;
    }

    function persistHealthState() {
      storageSet(HEALTH_KEY, JSON.stringify({
        attempts: runtimeState.attempts,
        lastAttemptAt: runtimeState.lastAttemptAt,
        lastHealthyAt: runtimeState.lastHealthyAt,
        safeMode: runtimeState.safeMode,
        release: PLUGIN_VERSION,
      }));
    }

    /** Bounded failure log for the console (never grows with render count). */
    const failureLog = new Set();
    const failureWindow = [];
    function noteFailure(source, error) {
      const now = Date.now();
      while (failureWindow.length > 0 && now - failureWindow[0] > ERROR_BUDGET_WINDOW_MS) failureWindow.shift();
      failureWindow.push(now);
      const message = source + ": " + String(error === undefined || error === null ? "unknown error" : error).slice(0, 240);
      setRuntime({ failures: failureWindow.length, lastError: message });
      if (failureLog.size < 60 && failureLog.has(message) === false) {
        failureLog.add(message);
        try { console.warn(LOG_PREFIX + " pane component failure (" + message + "). The stock view stays in charge; see window.__dshSplitWorkspace.health()."); } catch {}
      }
      if (runtimeState.active === true && runtimeState.safeMode !== true && failureWindow.length >= ERROR_BUDGET_COUNT) {
        enterSafeMode("error-budget");
      }
    }

    /** Crash-loop safe mode: stop, keep the tree, render only the chip. */
    function enterSafeMode(reason) {
      if (runtimeState.safeMode === true) return false;
      setRuntime({ safeMode: true, active: false, chipDismissed: false, helpOpen: false, tipVisible: false });
      persistHealthState();
      try {
        console.warn(LOG_PREFIX + " split view was paused automatically (" + String(reason || "crash")
          + ") so a failing pane can never take the host down. Your layout is kept and the stock view is untouched."
          + " Retry: window.__dshSplitWorkspace.retry() — Disable: window.__dshSplitWorkspace.setEnabled(false)."
          + " See README > Safety, recovery and diagnostics.");
      } catch {}
      return true;
    }

    /** A deliberate activation attempt: persisted before it can crash. */
    let activationMarked = false;
    function markActivationAttempt() {
      if (activationMarked) return;
      activationMarked = true;
      setRuntime({ attempts: runtimeState.attempts + 1, lastAttemptAt: Date.now() });
      persistHealthState();
    }
    /** The workspace stayed up and responsive: reset the crash counter. */
    function markHealthy() {
      if (runtimeState.safeMode === true) return;
      setRuntime({ attempts: 0, lastHealthyAt: Date.now() });
      persistHealthState();
    }
    /** Low-cost periodic health refresh while the workspace is active. */
    function refreshHealthy() {
      if (runtimeState.safeMode === true || runtimeState.active !== true) return;
      setRuntime({ lastHealthyAt: Date.now() });
      persistHealthState();
    }

    /** Kill switch: stops the workspace unconditionally (persisted). */
    function setEnabled(flag) {
      const next = flag !== false;
      storageSet(ENABLED_KEY, next ? "1" : "0");
      setRuntime({ enabled: next, ...(next ? {} : { active: false, helpOpen: false, tipVisible: false, chipDismissed: false }) });
      return next;
    }

    /** Clear the crash counters + safe mode and re-activate the kept tree. */
    function retryWorkspace() {
      activationMarked = false;
      failureWindow.length = 0;
      failureLog.clear();
      storageRemove(HEALTH_KEY);
      storageSet(ENABLED_KEY, "1");
      setRuntime({
        enabled: true,
        safeMode: false,
        active: false,
        geometryBlocked: false,
        attempts: 0,
        lastAttemptAt: 0,
        lastHealthyAt: 0,
        failures: 0,
        lastError: null,
        chipDismissed: false,
        epoch: runtimeState.epoch + 1,
      });
      return true;
    }

    /** Drop the persisted tree + crash counters and stay in the stock view. */
    function resetWorkspace() {
      activationMarked = false;
      failureWindow.length = 0;
      failureLog.clear();
      storageRemove(HEALTH_KEY);
      let cleared = false;
      try {
        treeStore.reset();
        cleared = true;
      } catch {}
      setRuntime({
        safeMode: false,
        active: false,
        geometryBlocked: false,
        attempts: 0,
        lastAttemptAt: 0,
        lastHealthyAt: 0,
        failures: 0,
        lastError: null,
        helpOpen: false,
        tipVisible: false,
        chipDismissed: false,
        epoch: runtimeState.epoch + 1,
      });
      return { reset: cleared, enabled: runtimeState.enabled };
    }

    /** Serialized health, plain JSON-safe data, never throws. */
    function healthSummary() {
      return {
        pluginVersion: PLUGIN_VERSION,
        hostRelease,
        testedHost,
        testedReleases: TESTED_RELEASES.slice(),
        enabled: runtimeState.enabled,
        safeMode: runtimeState.safeMode,
        active: runtimeState.active,
        minimized: runtimeState.minimized === true,
        geometryBlocked: runtimeState.geometryBlocked === true,
        panes: (() => { try { return treeStore.leafIds().length; } catch { return 0; } })(),
        blockedReason: (() => { try { return blockedReason(); } catch { return "unknown"; } })(),
        failures: runtimeState.failures,
        lastError: runtimeState.lastError,
        geometry: Object.assign({ ok: false, left: 0, right: 0, top: 0, bottom: 0 }, runtimeState.geometry),
        // Per-pane composer-editor ownership. A pane whose composer host does
        // not own the shared Lexical root is a plain contenteditable: typing
        // paints, Enter/Ctrl+A/the "/" trigger feed are dead. That state used to
        // be invisible here ("green health, dead composer"), so surface it.
        editorRoots: (() => {
          const out = [];
          try {
            for (const [sid, guard] of paneEditorGuards) {
              let root = null;
              try {
                if (guard !== null && guard !== undefined && guard.editor !== null && guard.editor !== undefined
                    && typeof guard.editor.getRootElement === "function") {
                  root = guard.editor.getRootElement();
                }
              } catch {}
              let host = null;
              try {
                const pane = document.querySelector('.dsv-pane[data-dsv-pane="' + String(sid).replace(/"/g, '\\"') + '"]');
                host = pane === null ? null : pane.querySelector("[data-composer-input]");
              } catch {}
              out.push({
                sessionId: sid,
                paneHost: host !== null,
                owned: host !== null && root === host,
                rootInPane: host !== null && root !== null
                  && (root === host || (typeof host.contains === "function" && host.contains(root))),
                root: root === null ? null
                  : (root === host ? "this-pane"
                    : (typeof root.closest === "function" && root.closest(".dsv-pane") !== null ? "other-pane" : "elsewhere")),
              });
            }
          } catch {}
          return out;
        })(),
        persistedTree: runtimeState.persistedTree,
        crashGuard: {
          attempts: runtimeState.attempts,
          lastAttemptAt: runtimeState.lastAttemptAt,
          lastHealthyAt: runtimeState.lastHealthyAt,
        },
        release: PLUGIN_VERSION,
      };
    }

    function helpText() {
      return {
        version: PLUGIN_VERSION,
        shortcuts: [
          { keys: "Alt+T", action: "Toggle the focused pane between the full composer and the compact TUI line" },
          { keys: "Alt+Shift+Left/Right/Up/Down", action: "Move keyboard focus to the neighbouring pane" },
        ],
        gestures: [
          "Drag a conversation from the sidebar onto the page to start a split",
          "Drag a pane by its header to move it: its slot closes and a dashed hole previews where it will land",
          "Drag the dividers to resize; ✕ closes a pane; the pane header ❓ opens this help",
        ],
        disable: "window.__dshSplitWorkspace.setEnabled(false) — or localStorage 'dsh.split-workspace.enabled.v1' = \"0\"",
        reset: "window.__dshSplitWorkspace.reset()",
        diagnostics: "window.__dshSplitWorkspace.health()",
        docs: "README — Safety, recovery and diagnostics",
      };
    }

    /** The one reason the workspace is (or is not) taking the viewport. */
    function blockedReason() {
      if (runtimeState.enabled !== true) return "kill-switch";
      if (runtimeState.safeMode === true) return "safe-mode";
      let leaves = 0;
      try { leaves = treeStore.leafIds().length; } catch { return "unknown"; }
      if (leaves < 2) return "no-split";
      if (runtimeState.minimized === true) return "minimized";
      if (runtimeState.active !== true || runtimeState.geometry.ok !== true) return "geometry";
      return null;
    }

    /** Publish the latest column measurement into the runtime state. Only
        changed values notify (the geometry path runs on rAF during sidebar
        transitions), so this can never drive a render loop. It also derives
        `geometryBlocked` — B3 "invisible active": a persisted split whose
        column cannot be measured renders NOTHING, so it must not eat the
        user's chords or treat the phantom workspace as active. */
    function noteGeometry(bounds) {
      const next = {
        ok: bounds !== null && bounds !== undefined && bounds.ok === true,
        left: bounds !== null && bounds !== undefined && typeof bounds.left === "number" ? bounds.left : 0,
        right: bounds !== null && bounds !== undefined && typeof bounds.right === "number" ? bounds.right : 0,
        top: bounds !== null && bounds !== undefined && typeof bounds.top === "number" ? bounds.top : 0,
        bottom: bounds !== null && bounds !== undefined && typeof bounds.bottom === "number" ? bounds.bottom : 0,
      };
      let blocked = false;
      try { blocked = treeStore.leafIds().length >= 2 && next.ok !== true; } catch {}
      const current = runtimeState.geometry;
      const same = current.ok === next.ok && current.left === next.left && current.right === next.right
        && current.top === next.top && current.bottom === next.bottom;
      if (same && runtimeState.geometryBlocked === blocked) return;
      setRuntime(same ? { geometryBlocked: blocked } : { geometry: next, geometryBlocked: blocked });
    }

    /** Diagnostics wrapper: every public method returns plain data, never throws. */
    function safeCall(label, fn, fallback) {
      try {
        return fn();
      } catch (error) {
        try { console.warn(LOG_PREFIX + " " + label + " failed:", String(error).slice(0, 160)); } catch {}
        return fallback;
      }
    }

    // ---- boot-time guard -------------------------------------------------
    (function applyBootHealth() {
      const record = readHealthRecord();
      // A different plugin release resets the guard: this build may be the fix,
      // so a crash counter from an older bundle must not latch the user forever.
      if (record.release !== null && record.release !== PLUGIN_VERSION) {
        storageRemove(HEALTH_KEY);
        return;
      }
      runtimeState = Object.assign({}, runtimeState, {
        attempts: record.attempts,
        lastAttemptAt: record.lastAttemptAt,
        lastHealthyAt: record.lastHealthyAt,
        safeMode: record.safeMode,
      });
      // Crash-loop guard: the previous activation never reached healthy, or the
      // same tree was attempted repeatedly => do NOT auto-activate the persisted
      // tree this boot. The tree itself is kept; only the overlay stays off.
      const neverHealthy = record.lastAttemptAt > record.lastHealthyAt;
      if (record.safeMode !== true && (neverHealthy || record.attempts >= 2)) {
        runtimeState = Object.assign({}, runtimeState, { safeMode: true });
        persistHealthState();
      }
      if (runtimeState.safeMode === true) {
        try {
          console.warn(LOG_PREFIX + " split view is paused in SAFE MODE after a previous crash before it could become healthy."
            + " Your layout is kept and the stock view is untouched. Retry: window.__dshSplitWorkspace.retry() —"
            + " Disable: window.__dshSplitWorkspace.setEnabled(false). See README > Safety, recovery and diagnostics.");
        } catch {}
      }
    })();

    if (runtimeState.enabled !== true) {
      try {
        console.info(LOG_PREFIX + " split view is disabled by the kill switch (localStorage '" + ENABLED_KEY
          + "' = \"0\"). Enable it with window.__dshSplitWorkspace.setEnabled(true).");
      } catch {}
    }
    if (hostRelease !== null && testedHost === false) {
      try {
        console.info(LOG_PREFIX + " host release " + hostRelease + " is not in this build's tested list ("
          + TESTED_RELEASES.join(", ") + "). Split view still activates; the crash-loop guard and safe mode are the protection."
          + " If the UI misbehaves: window.__dshSplitWorkspace.health() / retry() / setEnabled(false). See README > Safety, recovery and diagnostics.");
      } catch {}
    }

    // ---------------------------------------------------------------------
    // split-tree store
    // ---------------------------------------------------------------------

    let splitSeq = 0;
    function nextSplitId() {
      splitSeq += 1;
      return "sp" + splitSeq;
    }

    function leafOf(node, out) {
      if (node === null) return out;
      if (node.t === "leaf") out.push(node.id);
      else for (const kid of node.kids) leafOf(kid, out);
      return out;
    }

    function findLeafNode(node, id) {
      if (node === null) return null;
      if (node.t === "leaf") return node.id === id ? node : null;
      for (const kid of node.kids) {
        const found = findLeafNode(kid, id);
        if (found !== null) return found;
      }
      return null;
    }

    function replaceBySid(node, sid, replacer) {
      if (node === null || node.t !== "split") return node;
      if (node.sid === sid) return replacer(node);
      let changed = false;
      const kids = node.kids.map((kid) => {
        const next = replaceBySid(kid, sid, replacer);
        if (next !== kid) changed = true;
        return next;
      });
      return changed ? { t: "split", sid: node.sid, dir: node.dir, kids, sizes: node.sizes.slice() } : node;
    }

    function removeLeaf(node, id) {
      if (node === null) return [null, false];
      if (node.t === "leaf") return [node, false];
      const kids = [];
      let removed = false;
      for (const kid of node.kids) {
        if (kid.t === "leaf" && kid.id === id) {
          removed = true;
          continue;
        }
        const [nextKid, removedHere] = removeLeaf(kid, id);
        removed = removed || removedHere;
        kids.push(nextKid);
      }
      if (!removed) return [node, false];
      if (kids.length === 0) return [null, true];
      if (kids.length === 1) return [kids[0], true];
      const even = 1 / kids.length;
      return [{ t: "split", sid: node.sid, dir: node.dir, kids, sizes: kids.map(() => even) }, true];
    }

    function splitLeafTree(root, leafId, dir, newId, side) {
      const target = findLeafNode(root, leafId);
      if (target === null) return [root, false];
      const fresh = { t: "leaf", id: newId };
      const pair = side === "before" ? [fresh, target] : [target, fresh];
      const replacement = { t: "split", sid: nextSplitId(), dir, kids: pair, sizes: [0.5, 0.5] };
      function walk(node) {
        if (node === null) return null;
        if (node.t === "leaf") return node === target ? replacement : node;
        const kids = node.kids.map(walk);
        for (let i = 0; i < kids.length; i++) {
          if (kids[i] !== node.kids[i]) {
            return { t: "split", sid: node.sid, dir: node.dir, kids, sizes: node.sizes.slice() };
          }
        }
        return node;
      }
      return [walk(root), true];
    }

    /** Session ids are opaque tokens handed out by the host. Persistence is a
        capability grant, so the id grammar stays strict: short strings only,
        no control characters, no separators that could confuse a CSS selector
        or a DOM attribute. */
    function isValidSessionId(id) {
      if (typeof id !== "string" || id === "" || id.length > MAX_SESSION_ID_LENGTH) return false;
      return /^[A-Za-z0-9._:@+-]+$/.test(id);
    }

    /** Validate + bound a persisted split tree.

        Persistence is the only thing that decides whether the plugin covers the
        stock UI at boot, so a stored tree is treated as untrusted input:
          * leaf ids must pass isValidSessionId,
          * ids must be UNIQUE across the whole tree (two panes on one session
            mount two composers on one Lexical editor — the permanently-dead
            composer state the audit describes),
          * at most MAX_TREE_DEPTH levels (a hand-edited or corrupt payload can
            never stack-overflow a recursive render); the number of panes is
            deliberately NOT capped,
          * sizes are normalized again after dropped kids.
        `seen`/`stats` are threaded through the recursion; the caller decides
        whether a repaired tree is kept (repaired) or a null result is discarded. */
    function normalizeTree(value, options) {
      const context = options === undefined || options === null ? {} : options;
      const depth = typeof context.depth === "number" ? context.depth : 0;
      const seen = context.seen instanceof Set ? context.seen : new Set();
      const stats = context.stats !== undefined && context.stats !== null ? context.stats : { duplicates: 0, depthLimited: 0 };
      if (value === null || typeof value !== "object") return null;
      if (depth > MAX_TREE_DEPTH) { stats.depthLimited += 1; return null; }
      if (value.t === "leaf") {
        if (!isValidSessionId(value.id)) return null;
        if (seen.has(value.id)) { stats.duplicates += 1; return null; }
        seen.add(value.id);
        return { t: "leaf", id: value.id };
      }
      if (value.t === "split" && (value.dir === "h" || value.dir === "v") && Array.isArray(value.kids)) {
        const kids = [];
        for (const kid of value.kids) {
          const normalized = normalizeTree(kid, { depth: depth + 1, seen, stats });
          if (normalized !== null) kids.push(normalized);
        }
        if (kids.length === 0) return null;
        if (kids.length === 1) return kids[0];
        const even = 1 / kids.length;
        const sizes = Array.isArray(value.sizes) && value.sizes.length === kids.length
          ? value.sizes.map((s) => (typeof s === "number" && Number.isFinite(s) && s > 0.05 ? s : even))
          : kids.map(() => even);
        const total = sizes.reduce((a, b) => a + b, 0) || 1;
        return {
          t: "split",
          sid: typeof value.sid === "string" && value.sid !== "" ? value.sid : nextSplitId(),
          dir: value.dir,
          kids,
          sizes: sizes.map((s) => s / total),
        };
      }
      return null;
    }

    function replaceLeafId(node, leafId, newId) {
      if (node === null || node === undefined) return null;
      if (node.t === "leaf") return node.id === leafId ? { t: "leaf", id: newId } : node;
      const kids = node.kids.map((kid) => replaceLeafId(kid, leafId, newId));
      let changed = false;
      for (let i = 0; i < kids.length; i++) if (kids[i] !== node.kids[i]) changed = true;
      return changed ? { t: "split", sid: node.sid, dir: node.dir, kids, sizes: node.sizes.slice() } : node;
    }

    function autoLayoutMode(count, aspect) {
      if (count <= 1) return "columns";
      if (count === 2) return aspect >= 1.05 ? "columns" : "rows";
      return "grid";
    }
    function buildArrangedRoot(ids, mode) {
      const leaves = ids.map((id) => ({ t: "leaf", id }));
      const equal = leaves.map(() => 1 / Math.max(1, leaves.length));
      if (leaves.length === 1) return leaves[0];
      if (mode !== "grid" || leaves.length === 2) {
        const dir = mode === "rows" ? "v" : "h";
        return { t: "split", sid: nextSplitId(), dir, kids: leaves, sizes: equal };
      }
      if (leaves.length === 3) {
        return {
          t: "split", sid: nextSplitId(), dir: "v", sizes: [0.5, 0.5],
          kids: [
            { t: "split", sid: nextSplitId(), dir: "h", kids: [leaves[0], leaves[1]], sizes: [0.5, 0.5] },
            leaves[2],
          ],
        };
      }
      // 4+ panes: a balanced row-major grid. Four keeps the familiar 2x2;
      // larger counts grow by roughly sqrt(n) columns, so the grid stays as
      // square as the pane count allows instead of stretching one row.
      const cols = leaves.length === 4 ? 2 : Math.max(2, Math.ceil(Math.sqrt(leaves.length)));
      const rows = Math.ceil(leaves.length / cols);
      const rowKids = [];
      for (let row = 0; row < rows; row += 1) {
        const slice = leaves.slice(row * cols, (row + 1) * cols);
        rowKids.push(slice.length === 1 ? slice[0] : {
          t: "split", sid: nextSplitId(), dir: "h", kids: slice,
          sizes: slice.map(() => 1 / slice.length),
        });
      }
      return {
        t: "split", sid: nextSplitId(), dir: "v", kids: rowKids,
        sizes: rowKids.map(() => 1 / rows),
      };
    }

    function createTreeStore() {
      let state = { root: null, focus: null };
      let revision = 0;
      const listeners = new Set();

      // ---- defensive load: validate, de-duplicate, cap, discard-on-invalid --
      // The persisted tree is the capability grant that decides whether the
      // plugin covers the stock UI at boot; it is never trusted verbatim.
      let persistedStatus = "absent";
      const raw = storageGet(TREE_KEY);
      if (raw !== null) {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        const stats = { duplicates: 0, depthLimited: 0 };
        const root = parsed !== null && parsed !== undefined && typeof parsed === "object"
          ? normalizeTree(parsed.root, { depth: 0, seen: new Set(), stats })
          : null;
        if (root !== null) {
          state = { root, focus: null };
          const repaired = stats.duplicates > 0 || stats.depthLimited > 0;
          persistedStatus = repaired ? "repaired" : "ok";
          if (repaired) {
            try {
              console.warn(LOG_PREFIX + " the saved split layout was repaired on load (duplicate panes dropped: "
                + stats.duplicates + ", too-deep nodes: " + stats.depthLimited + ").");
            } catch {}
            // Persist the repaired tree immediately: the bad payload must never
            // be re-read after a reload.
            storageSet(TREE_KEY, JSON.stringify({ root }));
          }
        } else {
          persistedStatus = "invalid";
          storageRemove(TREE_KEY);
          try {
            console.warn(LOG_PREFIX + " the saved split layout is invalid and was DISCARDED (the stock view stays in charge)."
              + " Reset: window.__dshSplitWorkspace.reset(). See README > Safety, recovery and diagnostics.");
          } catch {}
        }
      }
      setRuntime({ persistedTree: persistedStatus });

      function commit(next, skipPersist) {
        const before = leafOf(state.root, []);
        state = next;
        const ids = leafOf(state.root, []);
        const after = new Set(ids);
        if (state.focus === null || !ids.includes(state.focus)) state = { root: state.root, focus: ids[0] ?? null };
        // EVERY leaf-mutation path funnels through commit, so this is where
        // departed panes are scheduled for resource disposal (the audit's
        // "only the ✕ button tears down" leak: sidebar swaps, closeFocused and
        // movePane all bypassed the old handler).
        for (const id of before) {
          if (!after.has(id)) deferPaneDisposeCheck(id);
        }
        if (runtimeState.maximized !== null && !after.has(runtimeState.maximized)) {
          setRuntime({ maximized: null });
        }
        if (skipPersist !== true) {
          storageSet(TREE_KEY, JSON.stringify({ root: state.root }));
          setRuntime({ persistedTree: state.root === null ? "absent" : "ok" });
        }
        revision += 1;
        for (const listener of [...listeners]) listener();
      }

      return {
        getSnapshot: () => state,
        getRevision: () => revision,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        leafIds: () => leafOf(state.root, []),
        /** The workspace only takes the viewport when it actually SPLITS:
            two or more panes. With zero or one pane the stock view stays
            untouched (and fully interactive) — see the activation gate notes
            in WorkspaceApp. */
        isActive: () => leafOf(state.root, []).length >= 2,
        /** Hard reset: drop the persisted tree and stay in the stock view. */
        reset() {
          state = { root: null, focus: null };
          storageRemove(TREE_KEY);
          revision += 1;
          setRuntime({ persistedTree: "absent" });
          for (const listener of [...listeners]) listener();
        },
        setFocus(id) {
          if (state.focus === id) return;
          state = { root: state.root, focus: id };
          revision += 1;
          for (const listener of [...listeners]) listener();
        },
        // Swap the focused leaf's session to the native sidebar's current
        // session (click-to-swap). If that session is already a pane, focus it;
        // if there is no focused leaf yet, fall back to addPane.
        swapFocus(id) {
          if (state.focus === id) {
            if (findLeafNode(state.root, id) !== null) return;
          }
          if (findLeafNode(state.root, id) !== null) {
            commit({ root: state.root, focus: id });
            return;
          }
          const focus = state.focus ?? leafOf(state.root, [])[0];
          if (focus === undefined || findLeafNode(state.root, focus) === null) {
            this.addPane(id);
            return;
          }
          const next = replaceLeafId(state.root, focus, id);
          if (next === null) {
            this.addPane(id);
            return;
          }
          commit({ root: next, focus: id });
        },
        addPane(sessionId) {
          if (!isValidSessionId(sessionId)) return;
          if (findLeafNode(state.root, sessionId) !== null) {
            commit({ root: state.root, focus: sessionId });
            return;
          }
          if (state.root === null) {
            commit({ root: { t: "leaf", id: sessionId }, focus: sessionId });
            return;
          }
          const anchor = state.focus ?? leafOf(state.root, [])[0];
          if (anchor === undefined || findLeafNode(state.root, anchor) === null) {
            commit({
              root: { t: "split", sid: nextSplitId(), dir: "h", kids: [state.root, { t: "leaf", id: sessionId }], sizes: [0.5, 0.5] },
              focus: sessionId,
            });
            this.settleAuto();
            return;
          }
          const [next] = splitLeafTree(state.root, anchor, "h", sessionId, "after");
          commit({ root: next, focus: sessionId });
          this.settleAuto();
        },
        settleAuto() {
          const ids = leafOf(state.root, []);
          if (ids.length < 2) return;
          const root = buildArrangedRoot(ids, autoLayoutMode(ids.length, 1.2));
          commit({ root, focus: state.focus !== null && ids.includes(state.focus) ? state.focus : ids[0] });
        },
        // Public `arrange()` compatibility: the menu is gone, so every call
        // re-runs AUTO against the live aspect (an explicit mode is ignored).
        arrange(_mode, aspect) {
          const ids = leafOf(state.root, []);
          if (ids.length === 0) return;
          const root = buildArrangedRoot(ids, autoLayoutMode(ids.length, aspect));
          commit({ root, focus: state.focus !== null && ids.includes(state.focus) ? state.focus : ids[0] });
        },
        splitLeaf(leafId, dir, newId, side) {
          if (!isValidSessionId(newId)) return;
          if (findLeafNode(state.root, newId) !== null) {
            commit({ root: state.root, focus: newId });
            return;
          }
          const [next, ok] = splitLeafTree(state.root, leafId, dir, newId, side);
          // A directional split must keep the direction the user aimed at.
          // settleAuto() used to rewrite every split into the auto layout
          // (2 panes => columns), so dropping on the bottom edge still landed
          // right. Auto-arrange stays on addPane/closeLeaf, where no direction
          // was requested.
          if (ok) commit({ root: next, focus: newId });
        },
        closeLeaf(id) {
          const [next, removed] = removeLeaf(state.root, id);
          if (removed) { commit({ root: next, focus: state.focus }); this.settleAuto(); }
        },
        movePane(srcId, dstId, zone) {
          if (srcId === dstId) return;
          const [afterRemove, removed] = removeLeaf(state.root, srcId);
          if (!removed) {
            this.splitLeaf(dstId, zone.dir, srcId, zone.side);
            return;
          }
          if (afterRemove === null) {
            commit({ root: { t: "leaf", id: dstId }, focus: state.focus });
            this.splitLeaf(dstId, zone.dir, srcId, zone.side);
            return;
          }
          const [next, ok] = splitLeafTree(afterRemove, dstId, zone.dir, srcId, zone.side);
          if (ok) commit({ root: next, focus: state.focus });
        },
        /** Commit a tree that was computed OUTSIDE the store (the live drag
            preview). The preview already knows the exact tree the drop must
            produce, so recomputing it here could only introduce a mismatch
            (the split ids are fresh, and a set of new ids would remount the
            panes the preview was showing). */
        replaceRoot(root) {
          if (root === null) return;
          commit({ root, focus: state.focus });
        },
        setSizes(sid, sizes) {
          const root = replaceBySid(state.root, sid, (node) => ({ t: "split", sid: node.sid, dir: node.dir, kids: node.kids, sizes }));
          if (root !== state.root) commit({ root, focus: state.focus }, true); // live drag: no persist per move
        },
        persistNow() {
          storageSet(TREE_KEY, JSON.stringify({ root: state.root }));
        },
      };
    }

    const treeStore = createTreeStore();

    let dragPayload = null; // { kind: 'session' | 'pane', id }

    // ---------------------------------------------------------------------
    // live pane reflow
    //
    // Dragging a pane by its header behaves like dragging a grid tile: the
    // dragged pane's slot closes immediately (the remaining panes fill it),
    // and moving over another pane opens a hole on the side the gesture is
    // heading for, so the destination is visible before the mouse is
    // released. The preview is PURE GEOMETRY — the React tree is untouched
    // until the drop. Rebuilding the tree on every hover would remount every
    // re-hosted ChatView (transcript reload, composer state) and would make
    // the preview jitter; the wrappers are absolutely placed for the length
    // of the drag instead, and the real tree is swapped in once on drop.
    // ---------------------------------------------------------------------
    const REFLOW_HOLE_ID = "__dsv_hole__";
    const reflowState = {
      active: false,     // drag is ours; document listeners act on it
      armed: false,      // preview applied (never inside dragstart itself)
      settling: false,   // cancel animation is running, class still applied
      sourceId: null,
      root: null,        // tree snapshot taken at drag start
      canvas: null,
      canvasRect: null,  // client rect of the canvas at drag start
      originalRects: null, // leaf id -> { left, top, width, height } (canvas space)
      sourceRect: null,  // the dragged pane's slot at drag start
      collapsedRects: null, // layout after removing the source (what is on screen)
      leftSource: false, // pointer has left the source slot at least once
      wrappers: null,    // leaf id -> .dsv-pane-wrap element
      rects: null,       // geometry currently applied
      hole: null,
      targetId: null,
      zone: null,        // { dir, side, label }
      acc: { x: 0, y: 0 }, // movement since the last direction decision
      direction: null,   // last committed gesture direction (pauses keep it)
      last: null,
      start: null,
      timer: 0,          // settle animation timer
      pendingTimer: 0,   // deferred dragend finish (a drop may arrive after it)
      dropped: false,
      overCount: 0,
      dropCount: 0,
      endCount: 0,
      lastOver: null,
      lastDrop: null,
    };

    function setReflowBox(el, rect) {
      el.style.setProperty("--dsv-rl", rect.left + "px");
      el.style.setProperty("--dsv-rt", rect.top + "px");
      el.style.setProperty("--dsv-rw", rect.width + "px");
      el.style.setProperty("--dsv-rh", rect.height + "px");
    }
    function clearReflowBox(el) {
      el.style.removeProperty("--dsv-rl");
      el.style.removeProperty("--dsv-rt");
      el.style.removeProperty("--dsv-rw");
      el.style.removeProperty("--dsv-rh");
    }

    function reflowWrappers(canvas) {
      const map = new Map();
      for (const el of canvas.querySelectorAll(".dsv-pane-wrap[data-dsv-leaf]")) {
        map.set(el.getAttribute("data-dsv-leaf"), el);
      }
      return map;
    }

    /** Rects for a tree laid out in `box`, measured in canvas space. Mirrors
        RenderSplit/childStyle: dividers take GAP px out of the axis, the
        kids split the rest by ratio. */
    function reflowLayoutRects(node, box, out) {
      if (node === null || node === undefined) return out;
      if (node.t === "leaf") {
        out[node.id] = { left: box.left, top: box.top, width: box.width, height: box.height };
        return out;
      }
      const kids = Array.isArray(node.kids) ? node.kids : [];
      if (kids.length === 1) {
        reflowLayoutRects(kids[0], box, out);
        return out;
      }
      const horizontal = node.dir === "h";
      const avail = Math.max(0, (horizontal ? box.width : box.height) - GAP * (kids.length - 1));
      const sizes = Array.isArray(node.sizes) && node.sizes.length === kids.length
        ? node.sizes
        : kids.map(() => 1 / kids.length);
      let offset = 0;
      for (let i = 0; i < kids.length; i++) {
        const size = Math.max(0, sizes[i] * avail);
        reflowLayoutRects(
          kids[i],
          horizontal
            ? { left: box.left + offset, top: box.top, width: size, height: box.height }
            : { left: box.left, top: box.top + offset, width: box.width, height: size },
          out,
        );
        offset += size + GAP;
      }
      return out;
    }

    function reflowZoneFor(direction) {
      if (direction === "left") return { dir: "h", side: "before", label: "dropSplitLeft" };
      if (direction === "right") return { dir: "h", side: "after", label: "dropSplitRight" };
      if (direction === "up") return { dir: "v", side: "before", label: "dropSplitTop" };
      if (direction === "down") return { dir: "v", side: "after", label: "dropSplitBottom" };
      return null;
    }

    /** The tree the drop would produce: the source is removed first (its slot
        closes) and then re-inserted beside the target — the same arithmetic
        as treeStore.movePane, with the new leaf named either the preview's
        placeholder or the real session id. */
    function reflowTree(root, sourceId, targetId, zone, newLeafId) {
      if (root === null) return null;
      const [base] = removeLeaf(root, sourceId);
      if (targetId === null || zone === null) return base;
      if (base === null) return null;
      const [tree, ok] = splitLeafTree(base, targetId, zone.dir, newLeafId, zone.side);
      return ok ? tree : base;
    }

    /** Commit a direction after ~8px of movement, whichever way that motion
        pointed. Accumulating (rather than reading the last event) makes slow
        drags work, keeps a pause from erasing the hole, and lets a deliberate
        L-shaped move switch the drop side in one gesture. */
    function reflowNoteMotion(dx, dy) {
      reflowState.acc.x += dx;
      reflowState.acc.y += dy;
      if (Math.hypot(reflowState.acc.x, reflowState.acc.y) < 8) return;
      const ax = Math.abs(reflowState.acc.x);
      const ay = Math.abs(reflowState.acc.y);
      if (ax >= ay) reflowState.direction = reflowState.acc.x >= 0 ? "right" : "left";
      else reflowState.direction = reflowState.acc.y >= 0 ? "down" : "up";
      reflowState.acc.x = 0;
      reflowState.acc.y = 0;
    }

    function reflowHole() {
      if (reflowState.hole !== null && reflowState.hole.isConnected) return reflowState.hole;
      const hole = document.createElement("div");
      hole.className = "dsv-reflow-hole";
      hole.dataset.plugin = PLUGIN_ID;
      hole.dataset.dsvFixed = "true";
      const label = document.createElement("span");
      label.className = "dsv-drop-label";
      hole.appendChild(label);
      hole.hidden = true;
      document.body.appendChild(hole);
      reflowState.hole = hole;
      return hole;
    }

    function reflowApply(tree, zone) {
      const canvas = reflowState.canvas;
      if (canvas === null || tree === null || reflowState.canvasRect === null) return;
      const rects = reflowLayoutRects(tree, { left: 0, top: 0, width: reflowState.canvasRect.width, height: reflowState.canvasRect.height }, {});
      for (const [id, el] of reflowState.wrappers) {
        const rect = rects[id];
        if (rect !== undefined) setReflowBox(el, rect);
      }
      const holeRect = zone !== null ? rects[REFLOW_HOLE_ID] : undefined;
      const hole = reflowHole();
      if (holeRect === undefined) {
        hole.hidden = true;
      } else {
        hole.hidden = false;
        const left = reflowState.canvasRect.left + holeRect.left;
        const top = reflowState.canvasRect.top + holeRect.top;
        hole.style.left = left + "px";
        hole.style.top = top + "px";
        hole.style.width = holeRect.width + "px";
        hole.style.height = holeRect.height + "px";
        hole.firstChild.textContent = t(zone.label);
      }
      reflowState.rects = rects;
    }

    function beginPaneReflow(sessionId, frameEl) {
      try {
        if (!treeStore.isActive()) return;
        if (runtimeState.maximized !== null) return;
        if (frameEl === null || frameEl === undefined || typeof frameEl.closest !== "function") return;
        const canvas = frameEl.closest(".dsv-canvas");
        if (canvas === null) return;
        endPaneReflow(false);
        const origin = canvas.getBoundingClientRect();
        const wrappers = reflowWrappers(canvas);
        if (wrappers.size < 2) return;
        const rects = {};
        for (const [id, el] of wrappers) {
          const r = el.getBoundingClientRect();
          rects[id] = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
        }
        reflowState.active = true;
        reflowState.armed = false;
        reflowState.settling = false;
        reflowState.sourceId = sessionId;
        reflowState.root = treeStore.getSnapshot().root;
        reflowState.canvas = canvas;
        reflowState.canvasRect = origin;
        reflowState.originalRects = rects;
        reflowState.sourceRect = rects[sessionId] !== undefined ? rects[sessionId] : null;
        const [baseTree] = removeLeaf(reflowState.root, sessionId);
        reflowState.collapsedRects = baseTree === null
          ? {}
          : reflowLayoutRects(baseTree, { left: 0, top: 0, width: origin.width, height: origin.height }, {});
        reflowState.leftSource = false;
        reflowState.wrappers = wrappers;
        reflowState.rects = null;
        reflowState.targetId = null;
        reflowState.zone = null;
        reflowState.acc = { x: 0, y: 0 };
        reflowState.direction = null;
        reflowState.last = null;
        reflowState.start = null;
        reflowState.timer = 0;
        reflowState.pendingTimer = 0;
        reflowState.dropped = false;
        reflowState.overCount = 0;
        reflowState.dropCount = 0;
        reflowState.endCount = 0;
        reflowState.lastOver = null;
        reflowState.lastDrop = null;
      } catch {
        endPaneReflow(false);
      }
    }

    /** First dragover: the drag is definitely in flight, so hiding the drag
        source now can no longer cancel it. Seed the absolute boxes with the
        live flex geometry, force one layout, then let the collapse run. */
    function reflowArm() {
      if (!reflowState.active || reflowState.armed) return;
      const canvas = reflowState.canvas;
      if (canvas === null || !canvas.isConnected) {
        endPaneReflow(false);
        return;
      }
      reflowState.wrappers = reflowWrappers(canvas);
      canvas.classList.add("dsv-reflowing");
      document.body.classList.add("dsv-layout-previewing");
      for (const [id, el] of reflowState.wrappers) {
        const rect = reflowState.originalRects[id];
        if (rect !== undefined) setReflowBox(el, rect);
        if (id === reflowState.sourceId) {
          el.setAttribute("data-dsv-source", "");
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        }
      }
      // Positions transitioned from `auto` do not animate: establish the
      // start values with a synchronous layout read first.
      void canvas.offsetWidth;
      reflowApply(reflowTree(reflowState.root, reflowState.sourceId, null, null, REFLOW_HOLE_ID), null);
      reflowState.armed = true;
    }

    function updatePaneReflow(event) {
      if (!reflowState.active) return;
      if (!reflowState.armed) reflowArm();
      if (!reflowState.active || !reflowState.armed) return;
      const origin = reflowState.canvasRect;
      if (origin === null) return;
      const x = event.clientX;
      const y = event.clientY;
      reflowState.overCount += 1;
      reflowState.lastOver = { x: Math.round(x), y: Math.round(y) };
      if (reflowState.start === null) {
        reflowState.start = { x, y };
        reflowState.last = { x, y, t: event.timeStamp };
      } else {
        reflowNoteMotion(x - reflowState.last.x, y - reflowState.last.y);
        reflowState.last = { x, y, t: event.timeStamp };
      }
      const moved = Math.hypot(x - reflowState.start.x, y - reflowState.start.y);
      if (moved < 8) return;
      const rx = x - origin.left;
      const ry = y - origin.top;
      const sourceRect = reflowState.sourceRect;
      if (sourceRect !== null
        && (rx < sourceRect.left || rx > sourceRect.left + sourceRect.width
          || ry < sourceRect.top || ry > sourceRect.top + sourceRect.height)) {
        // The source slot answers "no target" only UNTIL the pointer leaves
        // it once. After that the same screen area belongs to the pane that
        // expanded into it, so dragging back over the old slot must show a
        // hole again (the returned-to-home case).
        reflowState.leftSource = true;
      }
      // Hit-test the COLLAPSED layout: that is exactly what the screen shows
      // after the source slot closed, and it is fixed for the whole drag, so
      // the preview can never steer its own next target.
      let targetId = null;
      if (reflowState.leftSource && rx >= 0 && ry >= 0 && rx <= origin.width && ry <= origin.height) {
        for (const [id, rect] of Object.entries(reflowState.collapsedRects)) {
          if (rx >= rect.left && rx <= rect.left + rect.width && ry >= rect.top && ry <= rect.top + rect.height) {
            targetId = id;
            break;
          }
        }
      }
      // A pause before release can deliver one final zero-delta dragover;
      // letting that erase the direction would close the hole under the
      // cursor and drop as a no-op. reflowNoteMotion only commits on movement.
      const direction = reflowState.direction;
      const zone = targetId !== null && direction !== null ? reflowZoneFor(direction) : null;
      const sameZone = zone === null
        ? reflowState.zone === null
        : reflowState.zone !== null && reflowState.zone.label === zone.label;
      if (targetId === reflowState.targetId && sameZone) return;
      reflowState.targetId = targetId;
      reflowState.zone = zone;
      reflowApply(reflowTree(reflowState.root, reflowState.sourceId, targetId, zone, REFLOW_HOLE_ID), zone);
    }

    function sameTreeShape(a, b) {
      if (a === b) return true;
      if (a === null || b === null || a === undefined || b === undefined) return false;
      if (a.t !== b.t) return false;
      if (a.t === "leaf") return a.id === b.id;
      if (a.dir !== b.dir || !Array.isArray(a.kids) || !Array.isArray(b.kids) || a.kids.length !== b.kids.length) return false;
      for (let i = 0; i < a.kids.length; i += 1) {
        if (!sameTreeShape(a.kids[i], b.kids[i])) return false;
      }
      return true;
    }

    function collapsePaneReflow() {
      const state = reflowState;
      if (state.timer !== 0) {
        try { window.clearTimeout(state.timer); } catch {}
        state.timer = 0;
      }
      if (state.pendingTimer !== 0) {
        try { window.clearTimeout(state.pendingTimer); } catch {}
        state.pendingTimer = 0;
      }
      const canvas = state.canvas;
      if (canvas !== null) canvas.classList.remove("dsv-reflowing");
      document.body.classList.remove("dsv-layout-previewing");
      scheduleTocGripSync(260);
      if (state.wrappers !== null) {
        for (const el of state.wrappers.values()) {
          if (el !== null && el !== undefined) {
            el.removeAttribute("data-dsv-source");
            el.style.opacity = "";
            el.style.pointerEvents = "";
            clearReflowBox(el);
          }
        }
      }
      if (state.hole !== null) {
        const hole = state.hole;
        state.hole = null;
        try { hole.remove(); } catch {}
      }
      state.active = false;
      state.armed = false;
      state.settling = false;
      state.sourceId = null;
      state.root = null;
      state.canvas = null;
      state.canvasRect = null;
      state.originalRects = null;
      state.sourceRect = null;
      state.collapsedRects = null;
      state.leftSource = false;
      state.wrappers = null;
      state.rects = null;
      state.targetId = null;
      state.zone = null;
      state.last = null;
      state.start = null;
      state.direction = null;
      state.acc = { x: 0, y: 0 };
      state.dropped = false;
    }

    /** End the drag: on a drop the committed tree already equals the preview,
        so the class is removed in the same frame as the commit. On a cancel,
        the panes glide back to the boxes measured at drag start first. */
    function endPaneReflow(animateBack) {
      if (!reflowState.active && !reflowState.settling) return;
      const canAnimate = animateBack !== false
        && reflowState.armed
        && reflowState.canvas !== null
        && reflowState.canvas.isConnected
        && reflowState.wrappers !== null
        && reflowState.originalRects !== null
        && !prefersReducedMotion();
      if (!canAnimate) {
        collapsePaneReflow();
        return;
      }
      for (const [id, el] of reflowState.wrappers) {
        const rect = reflowState.originalRects[id];
        if (rect !== undefined) setReflowBox(el, rect);
        el.removeAttribute("data-dsv-source");
        el.style.opacity = "";
        el.style.pointerEvents = "";
      }
      if (reflowState.hole !== null) reflowState.hole.hidden = true;
      reflowState.active = false;
      reflowState.settling = true;
      reflowState.timer = window.setTimeout(() => {
        reflowState.timer = 0;
        collapsePaneReflow();
      }, 220);
    }

    function dropPaneReflow() {
      if (!reflowState.active && !reflowState.settling) return;
      if (reflowState.pendingTimer !== 0) {
        try { window.clearTimeout(reflowState.pendingTimer); } catch {}
        reflowState.pendingTimer = 0;
      }
      const root = reflowState.root;
      const sourceId = reflowState.sourceId;
      const targetId = reflowState.targetId;
      const zone = reflowState.zone;
      // A tree changed under the drag (a pane closed from a keyboard path,
      // a session swap) invalidates the preview: do not resurrect leaves.
      const current = treeStore.getSnapshot().root;
      const finalTree = targetId !== null && zone !== null && current === root
        ? reflowTree(root, sourceId, targetId, zone, sourceId)
        : null;
      reflowState.dropCount += 1;
      reflowState.lastDrop = {
        sourceId,
        targetId,
        zone: zone === null ? null : zone.label,
        active: reflowState.active,
        settling: reflowState.settling,
        treeChanged: current !== root,
        commit: finalTree !== null && !sameTreeShape(finalTree, current),
      };
      collapsePaneReflow();
      if (finalTree !== null && !sameTreeShape(finalTree, current)) {
        treeStore.replaceRoot(finalTree);
      }
    }

    /** dragend does not always arrive after drop: Chromium's synthesized
        drag gestures have delivered it first, and the old immediate cancel
        swallowed the drop. Defer one task; if a drop lands in that window the
        commit wins, otherwise the preview glides back. */
    function finishPaneReflowGesture() {
      if (!reflowState.active && !reflowState.settling) return;
      if (reflowState.pendingTimer !== 0) return;
      reflowState.pendingTimer = window.setTimeout(() => {
        reflowState.pendingTimer = 0;
        if (!reflowState.active && !reflowState.settling) return;
        reflowState.endCount += 1;
        if (reflowState.dropped) dropPaneReflow();
        else endPaneReflow(true);
      }, 0);
    }

    function registerPaneReflow() {
      const onDragOver = (event) => {
        if (!reflowState.active) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = "move"; } catch {}
        event.stopPropagation();
        updatePaneReflow(event);
      };
      const onDrop = (event) => {
        if (!reflowState.active && !reflowState.settling) return;
        event.preventDefault();
        event.stopPropagation();
        reflowState.dropped = true;
        dropPaneReflow();
      };
      const onDragEnd = () => {
        finishPaneReflowGesture();
      };
      // Escape is deliberately NOT handled here: Chromium cancels the native
      // drag itself and fires dragend, and deactivating the preview mid-flight
      // would let a later drop fall through to the pane's own handler.
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("dragend", onDragEnd, true);
      window.addEventListener("blur", onDragEnd);
      return () => {
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("dragend", onDragEnd, true);
        window.removeEventListener("blur", onDragEnd);
        if (reflowState.timer !== 0) {
          try { window.clearTimeout(reflowState.timer); } catch {}
          reflowState.timer = 0;
        }
        if (reflowState.pendingTimer !== 0) {
          try { window.clearTimeout(reflowState.pendingTimer); } catch {}
          reflowState.pendingTimer = 0;
        }
        collapsePaneReflow();
      };
    }

    // ---------------------------------------------------------------------
    // live EXTERNAL drop preview (sidebar conversation -> workspace)
    //
    // Dropping a conversation dragged out of the stock sidebar onto a pane
    // edge splits that pane. A dashed 50% ghost used to be the only feedback,
    // so the user never saw what the split would actually look like until the
    // mouse was released. The preview below lays the REAL tree out before the
    // drop: every existing pane is absolutely placed at its post-drop box and
    // the new pane's slot is a hole showing the dragged conversation's title.
    // Nothing is committed until the drop; the store's own splitLeaf/addPane
    // then performs the exact mutation the geometry promised.
    // ---------------------------------------------------------------------
    const EXT_REFLOW_LEAF = "__dsv_ext__";
    const extReflow = {
      active: false,
      armed: false,
      canvas: null,
      canvasRect: null,
      wrappers: null,
      originalRects: null,
      root: null,
      sessionId: null,
      title: "",
      targetId: null,
      zone: null,      // { dir, side, label, zone } | null (centre = auto add)
      hit: false,      // pointer is over a pane right now
      hole: null,
      timer: 0,
    };

    /** Sidebar row title for the hole; falls back to the list snapshot/id. */
    function extSessionTitle(sessionId) {
      try {
        const selector = '[data-row-key="session:' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sessionId) : sessionId) + '"]';
        const row = document.querySelector(selector);
        if (row !== null) {
          const title = rowDragTitle(row);
          if (typeof title === "string" && title !== "") return title;
        }
      } catch {}
      try {
        const snap = sessionsListSource !== undefined && sessionsListSource !== null
          && typeof sessionsListSource.getSnapshot === "function" ? sessionsListSource.getSnapshot() : null;
        const entry = snap !== null && snap !== undefined && snap.byId !== undefined ? snap.byId[sessionId] : null;
        const title = entry !== null && entry !== undefined ? (entry.displayTitle || entry.title) : "";
        if (typeof title === "string" && title !== "") return title;
      } catch {}
      return sessionId;
    }

    function extHoleEl() {
      if (extReflow.hole !== null && extReflow.hole.isConnected) return extReflow.hole;
      const hole = document.createElement("div");
      hole.className = "dsv-reflow-hole dsv-ext-hole";
      hole.dataset.plugin = PLUGIN_ID;
      hole.dataset.dsvFixed = "true";
      const title = document.createElement("span");
      title.className = "dsv-hole-title";
      const hint = document.createElement("span");
      hint.className = "dsv-hole-sub";
      hole.appendChild(title);
      hole.appendChild(hint);
      hole.hidden = true;
      document.body.appendChild(hole);
      extReflow.hole = hole;
      return hole;
    }

    /** The tree `addPane` would build for the dragged session. Mirrors
        treeStore.addPane (anchor on the focused leaf, settleAuto in auto
        mode) so the centre preview and the drop cannot disagree. */
    function extAddPaneTree(root) {
      const ids = leafOf(root, []);
      const snapshot = treeStore.getSnapshot();
      const anchor = snapshot.focus ?? ids[0];
      let next;
      if (anchor === undefined || anchor === null || findLeafNode(root, anchor) === null) {
        next = {
          t: "split", sid: nextSplitId(), dir: "h", sizes: [0.5, 0.5],
          kids: [root, { t: "leaf", id: EXT_REFLOW_LEAF }],
        };
      } else {
        const [tree, ok] = splitLeafTree(root, anchor, "h", EXT_REFLOW_LEAF, "after");
        if (!ok) return root;
        next = tree;
      }
      const all = leafOf(next, []);
      next = buildArrangedRoot(all, autoLayoutMode(all.length, 1.2));
      return next;
    }

    function extPreviewTree(root, targetId, zone) {
      if (zone === null || zone.dir === null) return extAddPaneTree(root);
      const [tree, ok] = splitLeafTree(root, targetId, zone.dir, EXT_REFLOW_LEAF, zone.side);
      return ok ? tree : root;
    }

    function extSetBoxes(rects) {
      for (const [id, el] of extReflow.wrappers) {
        const rect = rects[id];
        if (rect !== undefined) setReflowBox(el, rect);
      }
    }

    function extShowHole(rects) {
      const hole = extHoleEl();
      const rect = rects[EXT_REFLOW_LEAF];
      if (rect === undefined) {
        hole.hidden = true;
        return;
      }
      const origin = extReflow.canvasRect;
      hole.hidden = false;
      hole.style.left = origin.left + rect.left + "px";
      hole.style.top = origin.top + rect.top + "px";
      hole.style.width = rect.width + "px";
      hole.style.height = rect.height + "px";
      hole.firstChild.textContent = extReflow.title;
      hole.lastChild.textContent = t("extDropHint");
    }

    function extApply(tree) {
      const origin = extReflow.canvasRect;
      if (origin === null) return;
      const rects = reflowLayoutRects(tree, { left: 0, top: 0, width: origin.width, height: origin.height }, {});
      extSetBoxes(rects);
      extShowHole(rects);
    }

    function extArm() {
      const canvas = extReflow.canvas;
      if (canvas === null || !canvas.isConnected) return;
      extReflow.wrappers = reflowWrappers(canvas);
      canvas.classList.add("dsv-reflowing");
      document.body.classList.add("dsv-layout-previewing");
      extSetBoxes(extReflow.originalRects);
      // positions that transitioned from `auto` need a synchronous start value
      void canvas.offsetWidth;
      extReflow.armed = true;
    }

    function extBegin(canvas, sessionId) {
      if (extReflow.active) return;
      if (extReflow.timer !== 0) {
        try { window.clearTimeout(extReflow.timer); } catch {}
        extReflow.timer = 0;
      }
      if (runtimeState.maximized !== null) return;
      if (treeStore.leafIds().length === 0) return;
      const root = treeStore.getSnapshot().root;
      if (root === null) return;
      const wrappers = reflowWrappers(canvas);
      if (wrappers.size === 0) return;
      const origin = canvas.getBoundingClientRect();
      const rects = {};
      for (const [id, el] of wrappers) {
        const r = el.getBoundingClientRect();
        rects[id] = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
      }
      extReflow.active = true;
      extReflow.armed = false;
      extReflow.canvas = canvas;
      extReflow.canvasRect = origin;
      extReflow.wrappers = wrappers;
      extReflow.originalRects = rects;
      extReflow.root = root;
      extReflow.sessionId = sessionId;
      extReflow.title = extSessionTitle(sessionId);
      extReflow.targetId = null;
      extReflow.zone = null;
      extReflow.hit = false;
      extReflow.timer = 0;
    }

    /** Apply the post-drop layout while the pointer moves. `targetId` is the
        pane under the cursor; a centre position previews addPane (auto). */
    function extUpdate(event) {
      if (!extReflow.active) return;
      const canvas = extReflow.canvas;
      if (canvas === null || !canvas.isConnected) {
        extEnd(false);
        return;
      }
      if (!extReflow.armed) extArm();
      if (!extReflow.armed) return;
      const origin = extReflow.canvasRect;
      const x = event.clientX;
      const y = event.clientY;
      if (x < origin.left || x > origin.left + origin.width || y < origin.top || y > origin.top + origin.height) {
        extEnd(true);
        return;
      }
      const rx = x - origin.left;
      const ry = y - origin.top;
      let targetId = null;
      for (const [id, rect] of Object.entries(extReflow.originalRects)) {
        if (rx >= rect.left && rx <= rect.left + rect.width && ry >= rect.top && ry <= rect.top + rect.height) {
          targetId = id;
          break;
        }
      }
      if (targetId === null) {
        if (extReflow.hit) {
          extReflow.hit = false;
          extReflow.targetId = null;
          extReflow.zone = null;
          extApply(extReflow.root);
        }
        return;
      }
      // originalRects are CANVAS-relative; zoneFor works on viewport
      // coordinates (it subtracts rect.left/top from the pointer).
      const rect = extReflow.originalRects[targetId];
      const hit = zoneFor({
        left: rect.left + origin.left,
        top: rect.top + origin.top,
        width: rect.width,
        height: rect.height,
      }, x, y);
      const zone = hit.zone === null ? null : { dir: hit.dir, side: hit.side, label: hit.label, zone: hit.zone };
      const same = extReflow.hit && extReflow.targetId === targetId
        && (zone === null ? extReflow.zone === null : extReflow.zone !== null && extReflow.zone.label === zone.label);
      if (same) return;
      extReflow.hit = true;
      extReflow.targetId = targetId;
      extReflow.zone = zone;
      extApply(extPreviewTree(extReflow.root, targetId, zone));
    }

    function extCollapse() {
      if (extReflow.timer !== 0) {
        try { window.clearTimeout(extReflow.timer); } catch {}
        extReflow.timer = 0;
      }
      const canvas = extReflow.canvas;
      if (canvas !== null) canvas.classList.remove("dsv-reflowing");
      document.body.classList.remove("dsv-layout-previewing");
      scheduleTocGripSync(260);
      if (extReflow.wrappers !== null) {
        for (const el of extReflow.wrappers.values()) {
          if (el !== null && el !== undefined) clearReflowBox(el);
        }
      }
      if (extReflow.hole !== null) {
        const hole = extReflow.hole;
        extReflow.hole = null;
        try { hole.remove(); } catch {}
      }
      extReflow.active = false;
      extReflow.armed = false;
      extReflow.canvas = null;
      extReflow.canvasRect = null;
      extReflow.wrappers = null;
      extReflow.originalRects = null;
      extReflow.root = null;
      extReflow.sessionId = null;
      extReflow.title = "";
      extReflow.targetId = null;
      extReflow.zone = null;
      extReflow.hit = false;
      extReflow.timer = 0;
    }

    /** Cancel: glide the panes back to the boxes they had before the drag. */
    function extEnd(animate) {
      if (!extReflow.active) return;
      const canAnimate = animate !== false
        && extReflow.armed
        && extReflow.canvas !== null
        && extReflow.canvas.isConnected
        && extReflow.wrappers !== null
        && extReflow.originalRects !== null
        && !prefersReducedMotion();
      if (!canAnimate) {
        extCollapse();
        return;
      }
      extSetBoxes(extReflow.originalRects);
      if (extReflow.hole !== null) extReflow.hole.hidden = true;
      extReflow.active = false;
      extReflow.timer = window.setTimeout(() => {
        extReflow.timer = 0;
        extCollapse();
      }, 200);
    }

    /** Drop: perform exactly the mutation the preview showed. */
    function extDrop(sessionId) {
      if (!extReflow.active) return false;
      const hit = extReflow.hit;
      const targetId = extReflow.targetId;
      const zone = extReflow.zone;
      extCollapse();
      if (!hit || targetId === null) return false;
      if (treeStore.leafIds().indexOf(sessionId) !== -1) return false;
      if (zone === null || zone.dir === null) {
        treeStore.addPane(sessionId);
      } else {
        treeStore.splitLeaf(targetId, zone.dir, sessionId, zone.side);
      }
      treeStore.setFocus(sessionId);
      return true;
    }

    function registerExternalReflow() {
      const isSessionDrag = (event) => {
        if (dragPayload !== null) return false;
        if (externalDragSessionId === null) return false;
        const data = event.dataTransfer;
        if (data === null || data === undefined) return false;
        try {
          if (Array.prototype.indexOf.call(data.types, "Files") !== -1) return false;
          return Array.prototype.indexOf.call(data.types, MIME_SESSION) !== -1;
        } catch {
          return false;
        }
      };
      const onDragOver = (event) => {
        if (!treeStore.isActive()) return;
        if (runtimeState.maximized !== null) return;
        if (!isSessionDrag(event)) return;
        const canvas = document.querySelector(".dsv-canvas");
        if (canvas === null) return;
        const id = externalDragSessionId;
        if (id === null) return;
        // An already-open conversation gets the pane's red refusal wash, not a
        // split preview — leave the event to the pane for that case.
        if (treeStore.leafIds().indexOf(id) !== -1) {
          if (extReflow.active) extEnd(true);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        try { event.dataTransfer.dropEffect = "move"; } catch {}
        if (!extReflow.active) extBegin(canvas, id);
        if (extReflow.active) extUpdate(event);
      };
      const onDrop = (event) => {
        if (!extReflow.active) return;
        event.preventDefault();
        event.stopPropagation();
        let id = externalDragSessionId;
        try {
          const mime = event.dataTransfer !== null && event.dataTransfer !== undefined
            ? event.dataTransfer.getData(MIME_SESSION) : "";
          if (typeof mime === "string" && mime !== "") id = mime;
        } catch {}
        if (id === null || id === undefined || id === "") {
          extEnd(false);
          return;
        }
        extDrop(id);
      };
      const onDragEnd = () => {
        if (extReflow.active) extEnd(true);
      };
      const onDragLeave = (event) => {
        if (!extReflow.active) return;
        if (event.relatedTarget === null || event.relatedTarget === undefined) extEnd(true);
      };
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("dragend", onDragEnd, true);
      document.addEventListener("dragleave", onDragLeave, true);
      return () => {
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("dragend", onDragEnd, true);
        document.removeEventListener("dragleave", onDragLeave, true);
        extCollapse();
      };
    }

    // ---------------------------------------------------------------------
    // "会话目录" (TOC) grip containment
    //
    // dsh-prompt-history portals one draggable .dsh-ph-toc-grip to <body> per
    // mounted conversation instance. In split view that is one per pane PLUS
    // one for the stock conversation hidden under the overlay and one for the
    // IM view — all of them read the same saved position, so they stack
    // exactly on top of each other (the "several overlapping buttons" report).
    // The workspace keeps one grip per LIVE pane, hides the non-pane copies,
    // and pushes a grip whose saved position sits outside its pane (e.g. over
    // the sidebar) back inside that pane. Repositioning uses a synthetic drag
    // so the plugin's own state, its TOC panel anchor and the saved position
    // all stay in sync.
    // ---------------------------------------------------------------------
    const TOC_GRIP_SELECTOR = ".dsh-ph-toc-grip";
    const TOC_GRIP_HIDDEN = "dsv-toc-hidden";
    /** Last pane box each grip was placed against. A geometry change (split,
       close, arrange, divider drag, maximize, rightbar push) re-centers that
       pane's grip on the left edge; an unchanged box leaves the user's own
       vertical position alone. */
    const tocGripGeometry = new Map();
    const tocGripTries = new Map();
    /** Pane-id signature of the last sync. A structural change (add, close,
       swap, re-arrange) remounts the portal grips at their default stop, so
       every surviving pane re-centers once even when its own box is unchanged. */
    let tocPaneKey = "";

    /** Session id + "this grip was mounted by a split pane" for a portal grip.
        The pane check uses component IDENTITY (RenderLeaf/PaneFrame), not
        display names, so it survives a minified host build. */
    function tocGripInfo(grip) {
      let key = null;
      try {
        for (const name of Object.keys(grip)) {
          if (name.indexOf("__reactFiber$") === 0) { key = name; break; }
        }
      } catch { key = null; }
      if (key === null) return null;
      let fiber = grip[key];
      let sessionId = null;
      let inPane = false;
      let hops = 0;
      while (fiber !== null && fiber !== undefined && hops < 80) {
        const props = fiber.memoizedProps;
        if (sessionId === null && props !== null && props !== undefined && typeof props.sessionId === "string") {
          sessionId = props.sessionId;
        }
        if (fiber.type === RenderLeaf || fiber.type === PaneFrame) inPane = true;
        fiber = fiber.return;
        hops += 1;
      }
      return { sessionId, inPane };
    }

    /** Move a grip with real mouse events: the plugin's drag handler updates
        its React state, the TOC panel anchor and localStorage from these. */
    function tocGripMoveTo(grip, left, top) {
      let rect;
      try { rect = grip.getBoundingClientRect(); } catch { return; }
      if (rect.width <= 0 || rect.height <= 0) return;
      if (Math.abs(rect.left - left) < 1.5 && Math.abs(rect.top - top) < 1.5) return;
      const sx = rect.left + rect.width / 2;
      const sy = rect.top + rect.height / 2;
      const tx = left + 10;
      const ty = top + 26;
      try {
        grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
        window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: tx, clientY: ty, button: 0, buttons: 1 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: tx, clientY: ty, button: 0 }));
      } catch {}
    }

    function tocGripsRestore() {
      try {
        for (const grip of document.querySelectorAll(TOC_GRIP_SELECTOR)) {
          grip.classList.remove(TOC_GRIP_HIDDEN);
        }
      } catch {}
    }

    /** Re-place the grips a beat after a preview/drop settles, when the pane
       boxes have their final geometry. */
    function scheduleTocGripSync(delay) {
      try {
        window.setTimeout(() => {
          try { tocGripSync(); } catch {}
        }, delay);
      } catch {}
    }

    function tocGripSync() {
      let grips;
      try { grips = Array.prototype.slice.call(document.querySelectorAll(TOC_GRIP_SELECTOR)); } catch { return; }
      if (grips.length === 0) return;
      if (reflowState.active || extReflow.active) return;
      if (document.body.classList.contains("dsv-layout-previewing")) {
        // Self-heal a flag left behind by an interrupted/crashed preview.
        if (reflowState.timer === 0 && extReflow.timer === 0) {
          document.body.classList.remove("dsv-layout-previewing");
        } else {
          return;
        }
      }
      const canvas = document.querySelector(".dsv-canvas");
      if (canvas !== null && canvas.classList.contains("dsv-reflowing")) return;
      if (document.querySelector(".dsv-divider.active") !== null) return;
      for (const grip of grips) {
        // A grip being dragged right now owns the pointer; never fight it.
        if (grip.style.cursor === "grabbing") return;
      }
      const active = treeStore.isActive() && runtimeState.active === true && runtimeState.maximized === null;
      if (!active) {
        tocGripGeometry.clear();
        tocGripTries.clear();
        tocPaneKey = "";
        tocGripsRestore();
        return;
      }
      const panes = new Map();
      try {
        for (const el of document.querySelectorAll(".dsv-canvas .dsv-pane[data-dsv-pane]")) {
          const id = el.getAttribute("data-dsv-pane");
          if (id === null || id === "") continue;
          panes.set(id, el.getBoundingClientRect());
        }
      } catch {}
      if (panes.size === 0) return;
      const paneKey = [...panes.keys()].sort().join("|");
      const structChanged = paneKey !== tocPaneKey;
      tocPaneKey = paneKey;
      const keep = new Map();
      for (const grip of grips) {
        const info = tocGripInfo(grip);
        const pane = info !== null && info.inPane && info.sessionId !== null ? panes.get(info.sessionId) : undefined;
        if (pane === undefined || pane === null || keep.has(info.sessionId)) {
          grip.classList.add(TOC_GRIP_HIDDEN);
          continue;
        }
        keep.set(info.sessionId, grip);
        grip.classList.remove(TOC_GRIP_HIDDEN);
      }
      // Drop bookkeeping for panes that no longer exist.
      for (const id of [...tocGripGeometry.keys()]) if (!keep.has(id)) tocGripGeometry.delete(id);
      for (const [id, grip] of keep) {
        const pane = panes.get(id);
        const r = grip.getBoundingClientRect();
        const minTop = pane.top + 40;
        const maxTop = Math.max(minTop, pane.bottom - 60);
        // The grip lives on the pane's LEFT edge (the TOC panel opens to its
        // right) and, after every layout adjustment, is re-homed to the
        // VERTICAL CENTER of that pane. A pane box that did not change keeps
        // the user's own vertical drag; only a changed box re-centers.
        const boxKey = Math.round(pane.left) + ":" + Math.round(pane.top) + ":"
          + Math.round(pane.width) + ":" + Math.round(pane.height);
        const recenter = structChanged || tocGripGeometry.get(id) !== boxKey;
        tocGripGeometry.set(id, boxKey);
        const targetLeft = pane.left + 12;
        const rawTop = recenter
          ? pane.top + Math.max(0, pane.height - Math.max(1, r.height)) / 2
          : (r.height > 0 ? r.top : pane.top + pane.height * 0.34);
        const targetTop = Math.max(minTop, Math.min(maxTop, rawTop));
        const offTarget = Math.abs(r.left - targetLeft) >= 1.5 || Math.abs(r.top - targetTop) >= 1.5;
        if (!offTarget) {
          tocGripGeometry.set(id, boxKey);
          tocGripTries.delete(id);
          continue;
        }
        if (recenter) {
          // A portal grip that just remounted may not have its drag handler
          // attached yet; a single synthetic move would silently no-op and
          // leave it at the plugin's default stop (top+40). Retry a few times
          // instead of recording the box as "done".
          const tries = tocGripTries.get(id) ?? 0;
          if (tries >= 3) {
            tocGripGeometry.set(id, boxKey);
            tocGripTries.delete(id);
            continue;
          }
          tocGripTries.set(id, tries + 1);
          tocGripGeometry.delete(id);
          tocGripMoveTo(grip, targetLeft, targetTop);
          scheduleTocGripSync(140);
          continue;
        }
        tocGripMoveTo(grip, targetLeft, targetTop);
      }
    }

    // ---------------------------------------------------------------------
    // services (bound in apply)
    // ---------------------------------------------------------------------

    let sessionsService = undefined;
    let sessionsListSource = undefined;
    let domListSourceDispose = null;
    let slotsService = undefined;
    let localeService = undefined;
    let uiSessionService = undefined;
    let conversationT = null;

    // ---------------------------------------------------------------------
    // root standard faces (0.1.x + 0.2.0)
    //
    // The stock components a pane re-hosts read GLOBAL standard faces too —
    // `useSessions`, `useSessionStatus`, `useSessionRetainInfo`, `useResource`,
    // `useWorkspaces`, `usePanelInfo`. Those live in the renderer's ROOT
    // standard binding, which 0.1.5 merged into `uiSession.resolve(id)` but
    // 0.2.0 keeps strictly apart: a session binding carries session faces only,
    // and no public client service hands out the root binding.
    //
    // The renderer DOES hand it to every root-scoped slot entry it renders, and
    // this plugin already owns one: its workspace is registered into
    // `shell.overlay` (declared `kind: list, scope: root`). So the overlay
    // component receives the fully materialized root kit as its props —
    // `useSessions`, `useSessionStatus`, `useSessionRetainInfo` and anything a
    // third-party plugin contributed through `slots.provideRoot` — and this is
    // where it is harvested for the panes. No renderer internals, no private
    // service fields: the same props the framework would have handed a stock
    // root entry.
    // ---------------------------------------------------------------------

    /** Root standard faces as last published by the overlay's own props.
        `generation` is the host-renderer generation the current kit belongs to;
        pane keys include it, so a controlled remount (instead of silently
        swapping face identities mid-flight) is the only response to a new
        standard kit. */
    const rootStandard = { value: null, generation: 0, pending: null, pendingGeneration: false, listeners: new Set() };

    /** The renderer's root kit minus the seats it synthesizes per entry:
        `renderFactorySlot` (always), `t` (locale declaration), `useStore` +
        `actions` (store declaration), `renderSlot`/`renderSlotChain`/
        `SessionProvider` (children declaration). This plugin's overlay entry
        declares none of those, but filtering them keeps the harvest honest if
        that ever changes. */
    const FRAMEWORK_SEATS = new Set(["renderFactorySlot", "t", "useStore", "actions", "renderSlot", "renderSlotChain", "SessionProvider"]);

    function extractRootStandard(props) {
      const out = {};
      if (props === null || props === undefined || typeof props !== "object") return out;
      for (const key of Object.keys(props)) {
        if (FRAMEWORK_SEATS.has(key)) continue;
        out[key] = props[key];
      }
      return out;
    }

    /** Faces the adopted kit is MISSING but this render provided. Root
        contributions are static for the page's lifetime, so this is the only
        legitimate change: a face that did not exist during the first render
        (a third-party plugin contributing later, a slow root roster). */
    function missingRootFaces(current, next) {
      let merged = null;
      for (const key of Object.keys(next)) {
        const value = next[key];
        if (value === undefined || current[key] !== undefined) continue;
        if (merged === null) merged = Object.assign({}, current);
        merged[key] = value;
      }
      return merged;
    }

    /** A whole-kit identity swap: the same face NAMES arrive but share NO
        identity with the adopted kit. That is not a normal root re-render (the
        0.2.x renderer memoizes the standard per binding); it means the renderer
        remounted/HMR'd or a second shell generation took over, and the panes are
        holding hooks from the dead generation. The controlled response is to
        bump the generation so panes remount and rebuild their kits and editor
        guards ONCE — never to swap the faces underneath live panes, which is how
        per-pane `prepareNative` stormed. */
    function isGenerationChange(current, next) {
      const nextKeys = Object.keys(next).filter((key) => next[key] !== undefined);
      if (nextKeys.length === 0) return false;
      const currentKeys = Object.keys(current).filter((key) => current[key] !== undefined);
      if (nextKeys.length !== currentKeys.length) return false;
      for (const key of nextKeys) {
        if (current[key] === undefined) return false;
        if (current[key] === next[key]) return false;
      }
      return true;
    }

    /** READ during the overlay's render: write-once lazy adoption so panes
        rendered in the same pass already see the kit. After adoption this is a
        pure read — later renders can only add missing faces, and only from the
        layout effect below (never a notify from render). */
    function readRootStandard(props) {
      if (rootStandard.value !== null) return rootStandard.value;
      const next = extractRootStandard(props);
      if (Object.keys(next).length === 0) return next;
      rootStandard.value = next;
      return rootStandard.value;
    }

    /** Called from the overlay's layout effect. Computes the only two legal
        changes (add missing faces, or a generation swap) and stashes them for
        publishRootStandard — no store mutation during render. */
    function harvestRootStandard(props) {
      if (rootStandard.value === null) {
        const next = extractRootStandard(props);
        if (Object.keys(next).length > 0) {
          rootStandard.value = next;
          rootStandard.pending = next;
          rootStandard.pendingGeneration = false;
        }
        return;
      }
      if (rootStandard.pending !== null) return;
      const current = rootStandard.value;
      const next = extractRootStandard(props);
      const missing = missingRootFaces(current, next);
      if (missing !== null) {
        rootStandard.pending = missing;
        rootStandard.pendingGeneration = false;
        return;
      }
      if (isGenerationChange(current, next)) {
        rootStandard.pending = next;
        rootStandard.pendingGeneration = true;
      }
    }

    /** Notify panes that the root faces (re)settled. Runs from a layout effect. */
    function publishRootStandard() {
      if (rootStandard.pending === null) return;
      const next = rootStandard.pending;
      const generationChange = rootStandard.pendingGeneration === true;
      rootStandard.pending = null;
      rootStandard.pendingGeneration = false;
      rootStandard.value = next;
      if (generationChange) {
        rootStandard.generation += 1;
        // One controlled remount pass: panes' unmount effects dispose their
        // retained references/guards/listeners, and the per-generation caches
        // of inject faces and entry stores must not outlive the faces they were
        // derived from.
        clearEntryInjectCache();
        entryStoreCache.clear();
        setRuntime({ generation: rootStandard.generation });
        try {
          console.warn(LOG_PREFIX + " the host renderer published a new root standard generation; remounting the split panes once to pick it up cleanly (the old generation's faces are dead).");
        } catch {}
      }
      for (const listener of [...rootStandard.listeners]) {
        try {
          listener();
        } catch (error) {
          try { console.warn(LOG_PREFIX + " root standard subscriber failed:", String(error).slice(0, 140)); } catch {}
        }
      }
    }

    function subscribeRootStandard(listener) {
      rootStandard.listeners.add(listener);
      return () => rootStandard.listeners.delete(listener);
    }

    /** Re-render the caller whenever the root faces change. Panes use it so a
        workspace opened before the root roster settled still picks it up. */
    function useRootStandard() {
      return React.useSyncExternalStore(
        subscribeRootStandard,
        () => rootStandard.value,
        () => rootStandard.value,
      );
    }

    /** Diagnostics (see composerChainDebug): the root faces this plugin
        harvested from its `shell.overlay` seat, and the faces of one session's
        binding. `window.__dshSplitWorkspace.rootFaces` / `.sessionFaces(id)`. */
    function rootFaceNames() {
      return rootStandard.value === null ? [] : Object.keys(rootStandard.value);
    }

    function sessionFaceNames(sessionId) {
      const binding = resolveSessionBinding(sessionId);
      if (binding === undefined || binding === null) return { hooks: [], keyedHooks: [], props: [], key: null };
      return {
        hooks: Object.keys(binding.hooks ?? {}),
        keyedHooks: Object.keys(binding.keyedHooks ?? {}),
        props: Object.keys(binding.props ?? {}),
        key: typeof binding.key === "string" ? binding.key : null,
      };
    }

    // ---------------------------------------------------------------------
    // dsh 0.2.0 session list + current session
    //
    // 0.2.0 dropped the client `sessions.list` store (its `sessions` service
    // only retains/binds single sessions now) and the list store's `current`
    // field. Both are read from the rendered sidebar instead: every row carries
    // `data-row-key="session:<id>"` and the open one is `aria-selected`, which
    // is exactly what the user sees. The DOM source is only built when the
    // service store is missing, so 0.1.x keeps its native store untouched.
    // ---------------------------------------------------------------------

    const SESSION_ROW_SELECTOR = '[data-row-key^="session:"], div[class*="_sessionRow"]';
    const SELECTED_ROW_SELECTOR = 'div[class*="_sessionRow"][aria-selected="true"], [data-row-key^="session:"][aria-selected="true"]';

    /** Session id of the selected sidebar row, or undefined. */
    function selectedSidebarSessionId() {
      try {
        const row = document.querySelector(SELECTED_ROW_SELECTOR);
        const key = row === null ? null : row.getAttribute("data-row-key");
        if (key === null || key.indexOf("session:") !== 0) return undefined;
        const id = key.slice("session:".length);
        return id === "" ? undefined : id;
      } catch {
        return undefined;
      }
    }

    /** The rendered sidebar as the snapshot shape the list consumers expect
        (ids in display order, byId[id].title/displayTitle). */
    function readSidebarSessions() {
      const ids = [];
      const byId = {};
      let rows;
      try {
        rows = document.querySelectorAll(SESSION_ROW_SELECTOR);
      } catch {
        return { ids, byId, current: undefined };
      }
      for (const row of rows) {
        const key = row.getAttribute("data-row-key");
        if (key === null || key.indexOf("session:") !== 0) continue;
        const id = key.slice("session:".length);
        if (id === "" || byId[id] !== undefined) continue;
        // textContent, NOT innerText: innerText forces a synchronous layout
        // per row, and this read runs on sidebar mutations — with streaming
        // sessions that became a forced-reflow storm (the desktop freeze
        // reported as whole-machine stalls). textContent reads the DOM
        // without layout; the whitespace normalization below makes the two
        // equivalent for these single-line titles.
        const title = (row.textContent ?? "").replace(/\s+/g, " ").trim();
        ids.push(id);
        byId[id] = { title, displayTitle: title };
      }
      return { ids, byId, current: selectedSidebarSessionId() };
    }

    /** A store face over the rendered sidebar. Reads are BOUNDED: the observer
        is only attached while the split workspace is ACTIVE (see setActive),
        re-reads coalesce through requestAnimationFrame, and a minimum spacing
        (DOM_LIST_MIN_READ_MS) throttles re-reads with one trailing catch-up —
        so continuous streaming text can never drive this into a per-frame
        full-sidebar scan. Emits a fresh snapshot object on real changes so
        React's identity check re-renders consumers. */
    const DOM_LIST_MIN_READ_MS = 200;

    function createDomSessionListSource() {
      let snapshot = readSidebarSessions();
      const listeners = new Set();
      let observer = null;
      let active = false;
      let rafPending = false;
      let timerPending = false;
      let lastReadAt = 0;

      const publish = () => {
        lastReadAt = Date.now();
        const next = readSidebarSessions();
        if (next.ids.length === snapshot.ids.length && next.ids.every((id, index) => snapshot.ids[index] === id)
          && next.current === snapshot.current
          && next.ids.every((id) => snapshot.byId[id] !== undefined && snapshot.byId[id].title === next.byId[id].title)) {
          return;
        }
        snapshot = next;
        for (const listener of Array.from(listeners)) {
          try {
            listener();
          } catch {}
        }
      };
      const maybePublish = () => {
        const since = Date.now() - lastReadAt;
        if (since < DOM_LIST_MIN_READ_MS) {
          if (!timerPending) {
            timerPending = true;
            window.setTimeout(() => {
              timerPending = false;
              if (active && listeners.size > 0) publish();
            }, DOM_LIST_MIN_READ_MS - since);
          }
          return;
        }
        publish();
      };
      const schedule = () => {
        if (rafPending || timerPending || !active || listeners.size === 0) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
          rafPending = false;
          if (active && listeners.size > 0) maybePublish();
        });
      };
      const attach = () => {
        if (observer === null) {
          try {
            observer = new MutationObserver(schedule);
          } catch {
            observer = null;
            return;
          }
        }
        try {
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["aria-selected", "data-row-key"],
          });
        } catch {}
      };
      const detach = () => {
        if (observer !== null) {
          try {
            observer.disconnect();
          } catch {}
        }
      };
      const dispose = () => {
        detach();
        observer = null;
        listeners.clear();
      };
      return {
        getSnapshot: () => snapshot,
        /** The observer only exists while the workspace is split (>=2 panes).
            Inactive = zero DOM observation cost, no matter what streams. */
        setActive(flag) {
          active = flag === true;
          if (active && listeners.size > 0) attach();
          else if (!active) detach();
        },
        subscribe: (listener) => {
          if (listener === undefined || typeof listener !== "function") return () => {};
          listeners.add(listener);
          if (active) attach();
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0) detach();
          };
        },
        dispose,
      };
    }

    /** The active session id across both store generations. 0.1.x answers from
        the list store (`current`); 0.2.0 dropped that field, so main-view
        retention and finally the selected sidebar row answer instead. */
    function currentSessionId() {
      if (sessionsListSource !== undefined && sessionsListSource !== null
        && typeof sessionsListSource.getSnapshot === "function") {
        try {
          const snapshot = sessionsListSource.getSnapshot();
          if (snapshot !== null && snapshot !== undefined) {
            if (snapshot.current !== undefined && snapshot.current !== null) return snapshot.current;
            const byId = snapshot.byId;
            if (byId !== undefined && byId !== null) {
              for (const id of Object.keys(byId)) {
                const entry = byId[id];
                const retained = entry === undefined || entry === null ? undefined : entry.retainedBy;
                const mainView = retained === undefined || retained === null ? undefined : retained.mainView;
                if (typeof mainView === "number" && mainView > 0) return id;
              }
            }
          }
        } catch {}
      }
      return selectedSidebarSessionId();
    }

    // S2 (1.6.0): the aria-selected MutationObserver that used to turn every
    // programmatic selection change into a focused-pane swap is GONE. The
    // focused pane now follows only a genuine click on a sidebar session row
    // (see the click-to-load effect in WorkspaceApp).

    // ---------------------------------------------------------------------
    // 0.2.0 standard session bindings
    //
    // 0.1.5 published session-scoped standard faces (useChat, useSessionStatus,
    // useConversation, ...) through `uiSession.resolve(id)`. 0.2.0 keeps the
    // same binding SHAPE ({ props, hooks, keyedHooks }) but hands it out per
    // retained SessionReference: `sessions.retain(id, { source })` and then
    // `uiSession.bindingSource(reference).value`, which settles once that
    // reference is ready. References are held for the pane's lifetime and
    // released when it closes, so retention counts stay honest.
    // ---------------------------------------------------------------------

    const paneSessionReferences = new Map();

    /** Per-session retain/binding failure records for diagnostics (1.6.1).
        The 1.6.0 regression: the pane retried `sessions.retain()` exactly once,
        at mount, when the host session catalog can still be empty — retain then
        returns undefined, the error was swallowed, and the pane stayed on
        "Session ended" forever (deterministically on the 0.2.1 desktop host,
        where the first attempted retain always raced the catalog). Every failed
        attempt is now recorded with its message and surfaced via
        `paneDebug.faces[sid].lastRetainError`, `health().lastError` and one
        `console.warn` when the bounded retries are exhausted. */
    const paneRetainFailures = new Map();
    function noteRetainFailure(sessionId, message) {
      const previous = paneRetainFailures.get(sessionId);
      paneRetainFailures.set(sessionId, {
        message: String(message).slice(0, 200),
        attempts: (previous !== undefined ? previous.attempts : 0) + 1,
        at: Date.now(),
      });
    }
    function clearRetainFailure(sessionId) {
      paneRetainFailures.delete(sessionId);
    }
    function retainFailureOf(sessionId) {
      return paneRetainFailures.get(sessionId);
    }

    /** Retain `sessionId` for this plugin (0.2.0 path only). A transient
        failure is NOT swallowed: it is recorded (with the exact message) so the
        retry driver below can report/backoff, and the caller can tell "not yet"
        from "gone". */
    function ensureSessionReference(sessionId) {
      if (sessionsService === undefined || sessionsService === null) {
        noteRetainFailure(sessionId, "sessions service is unavailable");
        return undefined;
      }
      if (typeof sessionsService.retain !== "function") {
        noteRetainFailure(sessionId, "sessions.retain is not a function on this host");
        return undefined;
      }
      const cached = paneSessionReferences.get(sessionId);
      if (cached !== undefined) return cached;
      try {
        const reference = sessionsService.retain(sessionId, { source: "splitView" });
        if (reference === undefined || reference === null) {
          // The 0.2.1 host returns undefined when the session catalog has not
          // loaded this id yet — exactly the race that made 1.6.0 panes stick on
          // "Session ended". Record it; the retry driver backs off and retries.
          noteRetainFailure(sessionId, "sessions.retain() returned " + String(reference) + " (session not resolvable yet?)");
          return undefined;
        }
        paneSessionReferences.set(sessionId, reference);
        return reference;
      } catch (error) {
        noteRetainFailure(sessionId, "sessions.retain threw: " + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error).slice(0, 160));
        return undefined;
      }
    }

    function releaseSessionReference(sessionId) {
      const reference = paneSessionReferences.get(sessionId);
      if (reference === undefined) return;
      paneSessionReferences.delete(sessionId);
      try {
        if (typeof reference.release === "function") reference.release();
      } catch {}
    }

    // ---------------------------------------------------------------------
    // Pane resource lifetime (1.6.0)
    //
    // Everything a pane stages on the host must be released on EVERY leaf
    // mutation path — not just the ✕ button. Two mechanisms cover every path:
    //   * treeStore.commit() schedules disposePaneIfUnused() for every leaf id
    //     that disappeared (sidebar swapFocus, closeFocused, movePane, ✕);
    //   * ChatPane retains/releases per React mount with a per-session
    //     reference count, so the pane's own unmount is the primary teardown.
    // The refcount also means a session shown by two panes (only possible
    // through a corrupt tree; persistence validation de-dupes) is disposed only
    // when the LAST pane leaves. disposePane itself is idempotent.
    // ---------------------------------------------------------------------

    const paneLiveRefs = new Map();
    const paneDisposeChecks = new Map();

    function retainPaneSession(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      paneLiveRefs.set(sessionId, (paneLiveRefs.get(sessionId) || 0) + 1);
      const timer = paneDisposeChecks.get(sessionId);
      if (timer !== undefined) {
        try { window.clearTimeout(timer); } catch {}
        paneDisposeChecks.delete(sessionId);
      }
    }

    function releasePaneSession(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      const count = paneLiveRefs.get(sessionId);
      if (count === undefined) return;
      if (count > 1) {
        paneLiveRefs.set(sessionId, count - 1);
        return;
      }
      paneLiveRefs.delete(sessionId);
      disposePaneIfUnused(sessionId);
    }

    /** Idempotent: release every host resource one pane staged. Safe to call
        twice (maps are deleted on first use). */
    function disposePane(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      // Stop the retain retry driver FIRST: a timer must never resurrect a
      // reference after this pane's resources are released.
      const resolver = sessionFaceResolvers.get(sessionId);
      if (resolver !== undefined) {
        sessionFaceResolvers.delete(sessionId);
        try { resolver.dispose(); } catch {}
      }
      try { releaseSessionReference(sessionId); } catch {}
      clearRetainFailure(sessionId);
      paneChatStores.delete(sessionId);
      paneImageIntake.delete(sessionId);
      paneDebug.faces[sessionId] = undefined;
      try { delete paneDebug.faces[sessionId]; } catch {}
      if (rootPendingBySession.has(sessionId)) setRootPending(sessionId, undefined);
      const guardEntry = paneEditorGuards.get(sessionId);
      if (guardEntry !== undefined) {
        paneEditorGuards.delete(sessionId);
        // `retire`, not a synchronous `dispose`: the pane's own unmount still
        // has to clear the shared editor root, and the guard is what hands it
        // back to the stock composer afterwards (see prepareNative).
        try {
          if (typeof guardEntry.retire === "function") guardEntry.retire();
          else if (typeof guardEntry.dispose === "function") guardEntry.dispose();
        } catch {}
      }
      const unsubTyping = paneTypingUnsubs.get(sessionId);
      if (unsubTyping !== undefined) {
        try { unsubTyping(); } catch {}
        paneTypingUnsubs.delete(sessionId);
      }
    }

    function paneInTree(sessionId) {
      try { return findLeafNode(treeStore.getSnapshot().root, sessionId) !== null; } catch { return false; }
    }

    /** Dispose only when the session is neither in the tree nor mounted. */
    function disposePaneIfUnused(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if ((paneLiveRefs.get(sessionId) || 0) > 0) return;
      if (paneInTree(sessionId)) return;
      disposePane(sessionId);
    }

    /** Deferred safety sweep from treeStore.commit: the departing pane's React
        unmount normally disposes it a commit later; this makes sure resource
        release also happens if an (unexpected) latched subtree kept it mounted. */
    function deferPaneDisposeCheck(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (paneDisposeChecks.has(sessionId)) return;
      paneDisposeChecks.set(sessionId, window.setTimeout(() => {
        paneDisposeChecks.delete(sessionId);
        disposePaneIfUnused(sessionId);
      }, 1200));
    }

    /** The standard binding for one session on either generation. */
    function resolveSessionBinding(sessionId) {
      const ui = uiSessionService;
      if (ui === undefined || ui === null) return undefined;
      if (typeof ui.resolve === "function") {
        try {
          return ui.resolve(sessionId);
        } catch {
          return undefined;
        }
      }
      if (typeof ui.bindingSource !== "function") return undefined;
      const reference = ensureSessionReference(sessionId);
      if (reference !== undefined) {
        try {
          const source = ui.bindingSource(reference);
          if (source !== undefined && source !== null && source.value !== undefined && source.value !== null) {
            return source.value;
          }
        } catch {}
      }
      // A pane showing the active conversation can borrow the main binding.
      const main = ui.current;
      if (main !== undefined && main !== null && main.value !== undefined && main.value !== null
        && selectedSidebarSessionId() === sessionId) {
        return main.value;
      }
      return undefined;
    }

    /** Whether the standard binding can be materialized yet. 0.1.x resolves
        synchronously, so the gate is a no-op there; 0.2.0 waits for the
        retained reference to open, because a pane kit is built exactly once
        WITH its faces — rebuilding would re-run per-call inject factories.

        Bounded: if the reference never opens (an unloadable session, a runtime
        that dropped bindingSource), the pane proceeds anyway after a short
        grace period and renders its own transcript/composer instead of sitting
        on a loading hint forever. */
    const SESSION_BINDING_GRACE_MS = 2500;

    function useSessionBindingReady(sessionId) {
      const status = useSessionFaceStatus(sessionId);
      const [ready, setReady] = React.useState(() => {
        if (uiSessionService === undefined || uiSessionService === null) return true;
        // 0.1.x resolves by id, and a runtime without the 0.2.0 surface has
        // nothing to wait for.
        if (typeof uiSessionService.resolve === "function") return true;
        if (typeof uiSessionService.bindingSource !== "function") return true;
        // Already materializable (e.g. the pane shows the main session):
        // do not make the kit wait for a reference it does not need.
        return paneKitTrustworthy(sessionId);
      });
      React.useEffect(() => {
        if (ready) return undefined;
        // 1.6.1: do NOT settle as a failure while the retain retries remain —
        // that was the 1.6.0 regression path (first retain raced the host
        // session catalog, settled, and the pane showed "Session ended"). The
        // gate resolves only when a face is bound, the retries are exhausted,
        // or the bounded grace period is over.
        if (status.face !== undefined && status.face !== null) {
          setReady(true);
          return undefined;
        }
        if (status.exhausted === true) {
          setReady(true);
          return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
          if (cancelled) return;
          warnPaneKitUnavailable(sessionId);
          setReady(true);
        }, SESSION_BINDING_GRACE_MS);
        return () => {
          cancelled = true;
          try { window.clearTimeout(timer); } catch {}
        };
      }, [ready, status.face, status.exhausted, sessionId]);
      return ready;
    }

    // ---------------------------------------------------------------------
    // pane readiness
    //
    // A pane re-hosts the stock transcript/composer OUTSIDE the slot renderer,
    // so it must assemble the same standard faces that renderer would:
    //   * ROOT faces (useSessions, useSessionStatus, useSessionRetainInfo,
    //     useResource, useWorkspaces, usePanelInfo, …) are harvested from this
    //     plugin's own root-scoped `shell.overlay` entry — see the root
    //     standard-face section above.
    //   * SESSION faces (chat, conversation, input, inputActions, session,
    //     projection, trajectory, …) come from the session binding: 0.1.5
    //     `uiSession.resolve(id)`, 0.2.0 `sessions.retain()` +
    //     `uiSession.bindingSource(reference)`.
    //   * The Chat node seat's `useDisclosure`/`useTurnData` are neither: they
    //     are the `conversation.chat.node` slot's contextual inject hooks,
    //     bound per render from the hookContext ChatView itself dispatches.
    // A pane therefore only has to WAIT for its session binding to open; it
    // never has to be suppressed. If the binding never arrives, the pane still
    // renders through this plugin's own fallback transcript/composer.
    // ---------------------------------------------------------------------

    const paneKitWarned = new Set();

    /** Whether the session-scoped standard faces are materialized yet. The
        0.1.x path resolves synchronously and is always trusted. */
    function sessionFacesReady(sessionId) {
      if (uiSessionService !== undefined && uiSessionService !== null
        && typeof uiSessionService.resolve === "function") return true;
      try {
        const binding = resolveSessionBinding(sessionId);
        if (binding === undefined || binding === null) return false;
        const hooks = binding.hooks === undefined || binding.hooks === null ? {} : binding.hooks;
        return hooks.chat !== undefined || hooks.conversation !== undefined;
      } catch {
        return false;
      }
    }

    /** Kept for the call sites that used to bail out on an incomplete kit: the
        session binding is all a pane needs now, and a missing one degrades to
        the plugin's own renderers instead of hiding the workspace. */
    function paneKitTrustworthy(sessionId) {
      return sessionFacesReady(sessionId);
    }

    function warnPaneKitUnavailable(sessionId) {
      const key = String(sessionId);
      if (paneKitWarned.has(key)) return;
      paneKitWarned.add(key);
      console.warn("[dsh-split-workspace] session faces are not materialized for " + key
        + " yet; the pane renders its built-in transcript/composer instead of the stock ones.");
    }

    /** Last composer-chain election per pane, published on
        `window.__dshSplitWorkspace.composerChain`. When an agent asks a question and
        no card appears, this says exactly which link failed: no chain entries
        captured, no pending interaction resolved for the session, no entry
        elected, or an entry elected without a store face. Diagnostics only —
        nothing in the render path reads it. */
    const composerChainDebug = { last: null, slots: null };
    window.__dshSplitWorkspace = Object.assign(window.__dshSplitWorkspace || {}, { composerChain: composerChainDebug });

    /** Probe both slot-ledger surfaces for the keys this plugin consumes.
        `entries()` is the raw registration view (chain keys consume every
        entry); `entriesOfSlot()` is the per-cell winner view the outlets
        actually render (list/array/single keys). They can disagree — a key
        whose entries are owned by a session scope only shows up in one of
        them — and the pane needs whichever surface has the roster. */
    function slotRosterProbe(keys) {
      const out = {};
      for (const key of keys) {
        let raw = null;
        let cells = null;
        try {
          const value = slotsService.entries(key);
          raw = Array.isArray(value) ? value.length : "not-array";
        } catch (error) { raw = "ERR:" + String(error).slice(0, 60); }
        try {
          const value = slotsService.entriesOfSlot(key);
          cells = Array.isArray(value) ? value.length : "not-array";
        } catch (error) { cells = "ERR:" + String(error).slice(0, 60); }
        out[key] = { entries: raw, entriesOfSlot: cells };
      }
      composerChainDebug.slots = out;
      return out;
    }
    Object.defineProperty(composerChainDebug, "live", {
      enumerable: false,
      get: () => slotRosterProbe(["conversation.view", "conversation.composer", "conversation.session.header", "conversation.chat.node"]),
    });
    Object.defineProperty(composerChainDebug, "rootFaces", {
      enumerable: false,
      get: rootFaceNames,
    });
    Object.defineProperty(composerChainDebug, "sessionFaces", {
      enumerable: false,
      get: () => (sessionId) => sessionFaceNames(sessionId),
    });
    Object.defineProperty(composerChainDebug, "panes", {
      enumerable: false,
      get: () => paneDebug,
    });

    /** Last prepared pane bundle, for diagnostics only. */
    const paneDebug = { last: null, faces: {} };

    /** Diagnostics-only writes: cap the per-session map so long-lived
        sessions cannot grow it without bound. */
    function notePaneFace(sessionId, entry) {
      let count = 0;
      for (const key in paneDebug.faces) count += 1;
      if (count > 32) paneDebug.faces = {};
      paneDebug.faces[sessionId] = entry;
    }

    function bindSessionFace(sessionId) {
      if (sessionsService === undefined || sessionsService === null) return undefined;
      try {
        const binding = sessionsService.binding(sessionId);
        if (binding === undefined || binding === null) return undefined;
        return binding.session;
      } catch (error) {
        noteRetainFailure(sessionId, "sessions.binding threw: " + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error).slice(0, 160));
        return undefined;
      }
    }

    // ---- bounded retain retry (1.6.1 regression fix) ---------------------
    // 1.6.0 attempted `sessions.retain()` exactly once, at pane mount. On the
    // 0.2.1 desktop host that attempt loses a race with the session catalog:
    // retain() returns undefined (the session is not resolvable yet), the error
    // was swallowed, no retry was armed, and the pane sat on "Session ended"
    // forever — deterministic on every boot. 1.5.1 was only saved by an
    // incidental re-run when the scraped session-list snapshot arrived, so the
    // fix is an explicit retry driver: backoff 200/600/1500/3000/5000 ms (max
    // 6 attempts), re-armed by `reference.ready`, by session-list snapshot
    // updates and by pane remounts. "Not yet" and "gone" are now distinct:
    // loading hint while retries remain, fallback only after exhaustion, with
    // one console.warn carrying the last caught retain error.
    const RETAIN_RETRY_DELAYS_MS = [200, 600, 1500, 3000, 5000];
    /** Pure policy: delay before retry attempt N+1, null when exhausted. */
    function retainRetryDelay(attempt) {
      if (typeof attempt !== "number" || !Number.isFinite(attempt) || attempt < 0) return null;
      const index = Math.floor(attempt);
      return index >= RETAIN_RETRY_DELAYS_MS.length ? null : RETAIN_RETRY_DELAYS_MS[index];
    }

    const sessionFaceResolvers = new Map();

    /** One pane-session's face + bounded retain retry driver. Deliberately
        plain module code (no React hooks) so the hooks below and the test seam
        drive the SAME logic. `delays` is a test-only override. */
    function createSessionFaceResolver(sessionId, delays) {
      const configured = Array.isArray(delays) && delays.length > 0 ? delays.slice() : null;
      const record = {
        sessionId,
        face: undefined,
        snapshot: { face: undefined, loading: true, exhausted: false, attempts: 0, lastError: null },
        listeners: new Set(),
        attempts: 0,
        exhausted: false,
        lastError: null,
        timer: 0,
        cancelled: false,
        warned: false,
      };
      const delayFor = (attempt) => {
        if (configured !== null) return attempt < configured.length ? configured[attempt] : null;
        return retainRetryDelay(attempt);
      };
      const publish = (patch) => {
        record.snapshot = Object.assign({}, record.snapshot, patch);
        for (const listener of [...record.listeners]) {
          try { listener(); } catch {}
        }
      };
      const failureMessage = () => {
        const failure = retainFailureOf(sessionId);
        if (failure !== undefined && failure !== null) return failure.message;
        return record.lastError !== null ? record.lastError : "unknown retain failure";
      };
      const bindNow = () => {
        const face = bindSessionFace(sessionId);
        if (face === undefined || face === null) return false;
        record.face = face;
        record.attempts = 0;
        record.exhausted = false;
        record.lastError = null;
        record.warned = false;
        clearRetainFailure(sessionId);
        notePaneFace(sessionId, {
          path: "bound",
          attempts: record.attempts,
          lastRetainError: null,
          reference: paneSessionReferences.has(sessionId),
          hasSession: true,
        });
        publish({ face, loading: false, exhausted: false, attempts: 0, lastError: null });
        return true;
      };
      const schedule = () => {
        if (record.cancelled || record.face !== undefined || record.timer !== 0) return;
        if (record.listeners.size === 0) return;
        if (record.exhausted === true) return; // already settled; never re-publish in a loop
        const delay = delayFor(record.attempts);
        if (delay === null) {
          record.exhausted = true;
          record.lastError = failureMessage();
          publish({ loading: false, exhausted: true, attempts: record.attempts, lastError: record.lastError });
          notePaneFace(sessionId, { path: "exhausted", attempts: record.attempts, lastRetainError: record.lastError });
          setRuntime({ lastError: "retain:" + String(sessionId) + ": " + record.lastError });
          if (record.warned !== true) {
            record.warned = true;
            try {
              console.warn(LOG_PREFIX + " could not retain session '" + String(sessionId) + "' for a pane after "
                + (record.attempts + 1) + " attempts (" + record.lastError + "). That pane shows its own fallback renderer"
                + " instead of the native transcript. If this persists: window.__dshSplitWorkspace.retry() or reset();"
                + " diagnostics: window.__dshSplitWorkspace.health().lastError — see README > Safety, recovery and diagnostics.");
            } catch {}
          }
          return;
        }
        record.attempts += 1;
        publish({ loading: true, attempts: record.attempts, exhausted: false });
        record.timer = window.setTimeout(() => {
          record.timer = 0;
          attempt();
        }, delay);
      };
      const attempt = () => {
        if (record.cancelled || record.face !== undefined || record.listeners.size === 0) return;
        if (bindNow()) return;
        const reference = ensureSessionReference(sessionId);
        if (record.cancelled || record.face !== undefined) return;
        if (reference === undefined) {
          record.lastError = failureMessage();
          notePaneFace(sessionId, { path: "retain-failed", attempts: record.attempts, lastRetainError: record.lastError });
          schedule();
          return;
        }
        notePaneFace(sessionId, {
          path: "retained",
          attempts: record.attempts,
          lastRetainError: null,
          reference: true,
          hasSession: reference.binding !== undefined && reference.binding !== null,
        });
        if (bindNow()) return;
        // Reference obtained but its binding has not materialized yet: retry on
        // `ready` AND keep the backoff armed, so a never-settling ready promise
        // cannot strand the pane either.
        try {
          const pending = reference.ready;
          if (pending !== undefined && pending !== null && typeof pending.then === "function") {
            pending.then(
              () => { if (!record.cancelled && record.face === undefined) attempt(); },
              () => { if (!record.cancelled && record.face === undefined) schedule(); },
            );
          }
        } catch {}
        schedule();
      };
      record.start = () => {
        if (record.face !== undefined) {
          publish({ face: record.face, loading: false, exhausted: false, lastError: null });
          return;
        }
        if (record.cancelled) { record.cancelled = false; }
        if (record.timer !== 0) return;
        // A (re)mount after exhaustion gets ONE fresh bounded cycle: the host
        // catalog may have loaded in the meantime. List-snapshot nudges below do
        // NOT re-arm, so an exhausted pane can never be driven into a loop.
        if (record.exhausted === true) {
          record.exhausted = false;
          record.attempts = 0;
          record.warned = false;
        }
        // Defer the first probe out of the commit/passive-effect pass: the
        // catalog race resolves a tick later anyway, and this keeps the store
        // subscription setup free of synchronous publishes.
        record.timer = window.setTimeout(() => {
          record.timer = 0;
          attempt();
        }, 0);
      };
      record.nudge = () => {
        if (record.cancelled || record.face !== undefined || record.timer !== 0) return;
        if (record.listeners.size === 0) return;
        if (record.exhausted === true) return; // settled; wait for a remount
        attempt();
      };
      record.subscribe = (listener) => {
        record.listeners.add(listener);
        if (record.listeners.size === 1) record.start();
        return () => {
          record.listeners.delete(listener);
          if (record.listeners.size === 0 && record.timer !== 0) {
            try { window.clearTimeout(record.timer); } catch {}
            record.timer = 0;
          }
        };
      };
      record.getSnapshot = () => record.snapshot;
      record.dispose = () => {
        record.cancelled = true;
        if (record.timer !== 0) {
          try { window.clearTimeout(record.timer); } catch {}
          record.timer = 0;
        }
        record.listeners.clear();
      };
      return record;
    }

    function sessionFaceResolver(sessionId) {
      let record = sessionFaceResolvers.get(sessionId);
      if (record === undefined) {
        record = createSessionFaceResolver(sessionId);
        sessionFaceResolvers.set(sessionId, record);
      }
      return record;
    }

    /** Reactive face + retry status for one pane's session. */
    function useSessionFaceStatus(sessionId) {
      const resolver = sessionFaceResolver(sessionId);
      return React.useSyncExternalStore(resolver.subscribe, resolver.getSnapshot, resolver.getSnapshot);
    }

    /** One pane's session face, RETAINED with bounded retries.
        0.2.0 hands out a binding only for an already-retained generation
        (`sessions.binding(id)` borrows without extending), so a pane opened on
        a session nobody else holds — a dropped-in conversation, or a pane on a
        session the native view has moved away from — has no face until this
        plugin retains it. `sessionFaceResolver` owns the retain call, its
        backoff and its diagnostics; this hook only subscribes.
        The scraped sidebar list is ADVISORY ONLY: a live pane whose row is
        temporarily filtered/collapsed/virtualized out of the sidebar must keep
        rendering its last-known face (the old cleared-on-list-loss behaviour
        showed "Session ended" over a live conversation). A LATE list snapshot
        is used as a retry signal instead. */
    function useSessionFace(sessionId) {
      const status = useSessionFaceStatus(sessionId);
      const listSnapshot = useSessionsList();
      React.useEffect(() => {
        if (listSnapshot !== null && listSnapshot !== undefined) sessionFaceResolver(sessionId).nudge();
      }, [listSnapshot, sessionId]);
      return status.face;
    }

    /** Sticky last-known summaries: the pane header keeps the title/cwd of a
        live session whose sidebar row disappeared. Bounded. */
    const lastSessionSummaries = new Map();
    function rememberSessionSummary(sessionId, summary) {
      if (typeof sessionId !== "string" || sessionId === "" || summary === null || summary === undefined) return;
      if (lastSessionSummaries.size > 64 && !lastSessionSummaries.has(sessionId)) lastSessionSummaries.clear();
      lastSessionSummaries.set(sessionId, summary);
    }


    function basenameOf(cwd) {
      if (typeof cwd !== "string" || cwd === "") return "";
      return cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd;
    }

    // ---------------------------------------------------------------------
    // hooks
    // ---------------------------------------------------------------------

    function useObserved(source, fallback) {
      const subscribe = React.useMemo(
        () => (source === undefined || source === null ? () => () => {} : (fn) => source.subscribe(fn)),
        [source],
      );
      const getSnapshot = React.useMemo(
        () => (source === undefined || source === null ? () => fallback : () => source.getSnapshot()),
        [source, fallback],
      );
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function useTree() {
      React.useSyncExternalStore(treeStore.subscribe, treeStore.getRevision, treeStore.getRevision);
      return treeStore.getSnapshot();
    }

    /** LEGACY pending-interaction source (0.1.5): the uiSession service exposed
        the pending map directly. The 0.2.x UiSession service has NO such
        property, so this path yields nothing on the live host — it stays as the
        fallback for 0.1.x compositions. The live source is the ROOT standard
        `useSessionStatus` hook, read by RootPendingProbe below. */
    const EMPTY_PENDING_INTERACTIONS = new Map();
    function pendingInteractionsSource() {
      const service = uiSessionService;
      if (service === undefined || service === null) return undefined;
      const source = service.pendingInteractions;
      return source !== undefined && source !== null && typeof source.getSnapshot === "function" ? source : undefined;
    }
    function useLegacySessionPendingInteraction(selector) {
      const subscribe = React.useCallback((notify) => {
        const source = pendingInteractionsSource();
        if (source === undefined || typeof source.subscribe !== "function") return () => {};
        return source.subscribe(notify);
      }, []);
      const getSnapshot = React.useCallback(
        () => {
          const source = pendingInteractionsSource();
          return source === undefined ? EMPTY_PENDING_INTERACTIONS : source.getSnapshot();
        },
        [],
      );
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      if (selector === undefined) return snapshot;
      return snapshot === null || snapshot === undefined || typeof snapshot.get !== "function"
        ? undefined
        : selector(snapshot);
    }

    // ---- root-sourced pending interactions (0.2.x) ------------------------
    // The stock conversation reads
    //   useSessionStatus((snapshot) => snapshot.get(sessionId)?.pendingInteraction)
    // from its ROOT standard kit. A root hook can only be called inside a
    // component, so each pane mounts a tiny probe component that subscribes the
    // root hook and publishes the value into this module store; ChatPane then
    // reads it without branching its own hook list.
    const rootPendingBySession = new Map();
    const rootPendingListeners = new Set();
    function setRootPending(sessionId, pending) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      const previous = rootPendingBySession.get(sessionId);
      if (previous === pending) return;
      if (pending === undefined || pending === null) rootPendingBySession.delete(sessionId);
      else rootPendingBySession.set(sessionId, pending);
      for (const listener of [...rootPendingListeners]) {
        try { listener(); } catch {}
      }
    }
    function useRootPendingInteraction(sessionId) {
      return React.useSyncExternalStore(
        (listener) => {
          rootPendingListeners.add(listener);
          return () => { rootPendingListeners.delete(listener); };
        },
        () => rootPendingBySession.get(sessionId),
        () => rootPendingBySession.get(sessionId),
      );
    }
    /** Mounted by ChatPane only when the harvested root kit carries
        `useSessionStatus`; its OWN hook list is fixed (one root hook + one
        effect), so the root source can appear/disappear without touching the
        pane's hook order. */
    function RootPendingProbe({ useSessionStatus, sessionId }) {
      const pending = useSessionStatus((snapshot) => {
        if (snapshot === null || snapshot === undefined || typeof snapshot.get !== "function") return undefined;
        const status = snapshot.get(sessionId);
        return status !== null && status !== undefined ? status.pendingInteraction : undefined;
      });
      React.useEffect(() => {
        setRootPending(sessionId, pending === null ? undefined : pending);
      }, [pending, sessionId]);
      React.useEffect(() => () => setRootPending(sessionId, undefined), [sessionId]);
      return null;
    }

    function useSessionsList() {
      return useObserved(sessionsListSource, null);
    }

    /** Selector hook factory over one SessionFace. Registers no hooks in the
        factory itself (it may run conditionally). */
    function makeUseSession(face) {
      const subscribe =
        face === undefined || face === null
          ? (cb) => () => {}
          : (cb) => face.subscribe(cb);
      const readSnapshot = face === undefined || face === null ? () => null : () => face.getSnapshot();
      return function useSession(selector) {
        const cache = React.useRef({ snapshot: undefined, selector: undefined, value: undefined });
        const compute = () => {
          const snapshot = readSnapshot();
          const entry = cache.current;
          if (entry.snapshot === snapshot && entry.selector === selector) return entry.value;
          const value = snapshot === null ? null : selector(snapshot);
          cache.current = { snapshot, selector, value };
          return value;
        };
        return React.useSyncExternalStore(subscribe, compute, compute);
      };
    }

    /** Selector hook factory over any observable store face. */
    function makeUseStoreFace(store, fallbackValue) {
      const subscribe =
        store === undefined || store === null || typeof store.subscribe !== "function"
          ? (cb) => () => {}
          : (cb) => store.subscribe(cb);
      const read = store === undefined || store === null || typeof store.getSnapshot !== "function"
        ? () => (fallbackValue === undefined ? null : fallbackValue)
        : () => store.getSnapshot();
      return function useStoreFace(selector) {
        const cache = React.useRef({ snapshot: undefined, selector: undefined, value: undefined });
        const compute = () => {
          const snapshot = read();
          const entry = cache.current;
          if (entry.snapshot === snapshot && entry.selector === selector) return entry.value;
          const value = selector === undefined ? snapshot : selector(snapshot);
          cache.current = { snapshot, selector, value };
          return value;
        };
        return React.useSyncExternalStore(subscribe, compute, compute);
      };
    }

    /** useSessions standard-kit hook: selector over the sessions list store. */
    function makeUseSessions() {
      const useList = makeUseStoreFace(sessionsListSource, { ids: [], byId: {} });
      return function useSessions(selector) {
        return useList(selector || ((s) => s));
      };
    }

    /** useProjection standard-kit hook over session projections. Per-face
        hooks are cached so subscribe identities stay stable across renders.

        An UNRESOLVED face is deliberately not cached. The kit is built once
        per pane, so caching a miss would freeze that projection key to
        `undefined` for the pane's whole life: `useProjection("sessionStats")`
        would fall back to the window-scoped derive path (counts and the tok/s
        average lagging behind) and `useProjection("tokenUsage")` would drop
        the whole token / cache-hit half of the composer stats row, because
        `hasTokens` then stays false. The stock renderer re-resolves its
        projection source on every render, so retrying here is the parity fix.

        Every render still calls exactly ONE store hook — the unresolved path
        hands back a shared no-op face — because skipping the call would change
        the hook count and blow up React the moment the face appeared. */
    function makeUseProjection(session) {
      const cache = new Map();
      const pending = makeUseStoreFace(undefined, undefined);
      return function useProjection(name, selector) {
        let useFace = cache.get(name);
        if (useFace === undefined) {
          let face;
          try {
            face = session !== undefined && session !== null && session.projections !== undefined
              ? session.projections.faceOf(name)
              : undefined;
          } catch {
            face = undefined;
          }
          if (face !== undefined && face !== null) {
            useFace = makeUseStoreFace(face, undefined);
            cache.set(name, useFace);
          } else {
            if (captureLog["projection:" + name] !== true) {
              captureLog["projection:" + name] = true;
              console.warn("[dsh-split-workspace] projection '" + name + "' is not resolvable yet; retrying every render");
            }
            useFace = pending;
          }
        }
        return useFace((snapshot) => {
          if (snapshot === null || snapshot === undefined) return undefined;
          return selector === undefined ? snapshot : selector(snapshot);
        });
      };
    }

    // ---------------------------------------------------------------------
    // chat snapshot helpers (fallback renderer)
    // ---------------------------------------------------------------------

    function blockText(content) {
      if (!Array.isArray(content)) return "";
      return content
        .map((block) => (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string" ? block.text : ""))
        .join("");
    }

    function firstLine(text, max) {
      const line = String(text).split("\n").find((candidate) => candidate.trim() !== "") || "";
      return line.length > max ? line.slice(0, max - 1) + "…" : line;
    }

    function formatClock(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m > 0 ? m + "m" + String(s).padStart(2, "0") + "s" : s + "s";
    }

    // One transient pane toast at a time (4s floor between announcements).
    let paneToastAt = 0;
    /** Fire-and-forget transient toast for outcomes the native UI renders only
        as a muted transcript row (e.g. /compact completion). Never throws. */
    /** Rename a pane session through the host's binding, the same path the
        stock rename dialog uses. Never throws; a rejected rename just leaves
        the title unchanged and the next summary refresh corrects it. */
    function renamePaneSession(sessionId, nextTitle) {
      try {
        if (sessionsService !== undefined && sessionsService !== null && typeof sessionsService.using === "function") {
          Promise.resolve(sessionsService.using(sessionId, { source: "splitView" }, (reference) => reference.binding.session.rename(nextTitle))).catch(() => {});
          return;
        }
        const binding = sessionsService !== undefined && sessionsService !== null && typeof sessionsService.binding === "function"
          ? sessionsService.binding(sessionId)
          : undefined;
        if (binding !== undefined && binding !== null && binding.session !== undefined) {
          Promise.resolve(binding.session.rename(nextTitle)).catch(() => {});
        }
      } catch {}
    }

    function showPaneToast(message) {
      const now = Date.now();
      if (now - paneToastAt < 4000) return;
      paneToastAt = now;
      try {
        const el = document.createElement("div");
        el.className = "dsv-toast";
        el.setAttribute("role", "status");
        el.textContent = String(message);
        el.style.cssText = "position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:2147483000;"
          + "max-width:min(640px,80vw);padding:8px 14px;border-radius:10px;"
          + "background:var(--dsw-alias-bg-overlay,rgba(28,28,32,.96));color:var(--dsw-alias-label-primary,#f2f2f2);"
          + "border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));box-shadow:0 6px 24px rgba(0,0,0,.35);"
          + "font-size:12px;line-height:18px;pointer-events:none;text-align:center;";
        document.body.appendChild(el);
        window.setTimeout(() => { try { el.remove(); } catch {} }, 4200);
      } catch {}
    }

    // ---------------------------------------------------------------------
    // slot capture: re-host the native conversation components per pane
    // ---------------------------------------------------------------------

    const captureLog = {};

    function capturedEntries(key) {
      if (slotsService === undefined || slotsService === null) return [];
      try {
        // Prefer the renderer's OWN outlet view. `entriesOfSlot` yields the
        // winners a slot outlet would render: it skips entries the slot core
        // has ABDICATED (an entry that threw is permanently benched) and
        // dedupes by cell id. `entries()` is the raw registration ledger and
        // does neither, so a benched or crashed entry stayed mounted here
        // forever, re-throwing on every render into a PaneBoundary that
        // renders null — the cell silently vanished from the pane while the
        // stock outlet kept rendering its neighbours.
        const source = typeof slotsService.entriesOfSlot === "function"
          ? (name) => slotsService.entriesOfSlot(name)
          : (name) => slotsService.entries(name);
        const raw = source(key);
        if (!Array.isArray(raw)) return [];
        return raw;
      } catch (error) {
        if (captureLog[key] !== true) {
          captureLog[key] = true;
          console.warn("[dsh-split-workspace] slots.entries(" + key + ") unavailable:", String(error).slice(0, 120));
        }
        return [];
      }
    }

    /** Best-effort extraction of { options, component, raw } from an entry record.
        Ground truth (SlotCore.register): the record is
        { component, options: {key?,id?,order?,label?,priority?}, select?, inject?,
          children?, store?, locale?, registrant? } — select/inject live on the
          record itself, not inside options. */
    function entryParts(entry) {
      if (entry === null || entry === undefined) return null;
      const options = entry.options !== undefined ? entry.options : entry;
      const component =
        entry.component !== undefined ? entry.component
        : entry.Component !== undefined ? entry.Component
        : entry.value !== undefined ? entry.value
        : entry.render !== undefined ? entry.render
        : typeof entry === "function" ? entry
        : null;
      if (component === null || component === undefined) return null;
      return { options, component, raw: entry };
    }

    function findEntryInList(entries, match) {
      for (const entry of entries) {
        const parts = entryParts(entry);
        if (parts === null) continue;
        if (match === undefined) return parts;
        if (match(parts.options, parts.component)) return parts;
      }
      return null;
    }

    function findEntry(key, match) {
      return findEntryInList(capturedEntries(key), match);
    }

    function conversationTranslate() {
      if (conversationT !== null) return conversationT;
      if (localeService === undefined || localeService === null) return (key) => key;
      try {
        conversationT = localeService.bind("conversation");
      } catch {
        conversationT = null;
      }
      return conversationT !== null ? conversationT : (key) => key;
    }

    /** The framework binds each slot occupant's `t` to that occupant's OWN
        locale namespace. The kit's `t` is bound to "conversation", so entries
        from other packages (model selection: "effort.providerDefault", …)
        would render raw keys. Bind per entry when the record carries a
        different namespace. */
    function entryTranslate(entry) {
      if (localeService === undefined || localeService === null) return undefined;
      try {
        const ns = entry !== null && entry !== undefined && typeof entry.locale === "string" ? entry.locale : null;
        if (ns === null || ns === "" || ns === "conversation") return undefined;
        const bound = localeService.bind(ns);
        return typeof bound === "function" ? bound : undefined;
      } catch {
        return undefined;
      }
    }

    /** Per-session scroll positions for re-hosted chat/trajectory views.
        Bounded: a long page life with many conversations must not grow this
        map without limit (one entry per session, oldest out first). */
    const chatScrollMemory = new Map();
    function rememberChatScroll(sessionId, position) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (position === null || position === undefined) {
        chatScrollMemory.delete(sessionId);
        return;
      }
      if (chatScrollMemory.size >= 32 && !chatScrollMemory.has(sessionId)) {
        const oldest = chatScrollMemory.keys().next();
        if (oldest.done !== true) chatScrollMemory.delete(oldest.value);
      }
      chatScrollMemory.set(sessionId, position);
    }

    /** Per-pane image intake (drag-drop + clipboard paste) wired to each
        pane's re-hosted composer face. */
    const paneImageIntake = new Map();

    /** Per-pane Lexical root guards ({ editor, dispose, retire }) — see
        prepareNative: the hidden stock composer for the same session strips or
        steals the editor's root element on mount/unmount, orphaning the pane's
        editor. */
    const paneEditorGuards = new Map();

    /** Elements carrying a LIVE IME composition (element -> last event stamp).
        Lexical binds its composition listeners — and its keymap's `composing`
        flag — to the editor ROOT element, so anything that re-points that root,
        or re-lays-out its surroundings, while a composition is live ORPHANS the
        preedit: the browser keeps painting the composition underline, Lexical
        never sees the compositionend, and every composition-gated branch
        (Enter above all) misfires from then on. So the plugin stands down on a
        pane while a composition is live inside it.

        Keyed by the element the composition targets (the contenteditable, or a
        TUI textarea). A `focusout` retires the entry, so a composition killed
        without a compositionend cannot wedge a pane forever; the age cap is a
        second backstop. */
    const composingSince = new Map();
    const COMPOSITION_STALE_MS = 30000;
    const noteComposition = (event) => {
      const target = event.target;
      if (target === null || target === undefined || target.nodeType !== 1) return;
      if (event.type === "compositionend") composingSince.delete(target);
      else composingSince.set(target, Date.now());
    };
    const retireComposition = (event) => {
      const target = event.target;
      if (target !== null && target !== undefined && target.nodeType === 1) composingSince.delete(target);
    };
    /** True while `scope` (or anything inside it) has a live composition. */
    const composingIn = (scope) => {
      if (scope === null || scope === undefined) return false;
      const now = Date.now();
      for (const [el, at] of composingSince) {
        if (now - at > COMPOSITION_STALE_MS) { composingSince.delete(el); continue; }
        if (el === scope) return true;
        try { if (typeof scope.contains === "function" && scope.contains(el)) return true; } catch {}
      }
      return false;
    };

    /** Last session the user actually typed into — focus fallback target. */
    let lastTypedSessionId = null;
    const paneTypingUnsubs = new Map();
    try { lastTypedSessionId = window.localStorage.getItem("dsh.split-workspace.last-typed.v1"); } catch {}
    function rememberTypedSession(id) {
      lastTypedSessionId = id;
      try { window.localStorage.setItem("dsh.split-workspace.last-typed.v1", id); } catch {}
    }

    /** Per-pane chat store instances (selection/inspect/draft/view currency). */
    const paneChatStores = new Map();
    function paneChatStore(sessionId) {
      let store = paneChatStores.get(sessionId);
      if (store !== undefined) return store;
      let snapshot = { selection: null, draft: "", view: null, inspect: null, turnProcesses: [] };
      const listeners = new Set();
      const emit = () => {
        for (const fn of [...listeners]) fn();
      };
      store = {
        useStore(selector) {
          const use = makeUseStoreFace(
            { subscribe: (fn) => store.subscribe(fn), getSnapshot: () => snapshot },
            snapshot,
          );
          return use(selector);
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        getSnapshot: () => snapshot,
        actions: {
          select: (target) => {
            snapshot = { ...snapshot, selection: target };
            emit();
          },
          setDraft: (text) => {
            snapshot = { ...snapshot, draft: text };
            emit();
          },
          setView: (view) => {
            snapshot = { ...snapshot, view };
            emit();
          },
          setInspect: (target) => {
            snapshot = { ...snapshot, inspect: target };
            emit();
          },
          // dsh 0.1.5 chat store action: the manually expanded answer per
          // Turn (storedTurnProcessEntry reads snapshot.turnProcesses).
          setTurnProcessOpen: (turn, answerStep, open) => {
            const list = Array.isArray(snapshot.turnProcesses) ? [...snapshot.turnProcesses] : [];
            const index = list.findIndex((entry) => entry !== null && entry !== undefined && entry.turn === turn);
            if (open !== true) {
              if (index >= 0) list.splice(index, 1);
            } else if (index < 0) {
              list.push({ turn, answerStep });
            } else {
              list[index] = { turn, answerStep };
            }
            snapshot = { ...snapshot, turnProcesses: list };
            emit();
          },
        },
      };
      paneChatStores.set(sessionId, store);
      return store;
    }

    /** Standard hook prop naming (matches the slots runtime's
        standardHookPropName): "chat" → "useChat", "chatNode" → "useChatNode". */
    function hookPropName(name) {
      const text = String(name);
      return "use" + text.charAt(0).toUpperCase() + text.slice(1);
    }

    /** Keyed selector hook over a keyed-source resolver — the local port of
        the renderer's keyedObservableHook: use<Name>(key, selector). */
    function makeKeyedUseFace(resolver) {
      const cache = new Map();
      return function useKeyedFace(key, selector, equal) {
        let use = cache.get(key);
        if (use === undefined) {
          let source;
          try { source = resolver(key); } catch { source = undefined; }
          use = makeUseStoreFace(source, undefined);
          cache.set(key, use);
        }
        return use(selector === undefined ? (value) => value : selector);
      };
    }

    /** Per-entry store instances (renderer parity): handle -> session -> instance. */
    const entryStoreCache = new Map();

    /** Instantiate the store an entry declares, exactly like the renderer's
        host.storeOf(entry, scoped binding): the declared handle mints one
        instance per scope key. Components read their own domain store through
        it (ExpandButton reads state.bySession[sessionId], ChatView reads
        state.turnProcesses, …) — handing them any other store crashes their
        selectors.

        `scopeKey` is the renderer's own scope key: a Session binding's key on
        0.2.0 (the session id), the legacy "session-<id>" spelling on 0.1.x.
        The instance is this plugin's own either way (the renderer's cache is
        not reachable), so the key only has to be stable and distinct. */
    function entryStoreInstance(parts, sessionId, scopeKey) {
      if (parts === null || parts === undefined) return null;
      const raw = parts.raw;
      const opts = parts.options;
      let handle = raw !== null && raw !== undefined && raw.store !== undefined ? raw.store
        : (opts !== null && opts !== undefined && opts.store !== undefined ? opts.store : undefined);
      // Registration accepts a handle or a thunk that mints one; the registry
      // resolves the thunk once (`typeof options.store === "function"`).
      if (typeof handle === "function" && handle.create === undefined) {
        try { handle = handle(); } catch (error) { handle = undefined; }
      }
      if (handle === undefined || handle === null || typeof handle.create !== "function") return null;
      let bySession = entryStoreCache.get(handle);
      if (bySession === undefined) {
        bySession = new Map();
        entryStoreCache.set(handle, bySession);
      }
      const key = typeof scopeKey === "string" && scopeKey !== "" ? scopeKey : "session-" + sessionId;
      if (bySession.has(key)) return bySession.get(key);
      let instance = null;
      try { instance = handle.create(key); } catch (error) { instance = null; }
      bySession.set(key, instance);
      return instance;
    }

    /** The useStore/actions pair for one entry, or {} when it declares no store. */
    function entryStoreProps(parts, sessionId, scopeKey) {
      const instance = entryStoreInstance(parts, sessionId, scopeKey);
      if (instance === null || instance === undefined) return {};
      return {
        useStore: makeUseStoreFace(instance, undefined),
        actions: instance.actions,
      };
    }

    /** Mirror the slots runtime's InjectFace semantics: an inject result of
        { hooks: { name: store } } surfaces each store as a `use<Name>` hook
        prop (hooks.duration → useDuration), and { keyedHooks: { name: resolver } }
        surfaces as a keyed `use<Name>(key, selector)` prop (0.1.5's ChatView
        reads useChatNode/useChatNodeProcess this way). Everything else passes
        through. Without this, re-hosted views (TrajectoryView and friends)
        never receive their hook props and render broken. */
    function injectFaceProps(result) {
      if (result === null || result === undefined) return {};
      const out = {};
      for (const key of Object.keys(result)) {
        const value = result[key];
        if (key === "hooks" && value !== null && typeof value === "object") {
          for (const hookName of Object.keys(value)) {
            if (value[hookName] === undefined) continue;
            out[hookPropName(hookName)] = makeUseStoreFace(value[hookName], undefined);
          }
        } else if (key === "keyedHooks" && value !== null && typeof value === "object") {
          for (const hookName of Object.keys(value)) {
            if (value[hookName] === undefined) continue;
            out[hookPropName(hookName)] = makeKeyedUseFace(value[hookName]);
          }
        } else {
          out[key] = value;
        }
      }
      return out;
    }

    /** dsh 0.1.5: materialize one session's standard source exactly like the
        slots renderer does (materializeStandardBinding): plain props verbatim,
        hooks as identity-stable use<Name> selector hooks, keyed hooks as keyed
        selector hooks. The re-hosted native components read standard faces
        (useChat, useConversation, useInput, useSession, ...) off this kit; on
        0.1.5 they come from the uiSession service's registered contributions
        (ui-chat contributes `chat`, ui-conversation `conversation`/`input`
        + inputActions, ui-session `session`, ...). */
    function materializeSessionStandard(sessionId) {
      const binding = resolveSessionBinding(sessionId);
      if (binding === undefined || binding === null) return { faces: {}, key: undefined };
      const out = {};
      const props = binding.props;
      if (props !== null && props !== undefined && typeof props === "object") {
        for (const key of Object.keys(props)) out[key] = props[key];
      }
      const hooks = binding.hooks;
      if (hooks !== null && hooks !== undefined && typeof hooks === "object") {
        for (const key of Object.keys(hooks)) {
          if (hooks[key] === undefined) continue;
          out[hookPropName(key)] = makeUseStoreFace(hooks[key], undefined);
        }
      }
      const keyedHooks = binding.keyedHooks;
      if (keyedHooks !== null && keyedHooks !== undefined && typeof keyedHooks === "object") {
        for (const key of Object.keys(keyedHooks)) {
          if (keyedHooks[key] === undefined) continue;
          out[hookPropName(key)] = makeKeyedUseFace(keyedHooks[key]);
        }
      }
      // 0.2.0 store scope key: the registry mints entry stores with
      // `handle.create(scopeBinding.key)`, and a Session binding's key IS the
      // session id (ui-session's materialize: `key: binding.sessionId`).
      // 0.1.x bindings carried no key, so the legacy "session-<id>" spelling
      // stays as the fallback (the plugin owns these instances either way).
      const key = typeof binding.key === "string" && binding.key !== "" ? binding.key : "session-" + sessionId;
      return { faces: out, key };
    }

    /** The standard session kit for one pane. Built ONCE per (sessionId,
        session) in ChatPane's memo — identities must stay stable so the
        re-hosted native components do not resubscribe every render.

        Returns the component kit, the STANDARD faces alone (root + session,
        exactly what the renderer passes to slot-level inject factories as
        `standard`), and the store scope key for entry stores. */
    function makeKit(sessionId, session, rootFaces) {
      const kit = {
        sessionId,
        useSession: makeUseSession(session),
        useSessions: makeUseSessions(),
        useProjection: makeUseProjection(session),
        t: conversationTranslate(),
      };
      // Root faces are the canonical implementations of the GLOBAL hooks
      // (useSessions over the real list store, useSessionStatus, …): they beat
      // this plugin's own stand-ins, which exist only for compositions that
      // never published a root kit (0.1.5 resolve() merges them itself).
      if (rootFaces !== null && rootFaces !== undefined) {
        for (const key of Object.keys(rootFaces)) kit[key] = rootFaces[key];
      }
      // Session-scoped faces win over everything (0.1.5 injects them here too).
      const sessionStandard = materializeSessionStandard(sessionId);
      for (const key of Object.keys(sessionStandard.faces)) kit[key] = sessionStandard.faces[key];
      const standard = rootFaces !== null && rootFaces !== undefined
        ? { ...rootFaces, ...sessionStandard.faces }
        : { ...sessionStandard.faces };
      // The kit is built once per pane, so a resolution miss here is permanent
      // for that pane. `useChat` is the one that matters most: slot occupants
      // like the composer stats row call it unconditionally, and without it
      // they throw on every render straight into the (silent) pane boundary —
      // the cell just disappears. Say so loudly instead of letting it vanish.
      if (kit.useChat === undefined) {
        const seen = captureLog["kit:useChat:" + sessionId];
        captureLog["kit:useChat:" + sessionId] = (seen === undefined ? 0 : seen) + 1;
        if (seen === undefined) {
          console.warn("[dsh-split-workspace] standard session faces unresolved for " + sessionId
            + " (no useChat); slot occupants that need them will render nothing. keys: "
            + Object.keys(sessionStandard.faces).join(","));
        }
      }
      return { kit, standard, scopeKey: sessionStandard.key };
    }

    /** Clone the kit (shallow) and merge extras — owner props win. */
    function kitProps(kit, extra) {
      const props = { ...kit };
      if (extra !== undefined && extra !== null) {
        for (const key of Object.keys(extra)) props[key] = extra[key];
      }
      return props;
    }

    // ---------------------------------------------------------------------
    // slot-level inject faces (0.1.x + 0.2.0)
    //
    // Beside the entry's own `inject(sessionId, actions)` face, a slot KEY can
    // declare a common inject face on the registration that declares it
    // (`children: { "<key>": { kind, scope, inject } }`). The stock renderer
    // folds it into every entry of that key in two halves:
    //   * `hooks`/`keyedHooks` sources          -> bound use<Name> props
    //   * FUNCTION-valued `hooks` members       -> "slot hook factories",
    //     invoked per render occurrence with (standard, hookContext)
    // The second half is what 0.2.0 introduced for the Chat node seat:
    // ui-chat declares `inject: { hooks: { turnData: …, disclosure:
    // (_standard, { disclosureReset }) => … } }` and ChatView passes the
    // per-node context through its `renderSlot(..., { hookContext })` call.
    // A pane that re-hosts ChatView must therefore honor `hookContext` and run
    // those factories, or every reasoning/tool row dies on
    // "useDisclosure is not a function".
    // ---------------------------------------------------------------------

    const slotInjectCache = new WeakMap();
    const EMPTY_SLOT_INJECT = { props: {} };

    /** Normalize one slot-level inject face by object identity (the declaration
        keeps one face object for the slot's whole life). */
    function cachedSlotInject(face) {
      if (face === undefined || face === null) return EMPTY_SLOT_INJECT;
      let bound = slotInjectCache.get(face);
      if (bound !== undefined) return bound;
      const definitions = face.hooks;
      if (definitions === undefined || definitions === null || typeof definitions !== "object") {
        bound = { props: face };
        slotInjectCache.set(face, bound);
        return bound;
      }
      const props = {};
      for (const key of Object.keys(face)) {
        if (key !== "hooks") props[key] = face[key];
      }
      let factories = null;
      for (const name of Object.keys(definitions)) {
        const definition = definitions[name];
        if (definition === undefined) continue;
        const hookName = hookPropName(name);
        if (typeof definition === "function") {
          if (factories === null) factories = {};
          factories[name] = definition;
        } else {
          props[hookName] = makeUseStoreFace(definition, undefined);
        }
      }
      bound = factories === null ? { props } : { props, slotHookFactories: factories };
      slotInjectCache.set(face, bound);
      return bound;
    }

    /** The declaration-owned inject face of one slot key, or undefined. */
    function slotInjectFaceOf(name) {
      const service = slotsService;
      if (service === undefined || service === null || typeof service.spec !== "function") return undefined;
      try {
        const spec = service.spec(name);
        return spec === undefined || spec === null ? undefined : spec.inject;
      } catch (error) {
        return undefined;
      }
    }

    /** Bind the function-valued slot hooks for ONE render occurrence. */
    function bindSlotHookFactories(factories, standard, hookContext) {
      const hooks = {};
      for (const name of Object.keys(factories)) {
        try {
          hooks[hookPropName(name)] = factories[name](standard, hookContext);
        } catch (error) {
          if (captureLog["slotFactory:" + name] !== true) {
            captureLog["slotFactory:" + name] = true;
            console.warn("[dsh-split-workspace] slot hook factory '" + name + "' failed:", String(error).slice(0, 140));
          }
        }
      }
      return hooks;
    }

    // ---------------------------------------------------------------------
    // factory-slot parity (0.2.1 framework seats)
    //
    // The 0.2.1 renderer attaches `renderFactorySlot` to EVERY re-hosted entry
    // (see renderer `standardKit`). Components migrated to factory slots call it
    // unconditionally — the user-message bubble (`UserStyleBubble` in ui-chat
    // calls `props.renderFactorySlot("conversation.chat.user.content", …)`) and
    // the model selector's label (`ModelSelect` calls
    // `props.renderSlot("conversation.input.model.label", …)` from its factory
    // kit) are the live-breakage cases. Without this seat the re-hosted render
    // throws "renderFactorySlot is not a function" / "renderSlot is not a
    // function" into the pane boundary, so user messages and model-label seats
    // vanish on 0.2.1.
    //
    // This is a GUARDED reimplementation of the renderer's FactoryOutlet on top
    // of the public host face (`slotsService.hostFace()`): version
    // subscription, factory lookup, ancestry recursion guard, its own error
    // boundary that renders the caller's fallback and never escalates to the
    // pane boundary, the factory kit assembled from THIS pane's standard faces
    // (plus the declared-children renderSlot/renderSlotChain seats, locale `t`,
    // store pair and inject face), and a `useFactorySlot` stub for nested local
    // slots. When the host face is unavailable the outlet renders the fallback
    // and logs once — it never throws into React render. Compatible with the
    // 0.2.0 host face too (same subscribeFactory/factoryOf surface).
    // ---------------------------------------------------------------------

    /** Cordis ctx of the plugin, used as the synthetic factory store scope
        owner (`bindStoreScope` wants {key, ctx}). Set in apply(). */
    let pluginCtx = null;
    let hostFaceCache = null;
    function factoryHostFace() {
      const service = slotsService;
      if (service === undefined || service === null || typeof service.hostFace !== "function") return null;
      if (hostFaceCache !== null && hostFaceCache.service === service) return hostFaceCache.face;
      try {
        const face = service.hostFace();
        if (face === undefined || face === null
            || typeof face.subscribeFactory !== "function"
            || typeof face.getFactoryVersion !== "function"
            || typeof face.factoryOf !== "function") return null;
        hostFaceCache = { service, face };
        return face;
      } catch {
        return null;
      }
    }

    const EMPTY_FACTORY_ANCESTRY = new Set();
    let factoryAncestryContext = null;
    function factoryAncestry() {
      // Lazy so module evaluation never depends on React.createContext (the
      // bundle also evaluates under minimal test shims).
      if (factoryAncestryContext === null) factoryAncestryContext = React.createContext(EMPTY_FACTORY_ANCESTRY);
      return factoryAncestryContext;
    }
    const NOOP_FACTORY_COMPONENT = () => null;
    /** `useFactorySlot` replacement: a local-slot factory renders its declared
        fallback (or nothing) instead of throwing outside its occurrence. */
    function factorySlotStub(name, fallback) {
      return fallback !== undefined && fallback !== null ? fallback : NOOP_FACTORY_COMPONENT;
    }
    function bindFactoryLocale(namespace) {
      if (typeof namespace !== "string" || namespace === "" || localeService === undefined || localeService === null) return undefined;
      try {
        const bound = localeService.bind(namespace);
        return typeof bound === "function" ? bound : undefined;
      } catch {
        return undefined;
      }
    }

    class FactorySlotBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        try {
          const key = "factory:" + String(this.props.name);
          if (captureLog[key] !== true) {
            captureLog[key] = true;
            console.warn(LOG_PREFIX + " factory slot '" + String(this.props.name)
              + "' failed to render (showing its fallback; the rest of the pane keeps running):", String(error).slice(0, 200));
          }
        } catch {}
      }
      render() {
        if (this.state.failed === true) {
          return this.props.fallback !== undefined && this.props.fallback !== null ? this.props.fallback : null;
        }
        return this.props.children;
      }
    }

    /** One factory occurrence: mirrors the renderer's FactoryOutlet semantics. */
    function FactorySlotOccurrence({ name, inputProps, slots, fallback, standard, sessionId, scopeKey, kitT, paneRenderers }) {
      const host = factoryHostFace();
      const AncestryContext = factoryAncestry();
      const ancestors = React.useContext(AncestryContext);
      const subscribeFactory = React.useCallback(
        (notify) => (host === null ? NOOP_SUBSCRIBE() : host.subscribeFactory(name, notify)),
        [host, name],
      );
      const readFactoryVersion = React.useCallback(
        () => (host === null ? 0 : host.getFactoryVersion(name)),
        [host, name],
      );
      const factoryVersion = React.useSyncExternalStore(subscribeFactory, readFactoryVersion);
      const occurrence = React.useRef({}).current;
      const nextAncestors = React.useMemo(() => new Set(ancestors).add(name), [ancestors, name]);
      const boundFactorySlot = React.useMemo(
        () => makeFactorySlotRenderer(standard, sessionId, scopeKey, kitT, paneRenderers),
        [standard, sessionId, scopeKey, kitT, paneRenderers],
      );
      React.useEffect(() => {
        if (host === null) return undefined;
        let release = undefined;
        try {
          const definition = host.factoryOf(name);
          if (definition !== undefined && definition !== null && typeof host.retainFactoryOccurrence === "function") {
            release = host.retainFactoryOccurrence(definition, occurrence);
          }
        } catch {}
        return () => {
          if (typeof release === "function") {
            try { release(); } catch {}
          }
        };
      }, [host, name, occurrence]);
      const definition = host === null ? undefined : (() => {
        try { return host.factoryOf(name); } catch { return undefined; }
      })();
      if (host === null || definition === undefined || definition === null) {
        return fallback !== undefined && fallback !== null ? fallback : null;
      }
      if (ancestors.has(name)) {
        // Recursion: the stock outlet throws a SlotOwnershipError here; a throw
        // from a shared content factory would blank every re-hosted row, so
        // degrade to the fallback instead.
        return fallback !== undefined && fallback !== null ? fallback : null;
      }
      const children = definition.children;
      const childrenDeclared = children !== undefined && children !== null && typeof children === "object";
      let registrationKit = null;
      try {
        registrationKit = {
          renderFactorySlot: boundFactorySlot,
          useFactorySlot: factorySlotStub,
        };
        const localeT = definition.locale !== undefined ? bindFactoryLocale(definition.locale) : undefined;
        registrationKit.t = localeT !== undefined ? localeT : (kitT !== undefined ? kitT : conversationTranslate());
        if (childrenDeclared) {
          if (paneRenderers !== null && paneRenderers !== undefined) {
            registrationKit.renderSlot = paneRenderers.renderSlot;
            let hasChain = false;
            for (const childKey of Object.keys(children)) {
              const child = children[childKey];
              if (child !== null && child !== undefined && child.kind === "chain") { hasChain = true; break; }
            }
            if (hasChain) registrationKit.renderSlotChain = paneRenderers.renderSlotChain;
          }
        }
      } catch (error) {
        if (captureLog.factoryKit !== true) {
          captureLog.factoryKit = true;
          console.warn(LOG_PREFIX + " could not assemble the kit for factory slot '" + name + "':", String(error).slice(0, 160));
        }
        registrationKit = { renderFactorySlot: boundFactorySlot, useFactorySlot: factorySlotStub };
      }
      // Factory store: the renderer resolves it from a session scope binding;
      // ours is synthetic ({key, ctx}) because the pane lives outside the stock
      // React scope tree. Every step is guarded — a factory without its store
      // fails into the boundary instead of taking the pane down.
      let store = undefined;
      if (definition.store !== undefined && pluginCtx !== null) {
        try {
          if (typeof host.factoryStoreOf === "function") {
            store = host.factoryStoreOf(definition, { key: scopeKey, ctx: pluginCtx }, occurrence);
          }
        } catch (error) {
          if (captureLog.factoryStore !== true) {
            captureLog.factoryStore = true;
            console.warn(LOG_PREFIX + " factory store resolution failed for '" + name + "' (continuing without it):", String(error).slice(0, 160));
          }
          store = undefined;
        }
      }
      let injected = EMPTY_FACTORY_INJECT;
      try {
        injected = runFactoryInject(definition, sessionId, store !== undefined && store !== null ? store.actions : undefined);
      } catch {}
      const provided = Object.assign({}, standard, registrationKit);
      if (store !== undefined && store !== null) {
        provided.useStore = makeUseStoreFace(store, undefined);
        provided.actions = store.actions;
      }
      const props = Object.assign({}, provided, injected, inputProps !== undefined && inputProps !== null ? inputProps : {});
      if (slots !== undefined && slots !== null && typeof slots === "object") props.slots = slots;
      const Comp = definition.component;
      if (Comp === undefined || Comp === null) return fallback !== undefined && fallback !== null ? fallback : null;
      const body = h(AncestryContext.Provider, { value: nextAncestors }, h(Comp, props));
      return h(FactorySlotBoundary, {
        name,
        fallback,
        key: name + ":" + String(factoryVersion),
      }, body);
    }

    const EMPTY_FACTORY_INJECT = {};

    function runFactoryInject(definition, sessionId, actions) {
      const inject = definition !== null && definition !== undefined ? definition.inject : undefined;
      if (typeof inject !== "function") return EMPTY_FACTORY_INJECT;
      try {
        const args = [sessionId];
        if (actions !== undefined && actions !== null) args.push(actions);
        return injectFaceProps(inject(...args));
      } catch (error) {
        const key = "factoryInject:" + String(definition.name);
        if (captureLog[key] !== true) {
          captureLog[key] = true;
          console.warn(LOG_PREFIX + " factory inject failed for '" + String(definition.name) + "':", String(error).slice(0, 140));
        }
        return EMPTY_FACTORY_INJECT;
      }
    }

    /** `renderFactorySlot(name, inputProps, options)` bound to one pane. Returns
        a React element (never throws): unknown factory => fallback, missing host
        face => fallback + one console note, factory crash => local boundary. */
    function makeFactorySlotRenderer(standard, sessionId, scopeKey, kitT, paneRenderers) {
      return function renderFactorySlot(name, inputProps, options) {
        const fallback = options !== undefined && options !== null ? options.fallback : undefined;
        const safeFallback = fallback !== undefined && fallback !== null ? fallback : null;
        if (typeof name !== "string" || name === "") return safeFallback;
        const host = factoryHostFace();
        if (host === null) {
          if (captureLog.factoryHost !== true) {
            captureLog.factoryHost = true;
            console.warn(LOG_PREFIX + " this host release exposes no slot factory host face; factory-seat content (user bubbles, model labels, …) degrades to its fallback. The panes keep working — see window.__dshSplitWorkspace.health().");
          }
          return safeFallback;
        }
        try {
          return h(FactorySlotOccurrence, {
            name,
            inputProps: inputProps !== undefined && inputProps !== null ? inputProps : {},
            slots: options !== undefined && options !== null ? options.slots : undefined,
            fallback,
            standard,
            sessionId,
            scopeKey,
            kitT,
            paneRenderers,
          });
        } catch (error) {
          return safeFallback;
        }
      };
    }

    /** Cached per-entry `inject(sessionId, actions)` faces, exactly like the
        stock renderer ("cached entry inject"). The plugin used to re-run the
        factory on EVERY render of EVERY captured entry — including the
        per-chat-node renderers on the streaming hot path — which allocated new
        hook props each time (defeating all downstream memoization) and re-ran
        arbitrary per-call side effects the inject contract allows. Keyed by the
        entry RECORD object (a re-registration is a new object) + session +
        store scope, so the cache follows the ledger. Bounded by a generous
        fixed ceiling (the pane count is no longer capped; the cache exists to
        release abandoned scopes, not to ration them). */
    let entryInjectCache = new WeakMap();
    function clearEntryInjectCache() {
      entryInjectCache = new WeakMap();
    }
    function cachedEntryInject(parts, sessionId, scopeKey, compute) {
      const raw = parts !== null && parts !== undefined ? parts.raw : null;
      if (raw === null || raw === undefined || typeof raw !== "object") return compute();
      let byScope = entryInjectCache.get(raw);
      if (byScope === undefined) {
        byScope = new Map();
        entryInjectCache.set(raw, byScope);
      }
      const key = String(sessionId) + "\u0000" + String(scopeKey);
      if (byScope.has(key)) return byScope.get(key);
      const face = compute();
      if (byScope.size > 64) byScope.clear();
      byScope.set(key, face);
      return face;
    }

    /** renderSlot / renderSlotChain / renderList dispatchers routing into the
        captured slot ledger with the pane kit merged in. */
    function makeRenderers(sessionId, session, kit, standard, scopeKey, paneActions) {
      const merge = (props, source) => {
        if (source !== undefined && source !== null) {
          for (const key of Object.keys(source)) props[key] = source[key];
        }
        return props;
      };
      /** Apply a captured entry's inject(sessionId) factory — the stock slots
          runtime does this for every render; the generic dispatchers here
          never did, so slot occupants that need their injected face (the
          cost-meter dock line, header actions, queue/todo strips, chat-node
          context bodies) rendered bare or not at all. Owner props still win.
          The result is CACHED per (entry record, session, scope): see
          cachedEntryInject. */
      const entryInjectProps = (parts) => {
        const raw = parts.raw;
        const fn = raw !== null && raw !== undefined && typeof raw.inject === "function"
          ? raw.inject
          : (parts.options !== null && parts.options !== undefined && typeof parts.options.inject === "function" ? parts.options.inject : null);
        if (fn === null) return {};
        return cachedEntryInject(parts, sessionId, scopeKey, () => {
          try {
            const face = injectFaceProps(fn(sessionId, paneActions));
            // Agent-Teams compatibility. The stock openTeammate (from
            // dsh-experimental-client-ui-agent-team) guards on
            // `retainedBy.mainView > 0` for the pane's session and silently
            // returns otherwise — a pane session is usually retained by the
            // split view, not the main view, so member rows were dead clicks
            // in panes. While the split workspace is active, route the click
            // into the workspace instead: focus the member's pane, or split it
            // in beside this one (see splitAwareOpenTeammate). Not active or
            // not a list-known conversation: stock behavior.
            if (face !== null && face !== undefined && typeof face.openTeammate === "function") {
              face.openTeammate = splitAwareOpenTeammate(face.openTeammate);
            }
            return face;
          } catch (error) {
            const id = parts.options !== null && parts.options !== undefined && parts.options.id !== undefined ? String(parts.options.id) : "entry";
            if (captureLog["inj:" + id] !== true) {
              captureLog["inj:" + id] = true;
              console.warn("[dsh-split-workspace] slot inject failed for '" + id + "':", String(error).slice(0, 140));
            }
            return {};
          }
        });
      };
      /** The slot-level half of one render, in the renderer's own order:
          kit first, then the entry inject, then the slot's static injected
          props, then its contextual hook factories, then the owner props. */
      const slotShare = (name, props, options) => {
        const injected = cachedSlotInject(slotInjectFaceOf(name));
        merge(props, injected.props);
        if (injected.slotHookFactories !== undefined) {
          const hasContext = options !== undefined && options !== null && Object.prototype.hasOwnProperty.call(options, "hookContext");
          if (!hasContext) {
            // The renderer treats this as an assembly failure (it throws): a
            // factory like the Chat node's `disclosure` cannot be bound without
            // its occurrence context. Warn once per slot and skip the entry
            // instead of spamming one thrown render per row.
            if (captureLog["slotCtx:" + name] !== true) {
              captureLog["slotCtx:" + name] = true;
              console.warn("[dsh-split-workspace] slot '" + name + "' declares contextual injected Hooks but the render position passed no hookContext; its entries are skipped in panes.");
            }
            return false;
          }
          merge(props, bindSlotHookFactories(injected.slotHookFactories, standard, options.hookContext));
        }
        return true;
      };
      /** The declared kind of one slot key ("list" | "single" | "keyed" |
          "chain"), or null when the spec is unavailable. The stock outlet
          dispatches on this: a LIST slot renders EVERY entry, single/keyed
          render one. The plugin's renderSlot used to pick entries[0] for
          every kind, so list-kind rows (conversation.session.header.actions:
          agent-team -20, agent-preset -10, cost-meter 1, …;
          conversation.session.header.utilities) silently lost every entry
          after the first in panes. */
      const slotKindOf = (name) => {
        try {
          const spec = slotsService !== undefined && slotsService !== null && typeof slotsService.spec === "function"
            ? slotsService.spec(name)
            : null;
          return spec !== null && spec !== undefined && typeof spec.kind === "string" ? spec.kind : null;
        } catch {
          return null;
        }
      };
      const renderSlot = (name, owner, options) => {
        let entries = capturedEntries(name);
        // Re-hosted panes use THIS dispatcher for the stock session header.
        // The sidebar-right expand button is a session-scoped seat with its own
        // store handle; mounting it inside every pane creates a second store
        // for the same session, and the shared right sidebar then reads a
        // different instance than the pane that nav acts on (dead-looking tab
        // icons). Panes never show that button anyway (the split toolbar owns
        // the rightbar toggle), so drop store-backed corner entries here: the
        // stock header keeps the only sidebar-right store.
        if (name === "conversation.session.header.corner") {
          entries = entries.filter((entry) => entry === null || entry === undefined
            || entry.store === undefined || entry.store === null);
        }
        if (entries.length === 0) {
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        // Stock parity for list-kind slots: renderSlot on a list renders
        // every entry (see slotKindOf) — the runtime's SlotOutlet does the
        // same, and callers like the session header pass a plain {} owner.
        if (slotKindOf(name) === "list") {
          const rows = renderList(name, owner, options);
          if (Array.isArray(rows) && rows.length > 0) return rows;
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        let picked = null;
        if (options !== undefined && options !== null && options.entryKey !== undefined) {
          picked = findEntryInList(entries, (opts) => opts !== null && opts !== undefined && opts.key === options.entryKey);
        } else {
          picked = entryParts(entries[0]);
        }
        if (picked === null) {
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        const props = merge(merge(merge({ ...kit }, entryInjectProps(picked)), entryStoreProps(picked, sessionId, scopeKey)), owner);
        if (!slotShare(name, props, options)) {
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        // node renderers need the renderer dispatchers + turn-data hook access
        if (name === "conversation.chat.node") {
          const useSession = kit.useSession;
          const useTurnData = (turnKey) =>
            useSession((snapshot) => {
              if (snapshot === null || snapshot === undefined) return undefined;
              try {
                const node = snapshot.chat.nodes.get(options.entryKey);
                const location = node !== undefined && node !== null ? node.location : undefined;
                return location !== undefined && (location.kind === "turn" || location.kind === "step")
                  ? location.turn.data.get(turnKey)
                  : undefined;
              } catch {
                return undefined;
              }
            });
          props.hooks = { ...(props.hooks !== undefined && props.hooks !== null ? props.hooks : {}), turnData: useTurnData };
          props.useTurnData = useTurnData;
        }
        props.renderSlot = renderSlot;
        props.renderSlotChain = renderSlotChain;
        const pickedT = entryTranslate(picked.raw);
        if (pickedT !== undefined) props.t = pickedT;
        return h(PaneBoundary, { fallback: null }, h(picked.component, props));
      };
      const renderSlotChain = (name, owner, options) => {
        const entries = capturedEntries(name);
        const out = [];
        for (const entry of entries) {
          const parts = entryParts(entry);
          if (parts === null) continue;
          const select = entry.select !== undefined ? entry.select : parts.options.select;
          let matched = null;
          try {
            matched = typeof select === "function" ? select(owner) : null;
          } catch {
            matched = null;
          }
          if (matched === null || matched === undefined) continue;
          const props = merge(merge(merge({ ...kit }, entryInjectProps(parts)), entryStoreProps(parts, sessionId, scopeKey)), owner);
          if (!slotShare(name, props, options)) continue;
          props.matched = matched;
          props.renderSlot = renderSlot;
          props.renderSlotChain = renderSlotChain;
          // stock-outlet parity (see renderList's data-slot note)
          if (props["data-slot"] === undefined) props["data-slot"] = name;
          const chainT = entryTranslate(entry);
          if (chainT !== undefined) props.t = chainT;
          out.push(h(PaneBoundary, { key: (parts.options !== null && parts.options !== undefined && parts.options.id) || out.length, fallback: null, slotKey: name }, h(parts.component, props)));
        }
        return out;
      };
      const renderList = (name, extraProps, options) => {
        const entries = capturedEntries(name);
        const out = [];
        for (const entry of entries) {
          const parts = entryParts(entry);
          if (parts === null) continue;
          const props = merge(merge(merge({ ...kit }, entryInjectProps(parts)), entryStoreProps(parts, sessionId, scopeKey)), extraProps);
          if (!slotShare(name, props, options)) continue;
          // Stock-outlet parity: every entry the outlet renders also gets the
          // render dispatchers, list-kind rows included. Deliverables
          // (conversation.chat.turnTail) calls props.renderSlot from inside its
          // row map — without this the row threw "renderSlot is not a function"
          // on every render in panes and vanished behind the boundary. The
          // single/chain dispatchers above already attach both.
          props.renderSlot = renderSlot;
          props.renderSlotChain = renderSlotChain;
          if (parts.options !== null && parts.options !== undefined && parts.options.id !== undefined && parts.options.id !== null) {
            props["data-slot-id"] = parts.options.id;
          }
          // Stock-outlet parity: the stock outlet stamps `data-slot="<key>"`
          // on what it renders, and third-party global CSS keys on it (the
          // cost meter lays its dock entries out through
          // `div:has(>[data-slot="conversation.composer.dock"] …)`). Panes
          // used to stamp only `data-slot-id`, so such rules silently did
          // not apply inside panes and the dock area rendered with different
          // geometry than the stock page — the two plugins "fought" over the
          // same row. Stamp both, exactly like the outlet.
          if (props["data-slot"] === undefined) props["data-slot"] = name;
          const listT = entryTranslate(entry);
          if (listT !== undefined) props.t = listT;
          out.push(h(PaneBoundary, { key: (parts.options !== null && parts.options !== undefined && parts.options.id) || out.length, fallback: null, slotKey: name }, h(parts.component, props)));
        }
        return out;
      };
      // `entryInjectProps` is also used by callers that render an entry
      // themselves outside the dispatchers (ChatPane's composer-chain
      // election): the stock rule is that EVERY entry render gets its own
      // inject face, and the ask/approval cards depend on it — the
      // `conversation.composer` elected entry (ui-user-questions QuestionFlow)
      // declares `keyedHooks: { questionCard: … }`, which materializes the
      // `useQuestionCard` prop. Omitting it threw
      // "useQuestionCard is not a function" and left the turn pending forever.
      return { renderSlot, renderSlotChain, renderList, entryInjectProps };
    }

    /** PURE (no React) props assembly for an elected composer-chain entry, in
        the stock renderer's merge order: kit -> entry inject face -> slot-level
        injected props -> entry store pair -> owner props -> matched -> locale
        `t`, plus the render dispatchers and the `data-slot` outlet stamp the
        stock outlet adds. Exposed through `window.__dshSplitWorkspace.__test` so the
        parity contract is regression-tested without a DOM. */
    function composerChainProps(kit, injectFace, slotProps, storeProps, ownerProps, matched, tFn, renderers) {
      const props = Object.assign({}, kit);
      if (injectFace !== undefined && injectFace !== null && typeof injectFace === "object") Object.assign(props, injectFace);
      if (slotProps !== undefined && slotProps !== null && typeof slotProps === "object") Object.assign(props, slotProps);
      if (storeProps !== undefined && storeProps !== null && typeof storeProps === "object") Object.assign(props, storeProps);
      if (ownerProps !== undefined && ownerProps !== null && typeof ownerProps === "object") Object.assign(props, ownerProps);
      props.matched = matched;
      if (tFn !== undefined) props.t = tFn;
      if (renderers !== undefined && renderers !== null) {
        if (props.renderSlot === undefined) props.renderSlot = renderers.renderSlot;
        if (props.renderSlotChain === undefined) props.renderSlotChain = renderers.renderSlotChain;
      }
      if (props["data-slot"] === undefined) props["data-slot"] = "conversation.composer";
      return props;
    }

    /** PURE chain election (stock semantics): the first entry whose
        `select(owner)` returns a non-null value owns the chain; selector
        crashes decline that entry (logged through the debug sink). Returns
        null when nothing matches, which the caller renders as its fallback
        (composerBar for the composer chain). Exposed via the __test seam so the
        ask/approval-card election path is regression-tested without a DOM. */
    function electComposerChain(entries, ownerProps, debug) {
      const list = Array.isArray(entries) ? entries : [];
      for (const entry of list) {
        const parts = entryParts(entry);
        if (parts === null) continue;
        const select = parts.raw !== null && parts.raw !== undefined && typeof parts.raw.select === "function"
          ? parts.raw.select
          : (parts.options !== null && parts.options !== undefined && typeof parts.options.select === "function" ? parts.options.select : null);
        if (select === null) continue;
        let matched = null;
        try {
          matched = select(ownerProps);
        } catch (error) {
          matched = null;
          if (debug !== undefined && debug !== null) debug.electionError = String(error).slice(0, 200);
        }
        if (matched === null || matched === undefined) continue;
        return { parts, matched, entry };
      }
      return null;
    }

    /** Error boundary so one pane's capture problem never kills the workspace.
        It logs EVERY distinct failure (once per message, plus a running total)
        and marks the DOM: the old latch logged only the first failure
        page-wide, so a slot cell that threw on every render — e.g. the
        composer stats row when a face it needs never arrived — simply vanished
        from the pane with nothing in the console to say why. The stock outlet
        logs every crash and stamps `data-slot-error`, so this matches it. */
    class PaneBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidUpdate(prevProps) {
        // Controlled re-attempt: when the pane's prepared bundle/generation
        // changes (resetKey), a latched slot boundary gets one fresh render.
        // Without this a transient capture error removed that slot for the
        // pane's whole life. Note: NO automatic loop — this only runs when the
        // reset key actually changes.
        if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
          this.setState({ error: null });
        }
      }
      componentDidCatch(error, info) {
        try {
          const message = String(error).slice(0, 200);
          const seen = captureLog["boundary:" + message];
          captureLog["boundary:" + message] = (seen === undefined ? 0 : seen) + 1;
          captureLog.boundaryCount = (captureLog.boundaryCount === undefined ? 0 : captureLog.boundaryCount) + 1;
          if (seen === undefined || seen === 0) {
            const where = this.props !== null && this.props !== undefined && this.props.slotKey !== undefined
              ? " in slot '" + this.props.slotKey + "'" : "";
            console.warn("[dsh-split-workspace] pane component failed" + where + " (rendering fallback):", message);
          }
          // Error budget: repeated boundary catches while the workspace is
          // active deactivate it to safe mode (single console.warn from there).
          noteFailure("slot", error);
        } catch {}
      }
      render() {
        if (this.state.error !== null) {
          if (this.props.fallback !== undefined && this.props.fallback !== null) return this.props.fallback;
          return h("div", { "data-dsv-slot-error": this.props.slotKey !== undefined ? String(this.props.slotKey) : "true" });
        }
        return this.props.children;
      }
    }

    /** Per-pane fail isolation (S3): a throw anywhere in the pane body — the
        ChatPane hook graph, NativeViewArea, the editor guard, a re-hosted
        component outside a slot boundary — renders THIS pane's retry card
        instead of unmounting the whole workspace. The retry button re-attempts
        the body; the other panes keep streaming untouched. */
    class PaneShellBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null, attempt: 0 };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try {
          console.warn(LOG_PREFIX + " pane '" + String(this.props.sessionId) + "' failed and was isolated — the other panes keep running. Use the pane's Retry button; see window.__dshSplitWorkspace.health().");
        } catch {}
        noteFailure("pane-shell", error);
      }
      render() {
        if (this.state.error !== null) {
          return h("div", { className: "dsv-pane-error", "data-dsv-pane-error": String(this.props.sessionId) },
            h("div", { className: "dsv-pane-error-title" }, t("paneFailed")),
            h("div", { className: "dsv-pane-error-body" }, String(this.state.error).slice(0, 240)),
            h("button", {
              type: "button",
              className: "dsv-empty-btn",
              onClick: () => { this.setState({ error: null, attempt: this.state.attempt + 1 }); },
            }, t("retryLabel")),
          );
        }
        return this.props.children;
      }
    }

    // ---------------------------------------------------------------------
    // native pane (re-hosted ChatView + InputBar with graceful fallback)
    // ---------------------------------------------------------------------

    /** Prepare everything needed to re-host the native transcript + composer
        for one pane. Built ONCE per (sessionId, session, root faces): inject
        factories can have per-call side effects, so they run exactly once
        here. Returns null fields when a capture is unavailable. */
    function prepareNative(sessionId, session, rootFaces) {
      const bundle = makeKit(sessionId, session, rootFaces);
      const kit = bundle.kit;
      const store = paneChatStore(sessionId);
      const renderers = makeRenderers(sessionId, session, kit, bundle.standard, bundle.scopeKey, store.actions);
      // Framework seats EVERY re-hosted entry receives from the stock renderer
      // (standardKit): `renderFactorySlot` always, and the declared-children
      // render dispatchers. 0.2.1 components call them unconditionally (user
      // bubbles, model labels), so they belong on the shared pane kit — the
      // dispatchers spread the kit, and kitProps-based consumers inherit them.
      kit.renderFactorySlot = makeFactorySlotRenderer(bundle.standard, sessionId, bundle.scopeKey, kit.t, renderers);
      kit.useFactorySlot = factorySlotStub;
      kit.renderSlot = renderers.renderSlot;
      kit.renderSlotChain = renderers.renderSlotChain;

      // transcript: the stock chat view entry
      const view = findEntry("conversation.view", (opts) => opts !== null && opts !== undefined && (opts.id === "chat" || opts.key === "chat"));
      let transcriptInjected = null;
      if (view !== null) {
        try {
          const injectFn = view.raw.inject !== undefined ? view.raw.inject : view.options.inject;
          if (typeof injectFn === "function") transcriptInjected = injectFaceProps(injectFn(sessionId, store.actions));
        } catch (error) {
          console.warn("[dsh-split-workspace] chat view inject failed:", String(error).slice(0, 140));
          transcriptInjected = null;
        }
      }

      // composer: the stock InputBar entry + its per-session input face
      const bar = findEntry("conversation.composer.bar");
      let composer = null;
      if (bar !== null) {
        let face = null;
        try {
          const injectFn = bar.raw.inject !== undefined ? bar.raw.inject : bar.options.inject;
          face = typeof injectFn === "function" ? injectFn(sessionId) : null;
        } catch (error) {
          console.warn("[dsh-split-workspace] composer inject failed:", String(error).slice(0, 140));
          face = null;
        }
        if (face !== null && face !== undefined) {
          const shell = face.keyboard;
          if (shell === undefined || shell === null) {
            // silent fallback cliff: without the keyboard shell the pane drops
            // to the plain-textarea composer — say so, loudly, once
            if (captureLog.composerFace !== true) {
              captureLog.composerFace = true;
              console.warn("[dsh-split-workspace] composer inject face has no keyboard shell; face keys: " + Object.keys(face !== null && face !== undefined ? face : {}).join(","));
            }
          } else {
            const inputSource = shell.state !== undefined && shell.state !== null && typeof shell.state.subscribe === "function"
              ? shell.state
              : shell;
            const useInput = makeUseStoreFace(inputSource, undefined);
            const inputActions = {
              setDraft: (text) => (typeof shell.setDraft === "function" ? shell.setDraft(text) : undefined),
              // dsh 0.1.5 action names (the stock InputBar reads these —
              // e.g. its attachment-prune effect calls pruneAttachments, and
              // a missing member throws mid-render and takes the bar down)
              addAttachments: (ids) => (typeof shell.addAttachments === "function" ? shell.addAttachments(ids) : false),
              removeAttachment: (id) => (typeof shell.removeAttachment === "function" ? shell.removeAttachment(id) : undefined),
              pruneAttachments: (ids) => (typeof shell.pruneAttachments === "function" ? shell.pruneAttachments(ids) : undefined),
              submit: () => (typeof shell.submit === "function" ? shell.submit() : undefined),
              // 0.1.4 aliases, kept for older cores
              addImages: (ids) => (typeof shell.addImages === "function" ? shell.addImages(ids) : (typeof shell.addAttachments === "function" ? shell.addAttachments(ids) : false)),
              removeImage: (id) => (typeof shell.removeImage === "function" ? shell.removeImage(id) : (typeof shell.removeAttachment === "function" ? shell.removeAttachment(id) : undefined)),
              pruneImages: (ids) => (typeof shell.pruneImages === "function" ? shell.pruneImages(ids) : (typeof shell.pruneAttachments === "function" ? shell.pruneAttachments(ids) : undefined)),
            };
            // pane-level intake for drag-drop + clipboard paste. (files,
            // text): files ride the stock draft pipeline and clipboard TEXT
            // lands at the input's caret — mixed text+image pastes land BOTH,
            // exactly like the stock handler. dsh 0.1.5 replaced the 0.1.4
            // image intake (face.addImages / shell.pasteBegin) with
            // face.addFiles (= createDrafts + addAttachments, error string or
            // null) and shell.paste (Lexical insert at selection); both
            // generations are supported, 0.1.5 first.
            const paneAddFiles = typeof face.addFiles === "function" ? face.addFiles
              : (typeof face.addImages === "function" ? face.addImages : null);
            paneImageIntake.set(sessionId, (files, text) => {
              try {
                if (Array.isArray(files) && files.length > 0) {
                  if (paneAddFiles === null) {
                    console.warn("[dsh-split-workspace] image intake unavailable: composer face has no addFiles/addImages");
                  } else {
                    const outcome = paneAddFiles.call(face, files);
                    if (typeof outcome === "string" && outcome !== "") {
                      console.warn("[dsh-split-workspace] image intake rejected:", outcome);
                    }
                  }
                }
                if (typeof text === "string" && text !== "") {
                  const el = document.activeElement;
                  const inPane = el !== null && el !== undefined
                    && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable === true);
                  if (!inPane) return;
                  if (typeof shell.paste === "function") {
                    // 0.1.5: inserts at the editor's current selection (or
                    // document end when collapsed), undo-boundaried like stock
                    shell.paste(text);
                  } else if (typeof shell.pasteBegin === "function" && el.tagName === "TEXTAREA") {
                    // legacy 0.1.4 caret-span path
                    const start = typeof el.selectionStart === "number" ? el.selectionStart : String(el.value || "").length;
                    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
                    shell.pasteBegin(text, { start, end });
                    const caret = start + text.length;
                    try { el.setSelectionRange(caret, caret); } catch {}
                  }
                }
              } catch (error) {
                console.warn("[dsh-split-workspace] image intake failed:", String(error).slice(0, 140));
              }
            });
            // Root guard for the pane's composer. The pane's contenteditable
            // hosts this session's Lexical editor, but the HIDDEN stock page
            // still mounts/unmounts its own composer for the same session —
            // its mount calls editor.setRootElement(stockEl) and its unmount
            // cleanup unconditionally calls editor.setRootElement(null), so
            // every sidebar session switch strips the root from whichever
            // pane owns that editor. The pane's editor turns into an orphan
            // plain contenteditable: typed text appears, but Lexical and the
            // input machine never see it — the grey placeholder stays, Enter
            // and attachments go dead. This listener re-claims the root for
            // the pane the instant anyone else takes or clears it.
            if (shell.editor !== undefined && shell.editor !== null && typeof shell.editor.registerRootListener === "function") {
              const paneEditor = shell.editor;
              const paneSelector = '.dsv-pane[data-dsv-pane="' + String(sessionId).replace(/"/g, '\\"') + '"]';
              // The composer div this pane currently hosts, if any — but only
              // while the pane is actually RENDERED. The workspace toggle
              // (session-hotkeys' Alt+W) hides the whole overlay with
              // `display:none`, and a hidden element is still `isConnected`, so
              // a visibility-blind check let the invisible pane keep the
              // session's Lexical root hostage. The visible stock composer was
              // then an orphan: typing painted characters into a plain
              // contenteditable while the input machine never heard them, the
              // send key stayed disabled and Enter did nothing — the stock
              // chatbox looked completely dead.
              const paneHost = () => {
                const pane = document.querySelector(paneSelector);
                if (pane === null) return null;
                // FIRST VISIBLE input, not just the first: transient/hidden
                // seats (a takeover card mid-transition, an unmounting bar)
                // can precede the live editor in document order with a zero
                // rect — returning null for those parked the editor on the
                // covered stock composer while a perfectly good host sat
                // right behind it.
                let found = null;
                try {
                  for (const candidate of pane.querySelectorAll("[data-composer-input]")) {
                    if (!candidate.isConnected) continue;
                    try { if (candidate.getClientRects().length === 0) continue; } catch {}
                    found = candidate;
                    break;
                  }
                } catch {}
                return found;
              };
              /** A host this editor may hand the root to: connected, and
                  rendered when the platform can tell us. */
              const usableHost = (candidate) => {
                if (candidate === null || candidate === undefined || !candidate.isConnected) return false;
                try { if (candidate.getClientRects().length === 0) return false; } catch {}
                return true;
              };
              // Whatever ELSE this editor was rooted at and is still in the
              // document — in practice the covered stock page's composer for
              // this same session. Only ever an element this very editor
              // occupied, so handing the root back can never land it on a
              // different session's composer.
              let displacedHost = null;
              // Seed it from whatever the editor is rooted at RIGHT NOW. At
              // guard-installation time this pane has not claimed the root yet,
              // so if the stock page mounted first (the normal boot order) that
              // element IS this session's other composer — and without the seed
              // the guard has no hand-over target when the pane later stops
              // being rendered, which leaves the visible stock chatbox an
              // orphan with typing that never reaches the input machine.
              try {
                const seed = paneEditor.getRootElement();
                if (seed !== null && seed !== undefined && typeof seed.closest === "function"
                    && seed.closest(paneSelector) === null) {
                  displacedHost = seed;
                }
              } catch {}
              let alive = true;
              let repairRaf = 0;
              let deferredRepairRaf = 0;
              let retireTimer = 0;
              // Re-point rate limiter (1.7.0: no more permanent breaker). Every
              // setRootElement rebuilds the editor's whole DOM, so two owners
              // contesting the root (the hidden stock composer vs this pane — and
              // on desktop compositions both may believe they are the visible
              // one) can ping-pong forever, which reads as a frozen app. The
              // limiter therefore keeps a minimum spacing and a rolling budget.
              // It used to TRIP A BREAKER and stand down for good when the
              // budget was spent; ordinary main-view navigation legitimately
              // re-points the shared editor once per session switch, so a few
              // switches between two split conversations spent the budget and
              // left the visible pane composer as a plain contenteditable
              // (typing painted, Enter / Ctrl+A / the "/" trigger feed dead).
              // When the budget is spent now the limiter only THROTTLES to one
              // repair per second — it never stops repairing — and it re-arms
              // once ownership is stable again. The give-back path (pane closed /
              // not rendering) stays armed so teardown still hands the root back
              // to the stock composer.
              const GUARD_MIN_REPOINT_MS = 250;
              const GUARD_WINDOW_MS = 10000;
              const GUARD_MAX_REPOINTS = 24;
              const GUARD_THROTTLE_MS = 1000;
              let repointTimes = [];
              let guardThrottled = false;
              const noteThrottle = () => {
                if (guardThrottled) return;
                guardThrottled = true;
                console.warn("[dsh-split-workspace] editor-root guard: the shared composer editor is being re-pointed often (main-view switches between split conversations do this); repairs are throttled to one per second until it settles. The pane composer stays live.");
              };
              const mayRepoint = () => {
                const now = Date.now();
                repointTimes = repointTimes.filter((t) => now - t < GUARD_WINDOW_MS);
                const last = repointTimes.length > 0 ? repointTimes[repointTimes.length - 1] : 0;
                if (repointTimes.length >= GUARD_MAX_REPOINTS) {
                  noteThrottle();
                  if (now - last < GUARD_THROTTLE_MS) return false;
                }
                if (repointTimes.length > 0 && now - last < GUARD_MIN_REPOINT_MS) return false;
                return true;
              };
              const noteRepoint = () => { repointTimes.push(Date.now()); };
              const guardRoot = (defer) => {
                if (!alive) return;
                let changed = false;
                try {
                  const el = paneHost();
                  const root = paneEditor.getRootElement();
                  if (el !== null) {
                    if (root !== el) {
                      // Lexical binds keydown, paste, copy, cut, drop,
                      // beforeinput and BOTH composition events to the root
                      // element, and it rebuilds that element's whole DOM when
                      // the root is re-pointed. Doing that while an IME
                      // composition is live in this div is what leaves the
                      // composition underline painted for good and strands
                      // `isComposing() === true` (which in turn makes the root
                      // keydown handler drop every later Enter). So while a
                      // composition is live here, leave the root exactly where
                      // it is; the flush below runs on compositionend, and on
                      // focusout or the next event if that never arrives.
                      if (composingIn(el)) return;
                      if (!mayRepoint()) return; // throttled: a later event retries
                      if (root !== null && root.isConnected) displacedHost = root;
                      paneEditor.setRootElement(el); // reclaim from the stock page
                      noteRepoint();
                      changed = true;
                    } else if (guardThrottled && repointTimes.length > 0
                        && Date.now() - repointTimes[repointTimes.length - 1] > 3000) {
                      // Ownership has been stable for a few seconds: re-arm the
                      // throttle warning (and the full budget) so a later genuine
                      // contention fight is still reported and repairable.
                      repointTimes = [];
                      guardThrottled = false;
                    }
                  } else {
                    // No RENDERED pane composer. Either the pane is tucked away
                    // (the workspace toggle), in TUI mode, or its composer is
                    // unmounted — and in every one of those cases the pane must
                    // not keep this session's editor: if the root is still
                    // parked in an invisible/unusable host, hand it to the
                    // session's other composer so the view the user is actually
                    // looking at keeps working. This path is deliberately NOT
                    // rate-limited: it is self-limiting by construction (it needs
                    // root === null or a root parked inside this pane) and it is
                    // what teardown uses — blocking it would strand the stock
                    // composer rootless after a pane closes, i.e. "the input is
                    // focused but completely dead".
                    const hostage = root !== null && root !== undefined
                      && (!root.isConnected || (typeof root.closest === "function" && root.closest(paneSelector) !== null));
                    if (hostage && usableHost(displacedHost) && !composingIn(root)) {
                      paneEditor.setRootElement(displacedHost);
                      noteRepoint();
                      changed = true;
                    } else if (root === null && usableHost(displacedHost) && !composingIn(displacedHost)) {
                      // the pane is gone (closed, or the composer is unmounted):
                      // the session's editor must not be left rootless — the
                      // stock page still shows this session
                      paneEditor.setRootElement(displacedHost);
                      noteRepoint();
                      changed = true;
                    }
                  }
                } catch {}
                // One deferred pass. A pane teardown nulls the root while its
                // own div is STILL connected (React runs the layout-effect
                // cleanup before it removes the host node), so the useful
                // re-check only lands after that commit.
                if (changed && defer !== false && repairRaf === 0) {
                  repairRaf = requestAnimationFrame(() => { repairRaf = 0; guardRoot(false); });
                }
              };
              let offGuard = null;
              try { offGuard = paneEditor.registerRootListener(guardRoot); } catch { offGuard = null; }
              // The root listener only fires on ownership changes that go
              // THROUGH the editor API after it exists. A pane whose editor is
              // already orphaned by then — the hidden stock page claimed the
              // root before this pane mounted, or its teardown raced the
              // mount — produces no further root event at all, and the pane's
              // contenteditable stays a plain div: typed characters paint, the
              // grey placeholder sticks, and Enter plus the attachment
              // pipeline are dead while the send key still works. Re-validate
              // on every event that lands inside this pane (idempotent while
              // the root is healthy) so that race cannot outlive the first
              // keystroke or click.
              const paneTargetOf = (event) => {
                const target = event.target;
                if (target === null || target === undefined || typeof target.closest !== "function") return null;
                let inPane = false;
                try { inPane = target.closest(paneSelector) !== null; } catch { return null; }
                // Also react to the session's OTHER composer (the covered stock
                // page). When the workspace is tucked away that is the visible
                // one, and a click or a keystroke landing in it is exactly the
                // moment to hand the editor root over — the toggle only flips a
                // class on <html>, which fires no event the pane could see.
                if (!inPane) {
                  try { if (target.closest("[data-composer-input]") === null) return null; } catch { return null; }
                }
                return target;
              };
              // Typing must NOT rebuild the focused editor's DOM inside the
              // keydown/beforeinput that carries it — that is what destroyed the
              // caret/selection and swallowed the model update. Key events only
              // schedule the repair for the next frame (idempotent while the
              // root is healthy); focus and pointer events repair immediately.
              const repairGuardSoon = () => {
                if (deferredRepairRaf !== 0) return;
                deferredRepairRaf = requestAnimationFrame(() => {
                  deferredRepairRaf = 0;
                  if (alive) guardRoot(false);
                });
              };
              const guardOnPointer = (event) => {
                if (paneTargetOf(event) === null) return;
                guardRoot();
              };
              const guardOnTyping = (event) => {
                if (paneTargetOf(event) === null) return;
                if (event.type === "keydown" && event.key === "a"
                    && (event.ctrlKey === true || event.metaKey === true)
                    && event.altKey !== true && event.shiftKey !== true) {
                  // Ctrl/Cmd+A on an orphaned host would select stray native
                  // characters on the covered page (Lexical never sees the
                  // chord). Repair first, then select this pane's text
                  // ourselves so "select all" keeps working.
                  const el = paneHost();
                  let root = null;
                  try { root = paneEditor.getRootElement(); } catch {}
                  if (el !== null && root !== el) {
                    event.preventDefault();
                    guardRoot(false);
                    window.requestAnimationFrame(() => {
                      const host = paneHost();
                      if (host === null) return;
                      try { host.focus({ preventScroll: true }); } catch { try { host.focus(); } catch {} }
                      try {
                        const range = document.createRange();
                        range.selectNodeContents(host);
                        const selection = window.getSelection();
                        if (selection !== null) {
                          selection.removeAllRanges();
                          selection.addRange(range);
                        }
                      } catch {}
                    });
                  }
                  return;
                }
                repairGuardSoon();
              };
              // Flush a reclaim that was deferred for a live composition. The
              // retirement is done here rather than left to the document-wide
              // tracker so this cannot depend on listener registration order.
              const guardOnCompositionEnd = (event) => {
                const target = event.target;
                if (target !== null && target !== undefined && target.nodeType === 1) composingSince.delete(target);
                guardRoot();
              };
              document.addEventListener("focusin", guardOnPointer, true);
              document.addEventListener("pointerdown", guardOnPointer, true);
              document.addEventListener("beforeinput", guardOnTyping, true);
              document.addEventListener("keydown", guardOnTyping, true);
              document.addEventListener("compositionend", guardOnCompositionEnd, true);
              const dispose = () => {
                if (!alive) return;
                // ORDER MATTERS: Lexical REPLAYS a root listener with
                // (null, prevRoot) when it is unregistered, so clearing `alive`
                // first is what stops a disposal from re-pointing the shared
                // root at an element React is about to delete.
                alive = false;
                if (repairRaf !== 0) { try { cancelAnimationFrame(repairRaf); } catch {} repairRaf = 0; }
                if (deferredRepairRaf !== 0) { try { cancelAnimationFrame(deferredRepairRaf); } catch {} deferredRepairRaf = 0; }
                if (retireTimer !== 0) { try { clearTimeout(retireTimer); } catch {} retireTimer = 0; }
                document.removeEventListener("focusin", guardOnPointer, true);
                document.removeEventListener("pointerdown", guardOnPointer, true);
                document.removeEventListener("beforeinput", guardOnTyping, true);
                document.removeEventListener("keydown", guardOnTyping, true);
                document.removeEventListener("compositionend", guardOnCompositionEnd, true);
                try { if (typeof offGuard === "function") offGuard(); } catch {}
              };
              const retire = () => {
                // Pane close: do NOT dispose synchronously. The pane's own
                // unmount is still ahead of us and will call
                // editor.setRootElement(null); the guard has to survive that
                // to hand the root back to the stock composer, and only then
                // can it be retired.
                if (retireTimer !== 0) return;
                retireTimer = window.setTimeout(() => { retireTimer = 0; dispose(); }, 400);
              };
              const previousGuard = paneEditorGuards.get(sessionId);
              if (previousGuard !== undefined) {
                // useMemo re-runs when the session face changes identity; the
                // superseded guard must not keep listening. Safe to do at once:
                // `dispose` clears `alive` before unregistering, so the replay
                // is a no-op.
                try { previousGuard.dispose(); } catch {}
              }
              paneEditorGuards.set(sessionId, { editor: paneEditor, dispose, retire, repair: () => guardRoot(false) });
            }
            // remember the last pane the user actually typed into (focus
            // fallback target when no pane is focused)
            try {
              const stateStore = shell.state !== undefined && shell.state !== null && typeof shell.state.subscribe === "function" ? shell.state : shell;
              if (stateStore !== undefined && stateStore !== null && typeof stateStore.subscribe === "function") {
                let lastDraft = null;
                try {
                  const snap = typeof stateStore.getSnapshot === "function" ? stateStore.getSnapshot() : null;
                  if (snap !== null && snap !== undefined && snap.draft !== undefined) lastDraft = snap.draft;
                } catch {}
                const unsubTyping = stateStore.subscribe(() => {
                  try {
                    const snap = typeof stateStore.getSnapshot === "function" ? stateStore.getSnapshot() : null;
                    const draft = snap !== null && snap !== undefined ? snap.draft : undefined;
                    if (typeof draft === "string" && draft !== lastDraft) {
                      lastDraft = draft;
                      if (draft !== "") rememberTypedSession(sessionId);
                    }
                  } catch {}
                });
                const previousTypingUnsub = paneTypingUnsubs.get(sessionId);
                if (previousTypingUnsub !== undefined) {
                  // A rebuilt prepared bundle installs a fresh typing
                  // subscription; the superseded one must not stay behind (the
                  // old code just overwrote the map entry and leaked it).
                  try { previousTypingUnsub(); } catch {}
                  paneTypingUnsubs.delete(sessionId);
                }
                if (typeof unsubTyping === "function") paneTypingUnsubs.set(sessionId, unsubTyping);
              }
            } catch {}
            composer = {
              bar,
              face,
              useInput,
              inputActions,
              // The bar entry's own store pair (stock standardKit supplies
              // useStore/actions when the registration declares a store).
              storeProps: entryStoreProps(bar, sessionId, bundle.scopeKey),
              // synchronous snapshot read for non-React guards (the pane's
              // last-resort Enter path in ChatPane) — the same store useInput
              // subscribes to
              readInput: () => {
                try { return typeof inputSource.getSnapshot === "function" ? inputSource.getSnapshot() : null; } catch { return null; }
              },
              useNotices: makeUseStoreFace(face.hooks !== undefined ? face.hooks.notices : undefined, null),
              useLexicon: makeUseStoreFace(face.hooks !== undefined ? face.hooks.lexicon : undefined, new Map()),
              useMenuLauncher: makeUseStoreFace(face.hooks !== undefined ? face.hooks.menuLauncher : undefined, null),
              renderSlot: (name, owner, options) => {
                if (name === "conversation.input.model" || name === "conversation.input.plan" || name === "conversation.input.attachments") {
                  const parts = findEntry(name);
                  if (parts === null) return null;
                  let seatInject = null;
                  try {
                    const injectFn = parts.raw.inject !== undefined ? parts.raw.inject : parts.options.inject;
                    if (typeof injectFn === "function") seatInject = injectFaceProps(injectFn(sessionId));
                  } catch {}
                  // Stock parity: the entry's own store pair rides the props
                  // too when it declares one (the kit otherwise supplies only
                  // the pane's standard faces).
                  const seatStore = entryStoreProps(parts, sessionId, bundle.scopeKey);
                  const props = kitProps(kit, {
                    locked: false,
                    inputActions,
                    ...(seatInject !== null && seatInject !== undefined ? seatInject : {}),
                    ...seatStore,
                  });
                  const seatT = entryTranslate(parts.raw);
                  if (seatT !== undefined) props.t = seatT;
                  if (owner !== undefined && owner !== null) {
                    for (const key of Object.keys(owner)) props[key] = owner[key];
                  }
                  return h(PaneBoundary, { fallback: null, slotKey: name }, h(parts.component, props));
                }
                return renderers.renderSlot(name, owner, options);
              },
            };
          }
        }
      }

      // header strip: the stock breadcrumb title, view tabs, and action row
      const header = findEntry("conversation.session.header");
      let headerFace = null;
      let headerInjected = null;
      if (header !== null) {
        try {
          const injectFn = header.raw.inject !== undefined ? header.raw.inject : header.options.inject;
          if (typeof injectFn === "function") {
            headerFace = injectFn(sessionId, store.actions);
            headerInjected = injectFaceProps(headerFace);
          }
        } catch (error) {
          console.warn("[dsh-split-workspace] header inject failed:", String(error).slice(0, 140));
          headerFace = null;
          headerInjected = null;
        }
      }

      // every registered view tab (chat, trajectory, context, …) with its
      // per-pane injected props, so tabs switch inside the pane.
      // The roster comes from the SLOT LEDGER, not from the header face:
      // 0.1.5's header inject carries `conversationViews` (a hook) and no
      // `.views` array at all, so gating this capture on `headerFace.views`
      // left `viewEntries` permanently empty — the header could list Chat /
      // Trajectory / Context while the pane always fell back to the chat view.
      const viewLedger = headerFace !== null && headerFace !== undefined && headerFace.views !== undefined
        ? headerFace.views
        : null;
      const viewEntries = [];
      for (const entry of capturedEntries("conversation.view")) {
        const parts = entryParts(entry);
        if (parts === null) continue;
        let injected = null;
        try {
          const injectFn = parts.raw.inject !== undefined ? parts.raw.inject : parts.options.inject;
          if (typeof injectFn === "function") injected = injectFaceProps(injectFn(sessionId, store.actions));
        } catch {}
        viewEntries.push({
          id: parts.options !== null && parts.options !== undefined ? (parts.options.id ?? parts.options.key ?? null) : null,
          parts,
          injected,
          t: entryTranslate(entry),
        });
      }

      paneDebug.last = {
        sessionId,
        scopeKey: bundle.scopeKey,
        rootFaces: Object.keys(rootFaces ?? {}),
        standardFaces: Object.keys(bundle.standard ?? {}),
        kitFaces: Object.keys(kit),
        view: view === null ? null : String(view.options?.id ?? view.options?.key ?? view.component?.name ?? "?"),
        composer: composer === null ? null : true,
        header: header === null ? null : true,
        viewEntries: viewEntries.length,
      };

      return { kit, standard: bundle.standard, scopeKey: bundle.scopeKey, renderers, store, view, transcriptInjected, composer, header, headerInjected, viewLedger, viewEntries };
    }
    /** Shared extra props for re-hosted view components. Injected faces come
        first; the pane-scoped store/render dispatchers always win so every
        view (chat, trajectory, …) routes into this pane's captured ledger. */
    function viewExtras(prepared, session, injected, storeProps) {
      const extra = {
        ...(injected !== null && injected !== undefined ? injected : {}),
        useStore: prepared.store.useStore,
        actions: prepared.store.actions,
        renderSlot: prepared.renderers.renderSlot,
        // Declared-children parity (stock standardKit attaches this when any
        // child kind is "chain"); a re-hosted view that dispatches a chain slot
        // threw "renderSlotChain is not a function" without it.
        renderSlotChain: prepared.renderers.renderSlotChain,
      };
      // 0.1.5: a view entry that declares its own store (ChatView → the chat
      // store) must read THAT store; the pane store backs only the plugin's
      // own tab/inspect currency.
      if (storeProps !== undefined && storeProps !== null && storeProps.useStore !== undefined) {
        extra.useStore = storeProps.useStore;
        extra.actions = storeProps.actions !== undefined ? storeProps.actions : extra.actions;
      }
      if (extra.loadOlder === undefined) extra.loadOlder = () => { try { session.loadOlder(); } catch {} };
      // per-session scroll memory (mirrors the shell's chatScrollPositions map)
      if (extra.chatScroll === undefined) {
        extra.chatScroll = {
          save: (position) => {
            try { rememberChatScroll(prepared.kit.sessionId, position); } catch {}
          },
          read: () => {
            try {
              const position = chatScrollMemory.get(prepared.kit.sessionId);
              return position !== undefined ? position : null;
            } catch { return null; }
          },
        };
      }
      if (extra.fileMentions === undefined) extra.fileMentions = () => undefined;
      // route inspect into the trajectory tab exactly like the stock shell does
      if (extra.inspectCall === undefined) extra.inspectCall = (callId) => {
        try {
          prepared.store.actions.setInspect({ callId });
          prepared.store.actions.setView("trajectory");
        } catch {}
      };
      if (extra.forkAt === undefined) extra.forkAt = () => {};
      if (extra.openFile === undefined) extra.openFile = () => Promise.resolve(null);
      if (extra.loadImage === undefined) extra.loadImage = () => Promise.resolve(null);
      // Required props of the stock ChatView (0.2.0 AND 0.2.1 destructure them
      // unconditionally): the plugin never supplied them, so an in-pane
      // "load through" / external-link click threw into the pane boundary and
      // blanked the transcript. Degrade safely; only when the captured kit does
      // not already carry a real implementation.
      if (extra.loadThrough === undefined && prepared.kit.loadThrough === undefined) {
        extra.loadThrough = () => Promise.resolve();
      }
      if (extra.openExternalLink === undefined && prepared.kit.openExternalLink === undefined) {
        extra.openExternalLink = (url) => {
          try { window.open(url, "_blank", "noopener,noreferrer"); } catch {}
        };
      }
      return extra;
    }

    function NativeTranscript({ prepared, session, fallback }) {
      const view = prepared.view;
      if (view === null || view === undefined) return fallback;
      const injected = prepared.transcriptInjected;
      const props = kitProps(prepared.kit, viewExtras(prepared, session, injected, entryStoreProps(view, prepared.kit.sessionId, prepared.scopeKey)));
      const viewT = entryTranslate(view.raw);
      if (viewT !== undefined) props.t = viewT;
      return h(PaneBoundary, { fallback }, h(view.component, props));
    }

    /** The stock session header per pane: breadcrumb title, view tabs
        (chat / trajectory / …), and the action row — fully traceable. */
    function NativeHeader({ prepared }) {
      const header = prepared.header;
      if (header === null || header === undefined) return null;
      const injected = prepared.headerInjected;
      if (injected === null || injected === undefined) return null;
      const props = kitProps(prepared.kit, {
        ...injected,
        // the header's OWN view state lives in the pane store: its injected
        // selectView writes through the actions this pane handed the face, so
        // useStore must read the same store. Nested header entries (the
        // utilities/actions rows) get their own entry stores via the
        // renderSlot dispatcher.
        useStore: prepared.store.useStore,
        actions: prepared.store.actions,
        renderSlot: prepared.renderers.renderSlot,
        renderSlotChain: prepared.renderers.renderSlotChain,
      });
      const headerT = entryTranslate(header.raw);
      if (headerT !== undefined) props.t = headerT;
      return h(PaneBoundary, { fallback: null }, h(header.component, props));
    }

    /** Renders the pane's ACTIVE view (tab) with the same ledger the stock
        header tabs write into — so switching tabs re-renders in the pane. */
    const NOOP_SUBSCRIBE = () => () => {};

    /** RULES OF HOOKS (M1): this component deliberately calls ZERO hooks. The
        old implementation called useSyncExternalStore/useStore AFTER early
        returns, and `prepared` is rebuilt when root faces/session identity
        change — a rebuild could flip those branches and throw "Rendered
        more/fewer hooks than expected". The closest boundary was the
        workspace-wide one, so a hook-order throw unmounted EVERY pane; with a
        persisted tree that made a boot crash loop. All hook state now lives in
        NativeViewTabs (a separate component type that only appears when there
        is a tab roster), so the branch decision costs no hook order at all. */
    function NativeViewArea({ prepared, session, fallback }) {
      const ledger = prepared.viewLedger;
      // dsh 0.1.5: the header face no longer carries a `.views` ledger — the
      // tab roster rides the standard session hook `conversationViews`
      // (injectFaceProps materialized it onto headerInjected as
      // useConversationViews). Without it the pane could never switch views.
      const viewsHook = prepared.headerInjected !== null && prepared.headerInjected !== undefined && typeof prepared.headerInjected.useConversationViews === "function"
        ? prepared.headerInjected.useConversationViews
        : null;
      if ((ledger === null || ledger === undefined) && viewsHook === null) {
        return h(NativeTranscript, { prepared, session, fallback });
      }
      if (prepared.viewEntries.length === 0) {
        return h(NativeTranscript, { prepared, session, fallback });
      }
      return h(NativeViewTabs, {
        prepared,
        session,
        fallback,
        ledger: ledger === undefined ? null : ledger,
        viewsHook,
      });
    }

    /** Hooky half of the pane view area. Its hook list is FIXED for the
        component's lifetime (one ledger subscription callback pair + two store
        hooks), so nothing downstream of a `prepared` rebuild can change it. */
    function NativeViewTabs({ prepared, session, fallback, ledger, viewsHook }) {
      const ledgerReadable = ledger !== null && ledger !== undefined && typeof ledger.subscribe === "function";
      const subscribeLedger = React.useCallback(
        (notify) => (ledgerReadable ? ledger.subscribe(notify) : NOOP_SUBSCRIBE()),
        [ledger, ledgerReadable],
      );
      const readLedgerVersion = React.useCallback(() => {
        if (ledger === null || ledger === undefined) return null;
        try { return typeof ledger.version === "function" ? ledger.version() : ledger.version; } catch { return null; }
      }, [ledger]);
      React.useSyncExternalStore(subscribeLedger, readLedgerVersion);
      const currentView = prepared.store.useStore((s) => (s !== null && s !== undefined ? s.view : null));
      // Always called (never behind `props.inspect === undefined`): the old
      // conditional call was the second Rules-of-Hooks violation here.
      const paneInspect = prepared.store.useStore((s) => (s !== null && s !== undefined ? s.inspect : null));
      let tabs = [];
      if (ledger !== null && ledger !== undefined) {
        try {
          tabs = ledger.list() || [];
        } catch {
          tabs = [];
        }
      } else {
        try {
          tabs = viewsHook((value) => value) || [];
        } catch {
          tabs = [];
        }
      }
      if (!Array.isArray(tabs)) tabs = [];
      let activeId = null;
      if (typeof currentView === "string" && tabs.some((tab) => tab !== null && tab !== undefined && tab.id === currentView)) {
        activeId = currentView;
      }
      if (activeId === null) {
        const chatTab = tabs.find((tab) => tab !== null && tab !== undefined && tab.id === "chat");
        activeId = chatTab !== undefined ? chatTab.id : (tabs.length > 0 && tabs[0] !== null && tabs[0] !== undefined ? tabs[0].id : "chat");
      }
      let found = prepared.viewEntries.find((ve) => ve.id === activeId);
      if (found === undefined) {
        // a tab the header offered has no ledger entry: say so once instead of
        // silently rendering the chat view under another tab's selection
        const key = "view:" + String(activeId);
        if (captureLog[key] !== true) {
          captureLog[key] = true;
          console.warn("[dsh-split-workspace] view '" + String(activeId) + "' is not in the pane's view ledger (have: "
            + prepared.viewEntries.map((ve) => String(ve.id)).join(",") + ") — falling back to chat");
        }
        found = prepared.viewEntries.find((ve) => ve.id === "chat");
      }
      if (found === undefined) return h(NativeTranscript, { prepared, session, fallback });
      const props = kitProps(prepared.kit, viewExtras(prepared, session, found.injected, entryStoreProps(found.parts, prepared.kit.sessionId, prepared.scopeKey)));
      // ConvViewProps carry the inspect selection + its dismissal — views like
      // trajectory render their detail panes through them
      if (props.inspect === undefined) {
        props.inspect = paneInspect;
        props.onInspectDone = () => {
          try { prepared.store.actions.setInspect(null); } catch {}
        };
      }
      if (found.t !== undefined) props.t = found.t;
      return h(PaneBoundary, { fallback: found.id === "chat" ? fallback : null }, h(found.parts.component, props));
    }

    function NativeComposer({ prepared, session, fallback }) {
      const composer = prepared.composer;
      // the stock zone carries the input machine STATE snapshot (with
      // .occurrences) — dock entries like the vision toolkit's paste dock
      // read props.input.occurrences and crash on the raw shell
      const inputState = composer === null || composer === undefined
        ? null
        : composer.useInput((s) => (s !== null && s !== undefined ? s : null));
      if (composer === null || composer === undefined) return fallback;
      // the stock page renders left/right/dock/overlay entries with a zone
      // owner ({ session, input }) — mirror it so entries keyed on the session
      // (cost line, context meter, attachment rail) bind to THIS pane
      const zone = {
        session,
        input: inputState !== null && inputState !== undefined
          ? inputState
          : (composer.face.keyboard !== undefined ? composer.face.keyboard : composer.face),
      };
      const dockEntries = prepared.renderers.renderList("conversation.composer.dock", zone);
      const props = kitProps(prepared.kit, {
        // The bar entry's own store pair, stock order: kit -> store -> inject.
        ...(composer.storeProps !== undefined && composer.storeProps !== null ? composer.storeProps : {}),
        // forward the WHOLE injected face, hooks materialized to use<Name>
        // props the way the slots runtime does — 0.1.5's InputBar reads
        // useBusyEnter/useFileUploads/useNotices off the face's hooks block.
        // Any prop the stock InputBar expects that the explicit whitelist
        // below does not know about still lands.
        ...injectFaceProps(composer.face),
        useInput: composer.useInput,
        inputActions: composer.inputActions,
        keyboard: composer.face.keyboard,
        addImages: composer.face.addImages,
        removeImage: composer.face.removeImage,
        draftImages: composer.face.draftImages,
        resolveSubmitMode: composer.face.resolveSubmitMode,
        toggleCommandMenu: composer.face.toggleCommandMenu,
        stop: composer.face.stop,
        command: composer.face.command,
        renderSlot: composer.renderSlot,
        renderSlotChain: prepared.renderers.renderSlotChain,
        renderFactorySlot: prepared.kit.renderFactorySlot,
        useNotices: composer.useNotices,
        useLexicon: composer.useLexicon,
        useMenuLauncher: composer.useMenuLauncher,
        variant: "composer",
        leftItems: prepared.renderers.renderList("conversation.input.left", zone),
        rightItems: prepared.renderers.renderList("conversation.input.right", zone),
        footer: h(DockLine, { entries: dockEntries }),
        overlay: prepared.renderers.renderList("conversation.input.overlay", zone),
      });
      // the stock composition renders the conversation.input.dock strips
      // (plan/todo, queue) ABOVE the bar — re-host them too, or panes lose them
      const dock = prepared.renderers.renderList("conversation.input.dock", zone);
      // The queue strip merges INTO the composer card natively (top-rounded
      // panel tucked under the card's top edge), which the one-line dock box
      // (draggable overflow + 60px-right text alignment) structurally breaks
      // — queue buttons (edit / remove / send-now) ended up clipped off the
      // draggable row's right edge and the strip sat misaligned. Queue
      // entries therefore render in their own native-geometry wrapper below,
      // and only the remaining strips stay in the dock line.
      // Identifying the queue entry is NOT about the data-queue-dock DOM
      // attribute: QueueDock paints that on its own root node, so it never
      // reaches this React element. What renderList DOES stamp onto the
      // element props is data-slot-id (the registrant's slot id); the stock
      // dock registrations are "todo" (order 0) and "queue" (order 20), and
      // the component itself is the exported QueueDock. renderList also wraps
      // every entry in a PaneBoundary element, so the component and its props
      // live one level down. Collect EVERY signal and accept a match on any
      // of them — a wrong-but-present data-slot-id must not mask the others.
      const isQueueEntry = (el) => {
        if (el === null || el === undefined || typeof el !== "object") return false;
        const props = el.props;
        if (props === null || props === undefined) return false;
        const child = props.children;
        const childProps = child !== null && child !== undefined && typeof child === "object" ? child.props : null;
        const component = child !== null && child !== undefined && typeof child === "object" ? child.type : null;
        const name = component !== null && component !== undefined ? (component.displayName || component.name) : null;
        const signals = [
          props["data-slot-id"],
          props["data-queue-dock"] !== undefined ? "queue" : null,
          childProps !== null && childProps !== undefined ? childProps["data-slot-id"] : null,
          childProps !== null && childProps !== undefined && childProps["data-queue-dock"] !== undefined ? "queue" : null,
          typeof name === "string" ? name : null,
        ];
        for (const signal of signals) {
          if (typeof signal !== "string") continue;
          if (signal === "queue" || signal.indexOf("QueueDock") !== -1) return true;
        }
        return false;
      };
      const queueEntries = [];
      const otherEntries = [];
      for (const el of dock) {
        if (isQueueEntry(el)) queueEntries.push(el);
        else otherEntries.push(el);
      }
      return h(PaneBoundary, { fallback }, h(React.Fragment, null,
        otherEntries.length > 0 ? h(DsvInputDock, null, h(DockLine, { entries: otherEntries })) : null,
        queueEntries.length > 0 ? h("div", { className: "dsv-queue-strip" }, queueEntries) : null,
        h(composer.bar.component, props),
      ));
    }

    /** Composer-mode toggle glyph: terminal (go TUI) vs maximize (go full). */
    function ComposerModeIcon({ tui }) {
      return tui === true
        ? h("svg", { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
            h("polyline", { points: "15 3 21 3 21 9" }),
            h("polyline", { points: "9 21 3 21 3 15" }),
            h("line", { x1: 21, y1: 3, x2: 14, y2: 10 }),
            h("line", { x1: 3, y1: 21, x2: 10, y2: 14 }))
        : h("svg", { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
            h("polyline", { points: "4 17 10 11 4 5" }),
            h("line", { x1: 12, y1: 19, x2: 20, y2: 19 }));
    }

    /** Queued-message / todo / plan strips (conversation.input.dock): the
        stock entries carry DIFFERENT width formulas (queue is card−16,
        todo is card−32), so they never line up with each other or with the
        input box. Pin the strip zone to the exact measured card box and
        neutralize each entry's horizontal metrics — every strip is then
        exactly as wide as the chat box above it. */
    /** The widest VISIBLE composer box (native card / TUI line) inside a
        scope. Transient or hidden seats can precede the real card in
        document order with a zero rect, so skip anything tiny — and only
        accept boxes that actually CONTAIN a textarea (the live input), so
        card-shaped decorations can never win the measurement. */
    function visibleComposerRect(scope) {
      let best = null;
      const nodes = scope.querySelectorAll("[data-composer-card], [data-dsv-composer-card], .dsv-tui");
      for (const node of nodes) {
        // dsh 0.1.5 renders the composer as a Lexical contenteditable, so a
        // textarea-only probe never matches the real card and every derived
        // width (queue strip, dock row) silently fell back to the full pane.
        // Accept the real input marker too — the same predicate `hasEditor`
        // uses for the geometry measurement.
        if (node.querySelector("textarea") === null && node.querySelector("[data-composer-input]") === null) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 12) continue;
        if (best === null || rect.width > best.width) best = rect;
      }
      return best;
    }

    /** Pin a row's left edge and width to the LIVE composer box, measured
        relative to the row's OWN wrapper — the footer/dock containers have
        their own offset, so pane-relative coordinates land shifted.
        Negative margins are required and valid: the wrapper can start
        right of the card's left edge. Writes only changed values: style
        writes would otherwise retrigger the subtree MutationObserver into
        an rAF-loop. */
    function useComposerAlignedRow(rowRef, leftBuffer, rightInset) {
      React.useLayoutEffect(() => {
        const row = rowRef.current;
        if (row === null) return;
        const pane = row.closest("[data-dsv-pane]");
        if (pane === null) return;
        let raf = 0;
        let applied = "";
        let stableCount = 0;
        // Re-apply briefly after mount/switch (mode flips and late-mounted
        // bars produce transient layouts), but BOUNDED: ~12 frames with an
        // early exit once the same geometry lands twice in a row. The old
        // fixed 90-tick loop kept measuring (forced layout per tick) for
        // ~1.5s on EVERY dock line of EVERY pane — pure cost once the layout
        // had already settled.
        const SETTLE_TICKS = 12;
        let settleTicks = SETTLE_TICKS;
        const apply = () => {
          const best = visibleComposerRect(pane);
          if (best === null) return;
          // Do not re-lay-out the composer's surroundings under a live IME:
          // the browser paints the composition underline at a cached position
          // and a shifted box can strand it there. The observer fires again on
          // the DOM churn the commit causes, so the alignment catches up.
          if (composingIn(pane)) return;
          const rowRect = row.getBoundingClientRect();
          const cs = getComputedStyle(row);
          const baseLeft = rowRect.left - (parseFloat(cs.marginLeft) || 0);
          const left = Math.round(best.left - baseLeft) + leftBuffer;
          const width = Math.max(120, Math.round(best.width) - leftBuffer - rightInset);
          const sig = left + "/" + width;
          if (sig === applied) {
            stableCount += 1;
            return;
          }
          stableCount = 0;
          applied = sig;
          row.style.marginLeft = left + "px";
          row.style.width = width + "px";
          row.style.maxWidth = "none";
        };
        const tick = () => {
          apply();
          if (stableCount >= 2) { settleTicks = 0; raf = 0; return; }
          if (settleTicks > 0) { settleTicks -= 1; raf = requestAnimationFrame(tick); }
          else raf = 0;
        };
        const schedule = () => {
          if (raf === 0) raf = requestAnimationFrame(tick);
        };
        apply();
        if (typeof ResizeObserver !== "function") return;
        const observer = new ResizeObserver(schedule);
        observer.observe(pane);
        let mutation = null;
        if (typeof MutationObserver === "function") {
          mutation = new MutationObserver(schedule);
          mutation.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-composer-card", "data-dsv-composer-card"] });
        }
        raf = requestAnimationFrame(tick);
        return () => {
          if (raf !== 0) cancelAnimationFrame(raf);
          observer.disconnect();
          if (mutation !== null) mutation.disconnect();
        };
      }, [leftBuffer, rightInset]);
    }

    function DsvInputDock({ children }) {
      const ref = React.useRef(null);
      useComposerAlignedRow(ref, 0, 0);
      return h("div", { ref, className: "dsv-input-dock" }, children);
    }

    /** Fixed one-line dock: a limited text area mirroring the chat box, left
        aligned. Cells are never hidden or shrunk — when they overflow, the
        row becomes draggable and panning reveals the clipped right side
        (the area itself never changes size). Drag skips real controls so
        their clicks keep working. */
    function DockLine({ entries }) {
      const rowRef = React.useRef(null);
      const innerRef = React.useRef(null);
      const [overflown, setOverflown] = React.useState(false);
      useComposerAlignedRow(rowRef, 4, 60);
      React.useEffect(() => {
        const row = rowRef.current;
        const inner = innerRef.current;
        if (row === null || inner === null || typeof ResizeObserver !== "function") return;
        const measure = () => setOverflown(row.scrollWidth > row.clientWidth + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        observer.observe(inner);
        return () => observer.disconnect();
        // `entries`, not `entries.length`: the cells re-render with new text
        // (a growing tok/s or token count) without changing the cell COUNT, and
        // the overflow flag has to follow that or a longer value stays clipped
        // behind the row's `overflow: hidden` with no pan affordance.
      }, [entries]);
      const onRowMouseDown = (event) => {
        if (event.button !== 0) return;
        const row = rowRef.current;
        if (row === null || row.scrollWidth <= row.clientWidth + 1) return;
        const target = event.target;
        if (target !== null && target !== undefined && typeof target.closest === "function" && target.closest("button, a, input, textarea, select") !== null) return;
        // Do NOT preventDefault on mousedown. It cancels the browser's focus
        // move for the whole click, so any press landing on this row (the
        // stats line / a cost-meter dock entry makes it long enough to
        // overflow) used to leave the composer unfocused — "cannot click
        // into the input". The drag now engages only after real movement;
        // until then the click behaves like a normal click.
        const startX = event.clientX;
        const startLeft = row.scrollLeft;
        let engaged = false;
        const onMove = (e) => {
          const dx = e.clientX - startX;
          if (!engaged) {
            if (Math.abs(dx) < 3) return;
            engaged = true;
            row.classList.add("dragging");
            try { window.getSelection().removeAllRanges(); } catch {}
          }
          row.scrollLeft = startLeft - dx;
        };
        const onUp = () => {
          if (engaged) row.classList.remove("dragging");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      };
      return h("div", { ref: rowRef, className: "dsv-dock-line" + (overflown ? " overflown" : ""), onMouseDown: onRowMouseDown },
        h("div", { ref: innerRef, className: "dsv-dock-inner" },
          entries.map((el, index) => h("div", { key: index, className: "dsv-dock-cell" }, el)),
        ),
      );
    }

    /** Minimal terminal-style composer wired to the pane's REAL input machine:
        same draft, same submit path (images/slash/mode semantics included).
        Pasted / dropped images ride the same draft as in full mode — the
        native attachments strip renders above the line so they stay
        visible (and removable) instead of silently sitting in the draft. */
    /** Queued-messages badge for TUI mode: the stock dock strip is part of
        the full composer, so TUI panes had NO sign of queued sends. One dim
        monospace line under the block's top rule — a glyph, the count in
        brand color, the first queued message as a truncated preview, and the
        full list in the tooltip. Steering sends are excluded: the native
        transcript already renders those as pending bubbles. */
    function TuiQueueLine({ useSession }) {
      const queue = useSession((s) => (s !== null && s !== undefined && Array.isArray(s.queue) ? s.queue : []));
      const items = [];
      for (const item of queue) {
        if (item !== null && item !== undefined && item.placement !== "steering") items.push(item);
      }
      if (items.length === 0) return null;
      const textOf = (item) => {
        const content = item !== null && item !== undefined ? item.content : null;
        return typeof content === "string" ? content : blockText(content);
      };
      const first = firstLine(textOf(items[0]), 48).trim();
      const all = items.map((item, i) => String(i + 1) + ". " + firstLine(textOf(item), 120)).join("\n");
      return h("div", { className: "dsv-tui-queue", title: all },
        h("span", { className: "dsv-tui-queue-glyph" }, "\u2261"),
        h("span", { className: "dsv-tui-queue-count" }, String(items.length) + " " + t("queuedBadge")),
        first !== "" ? h("span", { className: "dsv-tui-queue-preview" }, first) : null,
      );
    }

    function TuiMachineComposer({ prepared, running, toggle, useSession }) {
      const composer = prepared.composer;
      const draft = composer.useInput((s) => (s !== null && s !== undefined && s.draft !== undefined ? s.draft : ""));
      // dsh 0.1.5 input state carries `attachmentIds` (images AND files);
      // the 0.1.4 face exposed `imageIds` — read both, prefer the live one.
      const attachmentIds = composer.useInput((s) => {
        if (s === null || s === undefined) return [];
        if (Array.isArray(s.attachmentIds)) return s.attachmentIds;
        if (Array.isArray(s.imageIds)) return s.imageIds;
        return [];
      });
      const attachments = React.useMemo(() => {
        const face = composer.face;
        if (attachmentIds.length === 0 || face === null || face === undefined) return [];
        try {
          if (typeof face.resolveDraftAttachments === "function") {
            const list = face.resolveDraftAttachments(attachmentIds);
            return Array.isArray(list) ? list : [];
          }
        } catch {}
        try {
          if (typeof face.draftImages === "function") {
            const list = face.draftImages(attachmentIds);
            return Array.isArray(list) ? list : [];
          }
        } catch {}
        return [];
      }, [attachmentIds, composer.face]);
      const inputRef = React.useRef(null);
      React.useLayoutEffect(() => {
        const el = inputRef.current;
        if (el === null) return;
        el.style.height = "auto";
        el.style.height = Math.min(Math.max(el.scrollHeight, 18), 96) + "px";
      }, [draft]);
      const submit = () => { try { composer.inputActions.submit(); } catch {} };
      const onKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        }
      };
      const attachStrip = attachments.length > 0
        ? h("div", { className: "dsv-tui-attach" },
            composer.renderSlot("conversation.input.attachments", {
              attachments,
              canAcceptDrop: true,
              // 0.1.5 seat props (onAddFiles / onRemoveAttachment) with the
              // 0.1.4 names kept for older faces — the seat renders whichever
              // callbacks its generation knows
              onAddFiles: (files) => {
                const face = composer.face;
                try {
                  if (face !== null && face !== undefined && typeof face.addFiles === "function") { face.addFiles(files); return; }
                  if (face !== null && face !== undefined && typeof face.addImages === "function") face.addImages(files);
                } catch {}
              },
              onRemoveAttachment: (id) => {
                const face = composer.face;
                try {
                  if (face !== null && face !== undefined && typeof face.removeAttachment === "function") { face.removeAttachment(id); return; }
                  if (face !== null && face !== undefined && typeof face.removeImage === "function") face.removeImage(id);
                } catch {}
              },
              onAddImages: (files) => { try { composer.face.addImages(files); } catch {} },
              onRemoveImage: (id) => { try { composer.face.removeImage(id); } catch {} },
            }),
          )
        : null;
      return h(React.Fragment, null, attachStrip,
        h("div", { className: "dsv-tui-block" },
          h(TuiQueueLine, { useSession }),
          h("div", { className: "dsv-tui" },
        h("span", { className: "dsv-tui-prompt" }, "›"),
        h("textarea", {
          ref: inputRef, rows: 1, className: "dsv-tui-input", value: draft,
          placeholder: t("composerPlaceholder"), "aria-label": t("composerPlaceholder"),
          "data-dsv-tui-input": "true",
          spellCheck: false,
          onChange: (event) => { try { composer.inputActions.setDraft(event.target.value); } catch {} },
          onKeyDown,
        }),
        // stock primary-button semantics (primaryStops): while running, Stop
        // owns the key only when the draft is empty — a non-empty draft keeps
        // the send key, which delivers through submit()'s queue placement
        (running && String(draft).trim() === "")
          ? h("button", { type: "button", className: "dsv-tui-btn", title: t("stop"), "aria-label": t("stop"), onClick: () => { try { composer.face.stop(); } catch {} } }, h(PrimIcon, { prim: "IconStopFill16" }))
          : h("button", { type: "button", className: "dsv-tui-btn", title: t("send"), "aria-label": t("send"), disabled: String(draft).trim() === "", onClick: submit }, h(PrimIcon, { prim: "IconSendOutline14" })),
        toggle,
      )));
    }

    /** Plain fallback TUI composer (no native face captured): local draft over
        session.prompt / session.command. */
    function TuiPlainComposer({ sessionId, session, running, toggle, useSession }) {
      const [draft, setDraft] = React.useState("");
      const submit = () => {
        const text = draft.trim();
        // running must NOT gate the submit: stock semantics deliver the draft
        // with placement "queue" and the host resolves it — a plain send when
        // idle, a queued item when the agent is busy. Refusing here made
        // Enter dead exactly while a pane's session was running.
        if (text === "") return;
        try {
          const result = text.startsWith("/") ? session.command(text) : session.prompt([{ type: "text", text }], "queue");
          if (result !== undefined && result !== null && typeof result.then === "function") result.catch(() => {});
          setDraft("");
        } catch {}
      };
      const onKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
      };
      return h(React.Fragment, null,
        h("div", { className: "dsv-tui-block" },
          h(TuiQueueLine, { useSession }),
          h("div", { className: "dsv-tui" },
        h("span", { className: "dsv-tui-prompt" }, "›"),
        h("textarea", { rows: 1, className: "dsv-tui-input", value: draft, placeholder: t("composerPlaceholder"), "aria-label": t("composerPlaceholder"), "data-dsv-tui-input": "true", spellCheck: false, onChange: (event) => setDraft(event.target.value), onKeyDown }),
        toggle
      )));
    }

    /** One slim row for narrow panes: title + header actions + view tabs.
        The actions cluster re-hosts `conversation.session.header.actions`
        (agent-team trigger, agent-preset label, cost-meter statistics, …) so
        narrow panes keep the same menu-bar functionality the stock header
        shows — the slim row used to drop it entirely. */
    function SlimHeader({ prepared, summary, sessionId }) {
      const currentView = prepared.store.useStore((s) => (s !== null && s !== undefined ? s.view : null));
      const title = summary ? summary.displayTitle || summary.title || sessionId : sessionId;
      const actions = prepared.renderers.renderSlot("conversation.session.header.actions", {});
      const hasActions = Array.isArray(actions) ? actions.length > 0 : actions !== null && actions !== undefined;
      const tabs = [];
      for (const ve of prepared.viewEntries) {
        let labelText = ve.id;
        try {
          const label = ve.parts.options !== null && ve.parts.options !== undefined ? ve.parts.options.label : null;
          if (typeof label === "function") labelText = label() || ve.id;
        } catch {}
        tabs.push({ id: ve.id, label: labelText });
      }
      const titleRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const onTitleMouseDown = (event) => {
        const el = titleRef.current;
        if (el === null || el.scrollWidth <= el.clientWidth + 1) return;
        dragRef.current = { x: event.clientX, left: el.scrollLeft };
        const onMove = (e) => {
          const st = dragRef.current;
          if (st === null) return;
          el.scrollLeft = st.left + (st.x - e.clientX);
        };
        const onUp = () => {
          dragRef.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      };
      return h("div", { className: "dsv-slim-header", "data-actions": hasActions ? "" : undefined },
        hasActions ? h("div", { className: "dsv-slim-actions" }, actions) : null,
        h("div", { className: "dsv-slim-tabs" },
          tabs.map((tab) => h("button", {
            key: tab.id !== null && tab.id !== undefined ? tab.id : tab.label,
            type: "button",
            className: "dsv-slim-tab" + (currentView === tab.id || (currentView === null && tab.id === "chat") ? " active" : ""),
            onClick: () => { try { prepared.store.actions.setView(tab.id); } catch {} },
          }, tab.label)),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // fallback transcript + composer (built-in renderer, no captures needed)
    // ---------------------------------------------------------------------

    function PrimDisclosure(props) {
      const C = P.DisclosureRow;
      if (C !== undefined && C !== null) return h(C, props);
      const body = props.open ? [props.collapsedContent, props.children] : props.collapsedContent;
      return h(
        "div",
        { className: props.rowClassName, onClick: props.expandOnRowClick ? props.onToggle : undefined, style: { cursor: "pointer" } },
        h("span", { className: props.leadingClassName }, props.icon),
        h("span", { className: props.titleClassName }, props.title),
        body,
      );
    }

    function UserBubble({ content, pending }) {
      const text = blockText(content);
      if (text === "") return null;
      return h(
        "div",
        { className: "dsv-user-row", "data-pending-steering": pending || undefined },
        h("div", { className: "dsv-user-stack" }, h("div", { className: "dsv-bubble" }, text)),
      );
    }

    function ReasoningRow({ text, running }) {
      const [expanded, setExpanded] = React.useState(false);
      const summaryRef = React.useRef(null);
      const visible = String(text || "");
      const summary = running
        ? visible.trimEnd().split("\n").pop() || ""
        : visible.split("\n").find((c) => c.trim() !== "") || "";
      React.useEffect(() => {
        const el = summaryRef.current;
        if (el !== null) el.scrollLeft = running ? el.scrollWidth - el.clientWidth : 0;
      }, [running, summary]);
      return h(
        "div",
        { className: "dsv-think-root", "data-variant": "think", "data-state": running ? "running" : "ok" },
        h(PrimDisclosure, {
          rowClassName: "dsv-think-row",
          leadingClassName: "dsv-think-leading",
          titleClassName: "dsv-think-title",
          chevronClassName: "dsv-think-chevron",
          icon: h(PrimIcon, { prim: "IconThinkOutline14", size: 14 }),
          title: "Think",
          open: expanded,
          expandable: true,
          expandOnRowClick: true,
          onToggle: () => setExpanded((v) => !v),
          collapsedContent: [
            h("span", { className: "dsv-think-separator", "aria-hidden": true }),
            h("span", { ref: summaryRef, className: "dsv-think-summary", "data-follow-end": running || undefined }, summary),
          ],
          children: h("div", { className: "dsv-think-body" }, visible),
        }),
      );
    }

    function RowCard({ state, icon, title, summary, error, bodies }) {
      const [expanded, setExpanded] = React.useState(false);
      const expandedBody = bodies.filter((b) => b !== null && b !== undefined);
      return h(
        "div",
        { className: "dsv-rowcard-root", "data-state": state },
        h(PrimDisclosure, {
          rowClassName: "dsv-rowcard-row",
          leadingClassName: "dsv-rowcard-leading",
          titleClassName: "dsv-rowcard-title",
          chevronClassName: "dsv-rowcard-chevron",
          icon,
          title,
          open: expanded,
          expandable: expandedBody.length > 0,
          expandOnRowClick: expandedBody.length > 0,
          onToggle: () => setExpanded((v) => !v),
          collapsedContent: [
            h("span", { className: "dsv-rowcard-separator", "aria-hidden": true }),
            h("span", { className: "dsv-rowcard-summary", "data-error": error || undefined }, summary),
          ],
          children: expandedBody.length > 0 ? h("div", {}, expandedBody) : null,
        }),
      );
    }

    function monoBody(text, error) {
      if (text === null || text === undefined || text === "") return null;
      return h("pre", { className: "dsv-rowcard-body", "data-error": error || undefined }, String(text));
    }

    function callRows(root, depth) {
      if (root === null || root === undefined || typeof root !== "object") return [];
      const rows = [];
      const name = typeof root.name === "string" ? root.name : "tool";
      const settled = root.result !== undefined && root.result !== null;
      const state = !settled ? "running" : root.error !== undefined && root.error !== null ? "error" : "ok";
      const argsRaw = typeof root.argsRaw === "string" ? root.argsRaw : "";
      let resultText = null;
      let isError = false;
      if (settled) {
        if (Array.isArray(root.result.content)) {
          resultText = root.result.content
            .map((item) => (item !== null && typeof item === "object" && item.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
            .join("\n");
        } else if (typeof root.result === "string") {
          resultText = root.result;
        }
        isError = root.result.isError === true || (root.error !== undefined && root.error !== null);
      }
      rows.push(
        h(RowCard, {
          key: String(root.callId || name) + ":" + depth + ":" + rows.length,
          state,
          icon: h(PrimIcon, { prim: "IconCodeOutline16", size: 14 }),
          title: name,
          summary: firstLine(argsRaw, 120) || (!settled ? "Running…" : isError ? "Error" : "Completed"),
          error: isError,
          bodies: [monoBody(argsRaw, false), monoBody(resultText, isError)],
        }),
      );
      if (Array.isArray(root.subCalls)) {
        for (const sub of root.subCalls) rows.push(...callRows(sub, depth + 1));
      }
      return rows;
    }

    function ToolCallNode({ data }) {
      return h("div", {}, callRows(data && data.root, 0));
    }

    function CommandNode({ data }) {
      const name = (data && data.name) || (data && data.commandId) || "command";
      const args = data && typeof data.args === "string" ? data.args : "";
      const outcome = data ? data.outcome : undefined;
      const failed = outcome !== null && outcome !== undefined && outcome.kind === "error";
      const state = outcome === null || outcome === undefined ? "running" : failed ? "error" : "ok";
      const outcomeText = outcome !== null && outcome !== undefined && typeof outcome.text === "string" ? outcome.text : "";
      const summary = (outcomeText !== "" && firstLine(outcomeText, 120)) || (failed ? "Failed" : state === "running" ? "Running…" : "Completed");
      return h(RowCard, {
        state,
        icon: h("span", { style: { fontSize: 12, lineHeight: "16px" } }, "⌘"),
        title: "/" + name,
        summary,
        error: failed,
        bodies: [monoBody(args, false), outcomeText !== "" ? monoBody(outcomeText, failed) : null],
      });
    }

    function AssistantBlocks({ blocks, streaming, interrupted }) {
      const list = Array.isArray(blocks) ? blocks : [];
      const last = list.length - 1;
      const rendered = [];
      for (let i = 0; i < list.length; i++) {
        const block = list[i];
        if (block === null || block === undefined) continue;
        if (block.kind === "text") {
          rendered.push(
            P.MarkdownText !== undefined && P.MarkdownText !== null
              ? h(P.MarkdownText, { key: i, text: block.text, streaming, codeLabels: { copyLabel: "Copy", copiedLabel: "Copied" } })
              : h("div", { key: i }, block.text),
          );
        } else if (block.kind === "reasoning") {
          rendered.push(h(ReasoningRow, { key: i, text: block.text, running: streaming && i === last }));
        } else if (block.kind === "image") {
          rendered.push(h("div", { key: i, className: "dsv-hint" }, "🖼"));
        } else if (block.kind === "tool-call") {
          // tool calls render as their own flow nodes
        } else {
          rendered.push(h("pre", { key: i, className: "dsv-rowcard-body" }, JSON.stringify(block, null, 2)));
        }
      }
      if (rendered.length === 0 && !interrupted) return null;
      return h(
        "div",
        { className: "dsv-md-root", "data-streaming": streaming || undefined },
        h(
          "div",
          { className: "dsv-md-body" },
          rendered,
          interrupted ? h("span", { className: "dsv-md-stopped" }, "Stopped") : null,
        ),
      );
    }

    function TurnStatusLine({ startTime }) {
      const [mountedAt] = React.useState(() => Date.now());
      const anchor = startTime || mountedAt;
      const [elapsed, setElapsed] = React.useState(() => Math.max(0, Date.now() - anchor));
      React.useEffect(() => {
        const tick = () => setElapsed(Math.max(0, Date.now() - anchor));
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
      }, [anchor]);
      return h(
        "div",
        { className: "dsv-turn-status", role: "status", "aria-live": "polite" },
        t("running"),
        elapsed >= 15000 ? h("span", { className: "dsv-turn-status-clock", "aria-hidden": true }, formatClock(elapsed)) : null,
      );
    }

    function FlowNode({ node }) {
      const data = node.data || {};
      switch (node.kind) {
        case "user":
        case "steering":
          return h(UserBubble, { content: data.content, pending: false });
        case "assistant-step":
          return h(AssistantBlocks, {
            blocks: data.blocks,
            streaming: data.status === "running",
            interrupted: data.status === "interrupted",
          });
        case "tool-call":
          return h(ToolCallNode, { data });
        case "command":
        case "command-input":
          return h(CommandNode, { data });
        case "turn-error":
          return h("div", { className: "dsv-turn-error" }, typeof data.message === "string" ? data.message : "Turn failed");
        case "turn-max-tokens":
          return h("div", { className: "dsv-turn-error" }, "Turn stopped by the output-token limit");
        default:
          return null;
      }
    }

    function FallbackTranscript({ useSession, session }) {
      const scrollerRef = React.useRef(null);
      const atBottomRef = React.useRef(true);
      const [, forceTick] = React.useState(0);

      const order = useSession((s) => (s !== null && s.chat !== undefined && s.chat !== null ? s.chat.order : []));
      const nodes = useSession((s) => (s !== null && s.chat !== undefined && s.chat !== null ? s.chat.nodes : null));
      const running = useSession((s) => (s !== null ? s.running === true : false));
      const openState = useSession((s) => (s !== null && s.openState !== undefined && s.openState !== null ? s.openState : "open"));
      const openError = useSession((s) => (s !== null ? s.openError : null));
      const hasMore = useSession((s) => (s !== null ? s.hasMore === true : false));
      const loadingOlder = useSession((s) => (s !== null ? s.loadingOlder === true : false));
      const queue = useSession((s) => (s !== null && Array.isArray(s.queue) ? s.queue : []));
      const timeline = useSession((s) => (s !== null && s.chat !== undefined && s.chat !== null && s.chat.timeline !== undefined ? s.chat.timeline : null));

      let runningStart = null;
      if (timeline !== null && timeline !== undefined && timeline.turns !== undefined) {
        try {
          for (const turn of timeline.turns.values()) {
            if (turn.status === "open" && turn.start !== undefined) runningStart = turn.start.time;
          }
        } catch {}
      }

      const toBottom = React.useCallback(() => {
        const el = scrollerRef.current;
        if (el === null) return;
        el.scrollTop = el.scrollHeight;
        atBottomRef.current = true;
        forceTick((v) => v + 1);
      }, []);

      // Auto-follow ONLY when the flow actually grew (new nodes, run state,
      // queued items) — not on EVERY render. The effect reads scrollHeight
      // (forced layout); with no deps it ran per streaming token batch per
      // pane, a constant reflow storm.
      React.useLayoutEffect(() => {
        if (atBottomRef.current) {
          const el = scrollerRef.current;
          if (el !== null) el.scrollTop = el.scrollHeight;
        }
      }, [order, running, queue.length]);

      const onScroll = () => {
        const el = scrollerRef.current;
        if (el === null) return;
        const next = el.scrollHeight - el.scrollTop - el.clientHeight <= 25;
        if (next !== atBottomRef.current) {
          atBottomRef.current = next;
          forceTick((v) => v + 1);
        }
      };

      const kids = [];
      if (openState === "loading") kids.push(h("div", { className: "dsv-hint", key: "hint" }, t("loadingHistory")));
      if (openState === "error") {
        kids.push(h("div", { className: "dsv-open-error", key: "error" }, t("loadError") + (openError && openError.message ? ": " + openError.message : "")));
      }
      if (hasMore) {
        kids.push(
          h("div", { className: "dsv-older", key: "older" },
            h("button", {
              type: "button",
              disabled: loadingOlder,
              onClick: () => { try { session.loadOlder(); } catch {} },
            }, loadingOlder ? "…" : t("loadOlder"))),
        );
      }
      if (openState === "open") {
        if (order.length === 0) {
          kids.push(h("div", { className: "dsv-hint", key: "empty", style: { alignSelf: "center", padding: "32px 0" } }, t("emptyTranscript")));
        } else {
          for (let i = 0; i < order.length; i++) {
            const key = order[i];
            let node = null;
            try {
              node = nodes !== null && nodes !== undefined ? nodes.get(key) : null;
            } catch {
              node = null;
            }
            if (node === null || node === undefined) continue;
            kids.push(
              h("div", { className: "dsv-flow-item", key, "data-chat-flow-key": key, "data-chat-flow-kind": String(node.kind || "") },
                h(FlowNode, { node })),
            );
          }
        }
      }
      if (running) kids.push(h(TurnStatusLine, { key: "status", startTime: runningStart }));
      let pendingIndex = 0;
      for (const item of queue) {
        if (item === null || item === undefined || item.placement !== "steering") continue;
        pendingIndex += 1;
        kids.push(h(UserBubble, { key: "steer-" + (item.id || pendingIndex), content: item.content, pending: true }));
      }

      return h(
        "div",
        { className: "dsv-chat-root" },
        h("div", { className: "dsv-chat-scroll", ref: scrollerRef, onScroll }, h("div", { className: "dsv-chat-column" }, kids)),
        !atBottomRef.current
          ? h("div", { className: "dsv-to-bottom-slot" },
              h("button", { type: "button", className: "dsv-to-bottom", "aria-label": t("toBottom"), title: t("toBottom"), onClick: toBottom },
                h(PrimIcon, { prim: "IconChevronDownOutline14" })))
          : null,
      );
    }

    function FallbackComposer({ sessionId, session, running }) {
      const [draft, setDraft] = React.useState("");
      const [imageIds, setImageIds] = React.useState([]);
      const inputRef = React.useRef(null);

      /** Upload pasted image files through the conversation service (same
          createDraftImages pipeline the stock composer uses) and keep the
          returned draft ids for the next submit. */
      const conversationService = () => {
        try {
          const scope = sessionsService !== undefined && sessionsService !== null && typeof sessionsService.scope === "function"
            ? sessionsService.scope(sessionId)
            : undefined;
          return scope !== undefined && scope !== null ? scope.get("conversation") : undefined;
        } catch {
          return undefined;
        }
      };
      const uploadPastedFiles = (files) => {
        const conversation = conversationService();
        if (conversation === undefined || conversation === null) return 0;
        // dsh 0.1.5: createDrafts(sessionId, files) registers image drafts
        // (and starts background uploads for files); 0.1.4 exposed the
        // image-only createDraftImages — prefer whichever the service carries
        const ids = [];
        try {
          if (typeof conversation.createDrafts === "function") {
            const drafts = conversation.createDrafts(sessionId, files);
            for (const draft of (drafts !== null && drafts !== undefined ? drafts : [])) {
              if (draft !== null && draft !== undefined && draft.id !== undefined) ids.push(draft.id);
            }
          } else if (typeof conversation.createDraftImages === "function") {
            const attachments = conversation.createDraftImages(files);
            for (const attachment of (attachments !== null && attachments !== undefined ? attachments : [])) {
              if (attachment !== null && attachment !== undefined && attachment.id !== undefined) ids.push(attachment.id);
            }
          } else {
            return 0;
          }
        } catch {
          return 0;
        }
        if (ids.length === 0) return 0;
        setImageIds((prev) => [...prev, ...ids]);
        return ids.length;
      };
      const onPaste = (event) => {
        const data = event.clipboardData;
        const files = data !== null && data !== undefined && data.files !== undefined && data.files !== null
          ? Array.from(data.files).filter((file) => file !== null && file !== undefined && typeof file.type === "string" && file.type.startsWith("image/"))
          : [];
        if (files.length === 0) return;
        if (uploadPastedFiles(files) > 0) event.preventDefault();
      };

      React.useLayoutEffect(() => {
        const el = inputRef.current;
        if (el === null) return;
        el.style.height = "auto";
        const natural = Math.min(el.scrollHeight, 168);
        el.style.height = Math.max(natural, 28) + "px";
      }, [draft]);

      const submit = () => {
        const text = draft.trim();
        // running must NOT gate the submit (see TuiPlainComposer): the "queue"
        // placement below is resolved host-side — a plain send when idle, a
        // queued item when the agent is busy. The old `|| running` refusal
        // made Enter dead exactly while the pane's session was running.
        if (text === "" && imageIds.length === 0) return;
        try {
          let result;
          if (text.startsWith("/") && imageIds.length === 0) {
            result = session.command(text);
          } else {
            let sent = false;
            if (imageIds.length > 0) {
              const conversation = conversationService();
              if (conversation !== undefined && conversation !== null && typeof conversation.sendSession === "function") {
                result = conversation.sendSession(session, text, imageIds, "queue");
                sent = true;
              }
            }
            if (!sent) result = session.prompt([{ type: "text", text }], "queue");
          }
          if (result !== undefined && result !== null && typeof result.then === "function") result.catch(() => {});
          setDraft("");
          setImageIds([]);
        } catch {}
      };

      const onKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        }
      };

      return h(
        "div",
        { className: "dsv-composer" },
        h(
          "div",
          { className: "dsv-composer-card" },
          h("textarea", {
            ref: inputRef,
            className: "dsv-composer-text",
            rows: 1,
            value: draft,
            placeholder: t("composerPlaceholder"),
            "aria-label": t("composerPlaceholder"),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown,
            onPaste,
          }),
          h(
            "div",
            { className: "dsv-composer-row" },
            h("div", { className: "dsv-composer-hint" },
              imageIds.length > 0 ? imageIds.length + " 🖼 · Enter ↵" : "Enter ↵"),
            h(
              "div",
              { className: "dsv-composer-trailing" },
              // stock primaryStops rule: Stop only for an empty draft while
              // running; a non-empty draft keeps a (queue-)send button
              (running && draft.trim() === "" && imageIds.length === 0)
                ? h("button", {
                    type: "button",
                    className: "dsv-send stop",
                    title: t("stop"),
                    "aria-label": t("stop"),
                    onClick: () => { try { session.cancel(); } catch {} },
                  }, h(PrimIcon, { prim: "IconStopFill16" }))
                : h("button", {
                    type: "button",
                    className: "dsv-send",
                    disabled: draft.trim() === "" && imageIds.length === 0,
                    title: t("send"),
                    "aria-label": t("send"),
                    onClick: submit,
                  }, h(PrimIcon, { prim: "IconSendOutline14" })),
            ),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // pane assembly
    // ---------------------------------------------------------------------

    function ChatPane({ sessionId, session, narrow, summary, composerMode, onToggleComposerMode, toggleNode }) {
      const useSession = React.useMemo(() => makeUseSession(session), [session]);
      const running = useSession((s) => (s !== null ? s.running === true : false));
      // Pane resources ride the React MOUNT: retain on mount, release on
      // unmount. Together with treeStore.commit's departed-leaf sweep this
      // covers EVERY leaf mutation path (✕, sidebar click-to-load, closeFocused,
      // movePane) — the old cleanup list lived only in the ✕ handler, so a
      // sidebar click leaked a retained SessionReference, an editor guard with
      // five document capture listeners, a typing subscription and the image
      // intake, and every stale guard then ran on every keystroke app-wide.
      React.useEffect(() => {
        retainPaneSession(sessionId);
        return () => { releasePaneSession(sessionId); };
      }, [sessionId]);
      // Pending user interactions (ask_user_question / plan-review, approvals)
      // come from the ROOT standard hook `useSessionStatus` — the same source the
      // stock ConversationRoot reads — because the 0.2.x UiSession service has
      // NO `pendingInteractions` property (the old read silently returned
      // nothing, so in-pane question/approval cards never appeared). The legacy
      // uiSession source remains only as the 0.1.x fallback. A root hook can only
      // be called from a component, so RootPendingProbe (rendered below) feeds
      // the value into a module store; this pane's hook list stays fixed.
      const rootFaces = useRootStandard();
      const useSessionStatus = rootFaces !== null && rootFaces !== undefined && typeof rootFaces.useSessionStatus === "function"
        ? rootFaces.useSessionStatus
        : null;
      const legacyPending = useLegacySessionPendingInteraction((snapshot) =>
        snapshot === null || snapshot === undefined || typeof snapshot.get !== "function"
          ? undefined
          : snapshot.get(sessionId),
      );
      const rootPending = useRootPendingInteraction(sessionId);
      const pendingInteraction = useSessionStatus !== null ? rootPending : legacyPending;
      // the native re-hosting bundle (kit, inject faces, hook factories) is
      // built once per (sessionId, session, root faces) — identities stay
      // stable. On 0.2.0 the session faces only exist once the retained
      // SessionReference has opened, so the build waits for it instead of
      // freezing an empty kit; the ROOT faces arrive on this plugin's own
      // `shell.overlay` entry, so subscribing here lets a pane that was opened
      // before the root roster settled pick them up without a remount.
      const bindingReady = useSessionBindingReady(sessionId);
      // "Not yet" vs "gone": while the bounded retain retries are still armed,
      // a pane without a session face shows the loading hint, NOT "Session
      // ended" (the 1.6.0 regression: the first retain raced the host catalog
      // and the pane settled into the ended state permanently).
      const faceStatus = useSessionFaceStatus(sessionId);
      const prepared = React.useMemo(
        () => (session === undefined || session === null || !bindingReady ? null : prepareNative(sessionId, session, rootFaces)),
        [sessionId, session, bindingReady, rootFaces],
      );

      React.useEffect(() => {
        if (session === undefined || session === null) return;
        // runtime-internal staging bridge: history window + live events
        try {
          const result = session.open();
          if (result !== undefined && result !== null && typeof result.catch === "function") result.catch(() => {});
        } catch {}
      }, [session]);

      if (session === undefined || session === null) {
        const stillRetrying = faceStatus !== undefined && faceStatus !== null
          && faceStatus.exhausted !== true && faceStatus.face === undefined;
        return h("div", { style: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" } },
          h("div", { className: "dsv-hint" }, t(stillRetrying === true ? "loadingHistory" : "sessionEnded")));
      }
      // Waiting for the retained SessionReference to open (bounded by
      // SESSION_BINDING_GRACE_MS). Hold the frame with a hint for that one
      // render — the native components below dereference the prepared bundle.
      if (prepared === null) {
        return h("div", { style: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" } },
          h("div", { className: "dsv-hint" }, t("loadingHistory")));
      }
      // TUI mode strips the stock session header entirely (breadcrumb, view
      // tabs, actions) — only the plugin's own pane header remains. Otherwise:
      // slim header for narrow panes, full stock header for wide ones.
      const header = composerMode === "tui"
        ? null
        : (narrow === true
          ? h(SlimHeader, { prepared, summary, sessionId })
          : h(NativeHeader, { prepared }));

      const transcript = h(NativeViewArea, {
        prepared,
        session,
        fallback: h(FallbackTranscript, { useSession, session }),
      });
      const composerBar = h(NativeComposer, {
        prepared,
        session,
        fallback: h(FallbackComposer, { sessionId, session, running }),
      });
      // conversation.composer chain: entries such as the ask_user question
      // editor, approval prompts, and plan reviews TAKE OVER the composer
      // while they match. Stock semantics: every chain entry receives the SAME
      // owner props and the first entry whose `select()` returns non-null owns
      // the composer — `pendingInteraction` (this pane's Session, from
      // uiSession) is the carrier they all read, so it must ride the props.
      // The stock page renders this chain with the bar as fallback.
      let composer = composerBar;
      const chainOwner = { sessionId, session, pendingInteraction };
      const chainEntries = capturedEntries("conversation.composer");
      // Static slot-level injected props for the chain declaration, plus the
      // entry inject face per elected entry — the stock renderer merges
      // kit -> entry inject -> slot inject -> store -> owner, and entries like
      // ui-user-questions declare their face as an entry inject with
      // `keyedHooks: { questionCard }` (=> `useQuestionCard`). Without the
      // entry inject the elected QuestionFlow throws
      // "useQuestionCard is not a function" and the turn stays pending.
      const chainSlotProps = cachedSlotInject(slotInjectFaceOf("conversation.composer")).props;
      const chainDebug = {
        sessionId,
        entries: chainEntries.length,
        pendingKind: pendingInteraction === null || pendingInteraction === undefined
          ? null
          : String(pendingInteraction.kind ?? pendingInteraction.constructor?.name ?? typeof pendingInteraction),
        elected: null,
        electionError: null,
        store: false,
        inject: false,
      };
      composerChainDebug.last = chainDebug;
      const elected = electComposerChain(chainEntries, chainOwner, chainDebug);
      if (elected !== null) {
        const parts = elected.parts;
        const matched = elected.matched;
        const chainT = entryTranslate(elected.entry);
        // Entry-declared stores ride the SAME per-entry kit share the stock
        // renderer builds (standardKit: useStore + actions). Without it the
        // question composer's QuestionFlow throws "useStore is not a function"
        // and the pane falls back to the plain InputBar — the card never shows.
        const storeProps = entryStoreProps(parts, sessionId, prepared.scopeKey);
        const injectFace = prepared.renderers.entryInjectProps(parts);
        chainDebug.elected = String(parts.options?.id ?? parts.options?.key ?? parts.component?.name ?? "entry");
        chainDebug.store = typeof storeProps.useStore === "function";
        chainDebug.inject = injectFace !== undefined && injectFace !== null && Object.keys(injectFace).length > 0;
        const props = composerChainProps(
          prepared.kit,
          injectFace,
          chainSlotProps,
          storeProps,
          chainOwner,
          matched,
          chainT !== undefined ? chainT : prepared.kit.t,
          prepared.renderers,
        );
        composer = h(PaneBoundary, { fallback: composerBar, slotKey: "conversation.composer" }, h(parts.component, props));
      }
      // TUI mode: a terminal-grade single line. A matching chain entry
      // (question / approval / plan review) still takes precedence over it.
      const composerNode = composer !== composerBar
        ? composer
        : (composerMode === "tui"
          ? (prepared.composer !== null && prepared.composer !== undefined
              ? h(TuiMachineComposer, { prepared, running, toggle: toggleNode, useSession })
              : h(TuiPlainComposer, { sessionId, session, running, toggle: toggleNode, useSession }))
          : composerBar);
      // Last-resort Enter for the re-hosted native editor. Its Enter is run by
      // a keymap registered on the SHARED per-session Lexical editor — the
      // hidden stock page registers the same keymap for the same session, and
      // whoever owns the editor root at that moment decides. Whenever the
      // keymap does not run (root re-pointed behind the pane's back, the
      // registration disposed with the stock composer, a keymap of another
      // generation answering for this editor), Lexical just inserts a
      // paragraph: the draft stays put, nothing is sent, and no toast says so.
      // The stock keymap preventDefaults the key in every branch that consumed
      // it, so a plain Enter that reaches this pane's React tree unconsumed is
      // by definition a dead submit — run it through the pane's own input
      // machine. Gated on a non-empty draft so it can never fire blind, and
      // scoped to the native editor so the TUI line and the fallback card keep
      // their own handlers.
      const onComposerKeyDown = (event) => {
        if (event.key !== "Enter" || event.shiftKey === true || event.altKey === true
            || event.ctrlKey === true || event.metaKey === true) return;
        const native = event.nativeEvent;
        if (native !== undefined && native !== null && (native.isComposing === true || native.keyCode === 229)) return;
        if (event.defaultPrevented === true) return; // the stock keymap owns it
        const target = event.target;
        if (target === null || target === undefined || typeof target.closest !== "function") return;
        const editorEl = target.closest("[data-composer-input]");
        if (editorEl === null) return; // TUI line / fallback card submit themselves
        // Only when the editor's root really is this div. A root that was just
        // re-claimed can lag the visible text, and sending a half-typed draft
        // would be worse than sending nothing — the guard repairs the root and
        // the next Enter works.
        const editor = editorEl.__lexicalEditor;
        if (editor === undefined || editor === null || typeof editor.getRootElement !== "function") return;
        if (editor.getRootElement() !== editorEl) {
          // Orphaned host: repair the ownership and REQUIRE the next Enter. The
          // keystroke that triggered the repair was never in the Lexical model,
          // and the repair rebuilds the DOM from that model — submitting now
          // would send a stale draft.
          const guard = paneEditorGuards.get(sessionId);
          if (guard !== undefined && guard !== null && typeof guard.repair === "function") {
            try { guard.repair(); } catch {}
          }
          return;
        }
        if (composer !== composerBar) return; // a question / approval card owns the composer
        const machine = prepared.composer;
        if (machine === null || machine === undefined) return;
        const snapshot = typeof machine.readInput === "function" ? machine.readInput() : null;
        const draft = snapshot !== null && snapshot !== undefined && typeof snapshot.draft === "string" ? snapshot.draft : "";
        if (draft.trim() === "") return;
        event.preventDefault();
        try { machine.inputActions.submit(); } catch {}
      };
      // ---- hero row: the agent-preset ("模式") chooser --------------------
      // The agent-preset seat lives in ConversationRoot's hero row
      // (`heroWorkspaceRow`, ui-conversation), and a pane NEVER renders that
      // component: a pane hosts the chat VIEW (ui-chat's transcript), the
      // composer bar and the session header — not the ConversationRoot that owns
      // the hero. On a blank session the stock page therefore offers
      // "标准模式 / PTC 模式 / Creator 模式 / 极简模式" next to the workspace
      // chip while every pane offered nothing, and this seat is the ONLY
      // chooser that exists (the header label is read-only — its own hint reads
      // "本会话运行的 Agent 预设，开始时即固定"), so split view could never
      // start a session in a non-default preset.
      //
      // `blank`/`awaitingFirstTurn`/`promptAttempted`/`running` are the SAME
      // session-face fields ui-conversation folds into `conversationPhase()`:
      //   phase === "blank"  ⟺  (blank || awaitingFirstTurn) && !running &&
      //                          !promptAttempted   (&& activeTargets.size === 0)
      // and the stock hero shows while `shellPhase === "blank"`. The sessions
      // LIST entry's own `blank` field is NOT usable here — it reads true for
      // long-lived conversations too, which put a preset chooser on panes whose
      // stock page shows no hero at all.
      const heroBlank = session !== undefined && session !== null
        && (session.blank === true || session.awaitingFirstTurn === true)
        && session.running !== true
        && session.promptAttempted !== true;
      const heroSeat = heroBlank
        ? prepared.renderers.renderSlot("conversation.hero.agentPreset", {}, undefined)
        : null;
      const heroRow = heroSeat !== null && heroSeat !== undefined
        ? h("div", { className: "dsv-hero-row", "data-dsv-hero": "" }, heroSeat)
        : null;
      return h(
        "div",
        { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }, onKeyDown: onComposerKeyDown },
        // Root-hook probe: subscribes this pane's session to the harvested
        // `useSessionStatus` and publishes the pending interaction for the
        // composer chain above. A separate component so ChatPane's own hook
        // list never changes when the root source appears/disappears.
        useSessionStatus !== null ? h(RootPendingProbe, { useSessionStatus, sessionId }) : null,
        header,
        transcript,
        heroRow,
        composerNode,
      );
    }

    // ---------------------------------------------------------------------
    // pane frame with drop zones
    // ---------------------------------------------------------------------

    /** True while an OS file/image drag hovers the pane (Explorer, browser
        drags). Session drags ride text/plain instead. */
    function isFileDrag(event) {
      const types = event.dataTransfer !== undefined && event.dataTransfer !== null ? event.dataTransfer.types : null;
      if (types === null || types === undefined) return false;
      try {
        for (let i = 0; i < types.length; i++) {
          if (types[i] === "Files") return true;
        }
      } catch {}
      return false;
    }

    /** Image files out of a DataTransfer / clipboard payload. */
    function imageFilesOf(data) {
      if (data === null || data === undefined || data.files === undefined || data.files === null) return [];
      return Array.from(data.files).filter((file) => file !== null && file !== undefined && typeof file.type === "string" && file.type.startsWith("image/"));
    }

    function zoneFor(rect, x, y) {
      const w = rect.width;
      const hh = rect.height;
      const dx = x - rect.left;
      const dy = y - rect.top;
      const edge = Math.max(48, Math.min(w, hh) * 0.28);
      const left = dx < edge;
      const right = dx > w - edge;
      const top = dy < edge;
      const bottom = dy > hh - edge;
      if (left && !right) return { dir: "h", side: "before", label: "dropSplitLeft", zone: { dir: "h", side: "before" } };
      if (right && !left) return { dir: "h", side: "after", label: "dropSplitRight", zone: { dir: "h", side: "after" } };
      if (top && !bottom) return { dir: "v", side: "before", label: "dropSplitTop", zone: { dir: "v", side: "before" } };
      if (bottom && !top) return { dir: "v", side: "after", label: "dropSplitBottom", zone: { dir: "v", side: "after" } };
      return { dir: null, side: null, label: "dropMove", zone: null };
    }

    function ghostStyle(zone) {
      if (zone === null || zone.dir === null) return { left: 4, top: 4, right: 4, bottom: 4 };
      if (zone.dir === "h") {
        return zone.side === "before" ? { left: 4, top: 4, bottom: 4, width: "50%" } : { right: 4, top: 4, bottom: 4, width: "50%" };
      }
      return zone.side === "before" ? { top: 4, left: 4, right: 4, height: "50%" } : { bottom: 4, left: 4, right: 4, height: "50%" };
    }

    function PaneFrame({ sessionId, session, summary, focused, chrome, onFocus, onClose, pickerFor }) {
      const runtime = useRuntime();
      const maximized = runtime.maximized === sessionId;
      const [renaming, setRenaming] = React.useState(false);
      const [renameDraft, setRenameDraft] = React.useState("");
      const [zone, setZone] = React.useState(null);
      const [invalidDrop, setInvalidDrop] = React.useState(false);
      const frameRef = React.useRef(null);
      const running = summary ? summary.running === true : false;
      const title = summary ? summary.displayTitle || summary.title || sessionId : sessionId;
      const cwd = summary ? basenameOf(summary.cwd) : "";
      const sessions = useSessionsList();
      // pane geometry: narrow panes get the slim header; short panes
      // (vertically split) default to the TUI composer. Hysteresis keeps the
      // composer mode from flip-flopping while a divider is dragged.
      const [paneSize, setPaneSize] = React.useState({ w: 0, h: 0 });
      const shortRef = React.useRef(false);
      React.useEffect(() => {
        const el = frameRef.current;
        if (el === null || typeof ResizeObserver !== "function") return;
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = Math.round(entry.contentRect.width);
            const h = Math.round(entry.contentRect.height);
            shortRef.current = h < 280 ? true : h > 340 ? false : shortRef.current;
            setPaneSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
          }
        });
        observer.observe(el);
        return () => observer.disconnect();
      }, []);
      const narrow = paneSize.w > 0 && paneSize.w < 560;
      // Below this width the six header actions no longer fit: collapse them
      // into one ⋯ button that opens a menu. The title keeps the row.
      const compactHeader = paneSize.w > 0 && paneSize.w < 320;
      const [menuOpen, setMenuOpen] = React.useState(false);
      React.useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = (event) => {
          const target = event.target;
          if (target !== null && target !== undefined && typeof target.closest === "function"
              && target.closest(".dsv-pane-menu, .dsv-pane-menu-btn") !== null) return;
          setMenuOpen(false);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [menuOpen]);
      React.useEffect(() => {
        if (!compactHeader) setMenuOpen(false);
      }, [compactHeader]);
      const shortPane = paneSize.h === 0 ? false : shortRef.current;
      // explicit mode lives in the module store so the Alt+T chord can
      // toggle the focused pane from the window keydown path; subscribing
      // re-renders this pane only when some pane's mode changes
      const [, bumpModeVersion] = React.useState(0);
      React.useEffect(() => composerModeStore.subscribe(() => bumpModeVersion((v) => v + 1)), []);
      const explicitMode = composerModeStore.getExplicit(sessionId);
      const composerMode = explicitMode !== null ? explicitMode : (shortPane ? "tui" : "full");
      composerModeStore.registerEffective(sessionId, composerMode);
      const toggleComposerMode = () => composerModeStore.toggle(sessionId);
      // the pinned toggle's right edge AND the dock text area both track the
      // LIVE chat box (composer card / TUI line) — measured from the DOM
      // rather than assumed from pane width, so both stay glued to the
      // input's real geometry whatever the bar resolves to. The box rides
      // the pane as CSS vars so deep children (dock row) inherit it.
      const [cardBox, setCardBox] = React.useState(null);
      // the composer card's own typography, mirrored onto the TUI line so
      // Alt+T swaps the input without changing the reader's type scale. The
      // stock card sets font-size/line-height from --dsh-content-font-*; the
      // bare pane is 16px/normal by inheritance, which made the terminal line
      // visibly larger and off the chat's baseline. Held in a ref as well:
      // in TUI mode the native card is unmounted, so the last measured values
      // must survive the swap.
      const [cardFont, setCardFont] = React.useState(null);
      const cardFontRef = React.useRef(null);
      const learnedFull = React.useRef(false);
      // frame width the learned box belongs to — a box measured for another
      // frame width cannot be reused (see the invalidation in measure())
      const learnedAtWidth = React.useRef(-1);
      React.useEffect(() => {
        const frame = frameRef.current;
        if (frame === null || typeof ResizeObserver !== "function") return;
        // TUI mode mounts no native card to measure (the learned box survives
        // in refs across this effect's re-runs), so install no observers at
        // all: streaming commits would otherwise schedule a full measure pass
        // on every token batch for nothing.
        if (composerMode === "tui") return;
        let raf = 0;
        let lastMeasureAt = 0;
        const measure = () => {
          // Visibility + rate gates FIRST: this observer fires on every React
          // commit while a pane streams. A hidden window has nothing to measure,
          // and passes are capped to ~12/s per pane so a streaming burst cannot
          // turn layout reads into per-commit work (S4).
          if (typeof document.visibilityState === "string" && document.visibilityState === "hidden") return;
          const now = Date.now();
          if (now - lastMeasureAt < 80) return;
          lastMeasureAt = now;
          // Cheap gate FIRST: no composer card markers in the frame at all
          // (takeover cards, transient unmounts) → nothing to re-mark or
          // measure, and no forced layout below. This observer fires on every
          // React commit while a pane streams, so the single querySelector
          // here is the only steady-state cost.
          if (frame.querySelector("[data-composer-card], [data-dsv-composer-card]") === null) return;
          // pick the widest VISIBLE composer box: transient or hidden seats
          // can precede the real card in document order with a zero rect,
          // and a stale mount-time measure never self-corrects on a quiet
          // pane — so re-derive from live DOM on every trigger
          // The pane's card carries BOTH markers. The rename used to REMOVE
          // `data-composer-card`, to opt panes out of the vision toolkit's
          // document-level paste hijack — but that hijack also requires the
          // paste target to be an HTMLTextAreaElement, and the 0.1.5 composer
          // is a Lexical contenteditable, so the opt-out stopped protecting
          // anything while the missing attribute kept silently breaking every
          // core consumer that keys on it:
          //   - input-trigger's `closest("[data-composer-card]")` keep-open
          //     guard went falsy, so any pointerdown inside a pane's own
          //     composer closed its / or @ menu;
          //   - the model-selector and message-feedback toasts lost their card
          //     anchor and fell back to the default placement.
          // Publishing the original marker as well restores every consumer
          // that resolves the card from a node INSIDE the pane (nearest
          // ancestor), and consumers that learned the renamed one keep
          // working. A consumer that still does a document-wide
          // `querySelector("[data-composer-card]")` keeps picking the stock
          // page's card, because that one comes first in document order — that
          // is a core-side defect this plugin cannot fix from here.
          for (const node of frame.querySelectorAll("[data-composer-card]")) {
            node.setAttribute("data-dsv-composer-card", "");
          }
          // ONE geometry source: the real full-mode card (must contain the
          // live editor). dsh 0.1.5 renders that editor as a Lexical
          // contenteditable (`[data-composer-input]`) — the stock InputBar
          // only falls back to a <textarea> — so a textarea-only probe never
          // finds the card, `--dsv-card-w` stays unset, and every derived
          // width (queue strip, dock row, TUI line) falls back to full pane
          // width. Once learned, the TUI line never overwrites it — the TUI
          // line lives in a different container, so measuring it would move
          // the toggle on every Alt+T. The learned box is also published as
          // CSS vars for the TUI line and the dock row.
          const hasEditor = (node) => node.querySelector("textarea") !== null || node.querySelector("[data-composer-input]") !== null;
          let best = null;
          let bestNode = null;
          const nodes = frame.querySelectorAll("[data-dsv-composer-card]");
          for (const node of nodes) {
            if (!hasEditor(node)) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width < 80 || rect.height < 12) continue;
            if (best === null || rect.width > best.width) {
              best = rect;
              bestNode = node;
            }
          }
          // The frame's own width keys the learned box: a box measured at a
          // different width cannot be reused (the invalidation below).
          const frameWidth = Math.round(frame.getBoundingClientRect().width);
          if (best !== null) {
            learnedFull.current = true;
            learnedAtWidth.current = frameWidth;
            // mirror the card's OWN typography (the stock card declares
            // font-size: var(--dsh-content-font-size) and the matching line
            // height); a bare pane would otherwise hand the TUI line 16px
            const cardStyle = window.getComputedStyle(bestNode);
            const fontSize = cardStyle.fontSize !== "" ? cardStyle.fontSize : "14px";
            const lineHeight = cardStyle.lineHeight !== "" && cardStyle.lineHeight !== "normal" ? cardStyle.lineHeight : "24px";
            const font = { fontSize, lineHeight };
            const previousFont = cardFontRef.current;
            if (previousFont === null || previousFont.fontSize !== font.fontSize || previousFont.lineHeight !== font.lineHeight) {
              cardFontRef.current = font;
              setCardFont(font);
            }
          } else if (learnedFull.current === true && learnedAtWidth.current === frameWidth) {
            return; // keep the learned full-mode box through TUI sessions
          } else {
            // No full-mode card to measure. The TUI line's own box is NOT a
            // substitute: `.dsv-tui-block` is laid out BY the vars this function
            // publishes, so measuring it feeds the published geometry back into
            // itself and freezes whatever the line happened to be at that
            // instant. A short pane mounts straight into TUI (`composerMode`
            // "tui" below the height threshold) and never sees a card, so it
            // baked its own fallback box in as the card box; the same freeze
            // kept a pre-resize box after the frame changed width, leaving the
            // line pinned to the left of a wider/narrower pane while the card
            // above it stayed centred.
            //
            // Drop the box instead (idempotent — React bails out on an equal
            // state): the vars go unpublished and the CSS fallback lays the
            // line out centred at the card's own width. The next full-mode
            // render re-learns the real box.
            learnedFull.current = false;
            learnedAtWidth.current = -1;
            setCardBox(null);
            return;
          }
          if (best === null) return;
          const frameRect = frame.getBoundingClientRect();
          const left = Math.max(0, Math.round(best.left - frameRect.left));
          const right = Math.max(left, Math.round(best.right - frameRect.left));
          const rightDist = Math.max(0, Math.round(frameRect.right - best.right));
          const bottomDist = Math.max(0, Math.round(frameRect.bottom - best.bottom));
          setCardBox((prev) => (prev !== null && prev.left === left && prev.right === right && prev.bottomDist === bottomDist ? prev : { left, right, rightDist, bottomDist }));
        };
        const schedule = () => {
          if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; measure(); });
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(frame);
        const mutation = typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
        if (mutation !== null) mutation.observe(frame, { childList: true, subtree: true });
        schedule();
        return () => {
          if (raf !== 0) cancelAnimationFrame(raf);
          observer.disconnect();
          if (mutation !== null) mutation.disconnect();
        };
      }, [paneSize.w, composerMode]);
      // a composer is never narrower than this — narrower "boxes" are
      // transient seats, not the real input; fall back to stock geometry
      const cardBoxSane = cardBox !== null && cardBox.right - cardBox.left >= 160;
      // ---- composer-mode toggle placement --------------------------------
      // The toggle must never share pixels with the composer's own controls.
      // Its home is the band between the card's bottom edge and the pane's
      // bottom edge (the stock stats row), where it is centred: a 26px button
      // needs 26 + 2px margins = 30px of band. A pane whose composer is FLUSH
      // with its bottom edge — a vertically split pane — has no such band,
      // and clamping `bottom` to 2px anyway parked the 26px button straight
      // on top of the stock send key. Two fallbacks, in order:
      //   gutter — right of the card's right border, i.e. OUTSIDE the card,
      //            so nothing inside the card can be covered (needs 28px);
      //   header — the pane chrome row (⬎ / ⬏ / ✕), which only exists for
      //            split panes. A lone pane (chrome === false) always keeps
      //            the stock stats band, so the header branch implies one.
      const MODE_BTN = 26;
      const MODE_GAP = 2;
      const bandFits = cardBoxSane && cardBox.bottomDist >= MODE_BTN + MODE_GAP * 2;
      const gutterFits = cardBoxSane && cardBox.rightDist >= MODE_BTN + MODE_GAP * 2;
      const tight = cardBoxSane && !bandFits && !gutterFits;
      // Historical corner anchor (2px inset so the toggle reads as attached to
      // the card's right border, centred in the band). Measured layouts put
      // the band at 30-53px, so this stays the normal path; it is also the
      // last resort for a lone pane, which has no header to dock into.
      const cornerRight = cardBoxSane ? Math.max(10, cardBox.rightDist + MODE_GAP) : 18;
      const cornerBottom = cardBoxSane ? Math.max(MODE_GAP, Math.round((cardBox.bottomDist - MODE_BTN) / 2)) : 4;
      // Only the GUTTER case moves the toggle off the historical corner: the
      // header branch renders it in the header instead, the band branch is the
      // corner, and an unmeasured card (cardBoxSane false) keeps the blind
      // corner rather than snapping to the pane's very edge. `tight` already
      // implies !bandFits && !gutterFits, so testing gutterFits alone is exact.
      const modeBtnInHeader = tight && chrome !== false;
      const modeBtnRight = cardBoxSane && gutterFits ? MODE_GAP : cornerRight;
      const modeBtnBottom = cardBoxSane && gutterFits ? MODE_GAP : cornerBottom;
      // in TUI mode the toggle is an INLINE flex child of the TUI line —
      // structural placement can never overlap the send key, and both stay
      // in the same band at the same size
      const modeBtnNode = chrome !== false ? h("button", {
        type: "button",
        className: "dsv-mode-btn inline",
        title: "TUI composer (Alt+T)",
        "aria-label": "TUI composer (Alt+T)",
        onMouseDown: (event) => event.stopPropagation(),
        onClick: (event) => {
          event.stopPropagation();
          toggleComposerMode();
        },
      }, h(ComposerModeIcon, { tui: composerMode === "tui" })) : null;

      const knownId = (id) => {
        if (typeof id !== "string" || id === "") return false;
        if (sessions !== null && sessions !== undefined && Array.isArray(sessions.ids)) return sessions.ids.indexOf(id) !== -1;
        return false;
      };
      const externalSessionDrag = (event) => {
        if (dragPayload !== null) return false;
        // Only drags that PROVABLY carry a sidebar conversation are claimed:
        // the plugin's dragstart capture (registerDragBridge) stamps
        // MIME_SESSION on the stock row drag. Plain text/plain drags (selected
        // chat text, links, text from another app) are never preventDefault'ed —
        // the old over-broad text/plain claim swallowed stock drops (S6).
        const types = event.dataTransfer ? event.dataTransfer.types : null;
        if (types === null || types === undefined) return false;
        try {
          return Array.prototype.indexOf.call(types, MIME_SESSION) !== -1;
        } catch {
          return false;
        }
      };

      const onDragOver = (event) => {
        if (dragPayload === null && isFileDrag(event)) {
          // image/file drags belong to the composer pipeline, not pane splitting
          event.preventDefault();
          try { event.dataTransfer.dropEffect = "copy"; } catch {}
          return;
        }
        const sourceId = dragPayload !== null ? dragPayload.id : externalDragSessionId;
        // A pane can never hold the same conversation twice. An internal pane
        // drag over its own frame, and any sidebar drag of a conversation that
        // is already a pane, get a red refusal wash instead of a drop zone. We
        // deliberately skip preventDefault so the browser reports "no drop".
        const refused = sourceId !== null && sourceId !== undefined && sourceId !== ""
          && (sourceId === sessionId || (dragPayload === null && treeStore.leafIds().indexOf(sourceId) !== -1));
        if (refused) {
          setZone((current) => (current === null ? current : null));
          setInvalidDrop(true);
          return;
        }
        if (dragPayload === null && !externalSessionDrag(event)) return;
        setInvalidDrop(false);
        event.preventDefault();
        try {
          event.dataTransfer.dropEffect = "move";
        } catch {}
        const rect = frameRef.current === null ? null : frameRef.current.getBoundingClientRect();
        if (rect === null) return;
        const next = zoneFor(rect, event.clientX, event.clientY);
        setZone((current) => (current === null || current.label !== next.label ? next : current));
      };
      const onDragLeave = (event) => {
        if (frameRef.current !== null && event.relatedTarget instanceof Node && frameRef.current.contains(event.relatedTarget)) return;
        setZone((current) => (current === null ? current : null));
        setInvalidDrop(false);
      };
      const onDrop = (event) => {
        setZone(null);
        setInvalidDrop(false);
        if (dragPayload === null && isFileDrag(event)) {
          event.preventDefault();
          event.stopPropagation();
          const files = imageFilesOf(event.dataTransfer);
          const intake = paneImageIntake.get(sessionId);
          if (intake !== undefined && files.length > 0) intake(files);
          // the re-hosted attachment seats listen on document for their
          // overlay reset — a pane drop never reaches them, so release the
          // overlay here through the window "dragend" reset they also watch
          try { window.dispatchEvent(new Event("dragend")); } catch {}
          return;
        }
        const payload = dragPayload;
        dragPayload = null;
        if (payload !== null) {
          event.preventDefault();
          event.stopPropagation();
          const rect = frameRef.current === null ? null : frameRef.current.getBoundingClientRect();
          const hit = rect === null ? { zone: null } : zoneFor(rect, event.clientX, event.clientY);
          if (payload.kind === "pane" && payload.id === sessionId) return;
          if (hit.zone === null) {
            if (payload.kind === "pane") treeStore.movePane(payload.id, sessionId, { dir: "h", side: "after" });
            else treeStore.addPane(payload.id);
            return;
          }
          if (payload.kind === "pane") treeStore.movePane(payload.id, sessionId, hit.zone);
          else treeStore.splitLeaf(sessionId, hit.zone.dir, payload.id, hit.zone.side);
          return;
        }
        // External drop from the native sidebar rows. 1.6.0: the plugin's
        // dragstart capture stamps MIME_SESSION on the stock row drag; the id is
        // read from that MIME first. A plain-text fallback is kept for host
        // compositions where dragstart data is unavailable — but only when the
        // dropped text names a conversation the sidebar actually shows, so an
        // arbitrary text drop is never hijacked.
        let mimeId = "";
        let plainId = "";
        try {
          if (event.dataTransfer) {
            mimeId = event.dataTransfer.getData(MIME_SESSION) || "";
            plainId = event.dataTransfer.getData("text/plain") || "";
          }
        } catch {
          mimeId = "";
          plainId = "";
        }
        const extId = (mimeId || plainId).trim();
        const viaMime = mimeId !== "";
        if (extId === "" || extId === sessionId) return;
        if (!isValidSessionId(extId)) return;
        if (!viaMime && !knownId(extId)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = frameRef.current === null ? null : frameRef.current.getBoundingClientRect();
        const hit = rect === null ? { zone: null } : zoneFor(rect, event.clientX, event.clientY);
        if (hit.zone === null) treeStore.addPane(extId);
        else treeStore.splitLeaf(sessionId, hit.zone.dir, extId, hit.zone.side);
      };

      // Shared action handlers: the full header renders them as icon buttons,
      // the compact header renders the same actions in a ⋯ menu.
      const doMaximize = () => setRuntime({ maximized: maximized ? null : sessionId });
      const doCopy = () => {
        const text = "会话 id：" + sessionId + "\n会话标题：" + (title || "");
        try {
          navigator.clipboard.writeText(text).then(
            () => showPaneToast(t("copied")),
            () => showPaneToast(t("copyFailed")),
          );
        } catch { showPaneToast(t("copyFailed")); }
      };
      const doHelp = () => openHelp();
      const doSplit = (dir, anchor) => pickerFor(sessionId, dir, anchor);
      const doClose = () => onClose(sessionId);
      const actionButton = (key, label, glyph, onClick) => h("button", {
        key,
        type: "button",
        className: "dsv-pane-btn" + (key === "close" ? " dsv-pane-btn-close" : ""),
        title: label,
        "aria-label": label,
        onClick: (event) => {
          event.stopPropagation();
          onClick(event);
        },
      }, glyph);
      const actionButtons = [
        actionButton("maximize", maximized ? t("restore") : t("maximize"), maximized ? "⤡" : "⤢", doMaximize),
        actionButton("copy", t("copy"), "⧉", doCopy),
        actionButton("help", t("helpOpen"), "?", doHelp),
        actionButton("splitRight", t("splitRight"), h(SplitIconV, { size: 15 }), (event) => doSplit("h", event.currentTarget)),
        actionButton("splitDown", t("splitDown"), h(SplitIconH, { size: 15 }), (event) => doSplit("v", event.currentTarget)),
        actionButton("close", t("closePane"), h(CloseIcon, { size: 14 }), doClose),
      ];
      const menuItem = (key, label, onClick, danger) => h("button", {
        key,
        type: "button",
        className: "dsv-pane-menu-item" + (danger === true ? " danger" : ""),
        onClick: (event) => {
          event.stopPropagation();
          onClick(event);
        },
      }, label);

      const startHeaderDrag = (event) => {
        const target = event.target;
        if (target !== null && target !== undefined && typeof target.closest === "function"
            && target.closest("button,input") !== null) {
          event.preventDefault();
          return;
        }
        dragPayload = { kind: "pane", id: sessionId };
        beginDragPreview(title, t("dragHintPane"), frameRef.current, { w: paneSize.w, h: paneSize.h });
        // Live reflow: from the first dragover on, the pane's slot closes and
        // a hole opens at the destination (see beginPaneReflow).
        beginPaneReflow(sessionId, frameRef.current);
        try {
          event.dataTransfer.setData(MIME_PANE, sessionId);
          event.dataTransfer.setData("text/plain", sessionId);
          event.dataTransfer.effectAllowed = "move";
          const blank = transparentDragImage();
          if (blank !== null) event.dataTransfer.setDragImage(blank, 0, 0);
        } catch {}
      };
      const endHeaderDrag = () => {
        dragPayload = null;
        setZone(null);
        setInvalidDrop(false);
        endDragPreview();
        finishPaneReflowGesture();
      };
      // A drop outside this pane (or a cancelled drag) never reaches the pane's
      // own onDrop, so clear the refusal wash from the document lifecycle too.
      React.useEffect(() => {
        const reset = () => setInvalidDrop(false);
        document.addEventListener("dragend", reset, true);
        document.addEventListener("drop", reset, true);
        return () => {
          document.removeEventListener("dragend", reset, true);
          document.removeEventListener("drop", reset, true);
        };
      }, []);

      return h(
        "div",
        {
          ref: frameRef,
          className: "dsv-pane" + (focused ? " focused" : "") + (chrome !== false ? "" : " bare")
            + (compactHeader ? " dsv-compact" : ""),
          "data-dsv-pane": sessionId,
          style: cardBoxSane ? {
            "--dsv-card-w": (cardBox.right - cardBox.left) + "px",
            "--dsv-card-left": cardBox.left + "px",
            "--dsv-card-right-inset": cardBox.rightDist + "px",
            "--dsv-card-bottom-inset": cardBox.bottomDist + "px",
            // the TUI line reads these so Alt+T keeps the composer's type scale
            "--dsv-composer-font-size": (cardFont !== null ? cardFont.fontSize : "var(--dsh-content-font-size, 14px)"),
            "--dsv-composer-line-height": (cardFont !== null ? cardFont.lineHeight : "calc(24px + var(--dsh-content-font-delta, 0px))"),
          } : (cardFont !== null ? {
            "--dsv-composer-font-size": cardFont.fontSize,
            "--dsv-composer-line-height": cardFont.lineHeight,
          } : undefined),
          onMouseDown: () => onFocus(sessionId),
          onDragOver,
          onDragLeave,
          onDrop,
          onPasteCapture: (event) => {
            // ANY clipboard paste carrying images routes into THIS pane's
            // intake — the same path as drag-drop. Image+text pastes land
            // BOTH (text at the caret, images as attachments). When the
            // clipboard carries only text/html (webpage copies), <img src>
            // references are fetched and attached, and the text still lands.
            const data = event.clipboardData;
            if (data === null || data === undefined) return;
            // Pastes landing in the NATIVE editor are the stock InputBar's
            // business: its Lexical keymap routes files through the upload
            // pipeline and text through keyboard.paste, with limits and
            // toasts. Intercepting here would double-handle (or, on the old
            // intake, drop) them — only the TUI / fallback textareas below
            // need this capture-phase intake.
            const target = event.target;
            if (target !== null && target !== undefined && typeof target.closest === "function"
                && (target.closest("[data-composer-input]") !== null
                    || (target.isContentEditable === true && target.closest("[data-dsv-composer-card]") !== null))) {
              return;
            }
            let files = imageFilesOf(data);
            if (files.length === 0 && data.items !== undefined && data.items !== null) {
              const recovered = [];
              for (const item of data.items) {
                if (item.kind !== "file" || typeof item.type !== "string" || !item.type.startsWith("image/")) continue;
                const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
                if (file !== null) recovered.push(file);
              }
              files = recovered;
            }
            const text = typeof data.getData === "function" ? (data.getData("text/plain") || "") : "";
            const intake = paneImageIntake.get(sessionId);
            if (intake === undefined) return; // fallback composer pastes via its own handler
            if (files.length > 0) {
              event.preventDefault();
              event.stopPropagation();
              intake(files, text);
              return;
            }
            let html = "";
            try { html = typeof data.getData === "function" ? (data.getData("text/html") || "") : ""; } catch { html = ""; }
            const srcs = [];
            const re = /<img[^>]*\ssrc="(https?:\/\/[^"]+)"/gi;
            let match;
            while ((match = re.exec(html)) !== null && srcs.length < 8) srcs.push(match[1]);
            if (srcs.length === 0 || text === "") return; // plain text paste: stock path
            // The TEXT half of a rich paste can only land through the editor's
            // own paste (`intake` → shell.paste at the native editor's
            // selection), so it only lands when THIS pane's native editor holds
            // the caret. In TUI mode — which short panes switch to
            // automatically — that editor is unmounted, and a paste fired with
            // no editable focus has nowhere to go either. preventDefault() here
            // then swallows the whole paste with no trace, which is exactly how
            // a link copied from a web page disappears. Fall through to the
            // browser's own paste whenever we cannot land the text.
            const caret = document.activeElement;
            const paneSel = '.dsv-pane[data-dsv-pane="' + String(sessionId).replace(/"/g, '\\"') + '"]';
            if (caret === null || caret === undefined || typeof caret.closest !== "function"
                || caret.closest(paneSel) === null
                || caret.closest("[data-composer-input]") === null) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            intake([], text); // text lands first
            for (const src of srcs) {
              fetch(src, { mode: "cors" }).then((res) => (res.ok ? res.blob() : null)).then((blob) => {
                if (blob === null || !String(blob.type).startsWith("image/")) return;
                const name = decodeURIComponent(src.split("?")[0].split("/").pop() || "pasted-image");
                const file = new File([blob], name, { type: blob.type || "image/png" });
                const hook = paneImageIntake.get(sessionId);
                if (hook !== undefined) hook([file]);
              }).catch(() => {});
            }
          },
        },
        chrome !== false ? h(
          "div",
          {
            className: "dsv-pane-header", draggable: true, onDragStart: startHeaderDrag, onDragEnd: endHeaderDrag, title,
            onDoubleClick: (event) => {
              const target = event.target;
              if (target !== null && target !== undefined && typeof target.closest === "function"
                  && target.closest("button,input,.dsv-pane-title-text") !== null) return;
              setRuntime({ maximized: maximized ? null : sessionId });
            },
          },
          // Reserved even when idle: the dot used to appear/disappear and
          // shifted the title's left edge by 15px between panes.
          h("span", { className: "dsv-pane-running" + (running ? "" : " idle"), title: running ? t("running") : undefined }),
          renaming
            ? h("input", {
                className: "dsv-pane-title-input",
                value: renameDraft,
                autoFocus: true,
                onChange: (event) => setRenameDraft(event.target.value),
                onClick: (event) => event.stopPropagation(),
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const next = renameDraft.trim();
                    setRenaming(false);
                    if (next && next !== title) renamePaneSession(sessionId, next);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setRenaming(false);
                  }
                },
                onBlur: () => {
                  const next = renameDraft.trim();
                  setRenaming(false);
                  if (next && next !== title) renamePaneSession(sessionId, next);
                },
                "aria-label": t("renameHint"),
              })
            : h("span", { className: "dsv-pane-title" },
                h("span", {
                  className: "dsv-pane-title-text dsv-pane-title-edit",
                  title: t("renameHint"),
                  onClick: (event) => {
                    event.stopPropagation();
                    if (summary !== null && summary !== undefined && summary.blank === true) {
                      showPaneToast(t("renameBlank"));
                      return;
                    }
                    setRenameDraft(title);
                    setRenaming(true);
                  },
                }, title)),
          cwd !== "" && cwd !== title ? h("span", { className: "dsv-pane-cwd" }, cwd) : null,
          h("span", { className: "dsv-pane-header-spacer" }),
          // no band under the card and no gutter beside it: the toggle docks
          // here, where the composer can never reach it. TUI mode renders the
          // toggle inline in its own line, so the header must stay out of it.
          modeBtnInHeader && composerMode !== "tui" ? modeBtnNode : null,
          compactHeader
            ? h("button", {
                type: "button",
                className: "dsv-pane-btn dsv-pane-menu-btn",
                title: t("moreActions"),
                "aria-label": t("moreActions"),
                onClick: (event) => { event.stopPropagation(); setMenuOpen((v) => !v); },
              }, "⋯")
            : actionButtons,
        ) : null,
        h(ChatPane, { sessionId, session, narrow, summary, composerMode, onToggleComposerMode: toggleComposerMode, toggleNode: composerMode === "tui" ? modeBtnNode : null }),
        composerMode !== "tui" && chrome !== false && !modeBtnInHeader ? h("button", {
          type: "button",
          className: "dsv-mode-btn",
          style: { right: modeBtnRight + "px", bottom: modeBtnBottom + "px" },
          title: "TUI composer (Alt+T)",
          "aria-label": "TUI composer (Alt+T)",
          onClick: (event) => {
            event.stopPropagation();
            toggleComposerMode();
          },
        }, h(ComposerModeIcon, { tui: composerMode === "tui" })) : null,
        compactHeader && menuOpen ? h("div", {
          className: "dsv-pane-menu",
          onPointerDown: (event) => event.stopPropagation(),
        },
          menuItem("maximize", maximized ? t("restore") : t("maximize"), () => { setMenuOpen(false); doMaximize(); }),
          menuItem("copy", t("copy"), () => { setMenuOpen(false); doCopy(); }),
          menuItem("help", t("helpOpen"), () => { setMenuOpen(false); doHelp(); }),
          menuItem("splitRight", t("splitRight"), (event) => { doSplit("h", event.currentTarget); setMenuOpen(false); }),
          menuItem("splitDown", t("splitDown"), (event) => { doSplit("v", event.currentTarget); setMenuOpen(false); }),
          menuItem("close", t("closePane"), () => { setMenuOpen(false); doClose(); }, true),
        ) : null,
        zone !== null
          ? h("div", { className: "dsv-drop-ghost", style: ghostStyle(zone) }, h("span", { className: "dsv-drop-label" }, t(zone.label)))
          : null,
        invalidDrop
          ? h("div", { className: "dsv-pane-invalid", "data-dsv-invalid-drop": "true", "aria-hidden": "true" },
              h("div", { className: "dsv-pane-invalid-card" },
                h("span", { className: "dsv-pane-invalid-icon" }, "⊘"),
                h("span", null, t("sameSessionBody"))))
          : null,
      );
    }

    /** Memoized pane frame: the sessions list mutates on every activity tick,
        which used to re-render every pane's re-hosted native components. The
        comparator treats dispatcher closures as stable (they are pure calls
        into module singletons) and compares summaries by displayed fields. */
    function summaryShallowEqual(a, b) {
      if (a === b) return true;
      if (a === undefined || a === null || b === undefined || b === null) return a === b;
      return a.running === b.running
        && (a.displayTitle !== undefined ? a.displayTitle : a.title) === (b.displayTitle !== undefined ? b.displayTitle : b.title)
        && a.cwd === b.cwd;
    }
    const PaneFrameMemo = React.memo(
      PaneFrame,
      (a, b) => a.sessionId === b.sessionId
        && a.session === b.session
        && a.focused === b.focused
        && a.chrome === b.chrome
        && summaryShallowEqual(a.summary, b.summary),
    );

    // ---------------------------------------------------------------------
    // canvas: recursive split rendering + dividers
    // ---------------------------------------------------------------------

    function childStyle(sizes, index, count, dir) {
      const ratio = sizes && sizes[index] ? sizes[index] : 1 / count;
      const gaps = GAP * (count - 1);
      const basis = "calc(" + (ratio * 100).toFixed(4) + "% - " + (gaps / count).toFixed(4) + "px)";
      return dir === "h" ? { width: basis, height: "100%" } : { height: basis, width: "100%" };
    }

    function RenderLeaf({ id, chrome, generation }) {
      const state = useTree();
      const sessions = useSessionsList();
      const liveSummary = sessions !== null && sessions !== undefined && sessions.byId !== undefined ? sessions.byId[id] : undefined;
      if (liveSummary !== undefined && liveSummary !== null) rememberSessionSummary(id, liveSummary);
      // Sticky: the scraped sidebar is advisory (see useSessionFace). A live
      // pane whose row is filtered/collapsed out keeps its title instead of
      // flipping to "Session ended"/bare-id.
      const summary = liveSummary !== undefined && liveSummary !== null ? liveSummary : lastSessionSummaries.get(id);
      // Retained on demand and re-resolved when the binding appears: a pane
      // added for a session nobody holds has no face on the first render
      // (0.2.0 borrows bindings, it does not create them).
      const session = useSessionFace(id);
      return h(PaneShellBoundary, { sessionId: id, resetKey: generation }, h(PaneFrameMemo, {
        sessionId: id,
        session,
        summary,
        // A lone pane renders without the pane header, so a single
        // conversation looks exactly like the stock view.
        chrome: chrome !== false,
        focused: state.focus === id,
        onFocus: (sid) => treeStore.setFocus(sid),
        // Teardown is NOT done here any more: treeStore.commit schedules the
        // departed leaf for disposal and ChatPane releases on unmount, so every
        // leaf-mutation path (✕, sidebar swap, closeFocused, movePane) is
        // covered by the same idempotent path.
        onClose: (sid) => closePaneAnimated(sid),
        pickerFor: (...args) => togglePicker(...args),
      }));
    }

    function RenderSplit({ node, generation }) {
      const kids = Array.isArray(node.kids) ? node.kids : [];
      const dir = node.dir === "v" ? "v" : "h";
      const count = Math.max(1, kids.length);
      const elements = [];
      kids.forEach((kid, index) => {
        const style = childStyle(node.sizes, index, count, dir);
        // The generation is part of the key: a root-standard generation change
        // remounts every pane ONCE, which lets their unmount effects dispose the
        // dead generation's guards/references instead of swapping face
        // identities underneath live panes (the prepareNative storm path).
        if (kid.t === "leaf") {
          elements.push(
            h("div", { key: kid.id + ":" + generation, style, className: "dsv-pane-wrap", "data-dsv-leaf": kid.id },
              h(RenderLeaf, { id: kid.id, chrome: true, generation })),
          );
        } else {
          elements.push(
            h("div", { key: (kid.sid || "s" + index) + ":" + generation, style, className: "dsv-split-wrap" },
              h(RenderSplit, { node: kid, generation })),
          );
        }
        if (index < count - 1) elements.push(h(Divider, { key: "d" + index + "-" + node.sid, dir, node, index }));
      });
      return h("div", { className: "dsv-split", "data-dir": dir }, elements);
    }

    function Divider({ dir, node, index }) {
      const [active, setActive] = React.useState(false);
      const dragRef = React.useRef(null);
      const onPointerDown = (event) => {
        event.preventDefault();
        const parent = event.currentTarget.parentElement;
        if (parent === null) return;
        const rect = parent.getBoundingClientRect();
        const total = (dir === "h" ? rect.width : rect.height) - GAP * (Math.max(1, node.kids.length) - 1);
        const kidCount = Math.max(1, node.kids.length);
        const evenRatio = 1 / kidCount;
        dragRef.current = {
          pointerId: event.pointerId,
          start: dir === "h" ? event.clientX : event.clientY,
          total: Math.max(1, total),
          ratios: Array.isArray(node.sizes) && node.sizes.length === node.kids.length
            ? node.sizes.slice()
            : node.kids.map(() => evenRatio),
          index,
          min: Math.max(0.04, MIN_PANE_PX / Math.max(1, total)),
        };
        setActive(true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
      };
      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const delta = (dir === "h" ? event.clientX : event.clientY) - drag.start;
        const ratios = drag.ratios.slice();
        const a = drag.index;
        const b = drag.index + 1;
        const pair = ratios[a] + ratios[b];
        ratios[a] = Math.min(pair - drag.min, Math.max(drag.min, drag.ratios[a] + delta / drag.total));
        ratios[b] = pair - ratios[a];
        treeStore.setSizes(node.sid, ratios);
      };
      const finish = (event) => {
        if (dragRef.current === null || dragRef.current.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setActive(false);
        treeStore.persistNow();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      };
      return h("div", {
        className: "dsv-divider" + (active ? " active" : ""),
        onPointerDown,
        onPointerMove,
        onPointerUp: finish,
        onPointerCancel: finish,
        role: "separator",
        "aria-orientation": dir === "h" ? "vertical" : "horizontal",
      });
    }

    function addCurrentSession() {
      const id = currentSessionId();
      if (id === undefined || id === null) return;
      // A pane never needs a "complete" kit any more: it re-hosts the stock
      // transcript when the session faces are up and its own renderers when
      // they are not (see sessionFacesReady). Only a genuinely unresolvable
      // session is refused.
      if (!paneKitTrustworthy(id)) warnPaneKitUnavailable(id);
      try {
        treeStore.addPane(id);
      } catch {}
    }

    function Canvas({ generation }) {
      const state = useTree();
      useRuntime();
      if (state.root === null) {
        return h(
          "div",
          { className: "dsv-empty" },
          h(SplitIconV, { size: 34 }),
          h("div", { className: "dsv-empty-title" }, t("emptyTitle")),
          h("div", { className: "dsv-empty-hint" }, t("emptyHint")),
          h("button", { type: "button", className: "dsv-empty-btn", onClick: addCurrentSession },
            h(PrimIcon, { prim: "IconPlusOutline16" }), t("addCurrent")),
        );
      }
      const maximized = runtimeState.maximized;
      if (maximized !== null && findLeafNode(state.root, maximized) !== null) {
        return h(
          "div",
          { className: "dsv-canvas" },
          h("div", { className: "dsv-pane-wrap", "data-dsv-leaf": maximized, style: { flex: 1, display: "flex", minWidth: 0, minHeight: 0 } },
            h(RenderLeaf, { id: maximized, chrome: true, generation })),
        );
      }
      return h(
        "div",
        { className: "dsv-canvas" },
        state.root.t === "leaf"
          ? h("div", { className: "dsv-pane-wrap", "data-dsv-leaf": state.root.id, style: { flex: 1, display: "flex", minWidth: 0, minHeight: 0 } },
              h(RenderLeaf, { id: state.root.id, chrome: false, generation }))
          : h(RenderSplit, { node: state.root, generation }),
      );
    }

    // ---------------------------------------------------------------------
    // rail + session picker
    // ---------------------------------------------------------------------

    let pickerRequest = null;
    const pickerListeners = new Set();
    function openPicker(leafId, dir, anchorEl) {
      const rect = anchorEl !== null && anchorEl !== undefined && typeof anchorEl.getBoundingClientRect === "function"
        ? anchorEl.getBoundingClientRect()
        : { left: window.innerWidth / 2 - 130, bottom: window.innerHeight / 2 };
      pickerRequest = { leafId, dir, rect };
      for (const fn of [...pickerListeners]) fn();
    }
    function closePicker() {
      pickerRequest = null;
      for (const fn of [...pickerListeners]) fn();
    }
    /** Split buttons toggle: same leaf + direction while open closes. */
    function togglePicker(leafId, dir, anchorEl) {
      if (pickerRequest !== null && pickerRequest.leafId === leafId && pickerRequest.dir === dir) closePicker();
      else openPicker(leafId, dir, anchorEl);
    }

    function SessionPicker({ request, onPick }) {
      const sessions = useSessionsList();
      const tree = useTree();
      const [query, setQuery] = React.useState("");
      const req = request;
      if (req === null || req === undefined) return null;
      const style = {
        position: "fixed",
        zIndex: 80,
        left: Math.min(req.rect.left, window.innerWidth - 284),
        top: Math.min(req.rect.bottom + 6, window.innerHeight - 330),
        width: 268,
        maxHeight: 314,
        overflowY: "auto",
        background: "var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 14,
        boxShadow: "var(--dsw-shadow-lv2, 0 8px 30px rgba(0,0,0,.16))",
        padding: 6,
      };
      const items = [];
      // Sessions already occupying a pane are not split candidates: the tree
      // must never hold one conversation twice. Blank (never-used) sessions and
      // subagent transcripts are not renderable pane conversations either.
      const openIds = tree === null || tree === undefined || tree.root === null ? [] : leafOf(tree.root, []);
      if (sessions !== null && sessions !== undefined && Array.isArray(sessions.ids)) {
        const q = query.trim().toLowerCase();
        for (const id of sessions.ids) {
          const summary = sessions.byId ? sessions.byId[id] : undefined;
          if (summary === undefined || summary.parentId !== undefined) continue;
          if (summary.origin === "subagent" || summary.blank === true) continue;
          // IM / channel sessions (`im:…`) are not standard conversations: the
          // split pane re-hosts a conversation body and they cannot supply one.
          if (id.indexOf("session-") !== 0) continue;
          if (openIds.indexOf(id) !== -1) continue;
          const title = summary.displayTitle || summary.title || id;
          if (q !== "" && !title.toLowerCase().includes(q)) continue;
          items.push({ id, summary, title });
        }
        // Same ordering as the stock conversation list: most recently updated
        // first. Sorting from the live snapshot keeps it live — the sessions
        // store emits on every activity mutation, so this re-renders and
        // re-sorts while the picker is open.
        items.sort((a, b) => (Number(b.summary.updatedAt) || 0) - (Number(a.summary.updatedAt) || 0));
      }
      return h(
        "div",
        {
          className: "dsv-picker",
          style,
          onKeyDown: (event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closePicker();
            }
          },
        },
        h("input", {
          className: "dsv-rail-search",
          style: { margin: "2px 2px 6px", width: "calc(100% - 4px)" },
          autoFocus: true,
          type: "search",
          placeholder: t("railSearch"),
          value: query,
          onChange: (event) => setQuery(event.target.value),
        }),
        items.map(({ id, summary, title }) =>
          h(
            "button",
            {
              key: id,
              type: "button",
              className: "dsv-rail-item",
              onClick: () => {
                onPick(id);
                closePicker();
              },
            },
            h("span", { className: "dsv-rail-dot" + (summary.running ? " running" : "") }),
            h(
              "span",
              { className: "dsv-rail-item-text" },
              h("span", { className: "dsv-rail-item-title" }, title),
              summary.cwd !== undefined ? h("span", { className: "dsv-rail-item-sub" }, basenameOf(summary.cwd)) : null,
            ),
          ),
        ),
        items.length === 0 ? h("div", { className: "dsv-picker-empty" }, t("pickerEmpty")) : null,
      );
    }

    // ---------------------------------------------------------------------
    // focus resolution + keyboard navigation (Esc-to-chat bridge, Alt+Shift+
    // arrows pane navigation) — consumed here and by dsh-session-hotkeys
    // ---------------------------------------------------------------------

    /** The session whose pane should currently count as focused: the explicit
        focus when valid, else the last session typed into, else the first
        pane. The resolved id is committed back so the glow follows. */
    function resolveFocusedSessionId() {
      const ids = treeStore.leafIds();
      if (ids.length === 0) return null;
      const state = treeStore.getSnapshot();
      if (state.focus !== null && state.focus !== undefined && ids.includes(state.focus)) return state.focus;
      if (lastTypedSessionId !== null && lastTypedSessionId !== undefined && ids.includes(lastTypedSessionId)) {
        treeStore.setFocus(lastTypedSessionId);
        return lastTypedSessionId;
      }
      treeStore.setFocus(ids[0]);
      return ids[0];
    }

    /** Focus the chat transcript scroller of one pane. ChatView's scroller is
        CSS-module hashed (no stable attribute), so after trying the stock
        markers we pick the pane's dominant scrollable geometrically. */
    function focusPaneScroller(sessionId) {
      const pane = document.querySelector('.dsv-pane[data-dsv-pane="' + String(sessionId).replace(/"/g, '\\"') + '"]');
      if (pane === null) return false;
      let scroller = pane.querySelector("[data-conversation-scroll], [data-chat-scroll]");
      if (scroller === null) {
        let best = null;
        let bestSurplus = 0;
        const candidates = pane.querySelectorAll("div, section, main");
        for (const el of candidates) {
          try {
            if (el.scrollHeight <= el.clientHeight + 4) continue;
            if (el.clientHeight < 120) continue;
            const overflowY = getComputedStyle(el).overflowY;
            if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;
            const surplus = el.scrollHeight - el.clientHeight;
            if (surplus > bestSurplus) { bestSurplus = surplus; best = el; }
          } catch {}
        }
        scroller = best;
      }
      const target = scroller !== null ? scroller : pane;
      try {
        if (target.getAttribute("tabindex") === null) {
          target.setAttribute("tabindex", "-1");
          target.classList.add("dsv-silent-focus");
        }
        target.focus({ preventScroll: true });
        // The glow follows keyboard focus too: commit the pane so the focused
        // rim/halo stays lit while the transcript holds focus (previously the
        // glow followed only mouse-downs and Alt+Shift+Arrow pane-nav, so a
        // programmatic hand-off — e.g. the session-hotkeys Esc-to-chat — left
        // the pane unlit). setFocus is a no-op when the pane is already the
        // focused one.
        try { treeStore.setFocus(sessionId); } catch {}
        return true;
      } catch {
        try { target.focus(); return true; } catch { return false; }
      }
    }

    /** Per-pane explicit composer mode ("tui" | "full"), module-level so
        the Alt+T chord can toggle the focused pane from the window keydown
        path. PaneFrame also registers its current EFFECTIVE mode (explicit
        or auto), so toggling flips correctly even when the pane is still in
        its auto (height-derived) mode. */
    const composerModeStore = (() => {
      const explicit = new Map();
      const effective = new Map();
      const listeners = new Set();
      const emit = () => { for (const fn of listeners) { try { fn(); } catch {} } };
      return {
        getExplicit: (id) => (explicit.has(id) ? explicit.get(id) : null),
        registerEffective: (id, mode) => { if (effective.get(id) !== mode) effective.set(id, mode); },
        toggle: (id) => {
          const current = explicit.get(id) || effective.get(id) || "full";
          explicit.set(id, current === "tui" ? "full" : "tui");
          emit();
        },
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        clear: () => { explicit.clear(); effective.clear(); },
      };
    })();
    /** Focus a pane's composer input (the chat box). TUI line first, then the
        native Lexical editor, then a legacy textarea; the caret goes to the
        end of the draft so typing appends. Falls back to the transcript when
        the pane has no input (e.g. takeover view).

        The list has to name the 0.1.5 editor AND this plugin's renamed card
        marker: it used to ask for `[data-composer-card] textarea` /
        `textarea[data-phase]`, neither of which exists in a pane (the marker
        is renamed to `data-dsv-composer-card`, and the input is a Lexical
        contenteditable, not a textarea). Every caller therefore fell through
        to `focusPaneScroller` — Alt+Shift+Arrow pane navigation parked focus
        on the transcript instead of the chat box, and Alt+T's caret re-seat
        after swapping the composer left focus nowhere at all. */
    function focusPaneInput(sessionId) {
      const pane = document.querySelector('.dsv-pane[data-dsv-pane="' + String(sessionId).replace(/"/g, '\\"') + '"]');
      if (pane === null) return false;
      const selectors = [
        "textarea[data-dsv-tui-input]",
        "[data-dsv-composer-card] [data-composer-input]",
        "[data-composer-input]",
        "[data-dsv-composer-card] textarea",
      ];
      let input = null;
      for (const selector of selectors) {
        input = pane.querySelector(selector);
        if (input !== null) break;
      }
      if (input === null) return focusPaneScroller(sessionId);
      try {
        input.focus({ preventScroll: true });
        // Textareas need an explicit caret; the Lexical editor restores its
        // own selection on focus, and collapsing a Range behind its back would
        // fight that.
        if (typeof input.setSelectionRange === "function") {
          const end = String(input.value !== undefined && input.value !== null ? input.value : "").length;
          try { input.setSelectionRange(end, end); } catch {}
        }
        try { treeStore.setFocus(sessionId); } catch {}
        return true;
      } catch {
        return focusPaneScroller(sessionId);
      }
    }

    /** Alt+Shift+Arrow spatial navigation over pane geometry. */
    function focusSiblingPane(dir) {
      const panes = Array.prototype.slice.call(document.querySelectorAll(".dsv-pane[data-dsv-pane]"));
      if (panes.length < 2) return;
      const focusId = resolveFocusedSessionId();
      let current = null;
      for (const pane of panes) {
        if (pane.getAttribute("data-dsv-pane") === focusId) { current = pane; break; }
      }
      if (current === null) current = panes[0];
      const currentRect = current.getBoundingClientRect();
      const centerX = currentRect.left + currentRect.width / 2;
      const centerY = currentRect.top + currentRect.height / 2;
      let best = null;
      let bestScore = Infinity;
      for (const pane of panes) {
        if (pane === current) continue;
        const rect = pane.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - centerX;
        const dy = rect.top + rect.height / 2 - centerY;
        let forward = false;
        let primary = 0;
        let cross = 0;
        if (dir === "left") { forward = dx < -8; primary = -dx; cross = Math.abs(dy); }
        else if (dir === "right") { forward = dx > 8; primary = dx; cross = Math.abs(dy); }
        else if (dir === "up") { forward = dy < -8; primary = -dy; cross = Math.abs(dx); }
        else { forward = dy > 8; primary = dy; cross = Math.abs(dx); }
        if (!forward) continue;
        const score = primary + cross * 2.5;
        if (score < bestScore) { bestScore = score; best = pane; }
      }
      if (best !== null) {
        const id = best.getAttribute("data-dsv-pane");
        treeStore.setFocus(id);
        return id;
      }
      return null;
    }

    const PANE_NAV_KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

    /** Alt+Shift+Arrow spatial navigation over pane geometry. Registered and
        disposed with the plugin's apply() lifetime (see registerGlobalKeys) —
        the old module-scope registration stacked a fresh listener on every
        plugin reload and never removed one. */
    function onPaneNavKeydown(event) {
      if (event.altKey !== true || event.shiftKey !== true || event.ctrlKey === true || event.metaKey === true) return;
      const dir = PANE_NAV_KEYS[event.key];
      if (dir === undefined) return;
      if (!dsvOperational() || !treeStore.isActive()) return;
      // S7: preventDefault only — stopPropagation() made plugin co-existence
      // order-dependent (another plugin bound to the same chord never saw it).
      event.preventDefault();
      const nextId = focusSiblingPane(dir);
      if (nextId !== null && nextId !== undefined) {
        // release the old pane's caret so arrows keep navigating, then put
        // the caret INTO the new pane's chat box (user preference: the chord
        // lands on the input, ready to type — not on the transcript)
        const active = document.activeElement;
        if (active !== null && active !== undefined && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable === true)) {
          try { active.blur(); } catch {}
        }
        focusPaneInput(nextId);
      }
    }

    /** Alt+T: toggle the focused pane's composer mode (TUI <-> full). Works
        while the caret is in any input — the swap re-seats the caret into
        the new input so an in-flight draft keeps flowing. Matched on the
        physical `event.code` ("KeyT") with an `event.key` fallback: on macOS
        Option+T yields a dead-key character, so a key-only match would
        never fire there. */
    function onComposerModeKeydown(event) {
      if (event.altKey !== true || event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) return;
      const codeIsT = event.code === "KeyT";
      const keyIsT = event.key === "t" || event.key === "T";
      if (!codeIsT && !keyIsT) return;
      if (!dsvOperational() || !treeStore.isActive()) return;
      event.preventDefault();
      const id = resolveFocusedSessionId();
      if (id === null || id === undefined) return;
      const pane = document.querySelector('.dsv-pane[data-dsv-pane="' + String(id).replace(/"/g, '\\"') + '"]');
      const active = document.activeElement;
      const caretInside = pane !== null && active !== null && active !== undefined && pane.contains(active)
        && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable === true);
      composerModeStore.toggle(id);
      if (caretInside) {
        window.requestAnimationFrame(() => { focusPaneInput(id); });
      }
    }

    /** Both global chords, as one disposables-managed registration. */
    function registerGlobalKeys() {
      window.addEventListener("keydown", onPaneNavKeydown, true);
      window.addEventListener("keydown", onComposerModeKeydown, true);
      return () => {
        window.removeEventListener("keydown", onPaneNavKeydown, true);
        window.removeEventListener("keydown", onComposerModeKeydown, true);
      };
    }

    /** Bridge for dsh-session-hotkeys (Esc-to-chat delegation, Alt+W close) plus
        the 1.6.0 diagnostics/control API. Every method returns plain
        serializable data and NEVER throws (safeCall). The `__test` seam exposes
        the PURE geometry/persistence helpers so the supported shell frame
        shapes (0.2.0 / 0.2.1) can be regression-tested from a node sandbox.

        focusChat returns true when a pane scroller was focused. closeFocused
        closes the FOCUSED pane (3 panes → 2 → 1); when a single pane remains
        it is deliberately KEPT and { exit: true } is reported instead — the
        session-hotkeys side hides the whole workspace shell (persisted, with a
        restore affordance) and the tree comes back intact on restore.
        Returns null when there is no pane to close. */
    window.__dshSplitWorkspace = Object.assign(window.__dshSplitWorkspace || {}, {
      split(sessionId) {
        return safeCall("split()", () => {
          if (typeof sessionId !== "string" || sessionId === "") return null;
          treeStore.addPane(sessionId);
          return treeStore.leafIds();
        }, null);
      },
      restore() {
        return safeCall("restore()", () => { restoreSplit(); return treeStore.leafIds(); }, null);
      },
      arrange(mode) {
        return safeCall("arrange()", () => {
          treeStore.arrange(typeof mode === "string" ? mode : "auto", 1.2);
          return treeStore.leafIds();
        }, null);
      },
      focusChat() {
        return safeCall("focusChat()", () => {
          const id = resolveFocusedSessionId();
          if (id === null || id === undefined) return false;
          return focusPaneScroller(id);
        }, false);
      },
      closeFocused() {
        return safeCall("closeFocused()", () => {
          if (!dsvOperational()) return null;
          const ids = treeStore.leafIds();
          if (ids.length === 0) return null;
          const id = resolveFocusedSessionId();
          if (id === null || id === undefined) return null;
          if (ids.length === 1) return { exit: true, remaining: 0 };
          treeStore.closeLeaf(id);
          return { exit: false, remaining: treeStore.leafIds().length };
        }, null);
      },
      /** Full diagnostics: version/host/guard state/geometry/persistence. */
      health() {
        return safeCall("health()", healthSummary, {
          pluginVersion: PLUGIN_VERSION,
          enabled: false,
          safeMode: true,
          error: "health() failed",
        });
      },
      /** Last pane-drag preview (live reflow) state. Diagnostics only. */
      reflow() {
        return safeCall("reflow()", () => ({
          active: reflowState.active,
          armed: reflowState.armed,
          settling: reflowState.settling,
          dropped: reflowState.dropped,
          sourceId: reflowState.sourceId,
          targetId: reflowState.targetId,
          zone: reflowState.zone === null ? null : reflowState.zone.label,
          overCount: reflowState.overCount,
          dropCount: reflowState.dropCount,
          endCount: reflowState.endCount,
          lastOver: reflowState.lastOver,
          lastDrop: reflowState.lastDrop,
        }), null);
      },
      /** Clear tree + crash counters, stay in the stock view. */
      reset() {
        return safeCall("reset()", resetWorkspace, { reset: false });
      },
      /** Clear crash counters/safe mode and re-activate the kept tree. */
      retry() {
        return safeCall("retry()", retryWorkspace, false);
      },
      /** Kill switch (persisted): false = never take over the viewport. */
      setEnabled(flag) {
        return safeCall("setEnabled()", () => setEnabled(flag !== false), runtimeState.enabled);
      },
      /** Shortcut/help data (the "?" card shows the same information). */
      help() {
        return safeCall("help()", helpText, { version: PLUGIN_VERSION, shortcuts: [] });
      },
      /** Open/close the in-plugin help card. */
      setHelpOpen(flag) {
        return safeCall("setHelpOpen()", () => {
          setRuntime({ helpOpen: flag === true, tipVisible: false });
          return runtimeState.helpOpen;
        }, false);
      },
    });
    // Live service seam (diagnostics only): lets the maintainer inspect the
    // right-sidebar controller and the shell layout while split view runs.
    Object.defineProperty(window.__dshSplitWorkspace, "__svc", {
      value: Object.freeze({
        ctxAlive: () => pluginCtx !== null && pluginCtx !== undefined,
        names() {
          try { return pluginCtx === null ? null : Object.keys(pluginCtx); } catch (error) { return String(error); }
        },
        get(name) {
          try {
            if (pluginCtx === null || typeof pluginCtx.get !== "function") return null;
            return pluginCtx.get(name) ?? null;
          } catch (error) { return { __error: String(error) }; }
        },
      }),
      configurable: true,
    });
    // Read-only test seam: production calls the very same functions, so the
    // logic under test is the logic that runs on the user's host.
    Object.defineProperty(window.__dshSplitWorkspace, "__test", {
      value: Object.freeze({
        frameColumns,
        selectFrameColumns,
        computeColumnBounds,
        normalizeTree,
        isValidSessionId,
        noteGeometry,
        operational: () => dsvOperational(),
        // Retain-retry driver seam (1.6.1): the SAME resolver the pane hooks
        // use, driveable with a fake sessions service and short delays.
        createSessionFaceResolver,
        retainRetryDelay,
        RETAIN_RETRY_DELAYS_MS: RETAIN_RETRY_DELAYS_MS.slice(),
        // Composer-chain parity seam (ask/approval cards): the PURE prop
        // assembly the elected chain entry receives, plus the inject-face
        // materializer it feeds (keyedHooks.questionCard => useQuestionCard).
        composerChainProps,
        electComposerChain,
        injectFaceProps,
        MAX_TREE_DEPTH,
        COLUMN_MIN_WIDTH,
        COLUMN_MIN_HEIGHT,
        TESTED_RELEASES: TESTED_RELEASES.slice(),
      }),
      enumerable: false,
      writable: false,
      configurable: false,
    });

    // ---------------------------------------------------------------------
    // integrated workspace (overlay constrained to the conversation column)
    // ---------------------------------------------------------------------

    /** The conversation column's usable box, as window-relative insets.
        The shell is a CSS grid `sidebar | conversation | details`; the split
        workspace must live INSIDE the middle track only — never over the
        sidebar (workspace switcher, agent presets live around it), never over
        the details column, and never over desktop-only chrome above/below the
        shell frame (title bars, tab strips) or the 0.2.1 `shell.bottom` row.

        Every edge has an element-rect source first and a computed-style
        fallback; when the two outer edges cannot be resolved with confidence
        the measurement reports `ok: false` and the workspace stays INACTIVE —
        a wrong guess here is how the overlay once covered the whole window
        (nothing selectable) on desktop compositions. Fail-closed.

        The decision itself is a PURE function (`computeColumnBounds`), and the
        DOM adapters below only snapshot rects/flags into it, so the 0.2.0 and
        0.2.1 frame shapes are regression-tested without a DOM (see the
        `window.__dshSplitWorkspace.__test` seam and tests/safety.mjs). */
    function rectSnapshot(rect) {
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    /** PURE column selection: pick sidebar / centre / details out of the frame's
        layout children. `children` entries are {skip, position, rect} and are
        NEVER selected by index or count — the centre is the column under the
        conversation scroller when that probe is available, else the widest
        positive-width column; sidebar/details are the nearest significant
        columns on either side. A full-frame-width SHORT child is a shell ROW
        (0.2.1 `shell.bottom`, 0-height today, populated by other plugins
        tomorrow), never a column. This is what makes the 0.2.1 frame shape
        structurally measurable. */
    function selectFrameColumns(children, probeRect, viewportWidth) {
      const layout = [];
      const kids = children === null || children === undefined ? [] : children;
      const frameWidth = typeof viewportWidth === "number" && Number.isFinite(viewportWidth) ? viewportWidth : null;
      for (const child of kids) {
        if (child === null || child === undefined) continue;
        if (child.skip === true) continue;
        if (child.position === "absolute" || child.position === "fixed") continue;
        if (child.rect === null || child.rect === undefined) continue;
        // Rows spanning the full frame width are never conversation columns.
        if (frameWidth !== null && child.rect.width >= frameWidth - 2 && child.rect.height < COLUMN_MIN_HEIGHT) continue;
        layout.push(child);
      }
      layout.sort((left, right) => left.rect.left - right.rect.left);
      let center = null;
      if (probeRect !== null && probeRect !== undefined && probeRect.width > 0) {
        const probeX = probeRect.left + probeRect.width / 2;
        for (const column of layout) {
          if (column.rect.width <= 0) continue;
          if (probeX >= column.rect.left - 1 && probeX <= column.rect.right + 1) { center = column; break; }
        }
      }
      if (center === null) {
        for (const column of layout) {
          if (column.rect.width <= 0) continue;
          if (center === null || column.rect.width > center.rect.width) center = column;
        }
      }
      if (center === null) center = layout.length > 0 ? layout[0] : null;
      let sidebar = null;
      let details = null;
      if (center !== null) {
        for (const column of layout) {
          if (column === center || column.rect.width <= 0) continue;
          if (column.rect.right <= center.rect.left + 1) {
            if (sidebar === null || column.rect.right > sidebar.rect.right) sidebar = column;
          } else if (column.rect.left >= center.rect.right - 1) {
            if (details === null || column.rect.left < details.rect.left) details = column;
          }
        }
      }
      return { sidebar, center, details, columns: layout };
    }

    /** PURE bounds decision (window-relative insets + confidence).
        Input: { viewportWidth, viewportHeight, frameRect, children, scrollRect,
        fallbackLeft, gridTracks } — all plain data. Vertical insets come from
        the CENTRE column's own rect when known (the shell.bottom row lives
        outside it); horizontal insets come from the columns, with the
        grid-template-columns tracks as a validated fallback: if the
        element-derived box is inconsistent (width below COLUMN_MIN_WIDTH) but
        the grid-derived conversation track is sane, the grid wins. If neither
        is confident the result is ok:false (fail-closed). */
    function computeColumnBounds(input) {
      const out = { left: null, right: null, top: 0, bottom: 0, ok: false, source: "fail-closed" };
      const viewportWidth = input !== null && input !== undefined ? input.viewportWidth : undefined;
      const viewportHeight = input !== null && input !== undefined ? input.viewportHeight : undefined;
      if (typeof viewportWidth !== "number" || !Number.isFinite(viewportWidth)
          || typeof viewportHeight !== "number" || !Number.isFinite(viewportHeight)) return out;
      const frameRect = input.frameRect !== undefined && input.frameRect !== null
        ? { left: input.frameRect.left, top: input.frameRect.top, right: input.frameRect.right, bottom: input.frameRect.bottom }
        : null;
      if (frameRect !== null) {
        out.top = Math.max(0, Math.round(frameRect.top));
        out.bottom = Math.max(0, Math.round(viewportHeight - frameRect.bottom));
      }
      const probeRect = input.scrollRect !== undefined && input.scrollRect !== null ? input.scrollRect : null;
      const selection = selectFrameColumns(input.children, probeRect, viewportWidth);
      const center = selection.center;
      const centerRect = center !== null && center !== undefined ? center.rect : null;
      if (centerRect !== null && centerRect.height > 0) {
        out.top = Math.max(0, Math.round(centerRect.top));
        out.bottom = Math.max(0, Math.round(viewportHeight - centerRect.bottom));
      }
      let elementLeft = null;
      let elementRight = null;
      if (centerRect !== null) {
        elementLeft = selection.sidebar !== null ? Math.round(selection.sidebar.rect.right) : Math.round(centerRect.left);
        elementRight = selection.details !== null
          ? Math.max(0, Math.round(viewportWidth - selection.details.rect.left))
          : Math.max(0, Math.round(viewportWidth - centerRect.right));
      }
      const fallbackLeft = typeof input.fallbackLeft === "number" && Number.isFinite(input.fallbackLeft) ? input.fallbackLeft : null;
      if (elementLeft === null) elementLeft = fallbackLeft;
      // grid-template-columns fallback, validated below instead of trusted.
      let gridLeft = null;
      let gridRight = null;
      const tracks = Array.isArray(input.gridTracks)
        ? input.gridTracks.filter((value) => typeof value === "number" && Number.isFinite(value))
        : [];
      if (tracks.length >= 2 && frameRect !== null) {
        gridLeft = Math.round(frameRect.left + tracks[0]);
        gridRight = Math.max(0, Math.round(viewportWidth - (frameRect.left + tracks[0] + tracks[1])));
      }
      const measure = (left, right) => {
        if (left === null || right === null) return null;
        if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
        const width = viewportWidth - left - right;
        const height = viewportHeight - out.top - out.bottom;
        return width >= COLUMN_MIN_WIDTH && height >= COLUMN_MIN_HEIGHT ? width : null;
      };
      let left = elementLeft;
      let right = elementRight;
      if (measure(left, right) === null && measure(gridLeft, gridRight) !== null) {
        left = gridLeft;
        right = gridRight;
        out.source = "grid";
      } else if (measure(left, right) !== null) {
        out.source = "elements";
      }
      if (left === null || !Number.isFinite(left)) return out;
      if (right === null || !Number.isFinite(right)) right = 0;
      out.left = Math.max(0, Math.round(left));
      out.right = Math.max(0, Math.round(right));
      const width = viewportWidth - out.left - out.right;
      const height = viewportHeight - out.top - out.bottom;
      out.ok = width >= COLUMN_MIN_WIDTH && height >= COLUMN_MIN_HEIGHT;
      out.width = width;
      out.height = height;
      return out;
    }

    /** DOM: true for frame children that are shell chrome, not layout columns.
        `data-shell-overlay` is the overlay layer; `data-shell-bottom` is the
        0.2.1 `shell.bottom` row (a fourth static child — treating it as the
        details column made the measured conversation width negative, so the
        workspace never activated on 0.2.1); `data-shell-leading` is the macOS
        titlebar seat; `data-side` marks the column drag handles. Positioned
        children (overlay layer, split handles) are transparent to layout by
        definition. */
    function isFrameChromeChild(el) {
      try {
        if (el.hasAttribute("data-shell-overlay")
            || el.hasAttribute("data-shell-bottom")
            || el.hasAttribute("data-shell-leading")
            || el.hasAttribute("data-side")) return true;
      } catch {}
      try {
        const position = window.getComputedStyle(el).position;
        if (position === "absolute" || position === "fixed") return true;
      } catch {}
      return false;
    }

    /** The shell frame's real layout column ELEMENTS, in visual order. Used to
        choose what to observe; the measured decision goes through
        computeColumnBounds/selectFrameColumns. */
    function frameColumns(frame) {
      const columns = [];
      if (frame === null || frame === undefined) return columns;
      const kids = frame.children;
      if (kids === null || kids === undefined) return columns;
      for (let i = 0; i < kids.length; i += 1) {
        const kid = kids[i];
        if (kid === null || kid === undefined) continue;
        if (isFrameChromeChild(kid)) continue;
        columns.push(kid);
      }
      columns.sort((left, right) => {
        try { return left.getBoundingClientRect().left - right.getBoundingClientRect().left; } catch { return 0; }
      });
      return columns;
    }

    /** DOM snapshot of the frame's children → pure-data input for the decision. */
    function frameChildrenSnapshot(frame) {
      const children = [];
      if (frame === null || frame === undefined) return children;
      const kids = frame.children;
      if (kids === null || kids === undefined) return children;
      for (let i = 0; i < kids.length; i += 1) {
        const kid = kids[i];
        if (kid === null || kid === undefined) continue;
        let position = "static";
        try { position = window.getComputedStyle(kid).position; } catch {}
        let rect = null;
        try { rect = rectSnapshot(kid.getBoundingClientRect()); } catch {}
        children.push({ skip: isFrameChromeChild(kid), position, rect });
      }
      return children;
    }

    function measureColumnBounds() {
      let frameRect = null;
      let children = [];
      let scrollRect = null;
      let fallbackLeft = null;
      let gridTracks = [];
      try {
        const overlayLayer = document.querySelector("[data-shell-overlay]");
        const frame = overlayLayer !== null && overlayLayer.parentElement !== null ? overlayLayer.parentElement : null;
        if (frame !== null) {
          try { frameRect = rectSnapshot(frame.getBoundingClientRect()); } catch { frameRect = null; }
          children = frameChildrenSnapshot(frame);
          const cols = getComputedStyle(frame).gridTemplateColumns;
          const tracks = String(cols).match(/(\d+(?:\.\d+)?)px/g);
          if (tracks !== null) gridTracks = tracks.map((value) => parseFloat(value));
        }
      } catch {}
      try {
        const scroll = document.querySelector("[data-conversation-scroll]");
        if (scroll !== null) {
          const rect = scroll.getBoundingClientRect();
          scrollRect = rectSnapshot(rect);
          fallbackLeft = scrollRect.left;
        } else {
          const aside = document.querySelector("aside");
          if (aside !== null) fallbackLeft = aside.getBoundingClientRect().right;
        }
      } catch {}
      return computeColumnBounds({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        frameRect,
        children,
        scrollRect,
        fallbackLeft,
        gridTracks,
      });
    }

    /** The conversation column as a plain rect (for the drag bridge's zone
        math — zoneFor reads left/top/width/height only). */
    function columnRect() {
      const bounds = measureColumnBounds();
      if (bounds.left === null) return null;
      const left = bounds.left;
      const top = bounds.top;
      const width = window.innerWidth - bounds.left - bounds.right;
      const height = window.innerHeight - bounds.top - bounds.bottom;
      return { left, top, width, height };
    }

    /** The right-sidebar controller / shell layout, read defensively: they are
       optional services (a Web host may not load the sidebar plugin). */
    function rightbarService() {
      try {
        return pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
          ? (pluginCtx.get("sidebarRight") ?? null)
          : null;
      } catch { return null; }
    }
    function rightbarLayout() {
      try {
        return pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
          ? (pluginCtx.get("layout") ?? null)
          : null;
      } catch { return null; }
    }

    /** Width-based state of the stock right sidebar; the split toolbar shows
        the same open/collapse control the stock header would. */
    function rightbarIsOpen() {
      const column = document.querySelector("[data-rightbar-col]");
      return column !== null && column.getBoundingClientRect().width > 1;
    }

    /** The repair path used when a stock control is stale. A split/exit used to
       leave the sidebar-right store's `expanded` flag out of step with the live
       column: the corner button either vanished (store said open, column was
       closed) or swallowed clicks (it wrote to a seat nobody rendered). The
       controller face and the shell layout still know the truth, so open the
       column through them and let the seat re-adopt its store. */
    function rightbarForce(open) {
      const sr = rightbarService();
      const layout = rightbarLayout();
      let expanded = null;
      try { expanded = typeof sr?.isExpanded === "function" ? sr.isExpanded() : null; } catch {}
      try {
        if (open) {
          // The shell layout is authoritative for SHOWING the column: opening
          // it first also covers the case where the seat's own store says
          // "expanded" but its React tree never rendered. Then align the store
          // so the collapsed button / panel agree with the visible column.
          if (layout !== null && typeof layout.openRightbar === "function") {
            layout.openRightbar(true, false);
          }
          if (expanded === false && typeof sr?.toggleExpanded === "function") sr.toggleExpanded();
          return;
        }
        if (layout !== null && typeof layout.closeRightbar === "function") {
          layout.closeRightbar();
        }
        if (expanded === true && typeof sr?.toggleExpanded === "function") sr.toggleExpanded();
      } catch (error) {
        console.warn(LOG_PREFIX, "rightbar repair failed", error);
      }
    }

    // One scheduled repair at a time: a stock click and the toolbar's own
    // fallback must not toggle the column twice.
    let rightbarRepairTimer = 0;
    let rightbarRepairWant = null;
    function scheduleRightbarRepair(open, delay) {
      rightbarRepairWant = open;
      if (rightbarRepairTimer !== 0) window.clearTimeout(rightbarRepairTimer);
      rightbarRepairTimer = window.setTimeout(() => {
        rightbarRepairTimer = 0;
        const want = rightbarRepairWant;
        rightbarRepairWant = null;
        if (want === null || rightbarIsOpen() === want) return;
        rightbarForce(want);
      }, delay === undefined ? 280 : delay);
    }

    /** Stock expand/collapse controls can be dead after a split teardown.
        Watch their clicks in the capture phase and repair a no-op after the
        animation window; a control that worked is simply left alone. */
    function onRightbarStockClick(event) {
      try {
        if (runtimeState.enabled !== true) return;
        const target = event.target;
        if (target === null || target === undefined || typeof target.closest !== "function") return;
        if (target.closest("[data-sidebar-right-expand]") !== null) {
          scheduleRightbarRepair(true, 300);
          return;
        }
        if (target.closest("[data-sidebar-right-toggle]") !== null) {
          scheduleRightbarRepair(false, 300);
        }
      } catch {}
    }

    /** Self-heal the "expanded but closed, with no way back" state: the store
        says the panel is open, the column is 0 wide and no expand button is
        rendered. Honor the stored state by opening the panel (which also
        restores its own collapse control). */
    function rightbarSelfHeal() {
      try {
        if (runtimeState.enabled !== true) return;
        if (rightbarIsOpen()) return;
        if (document.querySelector("[data-sidebar-right-expand]") !== null) return;
        const sr = rightbarService();
        if (sr === null || typeof sr.isExpanded !== "function") return;
        if (sr.isExpanded() !== true) return;
        rightbarForce(true);
      } catch {}
    }

    function toggleRightbar() {
      try {
        const open = rightbarIsOpen();
        const want = !open;
        // Use the stock controls first: they act on the seat the user sees and
        // the Open button also runs the default-page seeding.
        if (open) {
          const collapse = document.querySelector("[data-sidebar-right-toggle]");
          if (collapse !== null && collapse !== undefined) {
            collapse.click();
            scheduleRightbarRepair(want, 300);
            return;
          }
        } else {
          const expands = Array.prototype.slice.call(document.querySelectorAll("[data-sidebar-right-expand]"));
          const stock = expands.find((button) => button.closest(".dsv-pane") === null);
          if (stock !== undefined) {
            stock.click();
            scheduleRightbarRepair(want, 300);
            return;
          }
        }
        rightbarForce(want);
      } catch (error) {
        console.warn(LOG_PREFIX, "rightbar toggle failed", error);
      }
    }
    function useRightbarOpen() {
      const [open, setOpen] = React.useState(rightbarIsOpen);
      React.useEffect(() => {
        let column = null;
        let observer = null;
        let timer = 0;
        const sync = () => {
          setOpen(rightbarIsOpen());
          const next = document.querySelector("[data-rightbar-col]");
          if (next === column) return;
          column = next;
          if (observer !== null) {
            try { observer.disconnect(); } catch {}
            observer = null;
          }
          if (column !== null && typeof ResizeObserver === "function") {
            observer = new ResizeObserver(sync);
            try { observer.observe(column); } catch {}
          }
        };
        sync();
        // The column can be created/removed by the stock layout; a cheap
        // low-frequency re-scan re-attaches the observer and catches toggles
        // that did not go through this plugin's button.
        timer = window.setInterval(sync, 800);
        window.addEventListener("resize", sync);
        return () => {
          window.clearInterval(timer);
          window.removeEventListener("resize", sync);
          if (observer !== null) {
            try { observer.disconnect(); } catch {}
          }
        };
      }, []);
      return open;
    }
    /** Two distinct right-sidebar glyphs: a right chevron while the panel is
        closed (the click opens it) and a left chevron while it is open (the
        click collapses it). The frame stays the panel-with-divider shared with
        the stock control so the two read as the same affordance. */
    function RightbarIcon({ open }) {
      return h("svg", {
        width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
        "aria-hidden": "true", strokeWidth: 1,
      },
        h("rect", {
          x: 1.5, y: 1.5, width: 13, height: 13, rx: 2.5,
          stroke: "currentColor",
          fill: open === true ? "currentColor" : "none",
          fillOpacity: open === true ? 0.12 : 0,
        }),
        h("path", { d: "M5.5 2V14", stroke: "currentColor" }),
        h("path", {
          d: open === true ? "M10.8 6.1L8.6 8l2.2 1.9" : "M8.6 6.1L10.8 8l-2.2 1.9",
          stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round",
        }));
    }

    function LayoutBar() {
      const state = useTree();
      const rightbarOpen = useRightbarOpen();
      const barRef = React.useRef(null);
      // 0 = full, 1 = hide the "布局" label, 2 = hide the count as well.
      // The bar keeps a fixed 32px height; labels are never allowed to wrap.
      const [compact, setCompact] = React.useState(0);
      React.useEffect(() => {
        const el = barRef.current;
        if (el === null) return undefined;
        const update = () => {
          const width = el.clientWidth;
          const next = width < 400 ? 2 : width < 520 ? 1 : 0;
          setCompact((previous) => (previous === next ? previous : next));
        };
        update();
        if (typeof ResizeObserver !== "function") {
          window.addEventListener("resize", update);
          return () => window.removeEventListener("resize", update);
        }
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
      }, []);
      const count = state.root === null ? 0 : leafOf(state.root, []).length;
      return h("div", {
        ref: barRef,
        className: "dsv-layout-bar",
        "data-plugin": PLUGIN_ID,
        "data-window-drag": true,
        ...(compact === 0 ? {} : { "data-compact": String(compact) }),
      },
        h("div", { className: "dsv-layout-dragfill", "data-window-drag": true, "aria-hidden": "true" }),
        h("span", { className: "dsv-layout-title" }, t("layoutLabel")),
        h("span", { className: "dsv-layout-count", title: t("layoutLabel") }, String(count)),
        // The empty stretch of the bar is the window's drag region, like the
        // stock titlebar — buttons around it stay clickable (the global
        // [data-window-drag] rule makes interactive children no-drag).
        h("span", { className: "dsv-layout-spacer", "data-window-drag": true }),
        h("button", {
          type: "button",
          className: "dsv-layout-icon" + (rightbarOpen ? " is-open" : ""),
          title: rightbarOpen ? t("rightbarClose") : t("rightbarOpen"),
          "aria-label": rightbarOpen ? t("rightbarClose") : t("rightbarOpen"),
          "aria-pressed": rightbarOpen ? "true" : "false",
          "data-open": rightbarOpen ? "true" : "false",
          onClick: toggleRightbar,
        }, h(RightbarIcon, { open: rightbarOpen })),
        h("button", {
          type: "button", className: "dsv-layout-exit", title: t("minimizeSplit"),
          onClick: minimizeWorkspace,
        }, t("minimizeSplit")),
        h("button", {
          type: "button", className: "dsv-layout-exit", title: t("exitSplit"),
          onClick: exitWorkspace,
        }, t("exitSplit")),
      );
    }

    const WorkspaceBody = React.memo(function WorkspaceBody({ generation }) {
      const state = useTree();
      return h(
        "div",
        { className: "dsv-body-column" },
        h(LayoutBar, {}),
        h(
          "div",
          { className: "dsv-body" + (state.root !== null && state.root.t === "leaf" ? " flush" : "") },
          h(Canvas, { generation }),
        ),
      );
    });

    /** Top-level fail containment: if the workspace itself throws (a desktop
        service quirk, a faces mismatch), it isolates itself and the stock view
        keeps the viewport. 1.6.0: the crash also enters SAFE MODE with the tree
        KEPT (the chip offers Retry/Disable), so a deterministic crash can never
        loop the boot even though the persisted tree is still installed. */
    class WorkspaceBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        noteFailure("workspace", error);
        enterSafeMode("workspace-crash");
      }
      render() {
        return this.state.failed === true ? null : this.props.children;
      }
    }

    // ---------------------------------------------------------------------
    // plugin chrome: safe-mode chip, blocked chip, help + first-split tips.
    // All of it is plugin-owned, small and corner-anchored (or inside the
    // plugin's own overlay) so it can never cover stock controls.
    // ---------------------------------------------------------------------

    function openHelp() {
      setRuntime({ helpOpen: true, tipVisible: false });
    }
    function closeHelp() {
      setRuntime({ helpOpen: false });
    }

    function SafeModeChip() {
      return h("div", {
        className: "dsv-chip",
        role: "status",
        "aria-live": "polite",
        "data-plugin": PLUGIN_ID,
        title: t("safeModeBody"),
      },
        h("span", { className: "dsv-chip-text" }, t("safeModeTitle")),
        h("button", { type: "button", className: "dsv-chip-btn accent", onClick: () => { try { retryWorkspace(); } catch {} } }, t("retryLabel")),
        h("button", { type: "button", className: "dsv-chip-btn", onClick: () => { try { setEnabled(false); } catch {} } }, t("disableLabel")),
        h("button", {
          type: "button",
          className: "dsv-chip-btn icon",
          title: t("dismissLabel"),
          "aria-label": t("dismissLabel"),
          onClick: () => setRuntime({ chipDismissed: true }),
        }, "×"),
      );
    }

    function BlockedChip() {
      return h("div", {
        className: "dsv-chip",
        role: "status",
        "data-plugin": PLUGIN_ID,
        title: t("helpDiagnostics"),
      },
        h("span", { className: "dsv-chip-text" }, t("blockedTitle")),
        h("button", { type: "button", className: "dsv-chip-btn icon", title: t("helpOpen"), "aria-label": t("helpOpen"), onClick: openHelp }, "?"),
        h("button", { type: "button", className: "dsv-chip-btn accent", onClick: () => { try { retryWorkspace(); } catch {} } }, t("retryLabel")),
        h("button", { type: "button", className: "dsv-chip-btn", onClick: () => { try { setEnabled(false); } catch {} } }, t("disableLabel")),
      );
    }

    /** The one help card: opened by the pane header "?" and by the blocked
        chip. Lives inside the plugin overlay when active (fixed variant for the
        inactive chip path). */
    function HelpCard({ fixed }) {
      const help = helpText();
      return h("div", {
        className: "dsv-help-card" + (fixed === true ? " dsv-help-card-fixed" : ""),
        role: "dialog",
        "aria-label": t("helpTitle"),
        "data-plugin": PLUGIN_ID,
      },
        h("div", { className: "dsv-help-title" },
          t("helpTitle"),
          h("button", {
            type: "button",
            className: "dsv-chip-btn icon",
            style: { marginLeft: "auto" },
            title: t("helpClose"),
            "aria-label": t("helpClose"),
            onClick: closeHelp,
          }, "×"),
        ),
        help.shortcuts.map((item) => h("div", { className: "dsv-help-row", key: item.keys },
          h("span", { className: "dsv-help-keys" }, item.keys),
          h("span", { className: "dsv-help-body" }, item.action),
        )),
        h("div", { className: "dsv-help-body", style: { marginTop: "6px" } }, t("helpGestures")),
        h("div", { className: "dsv-help-body", style: { marginTop: "6px" } }, t("helpDisable")),
        h("div", { className: "dsv-help-body", style: { marginTop: "2px" } }, t("helpDiagnostics")),
        h("div", { className: "dsv-help-actions" },
          h("button", { type: "button", className: "dsv-chip-btn", onClick: closeHelp }, t("helpClose")),
          h("button", { type: "button", className: "dsv-chip-btn", onClick: () => setEnabled(false) }, t("disableLabel")),
        ),
      );
    }

    /** One-time first-split tip (localStorage dsh.split-workspace.hint.v1). */
    function FirstSplitTip() {
      React.useEffect(() => {
        storageSet(HINT_KEY, "1");
      }, []);
      return h("div", { className: "dsv-tip-card", "data-plugin": PLUGIN_ID },
        h("div", { className: "dsv-help-title" }, t("tipTitle")),
        h("div", { className: "dsv-help-body" }, t("tipBody")),
        h("div", { className: "dsv-help-actions" },
          h("button", { type: "button", className: "dsv-chip-btn accent", onClick: () => setRuntime({ tipVisible: false }) }, t("helpClose")),
        ),
      );
    }

    /** Draggable, edge-snapping restore chip shown while the split is
        minimized. Its position persists; a release snaps it to the nearest
        corner so it never floats in the middle of the conversation. */
    function chipWorkRect() {
      let bounds = null;
      try { bounds = measureColumnBounds(); } catch { bounds = null; }
      const ok = bounds !== null && bounds !== undefined && bounds.ok === true;
      const doc = document.documentElement;
      const darwin = (doc.dataset && doc.dataset.platform === "darwin")
        || (/Electron/.test(navigator.userAgent) && /Macintosh|Mac OS X/.test(navigator.userAgent));
      const fullscreen = doc.hasAttribute("data-fullscreen");
      const titlebarInset = darwin && !fullscreen ? 52 : (doc.hasAttribute("data-windows-titlebar") ? 40 : 0);
      const left = ok ? Math.max(0, bounds.left) : 0;
      const right = ok ? Math.max(0, bounds.right) : 0;
      const top = Math.max(ok ? Math.max(0, bounds.top) : 0, titlebarInset);
      const bottom = ok ? Math.max(0, bounds.bottom) : 0;
      const width = Math.max(120, window.innerWidth - left - right);
      const height = Math.max(60, window.innerHeight - top - bottom);
      return { left, top, width, height };
    }

    /** Draggable, edge-snapping restore chip shown while the split is
        minimized. It is confined to the conversation workspace (never the
        sidebar or the macOS traffic-light corner) and defaults to the
        workspace's bottom-left every time the split is minimized. */
    function MinimizedChip() {
      const MARGIN = 18;
      const ref = React.useRef(null);
      const dragRef = React.useRef(null);
      const defaultPos = () => {
        try { safeRemove(CHIP_KEY); } catch {}
        const work = chipWorkRect();
        const el = ref.current;
        const width = el ? el.offsetWidth : 229;
        const height = el ? el.offsetHeight : 42;
        return {
          x: work.left + MARGIN,
          y: work.top + work.height - height - MARGIN,
        };
      };
      const [pos, setPos] = React.useState(defaultPos);
      const [dragging, setDragging] = React.useState(false);

      const clampToWork = React.useCallback((next) => {
        const work = chipWorkRect();
        const el = ref.current;
        const width = el ? el.offsetWidth : 229;
        const height = el ? el.offsetHeight : 42;
        return {
          x: Math.min(Math.max(next.x, work.left + MARGIN), Math.max(work.left + MARGIN, work.left + work.width - width - MARGIN)),
          y: Math.min(Math.max(next.y, work.top + MARGIN), Math.max(work.top + MARGIN, work.top + work.height - height - MARGIN)),
        };
      }, []);

      React.useEffect(() => {
        const onResize = () => setPos((current) => clampToWork(current));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, [clampToWork]);

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (target !== null && target !== undefined && typeof target.closest === "function" && target.closest("button") !== null) return;
        const el = ref.current;
        if (el === null) return;
        const rect = el.getBoundingClientRect();
        dragRef.current = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false, last: null };
        setDragging(true);
        try { el.setPointerCapture(event.pointerId); } catch {}
      };
      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const next = clampToWork({ x: event.clientX - drag.dx, y: event.clientY - drag.dy });
        if (drag.last === null || Math.abs(next.x - drag.last.x) > 1 || Math.abs(next.y - drag.last.y) > 1) drag.moved = true;
        drag.last = next;
        setPos(next);
      };
      const finish = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
        if (!drag.moved) return;
        const el = ref.current;
        if (el === null) return;
        const work = chipWorkRect();
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const base = drag.last !== null ? drag.last : { x: el.offsetLeft, y: el.offsetTop };
        const snapped = {
          x: base.x + width / 2 < work.left + work.width / 2 ? work.left + MARGIN : work.left + work.width - width - MARGIN,
          y: base.y + height / 2 < work.top + work.height / 2 ? work.top + MARGIN : work.top + work.height - height - MARGIN,
        };
        setPos(clampToWork(snapped));
      };

      const style = { left: pos.x + "px", top: pos.y + "px", right: "auto", bottom: "auto" };
      return h("div", {
        ref,
        className: "dsv-chip dsv-minimized-chip" + (dragging ? " dragging" : ""),
        style,
        role: "status",
        "data-plugin": PLUGIN_ID,
        onPointerDown,
        onPointerMove,
        onPointerUp: finish,
        onPointerCancel: finish,
      },
        h("span", { className: "dsv-minimized-grip", title: t("minimizedTitle"), "aria-hidden": true }, "⠿"),
        h("span", { className: "dsv-chip-text" }, t("minimizedTitle")),
        h("button", {
          type: "button", className: "dsv-chip-btn accent",
          onClick: restoreSplit,
        }, t("restoreSplit")),
        h("button", {
          type: "button", className: "dsv-chip-btn icon",
          title: t("exitSplit"), "aria-label": t("exitSplit"),
          onClick: exitWorkspace,
        }, "×"),
      );
    }

    /** Always-mounted overlay-seat chrome: the safe-mode chip (with the tree
        kept), and a "could not start" chip when a persisted split cannot take
        the viewport (geometry fail-closed) — both dismissible and never over
        stock controls. */
    function PluginChrome() {
      const runtime = useRuntime();
      const tree = useTree();
      const leaves = tree.root === null ? 0 : leafOf(tree.root, []).length;
      const wantsActive = runtime.enabled === true && leaves >= 2;
      const [settledBlocked, setSettledBlocked] = React.useState(false);
      React.useEffect(() => {
        if (!wantsActive || runtime.safeMode === true || runtime.active === true) {
          setSettledBlocked(false);
          return undefined;
        }
        // Give the geometry effect a few frames to measure before announcing a
        // failure: the bounds state is a placeholder until the first measure.
        const timer = window.setTimeout(() => setSettledBlocked(true), 3000);
        return () => {
          try { window.clearTimeout(timer); } catch {}
        };
      }, [wantsActive, runtime.safeMode, runtime.active]);
      if (runtime.enabled !== true) return null;
      if (runtime.minimized === true && wantsActive) {
        return h(MinimizedChip, null);
      }
      if (runtime.safeMode === true) {
        if (runtime.chipDismissed === true) return null;
        return h(SafeModeChip, null);
      }
      if (settledBlocked !== true) return null;
      if (runtime.helpOpen === true) return h(HelpCard, { fixed: true });
      return h(BlockedChip, null);
    }

    /** The shell.overlay seat component: the workspace (keyed by the retry
        epoch, so Retry remounts a crashed/latched boundary) plus the chrome. */
    function SplitWorkspaceSeat(props) {
      const runtime = useRuntime();
      return h(React.Fragment, null,
        h(WorkspaceBoundary, { key: "workspace-" + runtime.epoch }, h(WorkspaceApp, props)),
        h(PluginChrome, null),
      );
    }

    function WorkspaceApp(props) {
      // This component IS the plugin's root-scoped seat: `shell.overlay` is
      // declared `kind: list, scope: root`, so the renderer hands it the
      // materialized ROOT standard kit (useSessions, useSessionStatus,
      // useSessionRetainInfo, useResource, useWorkspaces, usePanelInfo, plus
      // anything a third-party plugin contributed through slots.provideRoot).
      // Panes re-host stock components outside the slot renderer, so they need
      // those faces; harvesting them here keeps the whole port on public API.
      //
      // M4: adoption is WRITE-ONCE during render (so panes rendered in the same
      // pass see the kit) and every later change is published from the layout
      // effect below — adding missing faces only, or a controlled generation
      // remount. Render never mutates the store after adoption and never
      // notifies subscribers.
      readRootStandard(props);
      React.useLayoutEffect(() => {
        harvestRootStandard(props);
        publishRootStandard();
      });
      const runtime = useRuntime();
      const state = useTree();
      const activePanelId = typeof props.usePanelInfo === "function"
        ? props.usePanelInfo((info) => (info !== null && info !== undefined ? info.activePanelId : null))
        : null;
      const generation = runtime.generation;
      const leaves = state.root === null ? [] : leafOf(state.root, []);
      // The activation gate: >=2 panes AND the kill switch/safe mode allow it.
      // Everything below keys off this — observers, DOM scraping, the overlay.
      const minimized = runtime.minimized === true;
      const active = leaves.length >= 2 && runtime.enabled === true && runtime.safeMode !== true;
      const [picker, setPicker] = React.useState(pickerRequest);
      const [bounds, setBounds] = React.useState({ left: 0, right: 0, top: 0, bottom: 0, ok: false });
      const geometryWarnedRef = React.useRef(false);
      // B3 "invisible active": the workspace is OPERATIONAL only when it can
      // actually render (>=2 panes AND a confident column measurement). All
      // input/observation paths gate on this, so a persisted split whose
      // geometry fails renders nothing and also does NOT eat Alt+T /
      // Alt+Shift+Arrow (the chrome chip explains the state instead).
      const operational = active && bounds.ok === true && minimized !== true;

      // The DOM session-list source (0.2.0 path) observes the document only
      // while the workspace is operational — otherwise zero observation cost.
      React.useEffect(() => {
        if (sessionsListSource !== null && sessionsListSource !== undefined
            && typeof sessionsListSource.setActive === "function") {
          sessionsListSource.setActive(operational);
        }
      }, [operational]);

      // Track the workspace's own liveness for the health/diagnostics API.
      // `active` here means OPERATIONAL: the stock view is never claimed to be
      // covered while nothing is rendered.
      React.useEffect(() => {
        setRuntime({ active: operational });
      }, [operational]);

      // One TOC grip per live pane (see tocGripSync): hide the portal copies
      // mounted by the hidden stock view / IM view and keep every pane's grip
      // inside that pane. Portals mount asynchronously, so a body childList
      // observer plus a low-frequency re-scan catches new panes.
      React.useEffect(() => {
        if (!operational) {
          tocGripsRestore();
          return undefined;
        }
        let raf = 0;
        const schedule = () => {
          if (raf !== 0) return;
          raf = window.requestAnimationFrame(() => {
            raf = 0;
            try { tocGripSync(); } catch {}
          });
        };
        schedule();
        let observer = null;
        try {
          if (typeof MutationObserver === "function") {
            observer = new MutationObserver(schedule);
            observer.observe(document.body, { childList: true });
          }
        } catch { observer = null; }
        const timer = window.setInterval(schedule, 1000);
        document.addEventListener("mouseup", schedule, true);
        window.addEventListener("resize", schedule);
        return () => {
          if (raf !== 0) {
            try { window.cancelAnimationFrame(raf); } catch {}
          }
          if (observer !== null) {
            try { observer.disconnect(); } catch {}
          }
          window.clearInterval(timer);
          document.removeEventListener("mouseup", schedule, true);
          window.removeEventListener("resize", schedule);
          document.body.classList.remove("dsv-layout-previewing");
          tocGripsRestore();
        };
      }, [operational]);

      // A plugin/skills/settings panel replaces the whole main view. The split
      // overlay would cover it, so step aside automatically and keep the tree;
      // the restore chip brings the split back.
      React.useEffect(() => {
        if (!active || minimized) return;
        if (activePanelId === null || activePanelId === undefined) return;
        minimizeWorkspace();
      }, [active, minimized, activePanelId]);

      React.useEffect(() => {
        const onPicker = () => setPicker(pickerRequest);
        pickerListeners.add(onPicker);
        return () => {
          pickerListeners.delete(onPicker);
        };
      }, []);

      // click-away: a pointer-down outside the picker card closes it (the
      // split buttons are excluded — they toggle via togglePicker)
      React.useEffect(() => {
        if (picker === null || picker === undefined) return;
        const onPointerDown = (event) => {
          const target = event.target;
          if (target !== null && target !== undefined && typeof target.closest === "function") {
            try {
              if (target.closest(".dsv-picker") !== null) return;
              if (target.closest(".dsv-pane-btn") !== null) return;
            } catch {}
          }
          closePicker();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
      }, [picker]);

      // Conversation-column bounds, tracked ONLY while active. All four edges
      // are followed (sidebar on the left, details panel on the right, desktop
      // chrome above/below, the 0.2.1 shell.bottom row) so the overlay can never
      // grow over stock UI. A measurement that stops being confident
      // deactivates the workspace (render gate) and the chrome chip says so.
      React.useEffect(() => {
        if (!active || minimized) return undefined;
        let raf = 0;
        const apply = () => {
          raf = 0;
          const next = measureColumnBounds();
          noteGeometry(next);
          // One warning per unconfident episode (cleared once geometry is
          // back), next to a REAL measurement — the render gate used to warn
          // from the placeholder bounds on every boot.
          if (!next.ok) {
            if (geometryWarnedRef.current !== true) {
              geometryWarnedRef.current = true;
              console.warn(LOG_PREFIX + " the conversation column could not be measured confidently on this shell; the split workspace stays inactive and the stock view keeps the viewport. Diagnose with window.__dshSplitWorkspace.health() (geometry + hostRelease). See README > Safety, recovery and diagnostics.");
            }
          } else if (geometryWarnedRef.current !== false) {
            geometryWarnedRef.current = false;
          }
          setBounds((prev) => {
            const same = prev.left === next.left && prev.right === next.right
              && prev.top === next.top && prev.bottom === next.bottom && prev.ok === next.ok;
            return same ? prev : next;
          });
        };
        const schedule = () => {
          if (raf === 0) raf = window.requestAnimationFrame(apply);
        };
        apply();
        let observer = null;
        // A ResizeObserver can lose its columns when the shell replaces a track
        // (right sidebar open/close, desktop window resize). A single missed
        // measurement used to leave the whole workspace invisible until the
        // next full reload; this low-frequency backstop re-measures regardless.
        let fallbackInterval = window.setInterval(schedule, 1000);
        let transitionHost = null;
        try {
          const overlayLayer = document.querySelector("[data-shell-overlay]");
          const frame = overlayLayer !== null && overlayLayer.parentElement !== null ? overlayLayer.parentElement : null;
          const columns = frame !== null ? frameColumns(frame) : [];
          if (columns.length > 0 && typeof ResizeObserver === "function") {
            observer = new ResizeObserver(schedule);
            const observed = new Set();
            for (const column of columns) {
              if (observed.has(column)) continue;
              observed.add(column);
              try { observer.observe(column); } catch {}
            }
            if (frame !== null) {
              transitionHost = frame;
              frame.addEventListener("transitionend", schedule);
            }
          }
        } catch {}
        window.addEventListener("resize", schedule);
        document.addEventListener("visibilitychange", schedule);
        return () => {
          if (raf !== 0) window.cancelAnimationFrame(raf);
          if (observer !== null) {
            try { observer.disconnect(); } catch {}
          }
          if (transitionHost !== null) transitionHost.removeEventListener("transitionend", schedule);
          if (fallbackInterval !== 0) window.clearInterval(fallbackInterval);
          window.removeEventListener("resize", schedule);
          document.removeEventListener("visibilitychange", schedule);
        };
      }, [active]);

      // Crash-loop guard timers: a deliberate activation is persisted BEFORE it
      // can crash; a healthy, responsive workspace clears the counter after
      // HEALTHY_AFTER_MS and refreshes lastHealthyAt at most every 30s.
      React.useEffect(() => {
        if (!active || bounds.ok !== true) return undefined;
        markActivationAttempt();
        const healthyTimer = window.setTimeout(() => { markHealthy(); }, HEALTHY_AFTER_MS);
        const refreshTimer = window.setInterval(() => { refreshHealthy(); }, HEALTHY_REFRESH_MS);
        return () => {
          try { window.clearTimeout(healthyTimer); } catch {}
          try { window.clearInterval(refreshTimer); } catch {}
        };
      }, [active, bounds.ok]);

      // One-time first-split tip.
      React.useEffect(() => {
        if (!operational) return;
        if (storageGet(HINT_KEY) === "1") return;
        setRuntime({ tipVisible: true });
      }, [operational]);

      // Click-to-load into the focused pane. S2 FIX: the old effect watched
      // every `aria-selected` change across the document and swapped the focused
      // pane on ANY programmatic selection change (teams navigation, hotkeys,
      // other plugins). Only a genuine click on a sidebar session row swaps now,
      // and only while the workspace is actually rendered (B3: no invisible
      // tree mutations from a geometry-blocked workspace).
      React.useEffect(() => {
        if (!operational) return undefined;
        const onClick = (event) => {
          if (event.defaultPrevented === true) return;
          if (dragPayload !== null) return;
          const target = event.target;
          if (target === null || target === undefined || typeof target.closest !== "function") return;
          let row = null;
          try { row = target.closest('[data-row-key^="session:"]'); } catch { return; }
          if (row === null) return;
          let key = null;
          try { key = row.getAttribute("data-row-key"); } catch { return; }
          if (key === null || key.indexOf("session:") !== 0) return;
          const id = key.slice("session:".length);
          if (id === "" || !isValidSessionId(id)) return;
          if (findLeafNode(treeStore.getSnapshot().root, id) !== null) {
            treeStore.setFocus(id);
            return;
          }
          // Clicking a conversation that is not one of the panes means "show me
          // this conversation". The overlay would cover it, so tuck the split
          // away and let the stock click open it in the single-session view.
          // The pane tree is kept; the restore chip brings the split back.
          minimizeWorkspace();
        };
        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
      }, [operational]);

      // S3 (1.7.0): follow the ROOT session binding, not only pointer clicks.
      // A sidebar click is not the only way the stock main view changes
      // conversation. dsh-session-hotkeys' Alt+Up/Down (and search, teams
      // navigation, and every other programmatic `uiWorkspace.openSession`
      // caller) move the SAME root binding through
      // `sessions.retain(id, { source: "mainView" })` but emit no DOM click.
      // The 1.6.0 click-only contract therefore left the panes on the previous
      // conversation while the covered stock view moved underneath — the S2
      // policy's cost, reported as "Alt+Up/Down doesn't behave like a click".
      // The selected sidebar row's `aria-selected` flag is the observable
      // carrier of that root move on 0.2.x (the client `sessions` service has
      // no list store there); the DOM list source already observes exactly
      // `aria-selected` / `data-row-key` while the workspace is operational, so
      // this subscription adds no extra DOM observation. The click fast path
      // above still swaps synchronously; this follower then no-ops because the
      // focused leaf already equals the target.
      React.useEffect(() => {
        if (!operational) return undefined;
        const source = sessionsListSource;
        if (source === undefined || source === null || typeof source.subscribe !== "function") return undefined;
        let last = currentSessionId();
        // Prime on mount: a tree restored from storage must not yank the
        // focused pane to whatever session happened to be selected at boot.
        let primed = last !== undefined && last !== null;
        let scheduled = false;
        const read = () => {
          scheduled = false;
          const next = currentSessionId();
          if (next === undefined || next === null) return;
          if (!primed) {
            primed = true;
            last = next;
            return;
          }
          if (next === last) return;
          last = next;
          const tree = treeStore.getSnapshot();
          if (tree === null || tree.root === null) return;
          if (tree.focus === next) return;
          if (findLeafNode(tree.root, next) !== null) {
            treeStore.setFocus(next);
            return;
          }
          // The stock New Session button navigates the main view to a fresh
          // blank session. The split overlay would hide it, so minimize the
          // split (tree kept) and show that single session; the restore chip
          // returns to the split.
          try {
            const snap = sessionsListSource.getSnapshot();
            const row = snap !== null && snap !== undefined && snap.byId !== undefined ? snap.byId[next] : undefined;
            if (row !== undefined && row !== null && row.blank === true) {
              minimizeWorkspace();
              return;
            }
          } catch {}
          minimizeWorkspace();
        };
        read();
        const unsubscribe = source.subscribe(() => {
          if (scheduled) return;
          scheduled = true;
          window.requestAnimationFrame(read);
        });
        return () => {
          unsubscribe();
        };
      }, [operational]);

      // 1.7.0: compaction is the one command whose outcome the native UI shows
      // only as a muted row at the transcript tail (and, when it is typed in a
      // pane, its inline composer notice can land in the covered stock page).
      // Watch the flow for a NEW manual-compaction row (in any pane or the
      // stock view) and announce the outcome with a transient toast, so
      // "/compact" is never silent.
      React.useEffect(() => {
        if (!operational) return undefined;
        if (typeof MutationObserver !== "function") return undefined;
        const seen = new WeakSet();
        const seenText = new Set();
        const noticePattern = /(compacted|no compactable|compaction could not|compact failed|已压缩|压缩未完成|没有可压缩)/i;
        const announceText = (node, text) => {
          if (node === null || node === undefined || seen.has(node)) return;
          seen.add(node);
          let clean = "";
          try { clean = String(text || "").replace(/\s+/g, " ").trim(); } catch {}
          if (clean === "" || clean.length > 400) return;
          if (seenText.has(clean)) return;
          seenText.add(clean);
          const failed = /could not|failed|失败|无法/i.test(clean);
          showPaneToast(t(failed ? "compactionFailed" : "compactionDone"));
        };
        const announce = (node) => {
          let text = "";
          try { text = node.textContent || ""; } catch {}
          announceText(node, text);
        };
        const scan = (root) => {
          if (root === null || root === undefined) return;
          try {
            if (typeof root.closest === "function" && root.closest(".dsv-toast") !== null) return;
            if (typeof root.matches === "function" && root.matches(COMPACTION_SELECTOR)) {
              announce(root);
              return;
            }
            if (typeof root.querySelectorAll !== "function") return;
            for (const node of root.querySelectorAll(COMPACTION_SELECTOR)) announce(node);
            // The no-history / rejection path renders a composer status line
            // (role=status) instead of a transcript row; detect that too.
            const statuses = [];
            if (typeof root.matches === "function" && root.matches('[role="status"]')) statuses.push(root);
            for (const node of root.querySelectorAll('[role="status"]')) statuses.push(node);
            for (const node of statuses) {
              let text = "";
              try { text = node.textContent || ""; } catch {}
              if (text !== "" && noticePattern.test(text)) announceText(node, text);
            }
          } catch {}
        };
        // Rows/notices already present when the split activates are not new
        // events (a re-render of the same row must not re-announce it).
        try {
          for (const node of document.querySelectorAll(COMPACTION_SELECTOR + ', [role="status"]')) {
            seen.add(node);
            const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
            if (text !== "" && text.length <= 400) seenText.add(text);
          }
        } catch {}
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const added = record.addedNodes;
            for (let i = 0; i < added.length; i += 1) {
              const node = added[i];
              if (node === null || node === undefined || node.nodeType !== 1) continue;
              scan(node);
            }
          }
        });
        try { observer.observe(document.body, { childList: true, subtree: true }); } catch { return undefined; }
        return () => {
          try { observer.disconnect(); } catch {}
        };
      }, [operational]);

      // NOTE: there is deliberately NO "auto-add the current conversation"
      // effect any more. The old one flipped the workspace on at boot —
      // covering the stock hero row (workspace chooser + agent presets) from
      // the very first render, which is exactly how "enabled the plugin and
      // could no longer pick a workspace / preset" happened. Splitting now
      // starts explicitly: drag a conversation onto the conversation column
      // (the inactive drag bridge), drop one onto a pane edge, or use the
      // pane-header split buttons.

      const pickerPick = (sessionId) => {
        const req = picker;
        if (req === null || req === undefined) return;
        if (findLeafNode(state.root, req.leafId) !== null) {
          treeStore.splitLeaf(req.leafId, req.dir, sessionId, "after");
        } else {
          treeStore.addPane(sessionId);
        }
      };

      // Render gates (after every hook): inactive/safe-mode/kill-switch →
      // nothing; unconfident geometry → nothing. Both fail toward the stock
      // view, never toward a wrong overlay.
      if (!active) return null;
      if (minimized) return null;
      if (!bounds.ok) return null;

      return h(
        "div",
        {
          className: "dsv-overlay",
          style: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          tabIndex: -1,
          "aria-label": t("label"),
          onKeyDown: (event) => {
            if (event.key !== "Escape") return;
            const target = event.target;
            if (target !== null && target !== undefined && typeof target.tagName === "string"
                && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
              return;
            }
            if (pickerRequest !== null) closePicker();
            else if (runtime.helpOpen === true) closeHelp();
          },
        },
        h(WorkspaceBody, { generation }),
        picker !== null && picker !== undefined ? h(SessionPicker, { request: picker, onPick: pickerPick }) : null,
        runtime.helpOpen === true ? h(HelpCard, null) : null,
      );
    }

    // ---------------------------------------------------------------------
    // inactive-mode drag bridge — the split entry point while the overlay is
    // off. Dragging a conversation from the stock sidebar onto the
    // conversation column (still showing the stock view) splits it: a fixed
    // ghost previews the target half, edge drops split there, a center drop
    // opens the second pane to the right. Document-level listeners, all
    // disposables-managed; they stand down the moment the workspace is
    // active (panes own their own drop zones then).
    // ---------------------------------------------------------------------

    /** Fixed ghost box over one half/zone of the conversation column. */
    function bridgeGhostStyle(rect, zone) {
      if (zone === null || zone.dir === null) {
        return { left: rect.left + 4, top: rect.top + 4, width: rect.width - 8, height: rect.height - 8 };
      }
      if (zone.dir === "h") {
        return zone.side === "before"
          ? { left: rect.left + 4, top: rect.top + 4, width: Math.round(rect.width / 2) - 8, height: rect.height - 8 }
          : { left: rect.left + Math.round(rect.width / 2) + 4, top: rect.top + 4, width: Math.round(rect.width / 2) - 8, height: rect.height - 8 };
      }
      return zone.side === "before"
        ? { left: rect.left + 4, top: rect.top + 4, width: rect.width - 8, height: Math.round(rect.height / 2) - 8 }
        : { left: rect.left + 4, top: rect.top + Math.round(rect.height / 2) + 4, width: rect.width - 8, height: Math.round(rect.height / 2) - 8 };
    }

    /** A session id the rendered sidebar actually knows (cheap single-row
        probe — no full-list scrape; the DOM source is idle while inactive). */
    function sidebarKnowsSession(id) {
      if (typeof id !== "string" || id === "") return false;
      try {
        const selector = '[data-row-key="session:' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id) + '"]';
        return document.querySelector(selector) !== null;
      } catch {
        return false;
      }
    }

    /** A session id the live list source knows (store path first, DOM probe
        as the 0.2.0 fallback). */
    function sessionKnownToList(id) {
      try {
        const snapshot = sessionsListSource !== undefined && sessionsListSource !== null
          && typeof sessionsListSource.getSnapshot === "function"
          ? sessionsListSource.getSnapshot()
          : null;
        if (snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.ids) && snapshot.ids.indexOf(id) !== -1) return true;
      } catch {}
      return sidebarKnowsSession(id);
    }

    /** Split-aware replacement for the Agent-Teams header action's
        openTeammate (wrapped per pane in entryInjectProps). Stock behavior
        navigates the MAIN view and guards on main-view retention, which a
        pane session rarely has — while the split workspace is active the
        click routes into the workspace instead: focus the member's existing
        pane, or split its conversation in beside the focused pane. Falls
        back to the stock action when the workspace is inactive or the target
        is not a list-known conversation (e.g. a detached member session the
        sidebar does not list). */
    function splitAwareOpenTeammate(original) {
      return (sessionId, childSessionId) => {
        try {
          if (treeStore.isActive() && typeof childSessionId === "string" && childSessionId !== "") {
            const leafIds = treeStore.leafIds();
            if (leafIds.indexOf(childSessionId) !== -1) {
              treeStore.setFocus(childSessionId);
              return;
            }
            if (sessionKnownToList(childSessionId)) {
              treeStore.addPane(childSessionId);
              return;
            }
            // Unknown to the list: let the stock action try the main view.
          }
        } catch {}
        try {
          original(sessionId, childSessionId);
        } catch {}
      };
    }

    function registerDragBridge() {
      let ghost = null;
      let invalidGhost = null;
      const removeGhost = () => {
        if (ghost !== null) {
          try { ghost.remove(); } catch {}
          ghost = null;
        }
      };
      const removeInvalidGhost = () => {
        if (invalidGhost !== null) {
          try { invalidGhost.remove(); } catch {}
          invalidGhost = null;
        }
      };
      /** Red refusal wash over the stock conversation while the dragged
          sidebar conversation is the one already on screen. */
      const showInvalidGhost = (rect) => {
        if (invalidGhost === null) {
          invalidGhost = document.createElement("div");
          invalidGhost.className = "dsv-pane-invalid";
          invalidGhost.dataset.plugin = PLUGIN_ID;
          invalidGhost.dataset.dsvFixed = "true";
          const card = document.createElement("div");
          card.className = "dsv-pane-invalid-card";
          const icon = document.createElement("span");
          icon.className = "dsv-pane-invalid-icon";
          icon.textContent = "⊘";
          const text = document.createElement("span");
          text.textContent = t("sameSessionCurrent");
          card.appendChild(icon);
          card.appendChild(text);
          invalidGhost.appendChild(card);
          document.body.appendChild(invalidGhost);
        }
        invalidGhost.style.left = rect.left + "px";
        invalidGhost.style.top = rect.top + "px";
        invalidGhost.style.width = rect.width + "px";
        invalidGhost.style.height = rect.height + "px";
      };
      const showGhost = (rect, zone) => {
        if (ghost === null) {
          ghost = document.createElement("div");
          ghost.className = "dsv-drop-ghost";
          ghost.dataset.plugin = PLUGIN_ID;
          ghost.dataset.dsvFixed = "true";
          const label = document.createElement("span");
          label.className = "dsv-drop-label";
          ghost.appendChild(label);
          document.body.appendChild(ghost);
        }
        const style = bridgeGhostStyle(rect, zone);
        ghost.style.left = style.left + "px";
        ghost.style.top = style.top + "px";
        ghost.style.width = style.width + "px";
        ghost.style.height = style.height + "px";
        ghost.firstChild.textContent = t(zone === null || zone.dir === null ? "dropMove" : zone.label);
      };
      /** S6 FIX: the bridge claims ONLY drags that provably carry a sidebar
          conversation. A capture-phase `dragstart` listener stamps the
          plugin's MIME (`application/x-dsv-session`) onto a stock session-row
          drag before any target handler runs; plain text/plain drags (selected
          chat text, links, text from other apps) are left entirely to the
          browser/stock drop targets. */
      const sessionDragInFlight = (event) => {
        if (dragPayload !== null) return false; // internal pane drag: panes own it
        const data = event.dataTransfer !== undefined && event.dataTransfer !== null ? event.dataTransfer : null;
        if (data === null) return false;
        try {
          if (Array.prototype.indexOf.call(data.types, "Files") !== -1) return false; // file drag: composer pipeline
          return Array.prototype.indexOf.call(data.types, MIME_SESSION) !== -1;
        } catch {
          return false;
        }
      };
      const onDragStart = (event) => {
        // Runs for every dragstart in the document (capture), but only stamps
        // when the drag source is a sidebar session row. Adding a data type is
        // allowed in dragstart and does not disturb the stock row's own
        // text/plain payload.
        try {
          const target = event.target;
          if (target === null || target === undefined || typeof target.closest !== "function") return;
          const row = target.closest('[data-row-key^="session:"]');
          if (row === null) return;
          const key = row.getAttribute("data-row-key");
          if (key === null || key.indexOf("session:") !== 0) return;
          const id = key.slice("session:".length);
          if (!isValidSessionId(id)) return;
          if (event.dataTransfer === null || event.dataTransfer === undefined) return;
          event.dataTransfer.setData(MIME_SESSION, id);
          beginDragPreview(rowDragTitle(row), t("dragHint"), paneElementForSession(id));
          externalDragSessionId = id;
          const blank = transparentDragImage();
          if (blank !== null) event.dataTransfer.setDragImage(blank, 0, 0);
        } catch {}
      };
      const onPreviewOver = (event) => {
        moveDragPreview(event.clientX, event.clientY);
      };
      const onDragOver = (event) => {
        if (!dsvOperational()) return;
        if (treeStore.isActive()) return; // panes handle drops while split
        if (!sessionDragInFlight(event)) return;
        const rect = columnRect();
        if (rect === null) return;
        const inside = event.clientX >= rect.left && event.clientX <= rect.left + rect.width
          && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
        if (!inside) {
          removeGhost();
          removeInvalidGhost();
          return;
        }
        const current = selectedSidebarSessionId() ?? currentSessionId();
        if (externalDragSessionId !== null
          && current !== undefined && current !== null
          && externalDragSessionId === current) {
          // Dropping the conversation that already fills the workspace is a
          // no-op; show why instead of a misleading split target.
          removeGhost();
          showInvalidGhost(rect);
          return;
        }
        removeInvalidGhost();
        event.preventDefault();
        try { event.dataTransfer.dropEffect = "move"; } catch {}
        const hit = zoneFor(rect, event.clientX, event.clientY);
        // A centre drop in the stock view lands as a right split (the first
        // pane keeps the current conversation). Show that half — the old
        // full-column "move here" ghost promised a move that cannot happen.
        const zone = hit.zone === null
          ? { dir: "h", side: "after", label: "dropSplitRight" }
          : { dir: hit.dir, side: hit.side, label: hit.label };
        showGhost(rect, zone);
      };
      const onDrop = (event) => {
        removeGhost();
        removeInvalidGhost();
        if (!dsvOperational()) return;
        if (treeStore.isActive() || dragPayload !== null) return;
        if (!sessionDragInFlight(event)) return;
        const rect = columnRect();
        if (rect === null) return;
        const inside = event.clientX >= rect.left && event.clientX <= rect.left + rect.width
          && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
        if (!inside) return;
        let droppedId = "";
        try {
          if (event.dataTransfer !== undefined && event.dataTransfer !== null) {
            droppedId = event.dataTransfer.getData(MIME_SESSION) || "";
            if (droppedId === "") droppedId = event.dataTransfer.getData("text/plain") || "";
          }
        } catch {
          droppedId = "";
        }
        droppedId = (droppedId || "").trim();
        if (droppedId === "" || !sidebarKnowsSession(droppedId)) return;
        const current = selectedSidebarSessionId() ?? currentSessionId();
        if (current === undefined || current === null || current === droppedId) return;
        event.preventDefault();
        event.stopPropagation();
        // First pane = the conversation the user is looking at; the dropped
        // one goes beside it. Two leaves ⇒ the activation gate turns the
        // workspace on.
        if (treeStore.leafIds().length === 0) treeStore.addPane(current);
        const anchor = treeStore.getSnapshot().focus ?? treeStore.leafIds()[0];
        const hit = zoneFor(rect, event.clientX, event.clientY);
        if (hit.zone === null) treeStore.splitLeaf(anchor, "h", droppedId, "after");
        else treeStore.splitLeaf(anchor, hit.zone.dir, droppedId, hit.zone.side);
      };
      const onDragLeaveWindow = (event) => {
        if (event.relatedTarget === null || event.relatedTarget === undefined) {
          removeGhost();
          removeInvalidGhost();
        }
      };
      document.addEventListener("dragstart", onDragStart, true);
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("dragover", onPreviewOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("drop", endDragPreview, true);
      document.addEventListener("dragleave", onDragLeaveWindow, true);
      document.addEventListener("dragend", removeGhost, true);
      document.addEventListener("dragend", removeInvalidGhost, true);
      document.addEventListener("dragend", endDragPreview, true);
      return () => {
        document.removeEventListener("dragstart", onDragStart, true);
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("dragover", onPreviewOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("drop", endDragPreview, true);
        document.removeEventListener("dragleave", onDragLeaveWindow, true);
        document.removeEventListener("dragend", removeGhost, true);
        document.removeEventListener("dragend", removeInvalidGhost, true);
        document.removeEventListener("dragend", endDragPreview, true);
        removeGhost();
        removeInvalidGhost();
        endDragPreview();
      };
    }

    // ---------------------------------------------------------------------
    // plugin apply
    // ---------------------------------------------------------------------

    /** Bring the split back. If a plugin/skills/settings panel is showing, the
        overlay would cover it, so first return the main view to the focused
        pane's conversation. */
    // ---------------------------------------------------------------------
    // transitions: minimize / exit / close used to swap the DOM in one frame.
    // They now play a short fade on the element that is about to disappear;
    // the new layout's width transitions + the pane entry animation carry the
    // rest. (View transitions are deliberately not used: the split overlay
    // contains live editors and dozens of panes re-render on a drop, and the
    // snapshot cost is not worth a 150ms effect.)
    // ---------------------------------------------------------------------
    let minimizeTimer = 0;
    let exitTimer = 0;
    const closingPaneSessions = new Set();
    function prefersReducedMotion() {
      try {
        return typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch { return false; }
    }
    function scheduleRightbarHeal(delay) {
      try { window.setTimeout(() => { try { rightbarSelfHeal(); } catch {} }, delay === undefined ? 400 : delay); } catch {}
    }
    function minimizeWorkspace() {
      const finish = () => {
        try { setRuntime({ minimized: true }); writeMinimized(true); } catch {}
        scheduleRightbarHeal(450);
      };
      try {
        const overlay = document.querySelector(".dsv-overlay");
        if (overlay === null || overlay === undefined || prefersReducedMotion()) { finish(); return; }
        overlay.classList.add("dsv-leaving");
        clearTimeout(minimizeTimer);
        minimizeTimer = setTimeout(finish, 150);
      } catch { finish(); }
    }
    function exitWorkspace() {
      const finish = () => {
        try {
          treeStore.reset();
          setRuntime({ minimized: false });
          writeMinimized(false);
        } catch {}
        // The stock view owns the rightbar again; repair a stale open/collapse
        // state the split teardown may have left behind.
        scheduleRightbarHeal(450);
      };
      try {
        const overlay = document.querySelector(".dsv-overlay");
        const target = overlay !== null && overlay !== undefined
          ? overlay
          : document.querySelector(".dsv-minimized-chip");
        if (target === null || target === undefined || prefersReducedMotion()) { finish(); return; }
        target.classList.add("dsv-leaving");
        clearTimeout(exitTimer);
        exitTimer = setTimeout(finish, 150);
      } catch { finish(); }
    }
    function closePaneAnimated(sessionId) {
      if (closingPaneSessions.has(sessionId)) return;
      const pane = paneElementForSession(sessionId);
      if (pane === null || pane === undefined || prefersReducedMotion()) {
        try { treeStore.closeLeaf(sessionId); } catch {}
        return;
      }
      closingPaneSessions.add(sessionId);
      pane.classList.add("dsv-pane-closing");
      setTimeout(() => {
        closingPaneSessions.delete(sessionId);
        try { treeStore.closeLeaf(sessionId); } catch {}
      }, 150);
    }

    function restoreSplit() {
      try {
        const tree = treeStore.getSnapshot();
        const sid = tree !== null && tree !== undefined
          ? (tree.focus !== null && tree.focus !== undefined ? tree.focus : treeStore.leafIds()[0])
          : undefined;
        const layout = pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
          ? pluginCtx.get("layout")
          : null;
        if (layout !== null && layout !== undefined && typeof layout.selectPanel === "function") {
          layout.selectPanel(null);
        }
        if (sid !== undefined && sid !== null) {
          const workspace = pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
            ? pluginCtx.get("uiWorkspace")
            : null;
          if (workspace !== null && workspace !== undefined && typeof workspace.openSession === "function") {
            workspace.openSession(sid);
          }
        }
      } catch {}
      setRuntime({ minimized: false });
      writeMinimized(false);
    }

    /** Sidebar-footer entry point: start a split with the current session plus
        the next listed session. Drag-to-split remains the primary gesture; this
        makes the feature discoverable without a pane already open. */
    function startSplitFromFooter() {
      try {
        if (treeStore.leafIds().length >= 2) {
          restoreSplit();
          return;
        }
        const list = sessionsListSource;
        const snap = list !== undefined && list !== null && typeof list.getSnapshot === "function" ? list.getSnapshot() : null;
        const ids = snap !== null && snap !== undefined
          ? (Array.isArray(snap.ids) ? snap.ids : Object.keys(snap.byId || {}))
          : [];
        const current = currentSessionId();
        const first = current !== undefined && current !== null ? current : ids[0];
        const second = ids.find((id) => id !== first);
        if (first !== undefined && first !== null) treeStore.addPane(first);
        if (second !== undefined && second !== null) treeStore.addPane(second);
      } catch {}
    }
    function FooterSplitButton() {
      return h("button", {
        type: "button",
        className: "dsv-footer-btn",
        title: t("openSplit"),
        "aria-label": t("openSplit"),
        onClick: startSplitFromFooter,
      }, h(SplitIconV, { size: 15 }));
    }

    /** True while apply() has installed the plugin; guards double-apply (a
        Cordis reload used to stack a second registration and a second batch
        of effects on top of the live one). */
    let appliedOnce = false;

    function apply(ctx) {
      if (appliedOnce) return;
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      appliedOnce = true;
      const locale = ctx.get("locale");
      pluginCtx = ctx;
      sessionsService = ctx.get("sessions");
      // 0.1.x exposes the live list store on the sessions service; 0.2.0 does
      // not, so the rendered sidebar stands in (same snapshot shape, see
      // createDomSessionListSource).
      const serviceList = sessionsService !== undefined && sessionsService !== null ? sessionsService.list : undefined;
      if (serviceList !== undefined && serviceList !== null) {
        sessionsListSource = serviceList;
      } else {
        const domSource = createDomSessionListSource();
        sessionsListSource = domSource;
        domListSourceDispose = () => domSource.dispose();
      }
      uiSessionService = ctx.get("uiSession");
      slotsService = slots;
      localeService = locale;

      if (locale !== undefined) {
        try {
          ctx.effect(() => {
            const d1 = locale.register("splitView", "zh-CN", ZH);
            const d2 = locale.register("splitView", "zh", ZH);
            const d3 = locale.register("splitView", "en", EN);
            return () => {
              d1();
              d2();
              d3();
            };
          });
          const bound = locale.bind("splitView");
          const previous = translate;
          translate = (key) => {
            try {
              const value = bound(key);
              if (typeof value === "string" && value !== "" && value !== key) return value;
            } catch {}
            return previous(key);
          };
        } catch {}
      }

      ctx.effect(() => {
        // ONE composition tracker for the whole document — see composingIn.
        document.addEventListener("compositionstart", noteComposition, true);
        document.addEventListener("compositionupdate", noteComposition, true);
        document.addEventListener("compositionend", noteComposition, true);
        document.addEventListener("focusout", retireComposition, true);
        return () => {
          document.removeEventListener("compositionstart", noteComposition, true);
          document.removeEventListener("compositionupdate", noteComposition, true);
          document.removeEventListener("compositionend", noteComposition, true);
          document.removeEventListener("focusout", retireComposition, true);
          composingSince.clear();
        };
      }, "dsh-split-workspace: IME composition tracker");

      ctx.effect(() => insertStyle(DSV_CSS), "dsh-split-workspace: stylesheet");

      // Global chords (Alt+T, Alt+Shift+Arrows) ride the plugin's OWN
      // lifetime now: the old module-scope listeners stacked on every reload
      // and were never removed.
      ctx.effect(registerGlobalKeys, "dsh-split-workspace: global keys");

      // Inactive-mode drag bridge: dragging a conversation onto the stock
      // conversation column starts the split.
      ctx.effect(registerDragBridge, "dsh-split-workspace: drag bridge");

      // Right-sidebar repair: the split teardown could leave the sidebar-right
      // store open while its column was closed (the corner button then vanished
      // with no way back) or leave a stock control writing to a seat nobody
      // rendered (clicks looked dead). Watch those controls and heal the state.
      ctx.effect(() => {
        document.addEventListener("click", onRightbarStockClick, true);
        const kick = window.setTimeout(() => { try { rightbarSelfHeal(); } catch {} }, 1400);
        const timer = window.setInterval(() => { try { rightbarSelfHeal(); } catch {} }, 2000);
        return () => {
          document.removeEventListener("click", onRightbarStockClick, true);
          window.clearTimeout(kick);
          window.clearInterval(timer);
        };
      }, "dsh-split-workspace: rightbar repair");

      // Live reflow while a pane is dragged inside the split (move + hole
      // preview). Capture-phase so the reflow owns the drop before a pane's
      // own HTML5 drop handler can also move it.
      ctx.effect(registerPaneReflow, "dsh-split-workspace: pane reflow");

      // Live preview while a conversation is dragged from the stock sidebar
      // into the split: the panes take their post-drop boxes and a hole shows
      // the new pane before the mouse is released.
      ctx.effect(registerExternalReflow, "dsh-split-workspace: external drop preview");

      ctx.effect(
        () => () => {
          sessionsService = undefined;
          sessionsListSource = undefined;
          if (domListSourceDispose !== null) {
            try {
              domListSourceDispose();
            } catch {}
            domListSourceDispose = null;
          }
          uiSessionService = undefined;
          slotsService = undefined;
          localeService = undefined;
          conversationT = null;
          dragPayload = null;
          pluginCtx = null;
          hostFaceCache = null;
          paneChatStores.clear();
          // Full teardown of the module-level registries: every retained
          // session reference, editor guard, intake hook and subscription
          // used to survive a plugin unload and leak into the next load.
          for (const reference of paneSessionReferences.values()) {
            try {
              if (reference !== null && typeof reference.release === "function") reference.release();
            } catch {}
          }
          paneSessionReferences.clear();
          for (const guard of paneEditorGuards.values()) {
            try {
              if (guard !== null && typeof guard.dispose === "function") guard.dispose();
            } catch {}
          }
          paneEditorGuards.clear();
          for (const timer of paneDisposeChecks.values()) {
            try { window.clearTimeout(timer); } catch {}
          }
          paneDisposeChecks.clear();
          paneLiveRefs.clear();
          for (const resolver of sessionFaceResolvers.values()) {
            try { resolver.dispose(); } catch {}
          }
          sessionFaceResolvers.clear();
          paneRetainFailures.clear();
          for (const unsubscribe of paneTypingUnsubs.values()) {
            try { unsubscribe(); } catch {}
          }
          paneTypingUnsubs.clear();
          chatScrollMemory.clear();
          lastSessionSummaries.clear();
          entryStoreCache.clear();
          clearEntryInjectCache();
          paneImageIntake.clear();
          paneKitWarned.clear();
          rootPendingBySession.clear();
          rootPendingListeners.clear();
          for (const key of Object.keys(captureLog)) delete captureLog[key];
          paneDebug.faces = {};
          paneDebug.last = null;
          composerChainDebug.last = null;
          rootStandard.value = null;
          rootStandard.pending = null;
          rootStandard.pendingGeneration = false;
          rootStandard.listeners.clear();
          composerModeStore.clear();
          composingSince.clear();
          lastTypedSessionId = null;
          // S9: translate used to wrap itself on every apply (closure chain
          // growth); reset to the EN fallback so a reload starts clean.
          translate = FALLBACK_TRANSLATE;
          activationMarked = false;
          failureWindow.length = 0;
          failureLog.clear();
          setRuntime({ active: false, geometryBlocked: false, helpOpen: false, tipVisible: false });
          appliedOnce = false;
        },
        "dsh-split-workspace: service cleanup",
      );

      // The workspace rides inside a fail-open boundary AND hosts the plugin's
      // own chrome (safe-mode / blocked chip). SplitWorkspaceSeat is keyed by
      // the retry epoch, so a latched boundary can be remounted deliberately
      // instead of looping.
      slots.inject("shell.overlay", () =>
        slots.register({ name: "shell.overlay", id: "split-view-workspace", order: 0, label: () => t("label") }, (props) =>
          h(SplitWorkspaceSeat, props),
        ),
      );
      slots.inject("sidebar.footer.action", () =>
        slots.register({ name: "sidebar.footer.action", id: "split-workspace", order: 30, label: () => t("openSplit") }, () =>
          h(FooterSplitButton),
        ),
      );
    }

    // dsh 0.1.5: client services (sessions/locale) are provided asynchronously
    // after the module map finishes loading. Without this declaration the
    // client plugin boots first, caches undefined services, and silently
    // renders empty panes. Cordis holds apply() until every listed service is
    // live; all three are available within ~3s on 0.1.5-rc.2.
    exports.inject = ["slots", "sessions", "locale", "uiSession"];
    exports.apply = apply;
    return module.exports;
  },
});
