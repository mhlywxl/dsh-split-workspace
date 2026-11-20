    // split launcher + session membership (0.5.0)
    //
    // The sidebar footer button opens a small menu (add / exit / minimize /
    // reset) and the "add split" dialog multi-selects conversations. Both are
    // rendered from the always-mounted shell.overlay seat, so neither is
    // clipped by the sidebar column nor covered by the split overlay. The
    // session-row menus contribute the same four membership/window actions
    // through two surfaces: the stock "⋯" session menu (every supported build,
    // including 0.2.0/0.2.1 which have no session right-click menu) and the
    // host's contextMenus service (0.2.2+). The stock menu keeps owning the
    // presentation, so the contributions disappear when this plugin unloads.
    // ---------------------------------------------------------------------

    function usePendingSplit() {
      return React.useSyncExternalStore(
        pendingSplitStore.subscribe,
        pendingSplitStore.getSnapshot,
        pendingSplitStore.getSnapshot,
      );
    }

    function sameSessionIds(left, right) {
      if (left.length !== right.length) return false;
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
      }
      return true;
    }

    /** DSH Desktop exposes its preload product API; the browser Web GUI does
        not. Restarting the app is only possible from the Desktop. */
    function desktopShell() {
      return typeof window !== "undefined" && typeof window.dshDesktop !== "undefined";
    }

    /** Ask the Host half to close and reopen DSH. The Host is a Node child of
        the Desktop shell, so it can drive an OS-level quit+relaunch even
        though production DSH has no in-app restart entry. */
    function restartApplication() {
      if (!desktopShell()) {
        showPaneToast(t("restartUnsupported"), true);
        return;
      }
      showPaneToast(t("restarting"), true);
      try {
        fetch("/dsv/restart", {
          method: "POST",
          headers: { "content-type": "application/json", "x-dsv-restart": "1" },
          body: "{\"confirm\":true}",
          cache: "no-store",
          keepalive: true,
        }).then((response) => response.json().catch(() => null)).then((payload) => {
          if (payload === null || payload === undefined || payload.ok !== true) throw new Error("restart");
        }).catch(() => {
          showPaneToast(t("restartFailed"), true);
        });
      } catch {
        showPaneToast(t("restartFailed"), true);
      }
    }

    /** Confirmation before the app closes: running tasks are interrupted. */
    function RestartDialog() {
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeLauncher();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
      }, []);
      return h("div", {
        className: "dsv-modal-backdrop",
        onPointerDown: (event) => {
          if (event.target === event.currentTarget) closeLauncher();
        },
      },
        h("div", {
          className: "dsv-modal",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("restartTitle"),
        },
          h("div", { className: "dsv-modal-head" },
            h("span", { className: "dsv-modal-title" }, t("restartTitle")),
            h("button", {
              type: "button",
              className: "dsv-modal-close",
              title: t("addSplitCancel"),
              "aria-label": t("addSplitCancel"),
              onClick: closeLauncher,
            }, "×"),
          ),
          h("div", { className: "dsv-modal-hint" }, t("restartBody")),
          h("div", { className: "dsv-modal-foot", style: { borderTop: "none", paddingTop: 0 } },
            h("span", { className: "dsv-modal-count" }, ""),
            h("button", { type: "button", className: "dsv-modal-btn", onClick: closeLauncher }, t("addSplitCancel")),
            h("button", {
              type: "button",
              className: "dsv-modal-btn accent",
              onClick: () => { closeLauncher(); restartApplication(); },
            }, t("restartNow")),
          ),
        ),
      );
    }

    /** Aspect ratio of the conversation column; only decides columns vs rows
        for a two-pane split (the same 1.2 fallback settleAuto uses). */
    function splitColumnAspect() {
      try {
        const bounds = measureColumnBounds();
        if (bounds !== null && bounds !== undefined && bounds.ok === true) {
          const width = window.innerWidth - bounds.left - bounds.right;
          const height = window.innerHeight - bounds.top - bounds.bottom;
          if (width > 0 && height > 0) return width / height;
        }
      } catch {}
      return 1.2;
    }

    /** A deliberate split action overrides the soft guards (kill switch and
        crash-loop safe mode): the user just asked for a split now. */
    function prepareExplicitSplit() {
      try {
        if (runtimeState.enabled !== true) setEnabled(true);
        if (runtimeState.safeMode === true) retryWorkspace();
      } catch {}
    }

    function unminimizeForSplit() {
      if (runtimeState.minimized !== true) return;
      try {
        setRuntime({ minimized: false });
        writeMinimized(false);
      } catch {}
    }

    function openSessionInMainView(sessionId) {
      try {
        const workspace = pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
          ? pluginCtx.get("uiWorkspace")
          : null;
        if (workspace !== null && workspace !== undefined && typeof workspace.openSession === "function") {
          workspace.openSession(sessionId);
        }
      } catch {}
    }

    /** Build the split from an ordered session list. Zero/one selection leaves
        split mode entirely (a one-pane workspace is not a split) and shows the
        single conversation in the stock main view. */
    function buildSplitFromSessions(ids) {
      const ordered = [];
      for (const id of Array.isArray(ids) ? ids : []) {
        if (!isValidSessionId(id) || ordered.indexOf(id) !== -1) continue;
        if (floatStore.has(id)) floatStore.remove(id);
        closeAppWindowFor(id);
        ordered.push(id);
      }
      if (ordered.length < 2) {
        try { exitWorkspace(); } catch {}
        if (ordered.length === 1) openSessionInMainView(ordered[0]);
        return false;
      }
      pendingSplitStore.clear();
      prepareExplicitSplit();
      unminimizeForSplit();
      const root = buildArrangedRoot(ordered, autoLayoutMode(ordered.length, splitColumnAspect()));
      try { treeStore.replaceRoot(root); } catch {}
      return true;
    }

    /** Add one conversation to the split. Inactive: park it in the pending
        split until a second pick exists. Active: append a pane immediately. */
    function addSessionToSplit(sessionId) {
      if (!isValidSessionId(sessionId)) return false;
      if (floatStore.has(sessionId)) floatStore.remove(sessionId);
      closeAppWindowFor(sessionId);
      const leaves = treeStore.leafIds();
      if (leaves.indexOf(sessionId) !== -1) {
        try { treeStore.setFocus(sessionId); } catch {}
        return false;
      }
      if (leaves.length > 0) {
        pendingSplitStore.clear();
        prepareExplicitSplit();
        unminimizeForSplit();
        try { treeStore.addPane(sessionId); } catch {}
        return true;
      }
      pendingSplitStore.add(sessionId);
      if (pendingSplitStore.size() >= 2) {
        const ids = pendingSplitStore.ids();
        pendingSplitStore.clear();
        buildSplitFromSessions(ids);
      } else {
        showPaneToast(t("pendingAdded"), true);
      }
      return true;
    }

    /** Remove one conversation from the split (or from the pending pick).
        Dropping to one pane exits split mode entirely. */
    function removeSessionFromSplit(sessionId) {
      if (!isValidSessionId(sessionId)) return false;
      if (pendingSplitStore.has(sessionId)) {
        pendingSplitStore.remove(sessionId);
        showPaneToast(t("splitLeft"), true);
        return true;
      }
      const leaves = treeStore.leafIds();
      if (leaves.indexOf(sessionId) === -1) return false;
      if (leaves.length <= 2) {
        pendingSplitStore.clear();
        try { exitWorkspace(); } catch {}
        showPaneToast(t("splitExited"), true);
        return true;
      }
      closePaneAnimated(sessionId);
      return true;
    }

    /** Remove every transient node the plugin may have appended to the body. */
    function clearTransientSplitDom() {
      try {
        for (const selector of [".dsv-toast", ".dsv-drag-preview", ".dsv-drop-ghost", ".dsv-pane-invalid"]) {
          for (const element of document.querySelectorAll(selector)) {
            try { element.remove(); } catch {}
          }
        }
      } catch {}
      try {
        if (dragImageCanvas !== null && dragImageCanvas !== undefined) dragImageCanvas.remove();
      } catch {}
      dragImageCanvas = null;
      try { endDragPreview(); } catch {}
      try { document.body.classList.remove("dsv-layout-previewing"); } catch {}
      try { tocGripsRestore(); } catch {}
    }

    /** Drop per-pane runtime caches after the reset's unmount had a frame to
        run its own lifetime cleanup. A broken teardown could otherwise leave a
        stale retain/editor guard behind and the next split would inherit it. */
    function clearPaneRuntimeCaches() {
      try { treeStore.reset(); } catch {}
      if (composerAnchorBridge !== null) {
        try { composerAnchorBridge.dispose(); } catch {}
        composerAnchorBridge = null;
      }
      composerAnchorBridgeRefs = 0;
      for (const reference of paneSessionReferences.values()) {
        try { if (reference !== null && typeof reference.release === "function") reference.release(); } catch {}
      }
      paneSessionReferences.clear();
      for (const guard of paneEditorGuards.values()) {
        try { if (guard !== null && typeof guard.dispose === "function") guard.dispose(); } catch {}
      }
      paneEditorGuards.clear();
      for (const timer of paneDisposeChecks.values()) {
        try { window.clearTimeout(timer); } catch {}
      }
      paneDisposeChecks.clear();
      paneLiveRefs.clear();
      for (const resolver of sessionFaceResolvers.values()) {
        try { if (resolver !== null && typeof resolver.dispose === "function") resolver.dispose(); } catch {}
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
      composerModeStore.clear();
      composerActionsBySession.clear();
      setActiveComposerPaneId(null);
      paneToastAt = 0;
      lastTypedSessionId = null;
      storageRemove("dsh.split-workspace.last-typed.v1");
    }

    /** "Reset split": wipe every key this plugin owns (localStorage AND
        sessionStorage, current and older releases), the persisted tree, the
        crash guard, the kill switch, minimized/maximized UI state and all
        transient pane data — so a split can always be started again even after
        a cache-driven failure. */
    function resetSplitEnvironment() {
      const cleared = [];
      closeLauncher();
      pendingSplitStore.clear();
      floatStore.clear();
      try { window.clearTimeout(minimizeTimer); } catch {}
      try { window.clearTimeout(exitTimer); } catch {}
      minimizeTimer = 0;
      exitTimer = 0;
      closingPaneSessions.clear();
      dragPayload = null;
      externalDragSessionId = null;
      clearTransientSplitDom();
      // Layout, safe mode, health counters, geometry block and the retry epoch
      // (the epoch bump remounts the overlay boundary with clean state).
      try { resetWorkspace(); } catch {}
      clearSplitStorage(window.localStorage, cleared);
      clearSplitStorage(window.sessionStorage, cleared);
      // resetWorkspace() keeps a kill switch intact; this action is explicitly
      // "make the split work again", so drop the flag (an absent key means
      // enabled) and clear the runtime flag below.
      storageRemove(ENABLED_KEY);
      setRuntime({
        enabled: true,
        safeMode: false,
        active: false,
        minimized: false,
        geometryBlocked: false,
        maximized: null,
        chipDismissed: false,
        tipVisible: false,
        helpOpen: false,
        appWindow: null,
      });
      const resetEpoch = runtimeState.epoch;
      try {
        window.setTimeout(() => {
          // A split started within the grace window owns the caches now.
          if (runtimeState.epoch !== resetEpoch) return;
          try {
            if (treeStore.leafIds().length !== 0) return;
            clearPaneRuntimeCaches();
          } catch {}
        }, 350);
      } catch { try { clearPaneRuntimeCaches(); } catch {} }
      showPaneToast(t("resetDone"), true);
      return { reset: true, cleared: cleared.length };
    }

    const SPLIT_STORAGE_PREFIX = "dsh.split-workspace.";
    // User preferences survive "reset split": a hard reset is about the split
    // environment (layout/caches), not about the performance setting or the
    // update notices.
    const PRESERVED_STORAGE_KEYS = new Set([PERF_KEY, SEEN_VERSION_KEY, UPDATE_DISMISSED_KEY]);
    function clearSplitStorage(storage, cleared) {
      if (storage === null || storage === undefined) return;
      const keys = [];
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (typeof key === "string" && key.indexOf(SPLIT_STORAGE_PREFIX) === 0 && !PRESERVED_STORAGE_KEYS.has(key)) keys.push(key);
        }
      } catch {}
      for (const key of keys) {
        try {
          storage.removeItem(key);
          cleared.push(key);
        } catch {}
      }
    }

    /** Live membership of one conversation across the plugin's four surfaces:
        the split tree / pending pick, floats, the in-app window, and the
        Host-tracked native window list. Both session-menu surfaces read this,
        so they can never disagree about Enter vs Exit. */
    function sessionSurfaceState(id) {
      const inSplit = treeStore.leafIds().indexOf(id) !== -1;
      const pending = pendingSplitStore.has(id);
      const splitMember = inSplit || pending;
      const floating = floatStore.has(id);
      const appWindow = appWindowSnapshot();
      const independent = appWindow !== null && appWindow.id === id;
      const nativeWindow = nativeWindowStore.has(id);
      return { splitMember, floating, independent, nativeWindow };
    }

    /** Run one surface's Enter/Exit toggle. The state is re-read here (instead
        of trusting the label the row rendered) so a menu resolved a moment ago
        still acts on the live surface. */
    function runSessionSurfaceAction(kind, id) {
      if (!isValidSessionId(id)) return;
      if (kind === "split") {
        // 加入分屏 / 退出分屏 is one toggle: a member (split pane or pending
        // pick) exits, everything else joins.
        if (sessionSurfaceState(id).splitMember) removeSessionFromSplit(id);
        else if (floatStore.has(id)) dockFloatToSplit(id);
        else addSessionToSplit(id);
        return;
      }
      if (kind === "float") {
        if (floatStore.has(id)) closeFloatWindow(id);
        else floatSession(id);
        return;
      }
      if (kind === "independent") {
        if (sessionSurfaceState(id).independent) closeAppWindowFor(id);
        else openAppWindow(id);
        return;
      }
      if (kind === "native") {
        requestSystemWindow(id, nativeWindowStore.has(id) ? "close" : "open");
      }
    }

    /** Rows for one conversation: one "分屏插件" first-level group whose
        second level holds the split-membership toggle and the three window
        surfaces. Every entry is a single Enter/Exit toggle that mirrors its
        live state. Hosts with the `contextMenus` service (DSH 0.2.2+ only)
        render this group in the session right-click menu; every build gets the
        same four actions in the stock "⋯" session menu below. */
    function sessionMenuActions(id) {
      const { splitMember, floating, independent, nativeWindow } = sessionSurfaceState(id);
      return [
        {
          id: "split-plugin",
          label: t("menuGroup"),
          icon: { key: CONTEXT_ICON_PANEL },
          separatorBefore: true,
          children: [
            {
              id: "split",
              label: t(splitMember ? "exitSplit" : "menuAddToSplit"),
              icon: { key: CONTEXT_ICON_SPLIT },
              run: () => runSessionSurfaceAction("split", id),
            },
            {
              id: "float",
              label: t(floating ? "menuFloatClose" : "menuFloatOpen"),
              icon: { key: CONTEXT_ICON_FLOAT },
              run: () => runSessionSurfaceAction("float", id),
            },
            {
              id: "independent",
              label: t(independent ? "menuIndependentClose" : "menuIndependentOpen"),
              icon: { key: CONTEXT_ICON_WINDOW },
              failureLabel: t("systemWindowFailed"),
              run: () => runSessionSurfaceAction("independent", id),
            },
            {
              id: "native",
              label: t(nativeWindow ? "menuNativeClose" : "menuNativeOpen"),
              icon: { key: CONTEXT_ICON_NATIVE },
              failureLabel: t("systemWindowFailed"),
              run: () => runSessionSurfaceAction("native", id),
            },
          ],
        },
      ];
    }

    /** True once this plugin's session right-click group is registered on a host
        that ships the `contextMenus` service (DSH 0.2.2+). On those builds the
        session row's "⋯" button is a context-menu trigger for the SAME popup,
        which already renders the "分屏插件" group; the flat rows below must stay
        hidden so the four actions are not listed twice in one menu. */
    let sessionContextMenuActive = false;

    /** Contribute the "分屏插件" group to the stock session right-click menu.
        The service ships only from DSH 0.2.2; the same four actions reach every
        other build through the stock "⋯" session menu below. Looked up lazily:
        a host without the service simply does not get these rows. */
    function installSplitSessionMenu() {
      const ctx = pluginCtx;
      if (ctx === null || ctx === undefined || typeof ctx.get !== "function") return () => {};
      let timer = 0;
      let tries = 0;
      let dispose = null;
      const attempt = () => {
        timer = 0;
        let menus = undefined;
        try { menus = ctx.get("contextMenus"); } catch {}
        if (menus !== undefined && menus !== null && typeof menus.register === "function") {
          try {
            dispose = menus.register({
              id: "split-workspace.session",
              target: "session",
              order: 350,
              observe: () => [treeStore, pendingSplitStore, floatStore, runtimeStore, nativeWindowStore],
              resolve: (target) => {
                const id = target !== null && target !== undefined ? target.sessionId : undefined;
                if (!isValidSessionId(id)) return [];
                // Refresh the Host-tracked native-window list before building
                // the rows, so a window closed outside DSH already shows Enter.
                return nativeWindowStore.refresh().then(() => sessionMenuActions(id)).catch(() => []);
              },
            });
            sessionContextMenuActive = true;
          } catch (error) {
            try { console.warn(LOG_PREFIX + " could not register the session menu contribution:", String(error).slice(0, 160)); } catch {}
          }
          return;
        }
        if (tries >= 60) return;
        tries += 1;
        timer = window.setTimeout(attempt, 250);
      };
      attempt();
      return () => {
        sessionContextMenuActive = false;
        if (timer !== 0) { try { window.clearTimeout(timer); } catch {} }
        if (dispose !== null) { try { dispose(); } catch {} }
      };
    }

    // Stock "⋯" session menu rows (hosts without a session context menu)
    //
    // Every supported build renders the session row's ellipsis menu from the
    // `sidebar.workspaces.session.menu.item` list. On 0.2.0/0.2.1 builds that
    // list is the ONLY session menu (there is no right-click menu there), so
    // these four rows are what makes the split/float/window actions reachable.
    // On 0.2.2+ the ellipsis button is a context-menu trigger for the SAME popup
    // that renders this plugin's right-click "分屏插件" group; there the rows
    // render nothing (sessionFlatRowsSuppressed) so no action appears twice in
    // one menu. They go through the host's row primitive, which keeps the stock
    // markup, styling, keyboard walk and focus return; a host that does not
    // export that primitive still gets a working role="menuitem" button.
    // -----------------------------------------------------------------------

    /** The owner passes its menu-open hook through the occurrence hook context;
        a host that does not inject one still gets a working (never-closing)
        row, so the registration can never crash the menu. */
    const DETACHED_MENU_OPEN_STATE = [false, () => {}];
    function useDetachedMenuOpenState() {
      return DETACHED_MENU_OPEN_STATE;
    }
    function useOwnedMenuOpenState(props) {
      const useOpenState = props !== null && props !== undefined && typeof props.useMenuOpenState === "function"
        ? props.useMenuOpenState
        : useDetachedMenuOpenState;
      return useOpenState();
    }

    /** On 0.2.2+ the "⋯" button opens the same popup that already renders the
        plugin's right-click group, so the flat rows must render nothing — one
        menu must never list the same four actions twice. On 0.2.0/0.2.1 there is
        no context-menu service and the rows render normally. */
    function sessionFlatRowsSuppressed() {
      return sessionContextMenuActive;
    }

    /** One session-menu row through the host's row primitive. */
    function sessionMenuRow(props) {
      if (P !== null && P !== undefined && typeof P.MenuItemButton === "function") {
        return h(P.MenuItemButton, props);
      }
      return h("button", {
        type: "button",
        role: "menuitem",
        className: "dsv-session-menu-row",
        disabled: props.disabled === true,
        onClick: props.onSelect,
      },
        props.icon !== undefined && props.icon !== null ? props.icon : null,
        h("span", null, props.children),
      );
    }

    /** The four rows. Each subscribes only to the stores whose state its own
        label shows, so an open menu tracks nothing it does not display. */
    function SplitSessionMenuItem(props) {
      const id = props !== null && props !== undefined ? props.sessionId : undefined;
      const [, setMenuOpen] = useOwnedMenuOpenState(props);
      useTree();
      usePendingSplit();
      const splitMember = isValidSessionId(id) && sessionSurfaceState(id).splitMember;
      if (sessionFlatRowsSuppressed()) return null;
      return sessionMenuRow({
        separatorBefore: true,
        icon: h(TwoPaneGlyph, { size: 14 }),
        onSelect: () => {
          setMenuOpen(false);
          runSessionSurfaceAction("split", id);
        },
        children: t(splitMember ? "exitSplit" : "menuAddToSplit"),
      });
    }

    function FloatSessionMenuItem(props) {
      const id = props !== null && props !== undefined ? props.sessionId : undefined;
      const [, setMenuOpen] = useOwnedMenuOpenState(props);
      useFloats();
      const floating = isValidSessionId(id) && floatStore.has(id);
      if (sessionFlatRowsSuppressed()) return null;
      return sessionMenuRow({
        icon: h(FloatPaneGlyph, { size: 14 }),
        onSelect: () => {
          setMenuOpen(false);
          runSessionSurfaceAction("float", id);
        },
        children: t(floating ? "menuFloatClose" : "menuFloatOpen"),
      });
    }

    function IndependentSessionMenuItem(props) {
      const id = props !== null && props !== undefined ? props.sessionId : undefined;
      const [, setMenuOpen] = useOwnedMenuOpenState(props);
      const runtime = useRuntime();
      const appWindow = runtime !== null && runtime !== undefined ? runtime.appWindow : null;
      const independent = isValidSessionId(id) && appWindow !== null && appWindow !== undefined && appWindow.id === id;
      if (sessionFlatRowsSuppressed()) return null;
      return sessionMenuRow({
        icon: h(WindowGlyph, { size: 14 }),
        onSelect: () => {
          setMenuOpen(false);
          runSessionSurfaceAction("independent", id);
        },
        children: t(independent ? "menuIndependentClose" : "menuIndependentOpen"),
      });
    }

    function NativeSessionMenuItem(props) {
      const id = props !== null && props !== undefined ? props.sessionId : undefined;
      const [, setMenuOpen] = useOwnedMenuOpenState(props);
      // The Host owns these windows; subscribing starts the store's bounded
      // poll, and the explicit refresh makes the first open read a window that
      // was closed outside DSH while no menu was watching.
      React.useSyncExternalStore(nativeWindowStore.subscribe, nativeWindowStore.getSnapshot, nativeWindowStore.getSnapshot);
      React.useEffect(() => {
        try { nativeWindowStore.refresh(); } catch {}
      }, []);
      const nativeWindow = isValidSessionId(id) && nativeWindowStore.has(id);
      if (sessionFlatRowsSuppressed()) return null;
      return sessionMenuRow({
        icon: h(NativeWindowGlyph, { size: 14 }),
        onSelect: () => {
          setMenuOpen(false);
          runSessionSurfaceAction("native", id);
        },
        children: t(nativeWindow ? "menuNativeClose" : "menuNativeOpen"),
      });
    }

    function SplitPickCheck({ checked }) {
      return h("span", {
        className: "dsv-pick-check",
        "aria-hidden": "true",
      }, checked ? "✓" : "");
    }

    function SplitPickRow({ item, checked, onToggle }) {
      return h("button", {
        type: "button",
        role: "checkbox",
        "aria-checked": checked ? "true" : "false",
        className: "dsv-pick-row",
        onClick: onToggle,
      },
        h(SplitPickCheck, { checked }),
        h("span", { className: "dsv-pick-text" },
          h("span", { className: "dsv-pick-title" }, item.title),
          item.sub !== "" ? h("span", { className: "dsv-pick-sub" }, item.sub) : null,
        ),
        item.tag !== null && item.tag !== undefined ? h("span", { className: "dsv-pick-tag" }, t(item.tag)) : null,
      );
    }

    /** The pickable-conversation roster shared by the modal "添加分屏" dialog
        and the split-view panel's inline picker: real, non-blank, non-subagent
        chat sessions plus any already-selected id that dropped out of the live
        list (so it can still be unchecked). */
    function splitPickableItems(sessions, selected) {
      const items = [];
      const seen = new Set();
      if (sessions !== null && sessions !== undefined && Array.isArray(sessions.ids)) {
        for (const id of sessions.ids) {
          const summary = sessions.byId ? sessions.byId[id] : undefined;
          if (summary === undefined || summary === null) continue;
          if (summary.parentId !== undefined) continue;
          if (summary.origin === "subagent" || summary.blank === true) continue;
          if (id.indexOf("session-") !== 0) continue;
          seen.add(id);
          items.push({ id, summary, title: summary.displayTitle || summary.title || id });
        }
      }
      for (const id of Array.isArray(selected) ? selected : []) {
        if (seen.has(id)) continue;
        seen.add(id);
        items.push({ id, summary: null, title: id });
      }
      // Same ordering as the stock conversation list: most recently updated
      // first, re-sorted from the live snapshot while the picker is open.
      items.sort((a, b) => (Number(b.summary && b.summary.updatedAt) || 0) - (Number(a.summary && a.summary.updatedAt) || 0));
      return items;
    }

    /** Multi-select "添加分屏" dialog. Opened from the footer menu, so the
        current members stay selected and can be unchecked (the final selection
        rebuilds the split) or extended with more conversations. */
    function AddSplitDialog() {
      const sessions = useSessionsList();
      const tree = useTree();
      const treeLeaves = tree.root === null ? [] : leafOf(tree.root, []);
      const initialSelection = treeLeaves.length >= 2 ? treeLeaves : pendingSplitStore.ids();
      const [selected, setSelected] = React.useState(() => initialSelection.slice());
      const [query, setQuery] = React.useState("");

      // The DOM-backed list source observes only while the split is active;
      // refresh on mount so a picker opened from the stock view is current.
      React.useEffect(() => {
        try {
          if (sessionsListSource !== undefined && sessionsListSource !== null
              && typeof sessionsListSource.refresh === "function") sessionsListSource.refresh();
        } catch {}
      }, []);

      const pendingIds = pendingSplitStore.ids();
      const needle = query.trim().toLowerCase();
      const visible = splitPickableItems(sessions, selected)
        .filter((item) => needle === "" || item.title.toLowerCase().includes(needle));

      const toggle = (id) => setSelected((previous) => (previous.indexOf(id) === -1
        ? previous.concat([id])
        : previous.filter((entry) => entry !== id)));

      const confirm = () => {
        const ids = selected.slice();
        closeLauncher();
        if (ids.length >= 2) {
          prepareExplicitSplit();
          unminimizeForSplit();
          const leavesNow = treeStore.leafIds();
          const additionsOnly = leavesNow.length >= 2 && ids.length > leavesNow.length
            && leavesNow.every((id) => ids.indexOf(id) !== -1);
          if (additionsOnly) {
            for (const id of ids) {
              if (leavesNow.indexOf(id) === -1) {
                try { floatStore.remove(id); } catch {}
                try { treeStore.addPane(id); } catch {}
              }
            }
          } else if (!sameSessionIds(ids, leavesNow)) {
            buildSplitFromSessions(ids);
          }
          pendingSplitStore.clear();
          return;
        }
        const wasActive = treeStore.leafIds().length >= 2;
        pendingSplitStore.clear();
        if (!wasActive) {
          // Not in split mode yet: one pick becomes the pending split (the
          // dialog is also a way to stage the first conversation).
          if (ids.length === 1) {
            pendingSplitStore.add(ids[0]);
            showPaneToast(t("pendingAdded"), true);
          }
          return;
        }
        try { exitWorkspace(); } catch {}
        if (ids.length === 1) openSessionInMainView(ids[0]);
        showPaneToast(t("splitExited"), true);
      };

      return h("div", {
        className: "dsv-modal-backdrop",
        onPointerDown: (event) => {
          if (event.target === event.currentTarget) closeLauncher();
        },
        onKeyDown: (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeLauncher();
        },
      },
        h("div", {
          className: "dsv-modal",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("addSplitTitle"),
        },
          h("div", { className: "dsv-modal-head" },
            h("span", { className: "dsv-modal-title" }, t("addSplitTitle")),
            h("button", {
              type: "button",
              className: "dsv-modal-close",
              title: t("addSplitCancel"),
              "aria-label": t("addSplitCancel"),
              onClick: closeLauncher,
            }, "×"),
          ),
          h("div", { className: "dsv-modal-hint" }, t("addSplitHint")),
          h("input", {
            className: "dsv-modal-search",
            type: "search",
            autoFocus: true,
            placeholder: t("railSearch"),
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h("div", { className: "dsv-modal-body" },
            visible.length === 0 ? h("div", { className: "dsv-pick-empty" }, t("addSplitEmpty")) : null,
            visible.map((item) => h(SplitPickRow, {
              key: item.id,
              item: {
                title: item.title,
                sub: item.summary !== null && item.summary.cwd !== undefined ? basenameOf(item.summary.cwd) : "",
                tag: treeLeaves.indexOf(item.id) !== -1
                  ? "addSplitInSplit"
                  : (pendingIds.indexOf(item.id) !== -1 ? "addSplitPending" : null),
              },
              checked: selected.indexOf(item.id) !== -1,
              onToggle: () => toggle(item.id),
            })),
          ),
          h("div", { className: "dsv-modal-foot" },
            h("span", { className: "dsv-modal-count" }, t("addSplitSelected", { n: selected.length })),
            h("button", { type: "button", className: "dsv-modal-btn", onClick: closeLauncher }, t("addSplitCancel")),
            h("button", { type: "button", className: "dsv-modal-btn accent", onClick: confirm }, t("addSplitConfirm")),
          ),
        ),
      );
    }

    /** The split-view panel's own page while it cannot show the canvas yet.
        Three states share one card shell: the kill switch is off (offer Enable),
        the crash guard paused the split (offer Retry), or fewer than two
        conversations are staged (the multi-select picker). Confirming the
        picker with two or more conversations builds the split immediately, so
        the panel turns into the canvas without leaving the page. */
    function PanelSplitPicker() {
      const runtime = useRuntime();
      const sessions = useSessionsList();
      const tree = useTree();
      const treeLeaves = tree === null || tree === undefined || tree.root === null ? [] : leafOf(tree.root, []);
      const initial = treeLeaves.length > 0 ? treeLeaves.slice() : pendingSplitStore.ids().slice();
      const [selected, setSelected] = React.useState(initial);
      const [query, setQuery] = React.useState("");
      const pendingIds = pendingSplitStore.ids();
      const items = splitPickableItems(sessions, selected);
      React.useEffect(() => {
        try {
          if (sessionsListSource !== undefined && sessionsListSource !== null
              && typeof sessionsListSource.refresh === "function") sessionsListSource.refresh();
        } catch {}
      }, []);
      const card = (titleText, bodyText, action, options) => h("div", { className: "dsv-panel-picker", "data-plugin": PLUGIN_ID },
        h("div", { className: "dsv-modal dsv-panel-card dsv-panel-card-narrow" },
          h("div", { className: "dsv-modal-head" },
            h("span", { className: "dsv-panel-glyph", "aria-hidden": "true" }, h(SplitViewGlyph, { size: 18 })),
            h("span", { className: "dsv-modal-title" }, titleText),
          ),
          bodyText !== null && bodyText !== undefined ? h("div", { className: "dsv-modal-hint" }, bodyText) : null,
          action !== null && action !== undefined
            ? h("div", { className: "dsv-modal-foot" },
                h("span", { className: "dsv-modal-count" }, options !== undefined && options.note !== undefined ? options.note : ""),
                h("button", { type: "button", className: "dsv-modal-btn accent", onClick: action.run }, action.label),
              )
            : null,
        ),
      );
      if (runtime.enabled !== true) {
        return card(t("panelDisabledTitle"), t("panelDisabledBody"), {
          label: t("panelEnable"),
          run: () => { try { setEnabled(true); } catch {} },
        });
      }
      if (runtime.safeMode === true) {
        return card(t("panelSafeTitle"), t("panelSafeBody"), {
          label: t("retryLabel"),
          run: () => { try { retryWorkspace(); } catch {} },
        });
      }
      const needle = query.trim().toLowerCase();
      const visible = items.filter((item) => needle === "" || item.title.toLowerCase().includes(needle));
      const toggle = (id) => setSelected((previous) => (previous.indexOf(id) === -1
        ? previous.concat([id])
        : previous.filter((value) => value !== id)));
      const confirm = () => {
        if (selected.length < 2) {
          showPaneToast(t("panelNeedTwo"), true);
          return;
        }
        if (!buildSplitFromSessions(selected)) showPaneToast(t("panelNeedTwo"), true);
      };
      return h("div", { className: "dsv-panel-picker", "data-plugin": PLUGIN_ID },
        h("div", { className: "dsv-modal dsv-panel-card" },
          h("div", { className: "dsv-modal-head" },
            h("span", { className: "dsv-panel-glyph", "aria-hidden": "true" }, h(SplitViewGlyph, { size: 18 })),
            h("span", { className: "dsv-modal-title" }, t("panelPickTitle")),
          ),
          h("div", { className: "dsv-modal-hint" }, t("panelPickHint")),
          h("input", {
            className: "dsv-modal-search",
            type: "search",
            placeholder: t("railSearch"),
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h("div", { className: "dsv-modal-body" },
            visible.length === 0 ? h("div", { className: "dsv-pick-empty" }, t("panelNoSessions")) : null,
            visible.map((item) => h(SplitPickRow, {
              key: item.id,
              item: {
                title: item.title,
                sub: item.summary !== null && item.summary.cwd !== undefined ? basenameOf(item.summary.cwd) : "",
                tag: treeLeaves.indexOf(item.id) !== -1
                  ? "addSplitInSplit"
                  : (pendingIds.indexOf(item.id) !== -1 ? "addSplitPending" : null),
              },
              checked: selected.indexOf(item.id) !== -1,
              onToggle: () => toggle(item.id),
            })),
          ),
          h("div", { className: "dsv-modal-foot" },
            h("span", { className: "dsv-modal-count" },
              selected.length < 2 ? t("panelNeedTwo") : t("addSplitSelected", { n: selected.length })),
            h("button", {
              type: "button",
              className: "dsv-modal-btn accent",
              disabled: selected.length < 2,
              onClick: confirm,
            }, t("panelPickConfirm")),
          ),
        ),
      );
    }

    function SplitLauncherMenu({ request }) {
      const runtime = useRuntime();
      const tree = useTree();
      const pending = usePendingSplit();
      const ref = React.useRef(null);
      const [pos, setPos] = React.useState(null);
      const leaves = tree.root === null ? [] : leafOf(tree.root, []);
      const active = leaves.length >= 2;

      React.useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) return;
        const width = element.offsetWidth || 200;
        const height = element.offsetHeight || 210;
        const rect = request !== null && request !== undefined ? request.rect : null;
        let left = rect !== null && rect !== undefined ? rect.left : 12;
        left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
        let top;
        if (rect !== null && rect !== undefined) {
          top = rect.top - height - 6;
          if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 6);
        } else {
          top = window.innerHeight - height - 12;
        }
        setPos({ left, top });
      }, [request]);

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const target = event.target;
          if (target !== null && target !== undefined && typeof target.closest === "function") {
            try {
              if (target.closest(".dsv-launcher-menu") !== null) return;
              if (target.closest(".dsv-footer-btn") !== null) return;
              if (target.closest(".dsv-fallback-launcher") !== null) return;
            } catch {}
          }
          closeLauncher();
        };
        const onKeyDown = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeLauncher();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, []);

      const row = (key, icon, label, onClick, options) => h("button", {
        key,
        type: "button",
        role: "menuitem",
        className: "dsv-launcher-item" + (options !== undefined && options.danger === true ? " danger" : ""),
        disabled: options !== undefined && options.disabled === true,
        onClick: options !== undefined && options.disabled === true ? undefined : onClick,
      },
        h("span", { className: "dsv-launcher-icon", "aria-hidden": "true" }, icon),
        h("span", null, label),
      );

      return h("div", {
        ref,
        className: "dsv-launcher-menu",
        role: "menu",
        "aria-label": t("menuTitle"),
        style: pos === null ? { left: "-9999px", top: "-9999px" } : pos,
      },
        h("div", { className: "dsv-launcher-header" },
          pending.length > 0 ? t("pendingBadge", { n: pending.length }) : t("menuTitle")),
        row("add", "＋", t("menuAddSplit"), () => { closeLauncher(); openAddSplitDialog(request.source); }),
        h("div", { key: "separator-top", className: "dsv-launcher-separator" }),
        row("exit", "✕", t("exitSplit"), () => { closeLauncher(); try { exitWorkspace(); } catch {} }, { disabled: !active }),
        row("minimize", "—", t("menuMinimizeSplit"), () => { closeLauncher(); try { minimizeWorkspace(); } catch {} }, {
          disabled: !active || runtime.minimized === true,
        }),
        h("div", { key: "separator-bottom", className: "dsv-launcher-separator" }),
        row("performance", "⚡", t("performanceMode") + (runtime.performance === true ? " ✓" : ""),
          () => { closeLauncher(); setPerformanceMode(runtime.performance !== true); }),
        row("reload", "↻", t("refreshInterface"), () => { closeLauncher(); try { location.reload(); } catch {} }),
        desktopShell()
          // Drawn SVG, not the U+23FB power symbol: that codepoint is missing
          // from the default CJK font stack on Windows and rendered as a
          // mojibake box in the launcher menu.
          ? row("restart", h(RestartIcon, { size: 15 }), t("restartApp"), () => { closeLauncher(); openRestartDialog(); })
          : null,
        row("help", "?", t("helpOpen"), () => { closeLauncher(); openHelp(); }),
        row("reset", "↺", t("menuResetSplit"), () => { closeLauncher(); resetSplitEnvironment(); }, { danger: true }),
      );
    }

    /** Settings → Split workspace page: the same controls as the footer menu,
        reachable from the system Settings panel as well. */
    function SettingsSection(props) {
      const runtime = useRuntime();
      const tree = useTree();
      const pending = usePendingSplit();
      const floats = useFloats();
      const leaves = tree.root === null ? [] : leafOf(tree.root, []);
      const active = leaves.length >= 2;
      const appWindow = runtime.appWindow;
      const closeThen = (fn) => {
        try { if (props !== null && props !== undefined && typeof props.close === "function") props.close(); } catch {}
        try { fn(); } catch {}
      };
      const value = (text) => h("span", { className: "dsv-settings-value" }, text);
      const row = (key, label, content) => h("div", { key, className: "dsv-settings-row" },
        h("span", { className: "dsv-settings-row-label" }, label),
        content,
      );
      const button = (key, label, onClick, options) => h("button", {
        key,
        type: "button",
        className: "dsv-settings-btn"
          + (options !== undefined && options.accent === true ? " accent" : "")
          + (options !== undefined && options.danger === true ? " danger" : ""),
        disabled: options !== undefined && options.disabled === true,
        onClick: options !== undefined && options.disabled === true ? undefined : onClick,
      }, label);
      return h("div", { className: "dsv-settings", "data-plugin": PLUGIN_ID },
        h("div", { className: "dsv-settings-desc" }, t("settingsDesc")),
        h("section", { className: "dsv-settings-group" },
          h("h3", { className: "dsv-settings-group-title" }, t("settingsStatus")),
          row("version", t("settingsVersion"), value("v" + PLUGIN_VERSION)),
          row("panes", t("settingsPanes"), value(String(leaves.length))),
          row("pending", t("settingsPending"), value(String(pending.length))),
          row("floats", t("settingsFloats"), value(String(floats.windows.length))),
          appWindow !== null && appWindow !== undefined
            ? row("appwindow", t("menuSystemWindow"), value(appWindow.id))
            : null,
        ),
        h("section", { className: "dsv-settings-group" },
          h("h3", { className: "dsv-settings-group-title" }, t("settingsPerformance")),
          h("div", { className: "dsv-settings-row" },
            h("div", { className: "dsv-settings-label" },
              h("span", null, t("settingsPerformance")),
              h("span", { className: "dsv-settings-value" }, t("settingsPerformanceDesc")),
            ),
            button("performance", runtime.performance === true ? t("performanceOn") : t("performanceOff"),
              () => setPerformanceMode(runtime.performance !== true),
              { accent: runtime.performance === true }),
          ),
        ),
        h("section", { className: "dsv-settings-group" },
          h("h3", { className: "dsv-settings-group-title" }, t("settingsActions")),
          h("div", { className: "dsv-settings-actions" },
            button("panel", t("panelTitle"), () => closeThen(() => selectSplitPanel())),
            button("add", t("menuAddSplit"), () => closeThen(() => openAddSplitDialog("footer")), { accent: true }),
            button("exit", t("exitSplit"), () => { try { exitWorkspace(); } catch {} }, { disabled: !active }),
            button("minimize", t("menuMinimizeSplit"), () => { try { minimizeWorkspace(); } catch {} }, { disabled: !active || runtime.minimized === true }),
            button("refresh", t("refreshInterface"), () => { try { location.reload(); } catch {} }),
            desktopShell()
              ? button("restart", t("restartApp"), () => closeThen(() => openRestartDialog()))
              : null,
            appWindow !== null && appWindow !== undefined
              ? button("closeappwindow", t("independentClose"), () => closeThen(() => closeAppWindow()))
              : null,
            button("help", t("helpOpen"), () => closeThen(() => setRuntime({ helpOpen: true }))),
            button("reset", t("menuResetSplit"), () => { try { resetSplitEnvironment(); } catch {} }, { danger: true }),
          ),
        ),
      );
    }

    /** Fallback entry point when the stock sidebar footer does not render this
        plugin's action (collapsed/absent sidebar, a layout that replaces the
        footer, or an older host whose footer slot is empty). The launcher menu
        stays reachable from the conversation column's bottom-left corner. */
    function LauncherFallback() {
      const runtime = useRuntime();
      const launcher = useLauncherState();
      const pending = usePendingSplit();
      const [footerVisible, setFooterVisible] = React.useState(true);
      React.useEffect(() => {
        const check = () => {
          let visible = false;
          try {
            const button = document.querySelector(".dsv-footer-btn");
            visible = button !== null && button !== undefined && button.getBoundingClientRect().width > 0;
          } catch {}
          setFooterVisible(visible);
        };
        check();
        const timer = window.setInterval(check, runtime.performance === true ? 3000 : 1200);
        return () => { try { window.clearInterval(timer); } catch {} };
      }, [runtime.performance, runtime.enabled]);
      if (runtime.enabled !== true || footerVisible || launcher.mode !== "closed") return null;
      // Own the conversation column's bottom-left corner when its bounds are
      // known (so the fallback never sits on the stock sidebar controls); fall
      // back to the viewport corner when geometry is not measured yet.
      let style = null;
      try {
        const bounds = measureColumnBounds();
        if (bounds !== null && bounds !== undefined && bounds.ok === true) {
          style = {
            left: Math.max(8, bounds.left) + 16 + "px",
            bottom: Math.max(8, bounds.bottom) + 16 + "px",
          };
        }
      } catch {}
      return h("button", {
        type: "button",
        className: "dsv-fallback-launcher",
        style,
        title: t("menuTitle"),
        "aria-label": t("fallbackLauncher"),
        "aria-haspopup": "menu",
        onClick: (event) => openLauncherMenu(event.currentTarget),
      },
        h(SplitViewGlyph, { size: 15 }),
        h("span", { className: "dsv-fallback-label" }, t("fallbackLauncher")),
        pending.length > 0 ? h("span", { className: "dsv-footer-badge" }, String(pending.length)) : null,
      );
    }

    /** Always-mounted launcher layer (inside the shell.overlay seat). */
    function SplitLauncherLayer() {
      const launcher = useLauncherState();
      // A split that becomes active through any other entry point (drag,
      // pane-header picker, external API) retires the pending pick, so the
      // badge can never promise a pending conversation that is now a pane.
      React.useEffect(() => treeStore.subscribe(() => {
        if (treeStore.isActive() && pendingSplitStore.size() > 0) pendingSplitStore.clear();
      }), []);
      if (launcher.mode === "menu") return h(SplitLauncherMenu, { request: launcher });
      if (launcher.mode === "dialog") return h(AddSplitDialog, null);
      if (launcher.mode === "restart") return h(RestartDialog, null);
      return h(LauncherFallback, null);
    }


    /** One floating window: a fixed, movable, resizable frame around the real
        pane (header + transcript + composer). The pane header is the drag
        handle; the wrapper draws the window frame and owns the resize edges. */
