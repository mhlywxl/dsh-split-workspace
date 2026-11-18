    // ---------------------------------------------------------------------
    // pending split + launcher state (0.5.0)
    //
    // "Add to split" on a session row is only meaningful once a split exists.
    // While the workspace is inactive the first pick is parked in this store
    // (the "pending split") and the SECOND pick starts the split; the footer
    // button shows the pending count so the parked pick is never invisible.
    // The launcher store drives the footer menu and the multi-select dialog;
    // both render through the always-mounted shell overlay seat, so the
    // sidebar's clipping/stacking can never cut them.
    // ---------------------------------------------------------------------

    const pendingSplitStore = (() => {
      let ids = [];
      const listeners = new Set();
      const emit = () => {
        for (const listener of [...listeners]) {
          try { listener(); } catch {}
        }
      };
      return {
        getSnapshot: () => ids,
        subscribe(listener) {
          if (typeof listener !== "function") return () => {};
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        has: (id) => ids.indexOf(id) !== -1,
        /** @returns {boolean} true when the id was newly parked. */
        add(id) {
          if (!isValidSessionId(id) || ids.indexOf(id) !== -1) return false;
          ids = ids.concat([id]);
          emit();
          return true;
        },
        remove(id) {
          if (ids.indexOf(id) === -1) return false;
          ids = ids.filter((entry) => entry !== id);
          emit();
          return true;
        },
        clear() {
          if (ids.length === 0) return;
          ids = [];
          emit();
        },
        size: () => ids.length,
        ids: () => ids.slice(),
      };
    })();

    /** Footer-menu / add-dialog request. `mode`: closed | menu | dialog. */
    let launcherState = { mode: "closed", rect: null, source: null };
    const launcherListeners = new Set();
    function setLauncherState(next) {
      const same = launcherState.mode === next.mode
        && launcherState.source === next.source
        && launcherState.rect === next.rect;
      if (same) return launcherState;
      launcherState = next;
      for (const listener of [...launcherListeners]) {
        try { listener(); } catch {}
      }
      return launcherState;
    }
    function useLauncherState() {
      return React.useSyncExternalStore(
        (listener) => { launcherListeners.add(listener); return () => { launcherListeners.delete(listener); }; },
        () => launcherState,
        () => launcherState,
      );
    }
    function closeLauncher() {
      setLauncherState({ mode: "closed", rect: null, source: null });
    }
    function openLauncherMenu(anchorEl) {
      let rect = null;
      try {
        rect = anchorEl !== null && anchorEl !== undefined && typeof anchorEl.getBoundingClientRect === "function"
          ? anchorEl.getBoundingClientRect() : null;
      } catch { rect = null; }
      setLauncherState({ mode: "menu", rect, source: "footer" });
    }
    function openAddSplitDialog(source) {
      setLauncherState({ mode: "dialog", rect: null, source: source === "footer" ? "footer" : "session" });
    }
    function openRestartDialog() {
      setLauncherState({ mode: "restart", rect: null, source: "footer" });
    }

    // ---------------------------------------------------------------------
    // floating windows (0.6.0)
    //
    // DSH has no second native window: the Desktop main window denies
    // window.open() and the Web client has no per-session deep link, so a
    // "window" here is an in-app floating surface rendered by the
    // always-mounted shell.overlay seat. It hosts the SAME native ChatPane the
    // split re-hosts, and it is mutually exclusive with a split pane for one
    // session: entering a float detaches the pane, docking it back re-attaches
    // it. Geometry lives in viewport CSS pixels, persisted under FLOAT_KEY and
    // clamped to the conversation column on every gesture/resize.
    // ---------------------------------------------------------------------

    const FLOAT_W = 680;
    const FLOAT_H = 620;
    const FLOAT_MIN_W = 320;
    const FLOAT_MIN_H = 220;

    function readFloatWindows() {
      const raw = storageGet(FLOAT_KEY);
      if (!raw) return [];
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { return []; }
      const list = parsed !== null && parsed !== undefined && Array.isArray(parsed.windows) ? parsed.windows : [];
      const out = [];
      for (const entry of list) {
        if (entry === null || typeof entry !== "object") continue;
        const id = entry.id;
        if (!isValidSessionId(id)) continue;
        if (out.some((win) => win.id === id)) continue;
        const x = Number(entry.x);
        const y = Number(entry.y);
        const w = Number(entry.w);
        const h = Number(entry.h);
        const z = Number(entry.z);
        out.push({
          id,
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          w: Number.isFinite(w) && w >= FLOAT_MIN_W ? w : FLOAT_W,
          h: Number.isFinite(h) && h >= FLOAT_MIN_H ? h : FLOAT_H,
          z: Number.isFinite(z) ? z : out.length + 1,
        });
      }
      return out;
    }

    const floatStore = (() => {
      let windows = readFloatWindows();
      let focused = windows.length > 0 ? windows[windows.length - 1].id : null;
      let persistTimer = 0;
      const listeners = new Set();
      let snapshot = Object.freeze({ windows: windows.slice(), focused });
      const emit = () => {
        for (const listener of [...listeners]) {
          try { listener(); } catch {}
        }
      };
      const publish = () => {
        snapshot = Object.freeze({ windows: windows.slice(), focused });
        emit();
      };
      const write = () => {
        persistTimer = 0;
        try { storageSet(FLOAT_KEY, JSON.stringify({ windows })); } catch {}
      };
      const schedulePersist = (immediate) => {
        if (persistTimer !== 0) {
          try { window.clearTimeout(persistTimer); } catch {}
          persistTimer = 0;
        }
        if (immediate === true) { write(); return; }
        try { persistTimer = window.setTimeout(write, 200); } catch { write(); }
      };
      const find = (id) => windows.find((win) => win.id === id);
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          if (typeof listener !== "function") return () => {};
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        ids: () => windows.map((win) => win.id),
        size: () => windows.length,
        has: (id) => windows.some((win) => win.id === id),
        focusedId: () => focused,
        add(id, rect) {
          if (!isValidSessionId(id) || windows.some((win) => win.id === id)) return false;
          const max = windows.reduce((acc, win) => Math.max(acc, win.z), 0);
          windows = windows.concat([{
            id,
            x: rect !== null && rect !== undefined && Number.isFinite(rect.x) ? rect.x : 0,
            y: rect !== null && rect !== undefined && Number.isFinite(rect.y) ? rect.y : 0,
            w: rect !== null && rect !== undefined && Number.isFinite(rect.w) ? rect.w : FLOAT_W,
            h: rect !== null && rect !== undefined && Number.isFinite(rect.h) ? rect.h : FLOAT_H,
            z: max + 1,
          }]);
          focused = id;
          publish();
          schedulePersist(false);
          return true;
        },
        remove(id) {
          const next = windows.filter((win) => win.id !== id);
          if (next.length === windows.length) return false;
          windows = next;
          if (focused === id) {
            const top = windows.reduce((acc, win) => (acc === null || win.z > acc.z ? win : acc), null);
            focused = top === null ? null : top.id;
          }
          publish();
          schedulePersist(true);
          return true;
        },
        clear() {
          const had = windows.length > 0 || focused !== null;
          windows = [];
          focused = null;
          if (had) {
            publish();
            schedulePersist(true);
          }
        },
        focus(id) {
          const target = find(id);
          if (target === undefined) {
            focused = null;
            publish();
            return;
          }
          const max = windows.reduce((acc, win) => Math.max(acc, win.z), 0);
          if (target.z !== max || focused !== id) {
            target.z = max + 1;
            focused = id;
            publish();
            schedulePersist(false);
          }
        },
        setRect(id, rect, immediate) {
          const target = find(id);
          if (target === undefined) return;
          if (target.x === rect.x && target.y === rect.y && target.w === rect.w && target.h === rect.h) return;
          target.x = rect.x;
          target.y = rect.y;
          target.w = rect.w;
          target.h = rect.h;
          windows = windows.slice();
          publish();
          schedulePersist(immediate === true);
        },
        persistNow() {
          if (persistTimer !== 0) {
            try { window.clearTimeout(persistTimer); } catch {}
            persistTimer = 0;
          }
          write();
        },
      };
    })();

    function useFloats() {
      return React.useSyncExternalStore(floatStore.subscribe, floatStore.getSnapshot, floatStore.getSnapshot);
    }

    /** Keep a rect inside the conversation column (the same work area the
        restore chip uses; falls back to the viewport below the title bar). */
    function clampFloatRect(rect, work) {
      const width = Math.max(FLOAT_MIN_W, Math.min(rect.w, Math.max(FLOAT_MIN_W, work.width)));
      const height = Math.max(FLOAT_MIN_H, Math.min(rect.h, Math.max(FLOAT_MIN_H, work.height)));
      const x = Math.round(Math.min(Math.max(rect.x, work.left), Math.max(work.left, work.left + work.width - width)));
      const y = Math.round(Math.min(Math.max(rect.y, work.top), Math.max(work.top, work.top + work.height - height)));
      return { x, y, w: Math.round(width), h: Math.round(height) };
    }

    function defaultFloatRect() {
      const work = chipWorkRect();
      const w = Math.min(FLOAT_W, Math.max(FLOAT_MIN_W, Math.round(work.width * 0.74)));
      const h = Math.min(FLOAT_H, Math.max(FLOAT_MIN_H, Math.round(work.height * 0.74)));
      // Cascade successive windows so a second float never lands exactly on
      // the first one (the user can still drag them anywhere afterwards).
      let index = 0;
      try { index = floatStore.size(); } catch {}
      const offset = (index % 8) * 28;
      const x = work.left + Math.round((work.width - w) / 2) + offset;
      const y = work.top + Math.round(Math.max(0, (work.height - h) * 0.16)) + Math.round(offset * 0.5);
      return clampFloatRect({ x, y, w, h }, work);
    }

    /** Enter floating-window mode. A split pane (or a parked pending pick) is
        detached first so the same conversation is never hosted twice. */
    function floatSession(sessionId) {
      if (!isValidSessionId(sessionId)) return false;
      prepareExplicitSplit();
      if (floatStore.has(sessionId)) {
        floatStore.focus(sessionId);
        return false;
      }
      pendingSplitStore.remove(sessionId);
      try {
        if (treeStore.leafIds().indexOf(sessionId) !== -1) treeStore.closeLeaf(sessionId);
      } catch {}
      try {
        const remaining = treeStore.leafIds();
        if (remaining.length > 0 && remaining.length < 2) treeStore.reset();
      } catch {}
      floatStore.add(sessionId, defaultFloatRect());
      showPaneToast(t("floatEntered"), true);
      return true;
    }

    /** Close a float without putting it back into the split. */
    function closeFloatWindow(sessionId, options) {
      if (!floatStore.has(sessionId)) return false;
      floatStore.remove(sessionId);
      if (options === undefined || options.silent !== true) showPaneToast(t("floatClosed"), true);
      return true;
    }

    /** Switch one float back to split mode: append it to a live split, or
        rebuild/start from the pending pick when no split is running yet. */
    function dockFloatToSplit(sessionId) {
      if (!isValidSessionId(sessionId)) return false;
      if (!floatStore.has(sessionId)) return false;
      floatStore.remove(sessionId);
      const leaves = treeStore.leafIds();
      if (leaves.indexOf(sessionId) !== -1) {
        try { treeStore.setFocus(sessionId); } catch {}
        return true;
      }
      if (leaves.length > 0) {
        prepareExplicitSplit();
        unminimizeForSplit();
        try { treeStore.addPane(sessionId); } catch {}
        showPaneToast(t("floatDocked"), true);
        return true;
      }
      const pending = pendingSplitStore.ids().filter((id) => id !== sessionId);
      if (pending.length > 0) {
        pendingSplitStore.clear();
        buildSplitFromSessions(pending.concat([sessionId]));
        showPaneToast(t("floatDocked"), true);
        return true;
      }
      pendingSplitStore.add(sessionId);
      showPaneToast(t("pendingAdded"), true);
      return true;
    }

    /** Leave every in-app surface (split pane, pending pick, float) because the
        conversation now lives in a separate system window. The split ends
        through closeLeaf's own too-small rule when only one pane would remain. */
    function detachSessionForSystemWindow(sessionId) {
      try { if (floatStore.has(sessionId)) floatStore.remove(sessionId); } catch {}
      pendingSplitStore.remove(sessionId);
      try {
        const leaves = treeStore.leafIds();
        if (leaves.indexOf(sessionId) !== -1) treeStore.closeLeaf(sessionId);
        else if (leaves.length > 0 && leaves.length < 2) treeStore.reset();
      } catch {}
    }

    /** Ask the Host for the authenticated standalone URL and open it as a real
        separate window. In Desktop the app's window-open handler forwards
        http/https to the system browser (the only OS window a renderer plugin
        can create here); in Web mode `window.open` opens a browser window.
        A blank window is pre-opened in Web mode so the async Host round-trip
        cannot lose the user-gesture popup permission. */
    function openSystemWindow(sessionId) {
      if (!isValidSessionId(sessionId)) return Promise.resolve(false);
      let preopened = null;
      if (typeof window.dshDesktop === "undefined") {
        try { preopened = window.open("", "_blank"); } catch { preopened = null; }
      }
      const fail = () => {
        try { if (preopened !== null && preopened.closed !== true) preopened.close(); } catch {}
        showPaneToast(t("systemWindowFailed"), true);
        return false;
      };
      return fetch("/dsv/system-window", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).then((response) => (response.ok ? response.json().catch(() => null) : null)).then((payload) => {
        if (payload === null || payload === undefined || payload.ok !== true
            || typeof payload.url !== "string" || payload.url === "") return fail();
        try {
          detachSessionForSystemWindow(sessionId);
          if (preopened !== null && preopened.closed !== true) {
            try { preopened.opener = null; } catch {}
            preopened.location.href = payload.url;
          } else {
            window.open(payload.url, "_blank", "noopener,noreferrer");
          }
          showPaneToast(t("systemWindowOpened"), true);
          return true;
        } catch {
          return fail();
        }
      }).catch(() => fail());
    }

    let floatLayerMounted = false;

    // One gesture at a time (move or resize); the element that captured the
    // pointer owns it until pointerup/cancel.
    let floatGesture = null;
    function beginFloatGesture(sessionId, mode, event) {
      if (event === null || event === undefined || event.button !== 0) return;
      const state = floatStore.getSnapshot();
      const win = state.windows.find((entry) => entry.id === sessionId);
      if (win === undefined) return;
      const target = event.target;
      if (mode === "move" && target !== null && target !== undefined && typeof target.closest === "function"
          && target.closest("button,input,.dsv-pane-title-text") !== null) return;
      event.preventDefault();
      floatGesture = {
        id: sessionId,
        mode,
        pointerId: event.pointerId,
        sx: event.clientX,
        sy: event.clientY,
        start: { x: win.x, y: win.y, w: win.w, h: win.h },
        work: chipWorkRect(),
      };
      floatStore.focus(sessionId);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    }
    function moveFloatGesture(event) {
      const gesture = floatGesture;
      if (gesture === null || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.sx;
      const dy = event.clientY - gesture.sy;
      let next;
      if (gesture.mode === "move") {
        next = { x: gesture.start.x + dx, y: gesture.start.y + dy, w: gesture.start.w, h: gesture.start.h };
      } else {
        let left = gesture.start.x;
        let top = gesture.start.y;
        let right = gesture.start.x + gesture.start.w;
        let bottom = gesture.start.y + gesture.start.h;
        if (gesture.mode.indexOf("e") !== -1) right = Math.max(left + FLOAT_MIN_W, gesture.start.x + gesture.start.w + dx);
        if (gesture.mode.indexOf("w") !== -1) left = Math.min(right - FLOAT_MIN_W, gesture.start.x + dx);
        if (gesture.mode.indexOf("s") !== -1) bottom = Math.max(top + FLOAT_MIN_H, gesture.start.y + gesture.start.h + dy);
        if (gesture.mode.indexOf("n") !== -1) top = Math.min(bottom - FLOAT_MIN_H, gesture.start.y + dy);
        next = { x: left, y: top, w: right - left, h: bottom - top };
      }
      floatStore.setRect(gesture.id, clampFloatRect(next, gesture.work), false);
    }
    function endFloatGesture(event) {
      const gesture = floatGesture;
      if (gesture === null || (event !== undefined && event.pointerId !== gesture.pointerId)) return;
      floatGesture = null;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
      floatStore.persistNow();
    }

    let dragPayload = null; // { kind: 'session' | 'pane', id }

