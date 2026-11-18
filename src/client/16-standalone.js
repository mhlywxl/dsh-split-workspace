    // ---------------------------------------------------------------------
    // independent window (0.10.0)
    //
    // DSH Desktop exposes no plugin-facing BrowserWindow API: the main window
    // denies window.open, and a Host plugin runs in a Node child process. The
    // old "system window" therefore had to open the default browser. This
    // surface replaces it with a first-class window inside the application:
    // one native conversation, close / minimize / maximize-restore /
    // fullscreen controls, no browser dependency. It covers the app while
    // open and collapses to a restore chip when minimized.
    // ---------------------------------------------------------------------

    function appWindowSnapshot() {
      const state = runtimeState.appWindow;
      return state === null || state === undefined ? null : state;
    }

    /** Replace the browser window with the in-app independent window. */
    function openAppWindow(sessionId) {
      if (!isValidSessionId(sessionId)) return false;
      try { closeLauncher(); } catch {}
      try { if (floatStore.has(sessionId)) floatStore.remove(sessionId); } catch {}
      pendingSplitStore.remove(sessionId);
      setRuntime({ appWindow: { id: sessionId, minimized: false, maximized: false } });
      return true;
    }

    /** Close the independent window for one session (a different window stays). */
    function closeAppWindowFor(sessionId) {
      const state = appWindowSnapshot();
      if (state === null || state.id !== sessionId) return false;
      return closeAppWindow();
    }

    /** Close the independent window and return to the main conversation view. */
    function closeAppWindow() {
      const state = appWindowSnapshot();
      if (state === null) return false;
      setRuntime({ appWindow: null });
      try { openSessionInMainView(state.id); } catch {}
      return true;
    }

    function minimizeAppWindow() {
      const state = appWindowSnapshot();
      if (state === null || state.minimized === true) return false;
      setRuntime({ appWindow: Object.assign({}, state, { minimized: true }) });
      return true;
    }

    function restoreAppWindow() {
      const state = appWindowSnapshot();
      if (state === null || state.minimized !== true) return false;
      setRuntime({ appWindow: Object.assign({}, state, { minimized: false }) });
      return true;
    }

    function toggleMaximizeAppWindow() {
      const state = appWindowSnapshot();
      if (state === null) return false;
      setRuntime({ appWindow: Object.assign({}, state, { maximized: state.maximized !== true, minimized: false }) });
      return true;
    }

    /** One native conversation filling the independent window. */
    function IndependentSessionWindow({ sessionId, embedded }) {
      const runtime = useRuntime();
      const sessions = useSessionsList();
      const summary = sessions !== null && sessions !== undefined && sessions.byId !== undefined
        ? sessions.byId[sessionId]
        : undefined;
      const title = summary !== null && summary !== undefined
        ? (summary.displayTitle || summary.title || sessionId)
        : sessionId;
      React.useEffect(() => {
        const previous = document.title;
        try { document.title = title + " — DeepSeek Harness"; } catch {}
        return () => { try { document.title = previous; } catch {} };
      }, [title]);
      // The DOM session-list source normally observes only while a split is
      // live. This surface is a one-conversation workspace, so keep it warm
      // for the title and the re-hosted header.
      React.useEffect(() => {
        const source = sessionsListSource;
        if (source === undefined || source === null || typeof source.setActive !== "function") return undefined;
        try { source.setActive(true); } catch {}
        try { if (typeof source.refresh === "function") source.refresh(); } catch {}
        return () => {
          try { source.setActive(false); } catch {}
        };
      }, []);
      const state = appWindowSnapshot();
      return h("div", {
        className: "dsv-standalone" + (embedded === true ? " dsv-standalone-embedded" : ""),
        "data-dsv-standalone-window": sessionId,
      },
        h(RenderLeaf, {
          id: sessionId,
          chrome: true,
          generation: runtime.generation,
          standalone: true,
          appWindow: embedded === true,
          appWindowMaximized: state !== null && state.maximized === true,
        }),
      );
    }

    /** Window layer, rendered from the always-mounted shell overlay seat. */
    function AppWindowLayer() {
      const runtime = useRuntime();
      const state = runtime.appWindow;
      if (runtime.enabled !== true) return null;
      if (state === null || state === undefined || state.minimized === true) return null;
      return h("div", {
        className: "dsv-app-window-layer",
        "data-plugin": PLUGIN_ID,
      },
        h("div", {
          className: "dsv-app-window" + (state.maximized === true ? " maximized" : ""),
          "data-dsv-app-window": state.id,
        },
          h(IndependentSessionWindow, { sessionId: state.id, embedded: true }),
        ),
      );
    }

    /** Restore chip shown while the independent window is minimized. */
    function AppWindowChip() {
      const runtime = useRuntime();
      const sessions = useSessionsList();
      const state = runtime.appWindow;
      if (state === null || state === undefined || state.minimized !== true) return null;
      const summary = sessions !== null && sessions !== undefined && sessions.byId !== undefined
        ? sessions.byId[state.id]
        : undefined;
      const title = summary !== null && summary !== undefined
        ? (summary.displayTitle || summary.title || state.id)
        : state.id;
      return h("div", {
        className: "dsv-chip dsv-app-window-chip",
        "data-plugin": PLUGIN_ID,
        role: "status",
      },
        h("span", { className: "dsv-chip-text", title }, title),
        h("button", { type: "button", className: "dsv-chip-btn accent", onClick: restoreAppWindow }, t("independentRestore")),
        h("button", {
          type: "button", className: "dsv-chip-btn icon",
          title: t("independentClose"), "aria-label": t("independentClose"),
          onClick: closeAppWindow,
        }, "×"),
      );
    }
