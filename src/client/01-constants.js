    // ---------------------------------------------------------------------
    // constants + locale
    // ---------------------------------------------------------------------

    const PLUGIN_ID = "dsh-split-workspace";
    const PLUGIN_VERSION = "0.8.0";
    const LOG_PREFIX = "[dsh-split-workspace]";
    const TREE_KEY = "dsh.split-workspace.tree.v1";
    const OPEN_KEY = "dsh.split-workspace.open.v2";
    const RAIL_KEY = "dsh.split-workspace.rail.v1";
    const ENABLED_KEY = "dsh.split-workspace.enabled.v1";
    const HEALTH_KEY = "dsh.split-workspace.health.v1";
    const HINT_KEY = "dsh.split-workspace.hint.v1";
    const MIN_KEY = "dsh.split-workspace.minimized.v1";
    const CHIP_KEY = "dsh.split-workspace.chip.v1";
    const FLOAT_KEY = "dsh.split-workspace.float.v1";
    const PERF_KEY = "dsh.split-workspace.performance.v1";
    const SEEN_VERSION_KEY = "dsh.split-workspace.seen-version.v1";
    const UPDATE_DISMISSED_KEY = "dsh.split-workspace.update-dismissed.v1";
    const UPDATE_POLL_MS = 120000;
    /** `#dsvWindow=<sessionId>` marks a standalone system window opened by
        the Host route: that page renders exactly one conversation and nothing
        else (the split workspace and floats are skipped there). Read lazily on
        every seat render: the fragment can be applied after a plugin bundle is
        evaluated on some hosts, so a load-time snapshot is not reliable. */
    function standaloneSessionId() {
      try {
        if (typeof window === "undefined" || window.location === undefined) return null;
        const hash = String(window.location.hash || "");
        if (hash.length < 2) return null;
        const id = new URLSearchParams(hash.slice(1)).get("dsvWindow");
        return id !== null && id !== undefined && id !== "" && isValidSessionId(id) ? id : null;
      } catch {
        return null;
      }
    }
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
    /** Performance mode is a persisted, user-visible preference: it trades
        optional observers / animations for responsiveness on slow machines. */
    function readPerformanceMode() {
      return storageGet(PERF_KEY) === "1";
    }
    function writePerformanceMode(value) {
      storageSet(PERF_KEY, value === true ? "1" : "0");
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
    /** Cached preview box (px). Reading offsetWidth in the rAF loop forced a
        layout of the preview document on every pointer move. */
    let dragPreviewW = 224;
    let dragPreviewH = 64;
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
        // The stock transcript exposes data-conversation-scroll; use it
        // directly instead of scanning every scroll-classed node at dragstart.
        // The old scan resolved textContent for each candidate, which cost a
        // long task on a large conversation before the first drag frame.
        let source = pane.querySelector("[data-conversation-scroll]");
        if (source === null) {
          let sourceLength = 0;
          for (const node of pane.querySelectorAll('[class*="scroll"]')) {
            const length = (node.textContent || "").length;
            if (length > sourceLength) { source = node; sourceLength = length; }
          }
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
      const simpleOnly = (typeof window !== "undefined" && window.__DSV_SIMPLE_PREVIEW === true)
        || performanceModeOn();
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
            dragPreviewW = width;
            dragPreviewH = height;
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
            dragPreviewW = width;
            dragPreviewH = height;
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
        dragPreviewW = el.offsetWidth || 224;
        dragPreviewH = el.offsetHeight || 64;
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
          const width = dragPreviewW > 0 ? dragPreviewW : 224;
          const height = dragPreviewH > 0 ? dragPreviewH : 64;
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
      dragPreviewW = 224;
      dragPreviewH = 64;
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
    const TESTED_RELEASES = ["0.2.0-rc.2", "0.2.1-rc.2", "0.2.2-rc.3"];
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
      helpGestures: "Use the sidebar-footer split menu (Add split / Exit split / Minimize / Reset split) or drag a conversation from the sidebar onto the page to start a split. Right-click a conversation for Add to split / Leave split / Enter floating window; a floating window's Dock to split button puts it back. Drag a pane by its header to move it: its slot closes and a dashed hole previews where it will land. Drag the dividers to resize. ✕ closes a pane.",
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
      menuTitle: "Split view menu",
      menuAddSplit: "Add split",
      menuAddToSplit: "Add to split",
      menuMinimizeSplit: "Minimize split",
      menuResetSplit: "Reset split",
      resetDone: "Split view data cleared — layout, cache and temporary state were removed.",
      pendingAdded: "Added to the pending split. Add one more conversation to start splitting.",
      pendingBadge: "{n} pending",
      addSplitTitle: "Add split",
      addSplitHint: "Select the conversations to split. Unchecking a pane removes it; fewer than two conversations exits split view.",
      addSplitSelected: "{n} selected",
      addSplitConfirm: "OK",
      addSplitCancel: "Cancel",
      addSplitEmpty: "No conversations available",
      addSplitInSplit: "In split",
      addSplitPending: "Pending",
      splitExited: "Split view closed",
      splitLeft: "Left split view",
      menuFloatOpen: "Enter floating window",
      menuFloatClose: "Exit floating window",
      floatDock: "Dock to split",
      floatClose: "Close floating window",
      floatEntered: "Opened in a floating window",
      floatDocked: "Docked to the split view",
      floatClosed: "Floating window closed",
      floatHint: "Drag the title bar to move · drag an edge to resize",
      helpFloat: "Right-click a conversation → Enter floating window detaches it into a movable window; Dock to split puts it back.",
      menuSystemWindow: "Open in system window",
      systemWindowOpened: "Opened in a separate system window",
      systemWindowFailed: "Could not open a system window",
      standaloneFullscreen: "Fullscreen",
      performanceMode: "Performance mode",
      performanceOn: "Performance mode on — animations and background observers are reduced",
      performanceOff: "Performance mode off",
      reloadClient: "Reload interface",
      refreshInterface: "Refresh interface",
      updateReady: "Version {v} is installed — reload to apply",
      updateRestart: "Version {v} is installed — restart DSH to apply",
      reloadNow: "Reload now",
      gotIt: "Got it",
      laterLabel: "Later",
      updatedToast: "Updated to v{v}",
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
      helpGestures: "点击侧边栏底部的分屏按钮打开菜单（添加分屏 / 退出分屏 / 最小化分屏 / 重置分屏），或从左侧会话列表把对话拖到页面即可分屏；右键会话可加入 / 退出分屏，也可以“进入浮窗”把会话变成独立浮窗（浮窗标题栏的“回到分屏”可放回）。拖住面板标题栏可移动面板：原位置收起，虚线空位预览落点。拖动分隔条可调整大小，✕ 关闭面板。",
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
      menuTitle: "分屏菜单",
      menuAddSplit: "添加分屏",
      menuAddToSplit: "加入分屏",
      menuMinimizeSplit: "最小化分屏",
      menuResetSplit: "重置分屏",
      resetDone: "分屏数据已重置 — 布局、缓存与临时状态已清空。",
      pendingAdded: "已加入待分屏，再添加一个会话即可开始分屏。",
      pendingBadge: "{n} 个待分屏",
      addSplitTitle: "添加分屏",
      addSplitHint: "勾选要分屏的会话；取消勾选会移除对应面板，少于两个会话将退出分屏。",
      addSplitSelected: "已选 {n} 个",
      addSplitConfirm: "确定",
      addSplitCancel: "取消",
      addSplitEmpty: "没有可用的会话",
      addSplitInSplit: "分屏中",
      addSplitPending: "待分屏",
      splitExited: "已退出分屏",
      splitLeft: "已退出分屏",
      menuFloatOpen: "进入浮窗",
      menuFloatClose: "退出浮窗",
      floatDock: "回到分屏",
      floatClose: "关闭浮窗",
      floatEntered: "已在浮窗中打开",
      floatDocked: "已回到分屏",
      floatClosed: "浮窗已关闭",
      floatHint: "拖动标题栏移动 · 拖动边缘调整大小",
      helpFloat: "右键会话 → 进入浮窗，可把该会话变成独立浮窗；浮窗标题栏的“回到分屏”可放回分屏。",
      menuSystemWindow: "在系统窗口打开",
      systemWindowOpened: "已在独立系统窗口中打开",
      systemWindowFailed: "无法打开系统窗口",
      standaloneFullscreen: "全屏",
      performanceMode: "性能模式",
      performanceOn: "性能模式已开启：动画与后台观察器已精简",
      performanceOff: "性能模式已关闭",
      reloadClient: "重载界面",
      refreshInterface: "刷新界面",
      updateReady: "已安装 v{v}，刷新页面生效",
      updateRestart: "已安装 v{v}，请重启 DSH 后生效",
      reloadNow: "刷新页面",
      gotIt: "知道了",
      laterLabel: "稍后",
      updatedToast: "已更新到 v{v}",
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

