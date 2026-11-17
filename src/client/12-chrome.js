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
    /** Update-ready chip: the Host serves the on-disk plugin version, so a
        running page can notice a freshly installed/updated bundle and reload
        itself (client-only changes) without a full DSH restart. */
    function UpdateNotice() {
      const [ready, setReady] = React.useState(null);
      React.useEffect(() => {
        let stopped = false;
        const check = () => {
          fetch("/dsv/version", { cache: "no-store" }).then((response) => {
            if (!response.ok) return null;
            return response.json().catch(() => null);
          }).then((payload) => {
            if (stopped || payload === null || payload === undefined) return;
            const version = typeof payload.version === "string" ? payload.version : null;
            if (version === null || version === "" || version === PLUGIN_VERSION) return;
            if (storageGet(UPDATE_DISMISSED_KEY) === version) return;
            setReady(version);
          }).catch(() => {});
        };
        const bootTimer = window.setTimeout(check, 4000);
        const timer = window.setInterval(() => {
          if (document.visibilityState === "visible") check();
        }, UPDATE_POLL_MS);
        return () => {
          stopped = true;
          window.clearTimeout(bootTimer);
          window.clearInterval(timer);
        };
      }, []);
      if (ready === null) return null;
      const desktop = typeof window !== "undefined" && typeof window.dshDesktop !== "undefined";
      // DSH Desktop applies profile/plugin changes at startup, so a page reload
      // cannot pick up a new bundle there; only a restart can. The Web GUI can
      // apply it with a refresh. Say the right thing instead of offering a
      // button that silently fails.
      return h("div", { className: "dsv-update-chip", role: "status" },
        h("span", null, t(desktop ? "updateRestart" : "updateReady", { v: ready })),
        desktop ? null : h("button", {
          type: "button",
          className: "dsv-update-chip-btn accent",
          onClick: () => { try { location.reload(); } catch {} },
        }, t("reloadNow")),
        h("button", {
          type: "button",
          className: "dsv-update-chip-btn",
          onClick: () => {
            storageSet(UPDATE_DISMISSED_KEY, ready);
            setReady(null);
          },
        }, t(desktop ? "gotIt" : "laterLabel")),
      );
    }

    function SplitWorkspaceSeat(props) {
      const runtime = useRuntime();
      // A standalone system window renders ONLY its conversation: no split
      // workspace, no floats, no launcher. WorkspaceApp still mounts (hidden,
      // inactive) because it publishes the root standard faces the pane host
      // needs.
      const standaloneId = standaloneSessionId();
      if (standaloneId !== null) {
        try { document.documentElement.setAttribute("data-dsv-standalone", "1"); } catch {}
        const standaloneProps = Object.assign({}, props, { dsvStandalone: true });
        return h(React.Fragment, null,
          h(WorkspaceBoundary, { key: "workspace-" + runtime.epoch }, h(WorkspaceApp, standaloneProps)),
          h(WorkspaceBoundary, { key: "standalone-" + runtime.epoch }, h(StandaloneSessionWindow, { sessionId: standaloneId })),
        );
      }
      return h(React.Fragment, null,
        h(WorkspaceBoundary, { key: "workspace-" + runtime.epoch }, h(WorkspaceApp, props)),
        h(PluginChrome, null),
        h(WorkspaceBoundary, { key: "floats-" + runtime.epoch }, h(FloatLayer, null)),
        h(SplitLauncherLayer, null),
        h(UpdateNotice, null),
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
      // A standalone system window never activates the split overlay: its whole
      // page is owned by StandaloneSessionWindow.
      const standaloneWindow = props.dsvStandalone === true;
      const active = standaloneWindow !== true && leaves.length >= 2
        && runtime.enabled === true && runtime.safeMode !== true;
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
        if (!operational || runtime.performance === true) {
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
      }, [operational, runtime.performance]);

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
        let fallbackInterval = window.setInterval(schedule, runtime.performance === true ? 3500 : 1000);
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
      }, [active, runtime.performance]);

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
        if (!operational || runtime.performance === true) return undefined;
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
      }, [operational, runtime.performance]);

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
