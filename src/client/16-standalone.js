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

    // ---------------------------------------------------------------------
    // CSS anchor positioning fallback (native system window only)
    //
    // DSH's menus place portaled panels with CSS anchor positioning
    // (`position-anchor` + `anchor()` insets). Chromium implements it; WebKit /
    // WKWebView does not, so every dropdown loses its insets and falls back to
    // `top: 12px; left: 12px` — the top-left corner of the window, on top of the
    // header. This fallback reproduces the placement from the trigger that
    // opened the panel, using the placement attributes the stock Menu primitive
    // already publishes (`data-anchor-side` / `data-anchor-align`) and the
    // anchor custom properties the model selector keeps inline. It is inert on
    // engines with real anchor positioning support.
    // ---------------------------------------------------------------------

    // dsv-anchor-fallback:start — self-contained fallback (WKWebView fixture test).
    /** True when the engine can lay out `position: fixed` panels from anchors. */
    function cssAnchorPositioningSupported() {
      try {
        return typeof CSS !== "undefined"
          && typeof CSS.supports === "function"
          && CSS.supports("position-anchor: --dsv-probe")
          && CSS.supports("top: anchor(top)");
      } catch {
        return false;
      }
    }

    // dsv-anchor-math:start — pure placement math (unit-tested in test.mjs).
    function anchorPanelInsets(anchorRect, viewport, side, align, gap) {
      const margin = 12;
      const width = Math.max(0, viewport.width);
      const height = Math.max(0, viewport.height);
      const insets = {
        left: null, right: null, top: null, bottom: null,
        maxWidth: Math.max(120, width - margin * 2), maxHeight: null,
      };
      if (side === "top" || side === "bottom") {
        const space = side === "top"
          ? anchorRect.top - gap - margin
          : height - anchorRect.bottom - gap - margin;
        insets.maxHeight = Math.max(80, Math.min(space, height - margin * 2));
        if (side === "top") insets.bottom = height - anchorRect.top + gap;
        else insets.top = anchorRect.bottom + gap;
        if (align === "end") insets.right = Math.max(margin, width - anchorRect.right);
        else insets.left = Math.max(margin, anchorRect.left);
        return insets;
      }
      if (side === "right" || side === "left") {
        insets.top = Math.max(margin, Math.min(anchorRect.top, height - margin - 80));
        insets.maxHeight = Math.max(80, height - margin * 2);
        if (side === "right") insets.left = anchorRect.right + gap;
        else insets.right = Math.max(margin, width - anchorRect.left + gap);
        return insets;
      }
      return null;
    }
    // dsv-anchor-math:end

    /** Apply one computed placement to a portaled panel. */
    function applyAnchorPanelInsets(panel, anchor, side, align, gap) {
      const rect = anchor.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) return false;
      const insets = anchorPanelInsets(rect, {
        width: document.documentElement.clientWidth || window.innerWidth || 0,
        height: document.documentElement.clientHeight || window.innerHeight || 0,
      }, side, align, gap);
      if (insets === null) return false;
      const style = panel.style;
      style.position = "fixed";
      style.top = insets.top === null ? "auto" : insets.top + "px";
      style.bottom = insets.bottom === null ? "auto" : insets.bottom + "px";
      style.left = insets.left === null ? "auto" : insets.left + "px";
      style.right = insets.right === null ? "auto" : insets.right + "px";
      style.maxHeight = insets.maxHeight + "px";
      style.maxWidth = insets.maxWidth + "px";
      try { panel.dataset.dsvAnchorFallback = ""; } catch {}
      return true;
    }

    /** The trigger a panel points at, when DSH shares it as a custom property
        with the trigger (the model selector does: --dsh-model-anchor). */
    function anchorFromCustomProperty(panel) {
      if (panel.style === undefined) return null;
      let name = "";
      let value = "";
      for (let index = 0; index < panel.style.length; index += 1) {
        const property = panel.style.item(index);
        if (typeof property !== "string" || !property.startsWith("--")) continue;
        const candidate = String(panel.style.getPropertyValue(property) || "").trim();
        if (!candidate.startsWith("--")) continue;
        name = property;
        value = candidate;
        break;
      }
      if (name === "" || value === "") return null;
      for (const node of document.querySelectorAll("[style]")) {
        if (node === panel || panel.contains(node)) continue;
        if (node.hasAttribute("data-menu-backing")) continue;
        if (String(node.style.getPropertyValue(name) || "").trim() !== value) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) return node;
      }
      return null;
    }

    /** Re-place stock menus while CSS anchor positioning is unavailable. */
    function installAnchorFallback() {
      if (cssAnchorPositioningSupported()) return null;
      if (document.body === null || document.body === undefined) return null;
      const state = { target: null, at: 0 };
      const timers = new Map();

      const remember = (element) => {
        if (element === null || element === undefined) return;
        state.target = element;
        state.at = Date.now();
      };
      const buttonFrom = (target) => (target instanceof Element
        ? target.closest('button, [role="button"], [role="menuitem"], [aria-haspopup]')
        : null);
      const onPointerDown = (event) => { remember(buttonFrom(event.target)); };
      const onPointerOver = (event) => {
        remember(event.target instanceof Element ? event.target.closest('[aria-haspopup="menu"]') : null);
      };
      const onKeyDown = (event) => {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        remember(buttonFrom(event.target));
      };
      window.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("pointerover", onPointerOver, true);
      window.addEventListener("keydown", onKeyDown, true);

      /** A trigger is usable when it is still mounted and has a box. Menu rows
          stay usable: a submenu anchors to the row that opened it. */
      const visibleAnchor = (element) => {
        if (!(element instanceof Element) || element.isConnected !== true) return null;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0 ? element : null;
      };
      const recentAnchor = () => {
        if (state.target === null || Date.now() - state.at > 4000) return null;
        return visibleAnchor(state.target);
      };
      const activeAnchor = () => {
        const active = document.activeElement;
        if (!(active instanceof Element)) return null;
        // Focus usually moves into the opened menu; a menu row is not a trigger.
        if (active.closest('[role="menu"], [role="listbox"]') !== null) return null;
        return visibleAnchor(active.closest('button, [role="button"], [aria-haspopup]') || active);
      };

      const stop = (panel) => {
        const timer = timers.get(panel);
        if (timer === undefined) return;
        try { window.clearInterval(timer); } catch {}
        timers.delete(panel);
      };

      const update = (panel, anchor) => {
        if (panel.isConnected !== true) { stop(panel); return false; }
        const current = anchor.isConnected === true ? anchor : (recentAnchor() || activeAnchor());
        if (current === null) return false;
        const menu = panel.hasAttribute("data-anchor-side");
        const side = menu ? (panel.getAttribute("data-anchor-side") || "bottom") : "top";
        const align = menu ? (panel.getAttribute("data-anchor-align") || "start") : "end";
        const gap = String(panel.style.getPropertyValue("--dsh-model-anchor") || "") === "" ? 4 : 8;
        return applyAnchorPanelInsets(panel, current, side, align, gap);
      };

      const place = (panel) => {
        if (!(panel instanceof Element) || timers.has(panel)) return false;
        const menu = panel.hasAttribute("data-anchor-side");
        const model = panel.style !== undefined
          && String(panel.style.getPropertyValue("--dsh-model-anchor") || "") !== "";
        if (!menu && !model) return false;
        const anchor = anchorFromCustomProperty(panel) || recentAnchor() || activeAnchor();
        if (anchor === null) return false;
        update(panel, anchor);
        timers.set(panel, window.setInterval(() => { update(panel, anchor); }, 150));
        return true;
      };

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (place(node)) continue;
            for (const panel of node.querySelectorAll("[data-anchor-side]")) place(panel);
          }
          for (const node of record.removedNodes) {
            if (!(node instanceof Element)) continue;
            stop(node);
            for (const panel of node.querySelectorAll("[data-anchor-side]")) stop(panel);
          }
        }
      });
      try {
        observer.observe(document.body, { childList: true, subtree: false });
      } catch {
        return null;
      }

      return () => {
        try { observer.disconnect(); } catch {}
        window.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("pointerover", onPointerOver, true);
        window.removeEventListener("keydown", onKeyDown, true);
        for (const [, timer] of timers) {
          try { window.clearInterval(timer); } catch {}
        }
        timers.clear();
      };
    }
    // dsv-anchor-fallback:end

    /** Boot hook: returns a disposer only in a native system window. */
    function bootSystemWindow() {
      const sessionId = systemWindowSessionId();
      if (sessionId === null) return null;
      try { document.documentElement.dataset.dsvSystemWindow = "1"; } catch {}
      const disposeLayout = watchSystemWindowLayout();
      const disposeAnchorFallback = installAnchorFallback();
      activateSystemWindowSession(sessionId);
      return () => {
        try { disposeLayout(); } catch {}
        try { if (typeof disposeAnchorFallback === "function") disposeAnchorFallback(); } catch {}
      };
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
              showPaneToast(t(payload.engine === "edge" ? "systemWindowEdgeOpened" : "systemWindowNativeOpened"), true);
            }
            return;
          }
          const code = payload !== null && payload !== undefined ? payload.error : undefined;
          if (payload !== null && payload !== undefined && typeof payload.detail === "string" && payload.detail !== "") {
            try { console.warn("[dsh-split-workspace] system window failed:", payload.detail); } catch {}
          }
          const failure = code === "unsupported-platform" || code === "not-desktop"
            ? "systemWindowUnsupported"
            : (code === "webview2" ? "systemWindowWebView2Missing" : "systemWindowFailed");
          showPaneToast(t(failure), true);
        }).catch(() => {
          showPaneToast(t("systemWindowFailed"), true);
        });
      } catch {
        showPaneToast(t("systemWindowFailed"), true);
        return false;
      }
      return true;
    }

    /** Host diagnostics for system windows: returns the Host log tail (launch
        tokens are redacted by the Host). Also printed to the dev console. */
    function systemWindowLog() {
      try {
        return fetch("/dsv/system-window-log", {
          method: "GET",
          cache: "no-store",
          headers: { "x-dsv-system-window": "1" },
        }).then((response) => response.json().catch(() => null)).then((payload) => {
          if (payload === null || payload === undefined || typeof payload.log !== "string") return "";
          try {
            console.log("[dsh-split-workspace] system window log (" + String(payload.path || "") + "):\n" + payload.log);
          } catch {}
          return payload.log;
        }).catch(() => "");
      } catch {
        return Promise.resolve("");
      }
    }
