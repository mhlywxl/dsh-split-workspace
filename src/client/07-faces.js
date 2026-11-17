    // root standard faces (0.1.x + 0.2.0)
    //
    // The stock components a pane re-hosts read GLOBAL standard faces too —
    // `useSessions`, `useSessionStatus`, `useSessionRetainInfo`, `useResource`,
    // `useWorkspaces`, `usePanelInfo`. Those live in the renderer's ROOT
    // standard binding, which 0.1.5 merged into `uiSession.resolve(id)` but
    // 0.2.0 keeps strictly apart: a session binding carries session faces only,
    // and no public client service hands out the root binding.
    //
    // The renderer DOES hand it to every root-scoped slot entry it renders, and
    // this plugin already owns one: its workspace is registered into
    // `shell.overlay` (declared `kind: list, scope: root`). So the overlay
    // component receives the fully materialized root kit as its props —
    // `useSessions`, `useSessionStatus`, `useSessionRetainInfo` and anything a
    // third-party plugin contributed through `slots.provideRoot` — and this is
    // where it is harvested for the panes. No renderer internals, no private
    // service fields: the same props the framework would have handed a stock
    // root entry.
    // ---------------------------------------------------------------------

    /** Root standard faces as last published by the overlay's own props.
        `generation` is the host-renderer generation the current kit belongs to;
        pane keys include it, so a controlled remount (instead of silently
        swapping face identities mid-flight) is the only response to a new
        standard kit. */
    const rootStandard = { value: null, generation: 0, pending: null, pendingGeneration: false, listeners: new Set() };

    /** The renderer's root kit minus the seats it synthesizes per entry:
        `renderFactorySlot` (always), `t` (locale declaration), `useStore` +
        `actions` (store declaration), `renderSlot`/`renderSlotChain`/
        `SessionProvider` (children declaration). This plugin's overlay entry
        declares none of those, but filtering them keeps the harvest honest if
        that ever changes. */
    const FRAMEWORK_SEATS = new Set(["renderFactorySlot", "t", "useStore", "actions", "renderSlot", "renderSlotChain", "SessionProvider"]);

    function extractRootStandard(props) {
      const out = {};
      if (props === null || props === undefined || typeof props !== "object") return out;
      for (const key of Object.keys(props)) {
        if (FRAMEWORK_SEATS.has(key)) continue;
        out[key] = props[key];
      }
      return out;
    }

    /** Faces the adopted kit is MISSING but this render provided. Root
        contributions are static for the page's lifetime, so this is the only
        legitimate change: a face that did not exist during the first render
        (a third-party plugin contributing later, a slow root roster). */
    function missingRootFaces(current, next) {
      let merged = null;
      for (const key of Object.keys(next)) {
        const value = next[key];
        if (value === undefined || current[key] !== undefined) continue;
        if (merged === null) merged = Object.assign({}, current);
        merged[key] = value;
      }
      return merged;
    }

    /** A whole-kit identity swap: the same face NAMES arrive but share NO
        identity with the adopted kit. That is not a normal root re-render (the
        0.2.x renderer memoizes the standard per binding); it means the renderer
        remounted/HMR'd or a second shell generation took over, and the panes are
        holding hooks from the dead generation. The controlled response is to
        bump the generation so panes remount and rebuild their kits and editor
        guards ONCE — never to swap the faces underneath live panes, which is how
        per-pane `prepareNative` stormed. */
    function isGenerationChange(current, next) {
      const nextKeys = Object.keys(next).filter((key) => next[key] !== undefined);
      if (nextKeys.length === 0) return false;
      const currentKeys = Object.keys(current).filter((key) => current[key] !== undefined);
      if (nextKeys.length !== currentKeys.length) return false;
      for (const key of nextKeys) {
        if (current[key] === undefined) return false;
        if (current[key] === next[key]) return false;
      }
      return true;
    }

    /** READ during the overlay's render: write-once lazy adoption so panes
        rendered in the same pass already see the kit. After adoption this is a
        pure read — later renders can only add missing faces, and only from the
        layout effect below (never a notify from render). */
    function readRootStandard(props) {
      if (rootStandard.value !== null) return rootStandard.value;
      const next = extractRootStandard(props);
      if (Object.keys(next).length === 0) return next;
      rootStandard.value = next;
      return rootStandard.value;
    }

    /** Called from the overlay's layout effect. Computes the only two legal
        changes (add missing faces, or a generation swap) and stashes them for
        publishRootStandard — no store mutation during render. */
    function harvestRootStandard(props) {
      if (rootStandard.value === null) {
        const next = extractRootStandard(props);
        if (Object.keys(next).length > 0) {
          rootStandard.value = next;
          rootStandard.pending = next;
          rootStandard.pendingGeneration = false;
        }
        return;
      }
      if (rootStandard.pending !== null) return;
      const current = rootStandard.value;
      const next = extractRootStandard(props);
      const missing = missingRootFaces(current, next);
      if (missing !== null) {
        rootStandard.pending = missing;
        rootStandard.pendingGeneration = false;
        return;
      }
      if (isGenerationChange(current, next)) {
        rootStandard.pending = next;
        rootStandard.pendingGeneration = true;
      }
    }

    /** Notify panes that the root faces (re)settled. Runs from a layout effect. */
    function publishRootStandard() {
      if (rootStandard.pending === null) return;
      const next = rootStandard.pending;
      const generationChange = rootStandard.pendingGeneration === true;
      rootStandard.pending = null;
      rootStandard.pendingGeneration = false;
      rootStandard.value = next;
      if (generationChange) {
        rootStandard.generation += 1;
        // One controlled remount pass: panes' unmount effects dispose their
        // retained references/guards/listeners, and the per-generation caches
        // of inject faces and entry stores must not outlive the faces they were
        // derived from.
        clearEntryInjectCache();
        entryStoreCache.clear();
        setRuntime({ generation: rootStandard.generation });
        try {
          console.warn(LOG_PREFIX + " the host renderer published a new root standard generation; remounting the split panes once to pick it up cleanly (the old generation's faces are dead).");
        } catch {}
      }
      for (const listener of [...rootStandard.listeners]) {
        try {
          listener();
        } catch (error) {
          try { console.warn(LOG_PREFIX + " root standard subscriber failed:", String(error).slice(0, 140)); } catch {}
        }
      }
    }

    function subscribeRootStandard(listener) {
      rootStandard.listeners.add(listener);
      return () => rootStandard.listeners.delete(listener);
    }

    /** Re-render the caller whenever the root faces change. Panes use it so a
        workspace opened before the root roster settled still picks it up. */
    function useRootStandard() {
      return React.useSyncExternalStore(
        subscribeRootStandard,
        () => rootStandard.value,
        () => rootStandard.value,
      );
    }

    /** Diagnostics (see composerChainDebug): the root faces this plugin
        harvested from its `shell.overlay` seat, and the faces of one session's
        binding. `window.__dshSplitWorkspace.rootFaces` / `.sessionFaces(id)`. */
    function rootFaceNames() {
      return rootStandard.value === null ? [] : Object.keys(rootStandard.value);
    }

    function sessionFaceNames(sessionId) {
      const binding = resolveSessionBinding(sessionId);
      if (binding === undefined || binding === null) return { hooks: [], keyedHooks: [], props: [], key: null };
      return {
        hooks: Object.keys(binding.hooks ?? {}),
        keyedHooks: Object.keys(binding.keyedHooks ?? {}),
        props: Object.keys(binding.props ?? {}),
        key: typeof binding.key === "string" ? binding.key : null,
      };
    }

    // ---------------------------------------------------------------------
    // dsh 0.2.0 session list + current session
    //
    // 0.2.0 dropped the client `sessions.list` store (its `sessions` service
    // only retains/binds single sessions now) and the list store's `current`
    // field. Both are read from the rendered sidebar instead: every row carries
    // `data-row-key="session:<id>"` and the open one is `aria-selected`, which
    // is exactly what the user sees. The DOM source is only built when the
    // service store is missing, so 0.1.x keeps its native store untouched.
    // ---------------------------------------------------------------------

    const SESSION_ROW_SELECTOR = '[data-row-key^="session:"], div[class*="_sessionRow"]';
    const SELECTED_ROW_SELECTOR = 'div[class*="_sessionRow"][aria-selected="true"], [data-row-key^="session:"][aria-selected="true"]';

    /** Session id of the selected sidebar row, or undefined. */
    function selectedSidebarSessionId() {
      try {
        const row = document.querySelector(SELECTED_ROW_SELECTOR);
        const key = row === null ? null : row.getAttribute("data-row-key");
        if (key === null || key.indexOf("session:") !== 0) return undefined;
        const id = key.slice("session:".length);
        return id === "" ? undefined : id;
      } catch {
        return undefined;
      }
    }

    /** The rendered sidebar as the snapshot shape the list consumers expect
        (ids in display order, byId[id].title/displayTitle). */
    function readSidebarSessions() {
      const ids = [];
      const byId = {};
      let rows;
      try {
        rows = document.querySelectorAll(SESSION_ROW_SELECTOR);
      } catch {
        return { ids, byId, current: undefined };
      }
      for (const row of rows) {
        const key = row.getAttribute("data-row-key");
        if (key === null || key.indexOf("session:") !== 0) continue;
        const id = key.slice("session:".length);
        if (id === "" || byId[id] !== undefined) continue;
        // textContent, NOT innerText: innerText forces a synchronous layout
        // per row, and this read runs on sidebar mutations — with streaming
        // sessions that became a forced-reflow storm (the desktop freeze
        // reported as whole-machine stalls). textContent reads the DOM
        // without layout; the whitespace normalization below makes the two
        // equivalent for these single-line titles.
        const title = (row.textContent ?? "").replace(/\s+/g, " ").trim();
        ids.push(id);
        byId[id] = { title, displayTitle: title };
      }
      return { ids, byId, current: selectedSidebarSessionId() };
    }

    /** A store face over the rendered sidebar. Reads are BOUNDED: the observer
        is only attached while the split workspace is ACTIVE (see setActive),
        re-reads coalesce through requestAnimationFrame, and a minimum spacing
        (DOM_LIST_MIN_READ_MS) throttles re-reads with one trailing catch-up —
        so continuous streaming text can never drive this into a per-frame
        full-sidebar scan. Emits a fresh snapshot object on real changes so
        React's identity check re-renders consumers. */
    const DOM_LIST_MIN_READ_MS = 200;
    /** Sidebar scraping cadence; perf mode reads at most once a second. */
    function domListMinReadMs() {
      return performanceModeOn() ? 1000 : DOM_LIST_MIN_READ_MS;
    }

    function createDomSessionListSource() {
      let snapshot = readSidebarSessions();
      const listeners = new Set();
      let observer = null;
      let active = false;
      let rafPending = false;
      let timerPending = false;
      let lastReadAt = 0;

      const publish = () => {
        lastReadAt = Date.now();
        const next = readSidebarSessions();
        if (next.ids.length === snapshot.ids.length && next.ids.every((id, index) => snapshot.ids[index] === id)
          && next.current === snapshot.current
          && next.ids.every((id) => snapshot.byId[id] !== undefined && snapshot.byId[id].title === next.byId[id].title)) {
          return;
        }
        snapshot = next;
        for (const listener of Array.from(listeners)) {
          try {
            listener();
          } catch {}
        }
      };
      const maybePublish = () => {
        const minRead = domListMinReadMs();
        const since = Date.now() - lastReadAt;
        if (since < minRead) {
          if (!timerPending) {
            timerPending = true;
            window.setTimeout(() => {
              timerPending = false;
              if (active && listeners.size > 0) publish();
            }, minRead - since);
          }
          return;
        }
        publish();
      };
      const schedule = () => {
        if (rafPending || timerPending || !active || listeners.size === 0) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
          rafPending = false;
          if (active && listeners.size > 0) maybePublish();
        });
      };
      const attach = () => {
        if (observer === null) {
          try {
            observer = new MutationObserver(schedule);
          } catch {
            observer = null;
            return;
          }
        }
        try {
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["aria-selected", "data-row-key"],
          });
        } catch {}
      };
      const detach = () => {
        if (observer !== null) {
          try {
            observer.disconnect();
          } catch {}
        }
      };
      const dispose = () => {
        detach();
        observer = null;
        listeners.clear();
      };
      return {
        getSnapshot: () => snapshot,
        /** The observer only exists while the workspace is split (>=2 panes).
            Inactive = zero DOM observation cost, no matter what streams. */
        setActive(flag) {
          active = flag === true;
          if (active && listeners.size > 0) attach();
          else if (!active) detach();
        },
        /** Force one bounded re-read (the add-split dialog opens while the
            workspace may be inactive, when the observer is detached). */
        refresh: () => { publish(); },
        subscribe: (listener) => {
          if (listener === undefined || typeof listener !== "function") return () => {};
          listeners.add(listener);
          if (active) attach();
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0) detach();
          };
        },
        dispose,
      };
    }

    /** The active session id across both store generations. 0.1.x answers from
        the list store (`current`); 0.2.0 dropped that field, so main-view
        retention and finally the selected sidebar row answer instead. */
    function currentSessionId() {
      if (sessionsListSource !== undefined && sessionsListSource !== null
        && typeof sessionsListSource.getSnapshot === "function") {
        try {
          const snapshot = sessionsListSource.getSnapshot();
          if (snapshot !== null && snapshot !== undefined) {
            if (snapshot.current !== undefined && snapshot.current !== null) return snapshot.current;
            const byId = snapshot.byId;
            if (byId !== undefined && byId !== null) {
              for (const id of Object.keys(byId)) {
                const entry = byId[id];
                const retained = entry === undefined || entry === null ? undefined : entry.retainedBy;
                const mainView = retained === undefined || retained === null ? undefined : retained.mainView;
                if (typeof mainView === "number" && mainView > 0) return id;
              }
            }
          }
        } catch {}
      }
      return selectedSidebarSessionId();
    }

    // S2 (1.6.0): the aria-selected MutationObserver that used to turn every
    // programmatic selection change into a focused-pane swap is GONE. The
    // focused pane now follows only a genuine click on a sidebar session row
    // (see the click-to-load effect in WorkspaceApp).

    // ---------------------------------------------------------------------
    // 0.2.0 standard session bindings
    //
    // 0.1.5 published session-scoped standard faces (useChat, useSessionStatus,
    // useConversation, ...) through `uiSession.resolve(id)`. 0.2.0 keeps the
    // same binding SHAPE ({ props, hooks, keyedHooks }) but hands it out per
    // retained SessionReference: `sessions.retain(id, { source })` and then
    // `uiSession.bindingSource(reference).value`, which settles once that
    // reference is ready. References are held for the pane's lifetime and
    // released when it closes, so retention counts stay honest.
    // ---------------------------------------------------------------------

    const paneSessionReferences = new Map();

    /** Per-session retain/binding failure records for diagnostics (1.6.1).
        The 1.6.0 regression: the pane retried `sessions.retain()` exactly once,
        at mount, when the host session catalog can still be empty — retain then
        returns undefined, the error was swallowed, and the pane stayed on
        "Session ended" forever (deterministically on the 0.2.1 desktop host,
        where the first attempted retain always raced the catalog). Every failed
        attempt is now recorded with its message and surfaced via
        `paneDebug.faces[sid].lastRetainError`, `health().lastError` and one
        `console.warn` when the bounded retries are exhausted. */
    const paneRetainFailures = new Map();
    function noteRetainFailure(sessionId, message) {
      const previous = paneRetainFailures.get(sessionId);
      paneRetainFailures.set(sessionId, {
        message: String(message).slice(0, 200),
        attempts: (previous !== undefined ? previous.attempts : 0) + 1,
        at: Date.now(),
      });
    }
    function clearRetainFailure(sessionId) {
      paneRetainFailures.delete(sessionId);
    }
    function retainFailureOf(sessionId) {
      return paneRetainFailures.get(sessionId);
    }

    /** Retain `sessionId` for this plugin (0.2.0 path only). A transient
        failure is NOT swallowed: it is recorded (with the exact message) so the
        retry driver below can report/backoff, and the caller can tell "not yet"
        from "gone". */
    function ensureSessionReference(sessionId) {
      if (sessionsService === undefined || sessionsService === null) {
        noteRetainFailure(sessionId, "sessions service is unavailable");
        return undefined;
      }
      if (typeof sessionsService.retain !== "function") {
        noteRetainFailure(sessionId, "sessions.retain is not a function on this host");
        return undefined;
      }
      const cached = paneSessionReferences.get(sessionId);
      if (cached !== undefined) return cached;
      try {
        const reference = sessionsService.retain(sessionId, { source: "splitView" });
        if (reference === undefined || reference === null) {
          // The 0.2.1 host returns undefined when the session catalog has not
          // loaded this id yet — exactly the race that made 1.6.0 panes stick on
          // "Session ended". Record it; the retry driver backs off and retries.
          noteRetainFailure(sessionId, "sessions.retain() returned " + String(reference) + " (session not resolvable yet?)");
          return undefined;
        }
        paneSessionReferences.set(sessionId, reference);
        return reference;
      } catch (error) {
        noteRetainFailure(sessionId, "sessions.retain threw: " + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error).slice(0, 160));
        return undefined;
      }
    }

    function releaseSessionReference(sessionId) {
      const reference = paneSessionReferences.get(sessionId);
      if (reference === undefined) return;
      paneSessionReferences.delete(sessionId);
      try {
        if (typeof reference.release === "function") reference.release();
      } catch {}
    }

    // ---------------------------------------------------------------------
    // Pane resource lifetime (1.6.0)
    //
    // Everything a pane stages on the host must be released on EVERY leaf
    // mutation path — not just the ✕ button. Two mechanisms cover every path:
    //   * treeStore.commit() schedules disposePaneIfUnused() for every leaf id
    //     that disappeared (sidebar swapFocus, closeFocused, movePane, ✕);
    //   * ChatPane retains/releases per React mount with a per-session
    //     reference count, so the pane's own unmount is the primary teardown.
    // The refcount also means a session shown by two panes (only possible
    // through a corrupt tree; persistence validation de-dupes) is disposed only
    // when the LAST pane leaves. disposePane itself is idempotent.
    // ---------------------------------------------------------------------

    const paneLiveRefs = new Map();
    const paneDisposeChecks = new Map();

    function retainPaneSession(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      paneLiveRefs.set(sessionId, (paneLiveRefs.get(sessionId) || 0) + 1);
      const timer = paneDisposeChecks.get(sessionId);
      if (timer !== undefined) {
        try { window.clearTimeout(timer); } catch {}
        paneDisposeChecks.delete(sessionId);
      }
    }

    function releasePaneSession(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      const count = paneLiveRefs.get(sessionId);
      if (count === undefined) return;
      if (count > 1) {
        paneLiveRefs.set(sessionId, count - 1);
        return;
      }
      paneLiveRefs.delete(sessionId);
      disposePaneIfUnused(sessionId);
    }

    /** Idempotent: release every host resource one pane staged. Safe to call
        twice (maps are deleted on first use). */
    function disposePane(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      // Stop the retain retry driver FIRST: a timer must never resurrect a
      // reference after this pane's resources are released.
      const resolver = sessionFaceResolvers.get(sessionId);
      if (resolver !== undefined) {
        sessionFaceResolvers.delete(sessionId);
        try { resolver.dispose(); } catch {}
      }
      try { releaseSessionReference(sessionId); } catch {}
      clearRetainFailure(sessionId);
      paneChatStores.delete(sessionId);
      paneImageIntake.delete(sessionId);
      paneDebug.faces[sessionId] = undefined;
      try { delete paneDebug.faces[sessionId]; } catch {}
      if (rootPendingBySession.has(sessionId)) setRootPending(sessionId, undefined);
      const guardEntry = paneEditorGuards.get(sessionId);
      if (guardEntry !== undefined) {
        paneEditorGuards.delete(sessionId);
        // `retire`, not a synchronous `dispose`: the pane's own unmount still
        // has to clear the shared editor root, and the guard is what hands it
        // back to the stock composer afterwards (see prepareNative).
        try {
          if (typeof guardEntry.retire === "function") guardEntry.retire();
          else if (typeof guardEntry.dispose === "function") guardEntry.dispose();
        } catch {}
      }
      const unsubTyping = paneTypingUnsubs.get(sessionId);
      if (unsubTyping !== undefined) {
        try { unsubTyping(); } catch {}
        paneTypingUnsubs.delete(sessionId);
      }
    }

    function paneInTree(sessionId) {
      try { return findLeafNode(treeStore.getSnapshot().root, sessionId) !== null; } catch { return false; }
    }

    /** Dispose only when the session is neither in the tree nor mounted. */
    function disposePaneIfUnused(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if ((paneLiveRefs.get(sessionId) || 0) > 0) return;
      if (paneInTree(sessionId)) return;
      disposePane(sessionId);
    }

    /** Deferred safety sweep from treeStore.commit: the departing pane's React
        unmount normally disposes it a commit later; this makes sure resource
        release also happens if an (unexpected) latched subtree kept it mounted. */
    function deferPaneDisposeCheck(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (paneDisposeChecks.has(sessionId)) return;
      paneDisposeChecks.set(sessionId, window.setTimeout(() => {
        paneDisposeChecks.delete(sessionId);
        disposePaneIfUnused(sessionId);
      }, 1200));
    }

    /** The standard binding for one session on either generation. */
    function resolveSessionBinding(sessionId) {
      const ui = uiSessionService;
      if (ui === undefined || ui === null) return undefined;
      if (typeof ui.resolve === "function") {
        try {
          return ui.resolve(sessionId);
        } catch {
          return undefined;
        }
      }
      if (typeof ui.bindingSource !== "function") return undefined;
      const reference = ensureSessionReference(sessionId);
      if (reference !== undefined) {
        try {
          const source = ui.bindingSource(reference);
          if (source !== undefined && source !== null && source.value !== undefined && source.value !== null) {
            return source.value;
          }
        } catch {}
      }
      // A pane showing the active conversation can borrow the main binding.
      const main = ui.current;
      if (main !== undefined && main !== null && main.value !== undefined && main.value !== null
        && selectedSidebarSessionId() === sessionId) {
        return main.value;
      }
      return undefined;
    }

    /** Whether the standard binding can be materialized yet. 0.1.x resolves
        synchronously, so the gate is a no-op there; 0.2.0 waits for the
        retained reference to open, because a pane kit is built exactly once
        WITH its faces — rebuilding would re-run per-call inject factories.

        Bounded: if the reference never opens (an unloadable session, a runtime
        that dropped bindingSource), the pane proceeds anyway after a short
        grace period and renders its own transcript/composer instead of sitting
        on a loading hint forever. */
    const SESSION_BINDING_GRACE_MS = 2500;

    function useSessionBindingReady(sessionId) {
      const status = useSessionFaceStatus(sessionId);
      const [ready, setReady] = React.useState(() => {
        if (uiSessionService === undefined || uiSessionService === null) return true;
        // 0.1.x resolves by id, and a runtime without the 0.2.0 surface has
        // nothing to wait for.
        if (typeof uiSessionService.resolve === "function") return true;
        if (typeof uiSessionService.bindingSource !== "function") return true;
        // Already materializable (e.g. the pane shows the main session):
        // do not make the kit wait for a reference it does not need.
        return paneKitTrustworthy(sessionId);
      });
      React.useEffect(() => {
        if (ready) return undefined;
        // 1.6.1: do NOT settle as a failure while the retain retries remain —
        // that was the 1.6.0 regression path (first retain raced the host
        // session catalog, settled, and the pane showed "Session ended"). The
        // gate resolves only when a face is bound, the retries are exhausted,
        // or the bounded grace period is over.
        if (status.face !== undefined && status.face !== null) {
          setReady(true);
          return undefined;
        }
        if (status.exhausted === true) {
          setReady(true);
          return undefined;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
          if (cancelled) return;
          warnPaneKitUnavailable(sessionId);
          setReady(true);
        }, SESSION_BINDING_GRACE_MS);
        return () => {
          cancelled = true;
          try { window.clearTimeout(timer); } catch {}
        };
      }, [ready, status.face, status.exhausted, sessionId]);
      return ready;
    }

    // ---------------------------------------------------------------------
    // pane readiness
    //
    // A pane re-hosts the stock transcript/composer OUTSIDE the slot renderer,
    // so it must assemble the same standard faces that renderer would:
    //   * ROOT faces (useSessions, useSessionStatus, useSessionRetainInfo,
    //     useResource, useWorkspaces, usePanelInfo, …) are harvested from this
    //     plugin's own root-scoped `shell.overlay` entry — see the root
    //     standard-face section above.
    //   * SESSION faces (chat, conversation, input, inputActions, session,
    //     projection, trajectory, …) come from the session binding: 0.1.5
    //     `uiSession.resolve(id)`, 0.2.0 `sessions.retain()` +
    //     `uiSession.bindingSource(reference)`.
    //   * The Chat node seat's `useDisclosure`/`useTurnData` are neither: they
    //     are the `conversation.chat.node` slot's contextual inject hooks,
    //     bound per render from the hookContext ChatView itself dispatches.
    // A pane therefore only has to WAIT for its session binding to open; it
    // never has to be suppressed. If the binding never arrives, the pane still
    // renders through this plugin's own fallback transcript/composer.
    // ---------------------------------------------------------------------

    const paneKitWarned = new Set();

    /** Whether the session-scoped standard faces are materialized yet. The
        0.1.x path resolves synchronously and is always trusted. */
    function sessionFacesReady(sessionId) {
      if (uiSessionService !== undefined && uiSessionService !== null
        && typeof uiSessionService.resolve === "function") return true;
      try {
        const binding = resolveSessionBinding(sessionId);
        if (binding === undefined || binding === null) return false;
        const hooks = binding.hooks === undefined || binding.hooks === null ? {} : binding.hooks;
        return hooks.chat !== undefined || hooks.conversation !== undefined;
      } catch {
        return false;
      }
    }

    /** Kept for the call sites that used to bail out on an incomplete kit: the
        session binding is all a pane needs now, and a missing one degrades to
        the plugin's own renderers instead of hiding the workspace. */
    function paneKitTrustworthy(sessionId) {
      return sessionFacesReady(sessionId);
    }

    function warnPaneKitUnavailable(sessionId) {
      const key = String(sessionId);
      if (paneKitWarned.has(key)) return;
      paneKitWarned.add(key);
      console.warn("[dsh-split-workspace] session faces are not materialized for " + key
        + " yet; the pane renders its built-in transcript/composer instead of the stock ones.");
    }

    /** Last composer-chain election per pane, published on
        `window.__dshSplitWorkspace.composerChain`. When an agent asks a question and
        no card appears, this says exactly which link failed: no chain entries
        captured, no pending interaction resolved for the session, no entry
        elected, or an entry elected without a store face. Diagnostics only —
        nothing in the render path reads it. */
    const composerChainDebug = { last: null, slots: null };
    window.__dshSplitWorkspace = Object.assign(window.__dshSplitWorkspace || {}, { composerChain: composerChainDebug });

    /** Probe both slot-ledger surfaces for the keys this plugin consumes.
        `entries()` is the raw registration view (chain keys consume every
        entry); `entriesOfSlot()` is the per-cell winner view the outlets
        actually render (list/array/single keys). They can disagree — a key
        whose entries are owned by a session scope only shows up in one of
        them — and the pane needs whichever surface has the roster. */
    function slotRosterProbe(keys) {
      const out = {};
      for (const key of keys) {
        let raw = null;
        let cells = null;
        try {
          const value = slotsService.entries(key);
          raw = Array.isArray(value) ? value.length : "not-array";
        } catch (error) { raw = "ERR:" + String(error).slice(0, 60); }
        try {
          const value = slotsService.entriesOfSlot(key);
          cells = Array.isArray(value) ? value.length : "not-array";
        } catch (error) { cells = "ERR:" + String(error).slice(0, 60); }
        out[key] = { entries: raw, entriesOfSlot: cells };
      }
      composerChainDebug.slots = out;
      return out;
    }
    Object.defineProperty(composerChainDebug, "live", {
      enumerable: false,
      get: () => slotRosterProbe(["conversation.view", "conversation.composer", "conversation.session.header", "conversation.chat.node"]),
    });
    Object.defineProperty(composerChainDebug, "rootFaces", {
      enumerable: false,
      get: rootFaceNames,
    });
    Object.defineProperty(composerChainDebug, "sessionFaces", {
      enumerable: false,
      get: () => (sessionId) => sessionFaceNames(sessionId),
    });
    Object.defineProperty(composerChainDebug, "panes", {
      enumerable: false,
      get: () => paneDebug,
    });

    /** Last prepared pane bundle, for diagnostics only. */
    const paneDebug = { last: null, faces: {} };

    /** Diagnostics-only writes: cap the per-session map so long-lived
        sessions cannot grow it without bound. */
    function notePaneFace(sessionId, entry) {
      let count = 0;
      for (const key in paneDebug.faces) count += 1;
      if (count > 32) paneDebug.faces = {};
      paneDebug.faces[sessionId] = entry;
    }

    function bindSessionFace(sessionId) {
      if (sessionsService === undefined || sessionsService === null) return undefined;
      try {
        const binding = sessionsService.binding(sessionId);
        if (binding === undefined || binding === null) return undefined;
        return binding.session;
      } catch (error) {
        noteRetainFailure(sessionId, "sessions.binding threw: " + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error).slice(0, 160));
        return undefined;
      }
    }

    // ---- bounded retain retry (1.6.1 regression fix) ---------------------
    // 1.6.0 attempted `sessions.retain()` exactly once, at pane mount. On the
    // 0.2.1 desktop host that attempt loses a race with the session catalog:
    // retain() returns undefined (the session is not resolvable yet), the error
    // was swallowed, no retry was armed, and the pane sat on "Session ended"
    // forever — deterministic on every boot. 1.5.1 was only saved by an
    // incidental re-run when the scraped session-list snapshot arrived, so the
    // fix is an explicit retry driver: backoff 200/600/1500/3000/5000 ms (max
    // 6 attempts), re-armed by `reference.ready`, by session-list snapshot
    // updates and by pane remounts. "Not yet" and "gone" are now distinct:
    // loading hint while retries remain, fallback only after exhaustion, with
    // one console.warn carrying the last caught retain error.
    const RETAIN_RETRY_DELAYS_MS = [200, 600, 1500, 3000, 5000];
    /** Pure policy: delay before retry attempt N+1, null when exhausted. */
    function retainRetryDelay(attempt) {
      if (typeof attempt !== "number" || !Number.isFinite(attempt) || attempt < 0) return null;
      const index = Math.floor(attempt);
      return index >= RETAIN_RETRY_DELAYS_MS.length ? null : RETAIN_RETRY_DELAYS_MS[index];
    }

    const sessionFaceResolvers = new Map();

    /** One pane-session's face + bounded retain retry driver. Deliberately
        plain module code (no React hooks) so the hooks below and the test seam
        drive the SAME logic. `delays` is a test-only override. */
    function createSessionFaceResolver(sessionId, delays) {
      const configured = Array.isArray(delays) && delays.length > 0 ? delays.slice() : null;
      const record = {
        sessionId,
        face: undefined,
        snapshot: { face: undefined, loading: true, exhausted: false, attempts: 0, lastError: null },
        listeners: new Set(),
        attempts: 0,
        exhausted: false,
        lastError: null,
        timer: 0,
        cancelled: false,
        warned: false,
      };
      const delayFor = (attempt) => {
        if (configured !== null) return attempt < configured.length ? configured[attempt] : null;
        return retainRetryDelay(attempt);
      };
      const publish = (patch) => {
        record.snapshot = Object.assign({}, record.snapshot, patch);
        for (const listener of [...record.listeners]) {
          try { listener(); } catch {}
        }
      };
      const failureMessage = () => {
        const failure = retainFailureOf(sessionId);
        if (failure !== undefined && failure !== null) return failure.message;
        return record.lastError !== null ? record.lastError : "unknown retain failure";
      };
      const bindNow = () => {
        const face = bindSessionFace(sessionId);
        if (face === undefined || face === null) return false;
        record.face = face;
        record.attempts = 0;
        record.exhausted = false;
        record.lastError = null;
        record.warned = false;
        clearRetainFailure(sessionId);
        notePaneFace(sessionId, {
          path: "bound",
          attempts: record.attempts,
          lastRetainError: null,
          reference: paneSessionReferences.has(sessionId),
          hasSession: true,
        });
        publish({ face, loading: false, exhausted: false, attempts: 0, lastError: null });
        return true;
      };
      const schedule = () => {
        if (record.cancelled || record.face !== undefined || record.timer !== 0) return;
        if (record.listeners.size === 0) return;
        if (record.exhausted === true) return; // already settled; never re-publish in a loop
        const delay = delayFor(record.attempts);
        if (delay === null) {
          record.exhausted = true;
          record.lastError = failureMessage();
          publish({ loading: false, exhausted: true, attempts: record.attempts, lastError: record.lastError });
          notePaneFace(sessionId, { path: "exhausted", attempts: record.attempts, lastRetainError: record.lastError });
          setRuntime({ lastError: "retain:" + String(sessionId) + ": " + record.lastError });
          if (record.warned !== true) {
            record.warned = true;
            try {
              console.warn(LOG_PREFIX + " could not retain session '" + String(sessionId) + "' for a pane after "
                + (record.attempts + 1) + " attempts (" + record.lastError + "). That pane shows its own fallback renderer"
                + " instead of the native transcript. If this persists: window.__dshSplitWorkspace.retry() or reset();"
                + " diagnostics: window.__dshSplitWorkspace.health().lastError — see README > Safety, recovery and diagnostics.");
            } catch {}
          }
          return;
        }
        record.attempts += 1;
        publish({ loading: true, attempts: record.attempts, exhausted: false });
        record.timer = window.setTimeout(() => {
          record.timer = 0;
          attempt();
        }, delay);
      };
      const attempt = () => {
        if (record.cancelled || record.face !== undefined || record.listeners.size === 0) return;
        if (bindNow()) return;
        const reference = ensureSessionReference(sessionId);
        if (record.cancelled || record.face !== undefined) return;
        if (reference === undefined) {
          record.lastError = failureMessage();
          notePaneFace(sessionId, { path: "retain-failed", attempts: record.attempts, lastRetainError: record.lastError });
          schedule();
          return;
        }
        notePaneFace(sessionId, {
          path: "retained",
          attempts: record.attempts,
          lastRetainError: null,
          reference: true,
          hasSession: reference.binding !== undefined && reference.binding !== null,
        });
        if (bindNow()) return;
        // Reference obtained but its binding has not materialized yet: retry on
        // `ready` AND keep the backoff armed, so a never-settling ready promise
        // cannot strand the pane either.
        try {
          const pending = reference.ready;
          if (pending !== undefined && pending !== null && typeof pending.then === "function") {
            pending.then(
              () => { if (!record.cancelled && record.face === undefined) attempt(); },
              () => { if (!record.cancelled && record.face === undefined) schedule(); },
            );
          }
        } catch {}
        schedule();
      };
      record.start = () => {
        if (record.face !== undefined) {
          publish({ face: record.face, loading: false, exhausted: false, lastError: null });
          return;
        }
        if (record.cancelled) { record.cancelled = false; }
        if (record.timer !== 0) return;
        // A (re)mount after exhaustion gets ONE fresh bounded cycle: the host
        // catalog may have loaded in the meantime. List-snapshot nudges below do
        // NOT re-arm, so an exhausted pane can never be driven into a loop.
        if (record.exhausted === true) {
          record.exhausted = false;
          record.attempts = 0;
          record.warned = false;
        }
        // Defer the first probe out of the commit/passive-effect pass: the
        // catalog race resolves a tick later anyway, and this keeps the store
        // subscription setup free of synchronous publishes.
        record.timer = window.setTimeout(() => {
          record.timer = 0;
          attempt();
        }, 0);
      };
      record.nudge = () => {
        if (record.cancelled || record.face !== undefined || record.timer !== 0) return;
        if (record.listeners.size === 0) return;
        if (record.exhausted === true) return; // settled; wait for a remount
        attempt();
      };
      record.subscribe = (listener) => {
        record.listeners.add(listener);
        if (record.listeners.size === 1) record.start();
        return () => {
          record.listeners.delete(listener);
          if (record.listeners.size === 0 && record.timer !== 0) {
            try { window.clearTimeout(record.timer); } catch {}
            record.timer = 0;
          }
        };
      };
      record.getSnapshot = () => record.snapshot;
      record.dispose = () => {
        record.cancelled = true;
        if (record.timer !== 0) {
          try { window.clearTimeout(record.timer); } catch {}
          record.timer = 0;
        }
        record.listeners.clear();
      };
      return record;
    }

    function sessionFaceResolver(sessionId) {
      let record = sessionFaceResolvers.get(sessionId);
      if (record === undefined) {
        record = createSessionFaceResolver(sessionId);
        sessionFaceResolvers.set(sessionId, record);
      }
      return record;
    }

    /** Reactive face + retry status for one pane's session. */
    function useSessionFaceStatus(sessionId) {
      const resolver = sessionFaceResolver(sessionId);
      return React.useSyncExternalStore(resolver.subscribe, resolver.getSnapshot, resolver.getSnapshot);
    }

    /** One pane's session face, RETAINED with bounded retries.
        0.2.0 hands out a binding only for an already-retained generation
        (`sessions.binding(id)` borrows without extending), so a pane opened on
        a session nobody else holds — a dropped-in conversation, or a pane on a
        session the native view has moved away from — has no face until this
        plugin retains it. `sessionFaceResolver` owns the retain call, its
        backoff and its diagnostics; this hook only subscribes.
        The scraped sidebar list is ADVISORY ONLY: a live pane whose row is
        temporarily filtered/collapsed/virtualized out of the sidebar must keep
        rendering its last-known face (the old cleared-on-list-loss behaviour
        showed "Session ended" over a live conversation). A LATE list snapshot
        is used as a retry signal instead. */
    function useSessionFace(sessionId) {
      const status = useSessionFaceStatus(sessionId);
      const listSnapshot = useSessionsList();
      React.useEffect(() => {
        if (listSnapshot !== null && listSnapshot !== undefined) sessionFaceResolver(sessionId).nudge();
      }, [listSnapshot, sessionId]);
      return status.face;
    }

    /** Sticky last-known summaries: the pane header keeps the title/cwd of a
        live session whose sidebar row disappeared. Bounded. */
    const lastSessionSummaries = new Map();
    function rememberSessionSummary(sessionId, summary) {
      if (typeof sessionId !== "string" || sessionId === "" || summary === null || summary === undefined) return;
      if (lastSessionSummaries.size > 64 && !lastSessionSummaries.has(sessionId)) lastSessionSummaries.clear();
      lastSessionSummaries.set(sessionId, summary);
    }


    function basenameOf(cwd) {
      if (typeof cwd !== "string" || cwd === "") return "";
      return cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd;
    }

    // ---------------------------------------------------------------------
    // hooks
    // ---------------------------------------------------------------------

    function useObserved(source, fallback) {
      const subscribe = React.useMemo(
        () => (source === undefined || source === null ? () => () => {} : (fn) => source.subscribe(fn)),
        [source],
      );
      const getSnapshot = React.useMemo(
        () => (source === undefined || source === null ? () => fallback : () => source.getSnapshot()),
        [source, fallback],
      );
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function useTree() {
      React.useSyncExternalStore(treeStore.subscribe, treeStore.getRevision, treeStore.getRevision);
      return treeStore.getSnapshot();
    }

    /** LEGACY pending-interaction source (0.1.5): the uiSession service exposed
        the pending map directly. The 0.2.x UiSession service has NO such
        property, so this path yields nothing on the live host — it stays as the
        fallback for 0.1.x compositions. The live source is the ROOT standard
        `useSessionStatus` hook, read by RootPendingProbe below. */
    const EMPTY_PENDING_INTERACTIONS = new Map();
    function pendingInteractionsSource() {
      const service = uiSessionService;
      if (service === undefined || service === null) return undefined;
      const source = service.pendingInteractions;
      return source !== undefined && source !== null && typeof source.getSnapshot === "function" ? source : undefined;
    }
    function useLegacySessionPendingInteraction(selector) {
      const subscribe = React.useCallback((notify) => {
        const source = pendingInteractionsSource();
        if (source === undefined || typeof source.subscribe !== "function") return () => {};
        return source.subscribe(notify);
      }, []);
      const getSnapshot = React.useCallback(
        () => {
          const source = pendingInteractionsSource();
          return source === undefined ? EMPTY_PENDING_INTERACTIONS : source.getSnapshot();
        },
        [],
      );
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      if (selector === undefined) return snapshot;
      return snapshot === null || snapshot === undefined || typeof snapshot.get !== "function"
        ? undefined
        : selector(snapshot);
    }

    // ---- root-sourced pending interactions (0.2.x) ------------------------
    // The stock conversation reads
    //   useSessionStatus((snapshot) => snapshot.get(sessionId)?.pendingInteraction)
    // from its ROOT standard kit. A root hook can only be called inside a
    // component, so each pane mounts a tiny probe component that subscribes the
    // root hook and publishes the value into this module store; ChatPane then
    // reads it without branching its own hook list.
    const rootPendingBySession = new Map();
    const rootPendingListeners = new Set();
    function setRootPending(sessionId, pending) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      const previous = rootPendingBySession.get(sessionId);
      if (previous === pending) return;
      if (pending === undefined || pending === null) rootPendingBySession.delete(sessionId);
      else rootPendingBySession.set(sessionId, pending);
      for (const listener of [...rootPendingListeners]) {
        try { listener(); } catch {}
      }
    }
    function useRootPendingInteraction(sessionId) {
      return React.useSyncExternalStore(
        (listener) => {
          rootPendingListeners.add(listener);
          return () => { rootPendingListeners.delete(listener); };
        },
        () => rootPendingBySession.get(sessionId),
        () => rootPendingBySession.get(sessionId),
      );
    }
    /** Mounted by ChatPane only when the harvested root kit carries
        `useSessionStatus`; its OWN hook list is fixed (one root hook + one
        effect), so the root source can appear/disappear without touching the
        pane's hook order. */
    function RootPendingProbe({ useSessionStatus, sessionId }) {
      const pending = useSessionStatus((snapshot) => {
        if (snapshot === null || snapshot === undefined || typeof snapshot.get !== "function") return undefined;
        const status = snapshot.get(sessionId);
        return status !== null && status !== undefined ? status.pendingInteraction : undefined;
      });
      React.useEffect(() => {
        setRootPending(sessionId, pending === null ? undefined : pending);
      }, [pending, sessionId]);
      React.useEffect(() => () => setRootPending(sessionId, undefined), [sessionId]);
      return null;
    }

    function useSessionsList() {
      return useObserved(sessionsListSource, null);
    }

    /** Selector hook factory over one SessionFace. Registers no hooks in the
        factory itself (it may run conditionally). */
    function makeUseSession(face) {
      const subscribe =
        face === undefined || face === null
          ? (cb) => () => {}
          : (cb) => face.subscribe(cb);
      const readSnapshot = face === undefined || face === null ? () => null : () => face.getSnapshot();
      return function useSession(selector) {
        const cache = React.useRef({ snapshot: undefined, selector: undefined, value: undefined });
        const compute = () => {
          const snapshot = readSnapshot();
          const entry = cache.current;
          if (entry.snapshot === snapshot && entry.selector === selector) return entry.value;
          const value = snapshot === null ? null : selector(snapshot);
          cache.current = { snapshot, selector, value };
          return value;
        };
        return React.useSyncExternalStore(subscribe, compute, compute);
      };
    }

    /** Selector hook factory over any observable store face. */
    function makeUseStoreFace(store, fallbackValue) {
      const subscribe =
        store === undefined || store === null || typeof store.subscribe !== "function"
          ? (cb) => () => {}
          : (cb) => store.subscribe(cb);
      const read = store === undefined || store === null || typeof store.getSnapshot !== "function"
        ? () => (fallbackValue === undefined ? null : fallbackValue)
        : () => store.getSnapshot();
      return function useStoreFace(selector) {
        const cache = React.useRef({ snapshot: undefined, selector: undefined, value: undefined });
        const compute = () => {
          const snapshot = read();
          const entry = cache.current;
          if (entry.snapshot === snapshot && entry.selector === selector) return entry.value;
          const value = selector === undefined ? snapshot : selector(snapshot);
          cache.current = { snapshot, selector, value };
          return value;
        };
        return React.useSyncExternalStore(subscribe, compute, compute);
      };
    }

    /** useSessions standard-kit hook: selector over the sessions list store. */
    function makeUseSessions() {
      const useList = makeUseStoreFace(sessionsListSource, { ids: [], byId: {} });
      return function useSessions(selector) {
        return useList(selector || ((s) => s));
      };
    }

    /** useProjection standard-kit hook over session projections. Per-face
        hooks are cached so subscribe identities stay stable across renders.

        An UNRESOLVED face is deliberately not cached. The kit is built once
        per pane, so caching a miss would freeze that projection key to
        `undefined` for the pane's whole life: `useProjection("sessionStats")`
        would fall back to the window-scoped derive path (counts and the tok/s
        average lagging behind) and `useProjection("tokenUsage")` would drop
        the whole token / cache-hit half of the composer stats row, because
        `hasTokens` then stays false. The stock renderer re-resolves its
        projection source on every render, so retrying here is the parity fix.

        Every render still calls exactly ONE store hook — the unresolved path
        hands back a shared no-op face — because skipping the call would change
        the hook count and blow up React the moment the face appeared. */
    function makeUseProjection(session) {
      const cache = new Map();
      const pending = makeUseStoreFace(undefined, undefined);
      return function useProjection(name, selector) {
        let useFace = cache.get(name);
        if (useFace === undefined) {
          let face;
          try {
            face = session !== undefined && session !== null && session.projections !== undefined
              ? session.projections.faceOf(name)
              : undefined;
          } catch {
            face = undefined;
          }
          if (face !== undefined && face !== null) {
            useFace = makeUseStoreFace(face, undefined);
            cache.set(name, useFace);
          } else {
            if (captureLog["projection:" + name] !== true) {
              captureLog["projection:" + name] = true;
              console.warn("[dsh-split-workspace] projection '" + name + "' is not resolvable yet; retrying every render");
            }
            useFace = pending;
          }
        }
        return useFace((snapshot) => {
          if (snapshot === null || snapshot === undefined) return undefined;
          return selector === undefined ? snapshot : selector(snapshot);
        });
      };
    }

    // ---------------------------------------------------------------------
    // chat snapshot helpers (fallback renderer)
    // ---------------------------------------------------------------------

    function blockText(content) {
      if (!Array.isArray(content)) return "";
      return content
        .map((block) => (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string" ? block.text : ""))
        .join("");
    }

    function firstLine(text, max) {
      const line = String(text).split("\n").find((candidate) => candidate.trim() !== "") || "";
      return line.length > max ? line.slice(0, max - 1) + "…" : line;
    }

    function formatClock(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m > 0 ? m + "m" + String(s).padStart(2, "0") + "s" : s + "s";
    }

    // One transient pane toast at a time (4s floor between announcements).
    let paneToastAt = 0;
    /** Fire-and-forget transient toast for outcomes the native UI renders only
        as a muted transcript row (e.g. /compact completion). Never throws. */
    /** Rename a pane session through the host's binding, the same path the
        stock rename dialog uses. Never throws; a rejected rename just leaves
        the title unchanged and the next summary refresh corrects it. */
    function renamePaneSession(sessionId, nextTitle) {
      try {
        if (sessionsService !== undefined && sessionsService !== null && typeof sessionsService.using === "function") {
          Promise.resolve(sessionsService.using(sessionId, { source: "splitView" }, (reference) => reference.binding.session.rename(nextTitle))).catch(() => {});
          return;
        }
        const binding = sessionsService !== undefined && sessionsService !== null && typeof sessionsService.binding === "function"
          ? sessionsService.binding(sessionId)
          : undefined;
        if (binding !== undefined && binding !== null && binding.session !== undefined) {
          Promise.resolve(binding.session.rename(nextTitle)).catch(() => {});
        }
      } catch {}
    }

    function showPaneToast(message, force) {
      const now = Date.now();
      if (force !== true && now - paneToastAt < 4000) return;
      paneToastAt = now;
      try {
        // One toast at a time: forced action feedback may replace an earlier
        // one before its 4.2s lifetime ends.
        for (const previous of document.querySelectorAll(".dsv-toast")) {
          try { previous.remove(); } catch {}
        }
        const el = document.createElement("div");
        el.className = "dsv-toast";
        el.setAttribute("role", "status");
        el.textContent = String(message);
        el.style.cssText = "position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:2147483000;"
          + "max-width:min(640px,80vw);padding:8px 14px;border-radius:10px;"
          + "background:var(--dsw-alias-bg-overlay,rgba(28,28,32,.96));color:var(--dsw-alias-label-primary,#f2f2f2);"
          + "border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));box-shadow:0 6px 24px rgba(0,0,0,.35);"
          + "font-size:12px;line-height:18px;pointer-events:none;text-align:center;";
        document.body.appendChild(el);
        window.setTimeout(() => { try { el.remove(); } catch {} }, 4200);
      } catch {}
    }

    // ---------------------------------------------------------------------
