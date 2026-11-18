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
      performance: readPerformanceMode(),
      updateReady: null,
      // One conversation in an in-app independent window. DSH Desktop has no
      // plugin-facing BrowserWindow API, so this replaces the old browser
      // window with a first-class surface inside the application.
      appWindow: null,
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
    /** The same runtime state as a store object, for context-menu observes. */
    const runtimeStore = { getSnapshot: runtimeSnapshot, subscribe: runtimeSubscribe };

    /** The plugin's own state store as a hook (safe before apply() runs). */
    function useRuntime() {
      return React.useSyncExternalStore(runtimeSubscribe, runtimeSnapshot, runtimeSnapshot);
    }

    /** Performance mode: one boolean consumed by observers and CSS alike. */
    function performanceModeOn() {
      return runtimeState.performance === true;
    }
    /** Mirror performance mode onto <html> so the stylesheet can drop
        animations/shadows without re-rendering every pane. */
    function applyPerformanceClass() {
      try {
        if (typeof document !== "undefined" && document.documentElement !== null) {
          document.documentElement.setAttribute("data-dsv-performance", performanceModeOn() ? "1" : "0");
        }
      } catch {}
    }
    function setPerformanceMode(value) {
      const next = value === true;
      writePerformanceMode(next);
      setRuntime({ performance: next });
      applyPerformanceClass();
      showPaneToast(t(next ? "performanceOn" : "performanceOff"), true);
      return next;
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
        performance: runtimeState.performance === true,
        geometryBlocked: runtimeState.geometryBlocked === true,
        panes: (() => { try { return treeStore.leafIds().length; } catch { return 0; } })(),
        floats: (() => { try { return floatStore.ids(); } catch { return []; } })(),
        floatLayerMounted: floatLayerMounted,
        appWindow: runtimeState.appWindow === null ? null : Object.assign({}, runtimeState.appWindow),
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

