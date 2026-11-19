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

    /** Screenshots shown in the help card. The Host serves them from
        docs/screenshots under /dsv/help/, so the same relative URL works in
        the Desktop shell and the Web client. */
    const HELP_SHOTS = [
      { id: "session-menu", src: "/dsv/help/session-menu.png", label: "helpShotMenu" },
      { id: "footer-menu", src: "/dsv/help/footer-menu.png", label: "helpShotFooter" },
      { id: "settings", src: "/dsv/help/settings.png", label: "helpShotSettings" },
    ];

    /** Full-size screenshot opened from a help thumbnail. */
    function HelpShotLightbox({ shot, onClose }) {
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
      }, [onClose]);
      return h("div", {
        className: "dsv-help-lightbox",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t(shot.label),
        "data-plugin": PLUGIN_ID,
        onClick: onClose,
      },
        h("img", { src: shot.src, alt: t(shot.label), draggable: false, onClick: (event) => event.stopPropagation() }),
      );
    }

    /** The one help card: opened by the pane header "?" and by the blocked
        chip. Lives inside the plugin overlay when active (fixed variant for the
        inactive chip path). */
    function HelpCard({ fixed }) {
      const help = helpText();
      const [shot, setShot] = React.useState(null);
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
        h("div", { className: "dsv-help-body", style: { marginTop: "6px" } }, t("helpIndependent")),
        h("div", { className: "dsv-help-section-title" }, t("helpShotsTitle")),
        h("div", { className: "dsv-help-shots" }, HELP_SHOTS.map((item) => h("figure", {
          key: item.id,
          className: "dsv-help-shot",
          title: t("helpShotZoom"),
          onClick: () => setShot(item),
        },
          h("img", { src: item.src, alt: t(item.label), loading: "lazy", draggable: false }),
          h("figcaption", null, t(item.label)),
        ))),
        shot !== null ? h(HelpShotLightbox, { shot, onClose: () => setShot(null) }) : null,
        h("div", { className: "dsv-help-body", style: { marginTop: "6px" } }, t("helpDisable")),
        h("div", { className: "dsv-help-body", style: { marginTop: "2px" } }, t("helpDiagnostics")),
        h("div", { className: "dsv-help-body", style: { marginTop: "2px" } }, t("helpRestart")),
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

    /** Draggable restore chip shown while the split is minimized. It is
        confined to the conversation workspace (never the sidebar or the macOS
        traffic-light corner), can be dropped anywhere, and snaps to the NEAREST
        EDGE on release — the position along that edge is kept, so it can sit
        anywhere on any edge instead of only in the four corners. The chosen
        position persists across minimize cycles. */
    function MinimizedChip() {
      const MARGIN = 18;
      const ref = React.useRef(null);
      const dragRef = React.useRef(null);
      const defaultPos = () => {
        const work = chipWorkRect();
        const el = ref.current;
        const width = el ? el.offsetWidth : 229;
        const height = el ? el.offsetHeight : 42;
        const saved = readChipPos();
        if (saved !== null) {
          return {
            x: Math.min(Math.max(saved.x, work.left + MARGIN), Math.max(work.left + MARGIN, work.left + work.width - width - MARGIN)),
            y: Math.min(Math.max(saved.y, work.top + MARGIN), Math.max(work.top + MARGIN, work.top + work.height - height - MARGIN)),
          };
        }
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
        // Bring a restored position back inside the current work area after the
        // layout has been measured (the first render may predate it).
        setPos((current) => clampToWork(current));
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
        // Snap to the nearest EDGE only. The coordinate along that edge keeps
        // the drop position, so the chip can rest anywhere on any edge — not
        // just in the four corners.
        const leftDist = base.x - work.left;
        const rightDist = work.left + work.width - (base.x + width);
        const topDist = base.y - work.top;
        const bottomDist = work.top + work.height - (base.y + height);
        const nearest = Math.min(leftDist, rightDist, topDist, bottomDist);
        const snapped = { x: base.x, y: base.y };
        if (nearest === leftDist) snapped.x = work.left + MARGIN;
        else if (nearest === rightDist) snapped.x = work.left + work.width - width - MARGIN;
        else if (nearest === topDist) snapped.y = work.top + MARGIN;
        else snapped.y = work.top + work.height - height - MARGIN;
        const next = clampToWork(snapped);
        setPos(next);
        writeChipPos(next);
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
        stock controls. While the split-view panel owns the main column this
        chrome steps aside: the panel page renders its own state card. */
    function PluginChrome({ panelOwned }) {
      const runtime = useRuntime();
      const tree = useTree();
      const leaves = tree.root === null ? 0 : leafOf(tree.root, []).length;
      const wantsActive = runtime.enabled === true && leaves >= 2;
      const [settledBlocked, setSettledBlocked] = React.useState(false);
      // Unconditional hooks above; the panel-owned gate belongs here, after
      // them. An early return before useState/useEffect violated the hooks
      // order when the split-view panel was selected (React error #300: the
      // overlay slot entry crashed but still rendered).
      const panelOwnedUi = panelOwned === true;
      React.useEffect(() => {
        if (panelOwnedUi) return undefined;
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
      }, [wantsActive, runtime.safeMode, runtime.active, panelOwnedUi]);
      if (panelOwnedUi) return null;
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
      const desktop = desktopShell();
      // Desktop app code is applied through the Host's HMR/rebuild path when
      // it can be, but a Host-half or linked-package change can still need a
      // full restart. Offer the restart itself instead of asking the user to
      // quit the app by hand. The Web GUI reloads the page.
      return h("div", { className: "dsv-update-chip", role: "status" },
        h("span", null, t(desktop ? "updateRestart" : "updateReady", { v: ready })),
        desktop ? h("button", {
          type: "button",
          className: "dsv-update-chip-btn accent",
          onClick: () => { closeLauncher(); openRestartDialog(); },
        }, t("restartApp")) : h("button", {
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
      const appWindowState = runtime.appWindow;
      const appWindowOpen = appWindowState !== null && appWindowState !== undefined && appWindowState.minimized !== true;
      // The canvas ALWAYS lives here, the single live pane tree. Selecting the
      // "分屏视图" panel must not move it (the panel page below is empty and the
      // overlay covers exactly that column), otherwise every panel ⇄ split
      // switch would tear down and re-create N native conversations.
      const activePanelId = typeof props.usePanelInfo === "function"
        ? props.usePanelInfo((info) => (info !== null && info !== undefined ? info.activePanelId : null))
        : null;
      const panelOwned = activePanelId === SPLIT_PANEL_ID;
      return h(React.Fragment, null,
        h(WorkspaceBoundary, { key: "workspace-" + runtime.epoch },
          h(WorkspaceApp, Object.assign({}, props, { dsvAppWindowOpen: appWindowOpen }))),
        h(PluginChrome, { panelOwned }),
        h(WorkspaceBoundary, { key: "floats-" + runtime.epoch }, h(FloatLayer, null)),
        h(SplitLauncherLayer, null),
        h(AppWindowChip, null),
        h(AppWindowLayer, null),
        // The settings page and the help action can open the card without a
        // live split; the pane/overlay path only renders it while active.
        runtime.helpOpen === true && runtime.active !== true ? h(HelpCard, { fixed: true }) : null,
        h(UpdateNotice, null),
      );
    }

    // ---- live window-resize canvas freeze (0.12.0) -------------------------
    // Every pane re-hosts the stock conversation view; those components
    // re-measure their own scrollers on every size change, so a live window
    // resize used to re-layout and re-measure N conversations on every frame
    // (the trace showed style-recalc + per-frame chat ticks as the dominant
    // cost, in performance mode too). Keeping the canvas's inner layout frozen
    // at the gesture-start size and scaling the rendered layer to the live
    // window edge removes that per-frame work: the transform is a compositor
    // operation, and one real relayout happens at settle. Tradeoff: text is
    // scaled (slightly stretched) for the duration of the drag and crisps up
    // when it ends.
    function clearCanvasFreeze(el) {
      if (el === null || el === undefined) return;
      try {
        el.style.transform = "";
        el.style.transformOrigin = "";
        el.style.width = "";
        el.style.height = "";
        el.style.right = "";
        el.style.bottom = "";
        el.style.willChange = "";
      } catch {}
    }
    /** Keep a frozen inner box but present it at the live target box. */
    function applyCanvasFreeze(el, frozenW, frozenH, targetW, targetH, left, top) {
      if (frozenW <= 2 || frozenH <= 2 || targetW <= 2 || targetH <= 2) return false;
      try {
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
        el.style.width = frozenW + "px";
        el.style.height = frozenH + "px";
        el.style.transformOrigin = "0 0";
        // Promote the frozen layer once per gesture: the per-frame scale is a
        // compositor transform, not a repaint of the conversation text.
        el.style.willChange = "transform";
        el.style.transform = "scale(" + (targetW / frozenW) + "," + (targetH / frozenH) + ")";
        return true;
      } catch { return false; }
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
      // An independent window owns the screen while it is open; keep the
      // split tree (and its observers) quiet underneath.
      const appWindowOpen = props.dsvAppWindowOpen === true;
      const active = appWindowOpen !== true && leaves.length >= 2
        && runtime.enabled === true && runtime.safeMode !== true && minimized !== true;
      const [picker, setPicker] = React.useState(pickerRequest);
      const [bounds, setBounds] = React.useState({ left: 0, right: 0, top: 0, bottom: 0, ok: false });
      // Warm hold (0.13.0): the overlay canvas is the ONE live pane tree. When
      // the split is minimized, or another global panel (Plugins, Settings, …)
      // takes the main column, or the "分屏视图" panel is merely selected, the
      // canvas hides WITHOUT unmounting for WARM_HIDE_MS. Remounting N native
      // conversations (session retain, editor guards, transcript views) was the
      // latency behind every panel ⇄ split and minimize ⇄ restore switch; after
      // the warm window the tree is dropped so a long-hidden split stops
      // streaming in the background.
      const [warmCold, setWarmCold] = React.useState(false);
      const geometryWarnedRef = React.useRef(false);
      const overlayRef = React.useRef(null);
      // B3 "invisible active": the workspace is OPERATIONAL only when it can
      // actually render (>=2 panes AND a confident column measurement). All
      // input/observation paths gate on this, so a persisted split whose
      // geometry fails renders nothing and also does NOT eat Alt+T /
      // Alt+Shift+Arrow (the chrome chip explains the state instead).
      // The split-view main panel is NOT a foreign panel: the canvas covers
      // exactly that column, so selecting it must not step aside.
      const otherPanelActive = activePanelId !== null && activePanelId !== undefined
        && activePanelId !== SPLIT_PANEL_ID;
      const visible = active === true && otherPanelActive !== true;
      const warmEligible = appWindowOpen !== true && leaves.length >= 2
        && runtime.enabled === true && runtime.safeMode !== true;
      const warmHold = warmEligible === true && warmCold !== true && visible !== true;
      const operational = visible && bounds.ok === true;

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

      // Surface the warm-hold state for health()/diagnostics.
      React.useEffect(() => {
        setRuntime({ panelWarm: warmHold === true });
      }, [warmHold]);

      // Warm-hold timer: start it when the canvas becomes hidden and drop the
      // tree (cold) once the window expires; any show resets it.
      React.useEffect(() => {
        if (warmEligible !== true || visible === true) {
          if (warmCold !== false) setWarmCold(false);
          return undefined;
        }
        if (warmCold === true) return undefined;
        const timer = window.setTimeout(() => setWarmCold(true), WARM_HIDE_MS);
        return () => {
          try { window.clearTimeout(timer); } catch {}
        };
      }, [warmEligible, visible, warmCold]);

      // Invariant: a canvas that (re)appears must be hit-testable. A warm hold
      // that never fully cleared, a window-resize freeze interrupted by a
      // minimize, an interrupted pane drag or a hot-swapped older instance can
      // leave interaction styles behind so that the panes paint but every
      // control inside them — most visibly the pane header buttons — is dead
      // after "restore split". Repair once, one frame after the canvas shows,
      // and count it in health().canvasRepairs (should stay 0).
      React.useEffect(() => {
        if (visible !== true) return undefined;
        let raf = 0;
        try {
          raf = window.requestAnimationFrame(() => {
            raf = 0;
            const el = overlayRef.current;
            if (el === null || el === undefined || !el.isConnected) return;
            let repaired = false;
            try {
              if (el.style.transform !== "" || el.style.width !== "") {
                // A freeze survived the hidden phase: drop it and re-write the
                // real box (React may skip style writes it believes unchanged).
                clearCanvasFreeze(el);
                const box = measureColumnBounds();
                if (box !== null && box !== undefined && box.ok === true) {
                  el.style.left = box.left + "px";
                  el.style.right = box.right + "px";
                  el.style.top = box.top + "px";
                  el.style.bottom = box.bottom + "px";
                }
                repaired = true;
              }
              const computed = window.getComputedStyle(el);
              if (computed.pointerEvents === "none" || computed.visibility === "hidden") {
                el.style.setProperty("pointer-events", "auto", "important");
                el.style.setProperty("visibility", "visible", "important");
                repaired = true;
              }
              for (const header of el.querySelectorAll(".dsv-pane-header")) {
                if (window.getComputedStyle(header).pointerEvents === "none") {
                  header.style.setProperty("pointer-events", "auto", "important");
                  repaired = true;
                }
              }
              // A pane whose drag-to-reflow was interrupted keeps the inline
              // pointer-events:none / opacity:0 and stays dead to the mouse.
              if (reflowState.active !== true && reflowState.settling !== true) {
                for (const source of el.querySelectorAll("[data-dsv-source]")) {
                  source.removeAttribute("data-dsv-source");
                  if (source.style !== null && source.style !== undefined) {
                    source.style.pointerEvents = "";
                    source.style.opacity = "";
                  }
                  repaired = true;
                }
              }
            } catch {}
            if (repaired) {
              try { setRuntime({ canvasRepairs: runtimeState.canvasRepairs + 1 }); } catch {}
            }
          });
        } catch {}
        return () => {
          if (raf !== 0) {
            try { window.cancelAnimationFrame(raf); } catch {}
          }
        };
      }, [visible]);

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
        if (!visible) return undefined;
        let raf = 0;
        let frozen = null;
        const apply = () => {
          raf = 0;
          const next = measureColumnBounds();
          noteGeometry(next);
          const overlayEl = overlayRef.current;
          // Freeze is a fluidity-first tradeoff (scaled text while dragging),
          // so it belongs to performance mode; normal mode keeps transitions
          // and a true per-frame reflow.
          if (overlayEl !== null && runtime.performance === true && runtime.resizeFreeze !== false && windowResizing()) {
            // Live resize: hold the pane layout at the gesture-start size and
            // scale the rendered layer to the current column box. No setBounds
            // here — React must not rewrite the insets mid-gesture.
            if (frozen !== null && (frozen.left !== next.left || frozen.top !== next.top)) {
              // The sidebar moved (auto-collapse breakpoint): rebase.
              clearCanvasFreeze(overlayEl);
              frozen = null;
            }
            if (frozen === null) {
              let rect = null;
              try { rect = overlayEl.getBoundingClientRect(); } catch {}
              if (rect !== null && rect.width > 2 && rect.height > 2) {
                frozen = { w: Math.round(rect.width), h: Math.round(rect.height), left: next.left, top: next.top };
              }
            }
            if (frozen !== null && next.ok) {
              const targetW = window.innerWidth - next.left - next.right;
              const targetH = window.innerHeight - next.top - next.bottom;
              if (applyCanvasFreeze(overlayEl, frozen.w, frozen.h, targetW, targetH, next.left, next.top)) return;
            }
          } else if (frozen !== null) {
            // Gesture over: drop the freeze AND write the final box directly.
            // React may skip a style write it believes is unchanged, and the
            // freeze left inline values (right/bottom/transform) behind.
            clearCanvasFreeze(overlayEl);
            frozen = null;
            if (overlayEl !== null) {
              try {
                overlayEl.style.left = next.left + "px";
                overlayEl.style.right = next.right + "px";
                overlayEl.style.top = next.top + "px";
                overlayEl.style.bottom = next.bottom + "px";
              } catch {}
            }
          }
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
        const offSettle = onLayoutSettle(() => {
          // Gesture over: the scheduled apply below drops the freeze and writes
          // the final box in the same frame, so the canvas never spends a
          // frame at the intermediate "explicit width cleared" state.
          schedule();
        });
        window.addEventListener("resize", schedule);
        document.addEventListener("visibilitychange", schedule);
        return () => {
          offSettle();
          if (raf !== 0) window.cancelAnimationFrame(raf);
          if (observer !== null) {
            try { observer.disconnect(); } catch {}
          }
          if (transitionHost !== null) transitionHost.removeEventListener("transitionend", schedule);
          if (fallbackInterval !== 0) window.clearInterval(fallbackInterval);
          const overlayEl = overlayRef.current;
          if (overlayEl !== null) clearCanvasFreeze(overlayEl);
          window.removeEventListener("resize", schedule);
          document.removeEventListener("visibilitychange", schedule);
        };
      }, [visible, runtime.performance, runtime.resizeFreeze]);

      // Crash-loop guard timers: a deliberate activation is persisted BEFORE it
      // can crash; a healthy, responsive workspace clears the counter after
      // HEALTHY_AFTER_MS and refreshes lastHealthyAt at most every 30s.
      React.useEffect(() => {
        if (!visible || bounds.ok !== true) return undefined;
        markActivationAttempt();
        const healthyTimer = window.setTimeout(() => { markHealthy(); }, HEALTHY_AFTER_MS);
        const refreshTimer = window.setInterval(() => { refreshHealthy(); }, HEALTHY_REFRESH_MS);
        return () => {
          try { window.clearTimeout(healthyTimer); } catch {}
          try { window.clearInterval(refreshTimer); } catch {}
        };
      }, [visible, bounds.ok]);

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

      // Render gates (after every hook). Hidden states keep the canvas mounted
      // (warm hold) so the expensive pane tree is reused on the way back; only
      // a cold hold / disabled / <2 panes / independent window unmounts it.
      if (visible !== true) {
        if (warmHold !== true || bounds.ok !== true) return null;
        return h("div", {
          ref: overlayRef,
          className: "dsv-overlay dsv-warm",
          style: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          "aria-hidden": "true",
        }, h(WorkspaceBody, { generation }));
      }
      if (bounds.ok !== true) return null;

      return h(
        "div",
        {
          ref: overlayRef,
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

    /** The "分屏视图" main-panel page. The live canvas is the shell.overlay
        workspace, which stays mounted across panel ⇄ conversation switches so the
        native pane tree is never re-created for a mere navigation; this page is
        only the page state — the inline add-split picker while fewer than two
        conversations are staged, and an empty column the canvas covers once the
        split exists. */
    function SplitPanelView() {
      const runtime = useRuntime();
      const state = useTree();
      // Selecting the panel is also the restore affordance for a minimized
      // split: clear the flag so the (warm, still mounted) canvas shows again.
      React.useEffect(() => {
        if (runtime.minimized !== true) return;
        try {
          setRuntime({ minimized: false });
          writeMinimized(false);
        } catch {}
      }, [runtime.minimized]);
      const leaves = state.root === null ? [] : leafOf(state.root, []);
      const splitReady = leaves.length >= 2 && runtime.enabled === true && runtime.safeMode !== true;
      return h("div", { className: "dsv-panel-root", "data-plugin": PLUGIN_ID },
        splitReady ? null : h(PanelSplitPicker, null));
    }

    // ---------------------------------------------------------------------
