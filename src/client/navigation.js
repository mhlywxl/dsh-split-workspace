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
    Object.assign(pluginPublicApi(), {
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
          if (ids.length <= 2) {
            try { treeStore.closeLeaf(id); } catch {}
            scheduleRightbarHeal(450);
            return { exit: true, remaining: treeStore.leafIds().length };
          }
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
      /** Hard reset: also wipes every plugin-owned localStorage/sessionStorage
          key and the pane runtime caches, so a split can always start again. */
      resetAll() {
        return safeCall("resetAll()", resetSplitEnvironment, { reset: false, cleared: 0 });
      },
      /** Add one session to the split (or park it in the pending split while
          the workspace is inactive). */
      addToSplit(sessionId) {
        return safeCall("addToSplit()", () => addSessionToSplit(sessionId), false);
      },
      /** Remove one session from the split / pending pick. Dropping to one
          pane exits split mode. */
      removeFromSplit(sessionId) {
        return safeCall("removeFromSplit()", () => removeSessionFromSplit(sessionId), false);
      },
      /** Enter floating-window mode for one session (detaches a split pane). */
      float(sessionId) {
        return safeCall("float()", () => floatSession(sessionId), false);
      },
      /** Dock a floating window back into the split (or the pending pick). */
      dockFloat(sessionId) {
        return safeCall("dockFloat()", () => dockFloatToSplit(sessionId), false);
      },
      /** Close one floating window without docking it. */
      closeFloat(sessionId) {
        return safeCall("closeFloat()", () => closeFloatWindow(sessionId), false);
      },
      /** Current floating-window ids, in stable creation order. */
      floats() {
        return safeCall("floats()", () => floatStore.ids(), []);
      },
      /** Open one conversation in the app-internal independent window. */
      openSystemWindow(sessionId) {
        return safeCall("openSystemWindow()", () => openSystemWindow(sessionId), false);
      },
      /** Alias for openSystemWindow: independent of any browser window. */
      openIndependentWindow(sessionId) {
        return safeCall("openIndependentWindow()", () => openSystemWindow(sessionId), false);
      },
      /** Open one conversation in a real OS window (macOS native window). */
      openNativeWindow(sessionId) {
        return safeCall("openNativeWindow()", () => requestSystemWindow(sessionId, "open"), false);
      },
      /** Close the native OS window currently showing one conversation. */
      closeNativeWindow(sessionId) {
        return safeCall("closeNativeWindow()", () => requestSystemWindow(sessionId, "close"), false);
      },
      /** Session ids whose native OS window is currently open. */
      nativeWindows() {
        return safeCall("nativeWindows()", () => nativeWindowStore.getSnapshot().slice(), []);
      },
      /** Host diagnostics for the system window (log tail; tokens redacted). */
      systemWindowLog() {
        return safeCall("systemWindowLog()", () => systemWindowLog(), Promise.resolve(""));
      },
      /** Current independent-window state ({ id, minimized, maximized } or null). */
      appWindow() {
        return safeCall("appWindow()", () => (runtimeState.appWindow === null ? null : Object.assign({}, runtimeState.appWindow)), null);
      },
      /** Toggle performance mode (persisted; reduces animations/observers). */
      setPerformanceMode(flag) {
        return safeCall("setPerformanceMode()", () => setPerformanceMode(flag !== false), false);
      },
      /** Current performance-mode flag. */
      performanceMode() {
        return safeCall("performanceMode()", () => performanceModeOn(), false);
      },
      /** Toggle the live-resize canvas freeze (performance-mode refinement). */
      setResizeFreeze(flag) {
        return safeCall("setResizeFreeze()", () => setResizeFreeze(flag !== false), false);
      },
      resizeFreeze() {
        return safeCall("resizeFreeze()", () => resizeFreezeOn(), true);
      },
      /** Reload the page to pick up an updated client bundle (same as Ctrl+R). */
      reloadClient() {
        return safeCall("reloadClient()", () => { try { location.reload(); } catch {} return true; }, false);
      },
      /** Close and reopen DSH Desktop so changes that need a full restart load. */
      restartApp() {
        return safeCall("restartApp()", () => { restartApplication(); return true; }, false);
      },
      /** Sessions waiting for a second pick before the split starts. */
      pending() {
        return safeCall("pending()", () => pendingSplitStore.ids(), []);
      },
      /** Open the add-split dialog programmatically (footer menu equivalent). */
      openAddSplitDialog() {
        return safeCall("openAddSplitDialog()", () => { openAddSplitDialog("footer"); return true; }, false);
      },
      /** Clear crash counters/safe mode and re-activate the kept tree. */
      retry() {
        return safeCall("retry()", retryWorkspace, false);
      },
      /** Kill switch (persisted): false = never take over the viewport. */
      setEnabled(flag) {
        return safeCall("setEnabled()", () => setEnabled(flag !== false), runtimeState.enabled);
      },
      /** Diagnostics: ids of the entries captured for one slot. */
      composerEntries(name) {
        return safeCall("composerEntries()", () => {
          if (typeof name !== "string" || name === "") return [];
          const out = [];
          for (const entry of capturedEntries(name)) {
            const parts = entryParts(entry);
            const id = parts !== null && parts.options !== null && parts.options !== undefined
              ? parts.options.id : undefined;
            out.push(id !== undefined ? String(id) : "");
          }
          return out;
        }, []);
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
    definePublicMember("__svc", {
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
    // logic under test is the logic that runs on the user's host. It is
    // deliberately non-configurable; the fresh per-execution API object (see
    // pluginPublicApi) is what keeps a live bundle replacement from throwing
    // `Cannot redefine property`.
    definePublicMember("__test", {
      value: Object.freeze({
        frameColumns,
        selectFrameColumns,
        computeColumnBounds,
        measureColumnBounds,
        frameChildrenSnapshot,
        rectSnapshot,
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
      const performanceMode = useRuntime().performance === true;
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
        timer = window.setInterval(sync, performanceMode ? 3500 : 800);
        window.addEventListener("resize", sync);
        return () => {
          window.clearInterval(timer);
          window.removeEventListener("resize", sync);
          if (observer !== null) {
            try { observer.disconnect(); } catch {}
          }
        };
      }, [performanceMode]);
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

    // ---------------------------------------------------------------------
    // third-party composer-anchored overlay compatibility
    //
    // Prompt-enhancement plugins address the composer with GLOBAL lookups:
    // `document.querySelector("[data-composer-card]")` (dsh-prompt-history's
    // ghost/prediction overlay, dsh-agent-preset's anchor) or a keydown
    // handler scoped through `anchor.closest("[data-composer-card]")`. Those
    // selectors were written for the stock single-composer page. In split
    // view the hidden stock page still owns the FIRST composer card in
    // document order, so such a plugin measured the covered composer and
    // painted its suggestion at the stock position (or, with several panes,
    // at the first pane rather than the focused one).
    //
    // The bridge keeps the selector truthful without touching third-party
    // code: every pane card gets `data-dsv-composer-card` for this plugin's
    // own measurements, the hidden stock card loses `data-composer-card`
    // while split is active, and only the FOCUSED pane card carries
    // `data-composer-card`. A plugin's global query therefore resolves to
    // the pane the user is typing in, on focus, before the next keydown.
    // Attribute values are restored on deactivate.
    // ---------------------------------------------------------------------
    let composerAnchorBridge = null;

    function paneCardOf(pane) {
      try {
        return pane.querySelector("[data-dsv-composer-card], [data-composer-card]");
      } catch { return null; }
    }

    function installComposerAnchorBridge() {
      if (composerAnchorBridge !== null) {
        composerAnchorBridge.refresh();
        return composerAnchorBridge;
      }
      const state = {
        activePane: null,
        stock: new Map(), // stock card -> was it originally marked?
        seat: null,
        seatObserver: null,
        seatFrame: 0,
        timer: 0,
        lastSyncAt: 0,
      };
      // Scoped global selectors: prompt-enhancement plugins read the
      // transcript with document.querySelector(All) (dsh-prompt-history's
      // buildContext reads [data-chat-anchor-key], its observer watches
      // [data-conversation-scroll]). Those globals resolve to the hidden
      // stock page or the first/last pane, so a pane predicted from another
      // conversation. While split is active the same selectors resolve inside
      // the ACTIVE pane; every other selector is untouched.
      const nativeDocumentQuerySelector = document.querySelector.bind(document);
      const nativeDocumentQuerySelectorAll = document.querySelectorAll.bind(document);
      const SCOPED_GLOBAL_SELECTORS = new Set([
        "[data-conversation-scroll]",
        "[data-chat-anchor-key]",
        "[data-conversation-content]",
        "[data-conversation-session]",
      ]);
      function scopedGlobalQuery(selector, all) {
        const pane = state.activePane;
        if (pane !== null && pane.isConnected && typeof selector === "string" && SCOPED_GLOBAL_SELECTORS.has(selector)) {
          try {
            return all ? pane.querySelectorAll(selector) : pane.querySelector(selector);
          } catch {}
        }
        return all ? nativeDocumentQuerySelectorAll(selector) : nativeDocumentQuerySelector(selector);
      }
      try {
        document.querySelector = function querySelector(selector) { return scopedGlobalQuery(String(selector), false); };
        document.querySelectorAll = function querySelectorAll(selector) { return scopedGlobalQuery(String(selector), true); };
      } catch {}

      const observer = typeof MutationObserver === "function"
        ? new MutationObserver((records) => {
            for (const record of records) {
              const card = record.target;
              if (card === null || card === undefined || !(card instanceof Element)) continue;
              // React owns the stock composer and re-applies its declarative
              // attr on some updates; the covered card must stay unmarked.
              if (card.closest(".dsv-pane") === null && card.hasAttribute("data-composer-card")) {
                card.removeAttribute("data-composer-card");
              }
            }
          })
        : null;

      if (typeof MutationObserver === "function") {
        state.seatObserver = new MutationObserver(() => {
          if (state.seatFrame !== 0) return;
          // Perf mode: streaming mutates the overlay continuously. Sync at most
          // twice a second instead of once per animation frame.
          if (performanceModeOn()) {
            const now = Date.now();
            if (now - state.lastSyncAt < 500) return;
            state.lastSyncAt = now;
          }
          const run = () => { state.seatFrame = 0; sync(); };
          state.seatFrame = typeof requestAnimationFrame === "function"
            ? requestAnimationFrame(run)
            : setTimeout(run, 0);
        });
      }

      /** Drop the page-singleton prediction before its pane stops being the
          active one. dsh-prompt-history owns ONE module-level ghost node; its
          Escape handler is the only public way to reset that node before the
          inactive instance unmounts. */
      function dismissComposerPrediction(pane) {
        if (pane === null || pane === undefined || !pane.isConnected) return;
        const input = pane.querySelector("[data-composer-input]");
        if (input === null) return;
        try {
          input.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Escape", code: "Escape", bubbles: true, cancelable: true,
          }));
        } catch {}
      }

      function publishActivePane() {
        const pane = state.activePane;
        const id = pane !== null && pane.isConnected ? pane.getAttribute("data-dsv-pane") : null;
        setActiveComposerPaneId(id);
        try { composerChainDebug.activePane = id; } catch {}
      }

      function paneForTarget(target) {
        if (target === null || target === undefined || typeof target.closest !== "function") return null;
        return target.closest(".dsv-pane[data-dsv-pane]");
      }

      /** Re-scan when the stock composer is remounted behind the overlay
          (session switches replace the card). Observing only the stock
          composer seat keeps transcript streaming out of this path. */
      function watchStockSeat(card) {
        const seat = card.closest("[data-composer-seat]");
        if (seat === null || seat === state.seat || state.seatObserver === null) return;
        if (state.seat !== null) {
          try { state.seatObserver.disconnect(); } catch {}
        }
        state.seat = seat;
        try { state.seatObserver.observe(seat, { childList: true, subtree: true }); } catch {}
      }

      function adoptStock(card) {
        if (card === null || card === undefined) return;
        if (!state.stock.has(card)) {
          state.stock.set(card, card.hasAttribute("data-composer-card"));
          if (observer !== null) {
            try { observer.observe(card, { attributes: true, attributeFilter: ["data-composer-card"] }); } catch {}
          }
          watchStockSeat(card);
        }
        if (card.hasAttribute("data-composer-card")) card.removeAttribute("data-composer-card");
      }

      function paneCards() {
        const out = [];
        for (const pane of document.querySelectorAll(".dsv-pane[data-dsv-pane]")) {
          const card = paneCardOf(pane);
          if (card === null) continue;
          if (!card.hasAttribute("data-dsv-composer-card")) card.setAttribute("data-dsv-composer-card", "");
          out.push({ pane, card });
        }
        return out;
      }

      function sync() {
        const cards = paneCards();
        if (state.activePane === null || !state.activePane.isConnected) {
          state.activePane = document.querySelector(".dsv-pane.focused") || (cards.length > 0 ? cards[0].pane : null);
        }
        for (const entry of cards) {
          if (entry.pane === state.activePane) {
            if (!entry.pane.hasAttribute("data-dsv-composer-active")) entry.pane.setAttribute("data-dsv-composer-active", "");
            if (!entry.card.hasAttribute("data-composer-card")) entry.card.setAttribute("data-composer-card", "true");
          } else {
            if (entry.pane.hasAttribute("data-dsv-composer-active")) entry.pane.removeAttribute("data-dsv-composer-active");
            if (entry.card.hasAttribute("data-composer-card")) entry.card.removeAttribute("data-composer-card");
          }
        }
        for (const card of document.querySelectorAll("[data-composer-card]")) {
          if (card.closest(".dsv-pane") === null) adoptStock(card);
        }
        publishActivePane();
      }

      function refresh() {
        // New panes arrive after tree commits; pick up their cards and, when
        // the previous active pane is gone, fall back to the focused one.
        sync();
      }

      function activate(pane) {
        if (pane === null || pane === undefined || !pane.isConnected) return;
        if (state.activePane === pane) { sync(); return; }
        dismissComposerPrediction(state.activePane);
        state.activePane = pane;
        sync();
      }

      const onFocusIn = (event) => { activate(paneForTarget(event.target)); };
      const onPointerDown = (event) => { activate(paneForTarget(event.target)); };

      /** Accept a visible dsh-prompt-history prediction for the ACTIVE pane.
          The plugin's own Tab handler lives on the document and its hidden
          stock copy would write the first pane; this runs at window capture,
          stops every downstream handler, clears the shared ghost and writes
          the active pane's draft through its own inputActions. */
      const onSuggestionAccept = (event) => {
        if (event.key !== "Tab" && event.key !== "ArrowRight") return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const pane = paneForTarget(event.target);
        if (pane === null || pane !== state.activePane) return;
        const input = pane.querySelector("[data-composer-input]");
        if (input === null || String(input.textContent || "").trim() !== "") return;
        const ghost = document.querySelector(".dsh-ph-suggest");
        if (ghost === null || ghost.classList.contains("dsh-ph-suggest--pending")) return;
        const textEl = ghost.querySelector(".dsh-ph-suggest-text");
        const text = textEl !== null ? String(textEl.textContent || "").trim()
          : String(ghost.textContent || "").replace(/\s*(?:按\s*Tab\s*键?接受|Press\s+Tab[^ ]*).*$/i, "").trim();
        if (text === "") return;
        const actions = composerActionsBySession.get(pane.getAttribute("data-dsv-pane"));
        if (actions === undefined || typeof actions.setDraft !== "function") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // Clear the plugin's shared ghost first, then write this pane's draft.
        try {
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        } catch {}
        try { actions.setDraft(text); } catch {}
      };
      window.addEventListener("keydown", onSuggestionAccept, true);

      document.addEventListener("focusin", onFocusIn, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      refresh();
      // A pane composer can be remounted by a session/view switch without a
      // focus change. Re-assert the marker cheaply (writes only when needed)
      // so a global lookup can never fall back to the hidden stock card.
      state.timer = window.setInterval(sync, 1000);
      // Panes mount in stages (the composer can appear a frame after the
      // frame); one deferred pass catches that without a permanent observer.
      let late = 0;
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        late = window.setTimeout(refresh, 120);
      }

      function dispose() {
        try {
          document.querySelector = nativeDocumentQuerySelector;
          document.querySelectorAll = nativeDocumentQuerySelectorAll;
        } catch {}
        window.removeEventListener("keydown", onSuggestionAccept, true);
        document.removeEventListener("focusin", onFocusIn, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
        composerActionsBySession.clear();
        if (observer !== null) { try { observer.disconnect(); } catch {} }
        if (state.seatObserver !== null) { try { state.seatObserver.disconnect(); } catch {} }
        if (state.timer !== 0) { try { window.clearInterval(state.timer); } catch {} state.timer = 0; }
        if (state.seatFrame !== 0) {
          try {
            if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.seatFrame);
            else clearTimeout(state.seatFrame);
          } catch {}
          state.seatFrame = 0;
        }
        if (late !== 0) { try { window.clearTimeout(late); } catch {} }
        // Restore the stock page's marker and re-mark every pane card: the
        // workspace is leaving, so the stock card must own the selector again.
        for (const [card, had] of state.stock) {
          if (!card.isConnected) continue;
          if (had && !card.hasAttribute("data-composer-card")) card.setAttribute("data-composer-card", "true");
        }
        for (const pane of document.querySelectorAll(".dsv-pane[data-dsv-pane]")) {
          const card = paneCardOf(pane);
          if (card !== null && !card.hasAttribute("data-composer-card")) card.setAttribute("data-composer-card", "true");
          pane.removeAttribute("data-dsv-composer-active");
        }
        setActiveComposerPaneId(null);
        composerAnchorBridge = null;
      }

      composerAnchorBridge = { refresh, sync, dispose, state };
      return composerAnchorBridge;
    }

    /** Refcounted bridge ownership: the split body and the float layer can
        both host pane composers, and whichever unmounts last disposes. */
    let composerAnchorBridgeRefs = 0;
    function acquireComposerAnchorBridge() {
      installComposerAnchorBridge();
      composerAnchorBridgeRefs += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        composerAnchorBridgeRefs = Math.max(0, composerAnchorBridgeRefs - 1);
        if (composerAnchorBridgeRefs === 0 && composerAnchorBridge !== null) {
          try { composerAnchorBridge.dispose(); } catch {}
          composerAnchorBridge = null;
        }
      };
    }

    const WorkspaceBody = React.memo(function WorkspaceBody({ generation }) {
      const state = useTree();
      React.useLayoutEffect(() => {
        const release = acquireComposerAnchorBridge();
        return release;
      }, []);
      // A pane add/close/move mounts new composer cards after this commit.
      React.useEffect(() => {
        if (composerAnchorBridge !== null) composerAnchorBridge.refresh();
      }, [state.root]);
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
