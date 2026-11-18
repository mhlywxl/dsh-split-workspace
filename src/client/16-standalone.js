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

    // ---------------------------------------------------------------------
    // native system window (0.11.0)
    //
    // DSH Desktop has no plugin-facing BrowserWindow API, so the Host opens the
    // closest native equivalent: a real OS window (macOS AppKit NSWindow with a
    // WKWebView, driven by osascript) that loads the Host's authenticated web
    // client. The URL carries a hash marker, and this client boot turns that
    // page into a one-conversation window: no left sidebar, the requested
    // conversation active, and every other column (the right sidebar included)
    // left to the stock shell.
    // ---------------------------------------------------------------------

    const SYSTEM_WINDOW_HASH = "#dsv-system-window=";

    /** The session id carried by the native window URL hash, if any. */
    function systemWindowSessionId() {
      try {
        const hash = String(window.location.hash || "");
        if (!hash.startsWith(SYSTEM_WINDOW_HASH)) return null;
        const value = decodeURIComponent(hash.slice(SYSTEM_WINDOW_HASH.length).split("&")[0] || "");
        return isValidSessionId(value) ? value : null;
      } catch {
        return null;
      }
    }

    /** Zero the sidebar grid track while keeping the solved centre and
        right-sidebar tracks. AppFrame writes the whole track list as an inline
        React style, so only the first track is rewritten. */
    function zeroSystemWindowSidebarTrack() {
      try {
        const root = document.querySelector('[data-slot="root"]');
        if (root === null || root === undefined) return false;
        let frame = null;
        for (const element of root.querySelectorAll("div[style]")) {
          if (element.style !== undefined && element.style.gridTemplateColumns !== "") {
            frame = element;
            break;
          }
        }
        if (frame === null) return false;
        const value = String(frame.style.gridTemplateColumns || "");
        if (value === "" || value.startsWith("0px ")) return true;
        frame.style.gridTemplateColumns = "0px " + value.replace(/^\s*\S+\s+/, "");
        return true;
      } catch {
        return false;
      }
    }

    /** Re-zero the track whenever React re-solves the columns (right sidebar
        toggles, window resize, drawer mode). */
    function watchSystemWindowLayout() {
      let observer = null;
      let timer = 0;
      const attach = () => {
        const root = document.querySelector('[data-slot="root"]');
        if (root === null || root === undefined) return false;
        try {
          observer = new MutationObserver(() => { zeroSystemWindowSidebarTrack(); });
          observer.observe(root, { attributes: true, subtree: true, attributeFilter: ["style"] });
        } catch {}
        zeroSystemWindowSidebarTrack();
        return true;
      };
      if (!attach()) {
        let tries = 0;
        timer = window.setInterval(() => {
          tries += 1;
          if (attach() || tries >= 40) {
            window.clearInterval(timer);
            timer = 0;
          }
        }, 250);
      }
      return () => {
        if (observer !== null) {
          try { observer.disconnect(); } catch {}
        }
        if (timer !== 0) {
          try { window.clearInterval(timer); } catch {}
        }
      };
    }

    /** Activate the requested conversation once the stock shell is ready. The
        web client boots a fresh session first, so retry until the main view
        actually shows the requested id. */
    function activateSystemWindowSession(sessionId) {
      let tries = 0;
      const attempt = () => {
        tries += 1;
        if (currentSessionId() === sessionId) return;
        openSessionInMainView(sessionId);
        if (tries >= 12) return;
        window.setTimeout(attempt, 350);
      };
      window.setTimeout(attempt, 200);
    }

    /** Boot hook: returns a disposer only in a native system window. */
    function bootSystemWindow() {
      const sessionId = systemWindowSessionId();
      if (sessionId === null) return null;
      try { document.documentElement.dataset.dsvSystemWindow = "1"; } catch {}
      const disposeLayout = watchSystemWindowLayout();
      activateSystemWindowSession(sessionId);
      return disposeLayout;
    }

    // The Host owns the system windows. This store mirrors their session ids
    // so the session menu can offer Enter / Exit; it polls only while a menu
    // observes it, and every open/close updates it optimistically.
    const nativeWindowStore = (() => {
      let sessions = [];
      const listeners = new Set();
      let timer = 0;
      let inflight = null;
      const emit = () => {
        for (const listener of [...listeners]) {
          try { listener(); } catch {}
        }
      };
      const publish = (value) => {
        const next = [];
        for (const id of Array.isArray(value) ? value : []) {
          if (isValidSessionId(id) && next.indexOf(id) === -1) next.push(id);
        }
        const same = next.length === sessions.length && next.every((id, index) => sessions[index] === id);
        if (same) return;
        sessions = next;
        emit();
      };
      /** Fetch the Host's window list; concurrent callers share one request.
          The returned promise always settles, so the menu never hangs. */
      const read = () => {
        if (inflight !== null) return inflight;
        inflight = Promise.resolve().then(() => {
          try {
            return fetch("/dsv/system-window", {
              method: "GET",
              cache: "no-store",
              headers: { "x-dsv-system-window": "1" },
            }).then((response) => response.json().catch(() => null)).then((payload) => {
              if (payload !== null && payload !== undefined && payload.ok === true && Array.isArray(payload.sessions)) {
                publish(payload.sessions);
              }
            }).catch(() => {});
          } catch {
            return undefined;
          }
        }).finally(() => { inflight = null; });
        return inflight;
      };
      return {
        getSnapshot: () => sessions,
        subscribe(listener) {
          if (typeof listener !== "function") return () => {};
          listeners.add(listener);
          if (listeners.size === 1) {
            read();
            timer = window.setInterval(read, 2000);
          }
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0 && timer !== 0) {
              try { window.clearInterval(timer); } catch {}
              timer = 0;
            }
          };
        },
        has: (id) => sessions.indexOf(id) !== -1,
        markOpen(id) {
          if (!isValidSessionId(id) || sessions.indexOf(id) !== -1) return;
          sessions = sessions.concat([id]);
          emit();
        },
        markClosed(id) {
          if (sessions.indexOf(id) === -1) return;
          sessions = sessions.filter((entry) => entry !== id);
          emit();
        },
        refresh: () => read(),
      };
    })();

    /** Host action: open or close the native (OS) window for one conversation. */
    function requestSystemWindow(sessionId, mode) {
      if (!isValidSessionId(sessionId)) return false;
      const closing = mode === "close";
      if (!desktopShell()) {
        showPaneToast(t("systemWindowUnsupported"), true);
        return false;
      }
      showPaneToast(t(closing ? "systemWindowClosing" : "systemWindowOpening"), true);
      try {
        fetch("/dsv/system-window", {
          method: "POST",
          headers: { "content-type": "application/json", "x-dsv-system-window": "1" },
          body: JSON.stringify({ sessionId, action: closing ? "close" : "open" }),
          cache: "no-store",
        }).then((response) => response.json().catch(() => null)).then((payload) => {
          if (payload !== null && payload !== undefined && payload.ok === true) {
            if (closing) {
              nativeWindowStore.markClosed(sessionId);
              showPaneToast(t("systemWindowNativeClosed"), true);
            } else {
              nativeWindowStore.markOpen(sessionId);
              showPaneToast(t("systemWindowNativeOpened"), true);
            }
            return;
          }
          const code = payload !== null && payload !== undefined ? payload.error : undefined;
          showPaneToast(t(code === "unsupported-platform" || code === "not-desktop"
            ? "systemWindowUnsupported"
            : "systemWindowFailed"), true);
        }).catch(() => {
          showPaneToast(t("systemWindowFailed"), true);
        });
      } catch {
        showPaneToast(t("systemWindowFailed"), true);
        return false;
      }
      return true;
    }
