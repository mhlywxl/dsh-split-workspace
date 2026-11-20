    // slot capture: re-host the native conversation components per pane
    // ---------------------------------------------------------------------

    const captureLog = {};

    function capturedEntries(key) {
      if (slotsService === undefined || slotsService === null) return [];
      try {
        // Prefer the renderer's OWN outlet view. `entriesOfSlot` yields the
        // winners a slot outlet would render: it skips entries the slot core
        // has ABDICATED (an entry that threw is permanently benched) and
        // dedupes by cell id. `entries()` is the raw registration ledger and
        // does neither, so a benched or crashed entry stayed mounted here
        // forever, re-throwing on every render into a PaneBoundary that
        // renders null — the cell silently vanished from the pane while the
        // stock outlet kept rendering its neighbours.
        const source = typeof slotsService.entriesOfSlot === "function"
          ? (name) => slotsService.entriesOfSlot(name)
          : (name) => slotsService.entries(name);
        const raw = source(key);
        if (!Array.isArray(raw)) return [];
        return raw;
      } catch (error) {
        if (captureLog[key] !== true) {
          captureLog[key] = true;
          console.warn("[dsh-split-workspace] slots.entries(" + key + ") unavailable:", String(error).slice(0, 120));
        }
        return [];
      }
    }

    /** Best-effort extraction of { options, component, raw } from an entry record.
        Ground truth (SlotCore.register): the record is
        { component, options: {key?,id?,order?,label?,priority?}, select?, inject?,
          children?, store?, locale?, registrant? } — select/inject live on the
          record itself, not inside options. */
    function entryParts(entry) {
      if (entry === null || entry === undefined) return null;
      const options = entry.options !== undefined ? entry.options : entry;
      const component =
        entry.component !== undefined ? entry.component
        : entry.Component !== undefined ? entry.Component
        : entry.value !== undefined ? entry.value
        : entry.render !== undefined ? entry.render
        : typeof entry === "function" ? entry
        : null;
      if (component === null || component === undefined) return null;
      return { options, component, raw: entry };
    }

    function findEntryInList(entries, match) {
      for (const entry of entries) {
        const parts = entryParts(entry);
        if (parts === null) continue;
        if (match === undefined) return parts;
        if (match(parts.options, parts.component)) return parts;
      }
      return null;
    }

    function findEntry(key, match) {
      return findEntryInList(capturedEntries(key), match);
    }

    function conversationTranslate() {
      if (conversationT !== null) return conversationT;
      if (localeService === undefined || localeService === null) return (key) => key;
      try {
        conversationT = localeService.bind("conversation");
      } catch {
        conversationT = null;
      }
      return conversationT !== null ? conversationT : (key) => key;
    }

    /** The framework binds each slot occupant's `t` to that occupant's OWN
        locale namespace. The kit's `t` is bound to "conversation", so entries
        from other packages (model selection: "effort.providerDefault", …)
        would render raw keys. Bind per entry when the record carries a
        different namespace. */
    function entryTranslate(entry) {
      if (localeService === undefined || localeService === null) return undefined;
      try {
        const ns = entry !== null && entry !== undefined && typeof entry.locale === "string" ? entry.locale : null;
        if (ns === null || ns === "" || ns === "conversation") return undefined;
        const bound = localeService.bind(ns);
        return typeof bound === "function" ? bound : undefined;
      } catch {
        return undefined;
      }
    }

    /** Per-session scroll positions for re-hosted chat/trajectory views.
        Bounded: a long page life with many conversations must not grow this
        map without limit (one entry per session, oldest out first). */
    const chatScrollMemory = new Map();
    function rememberChatScroll(sessionId, position) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (position === null || position === undefined) {
        chatScrollMemory.delete(sessionId);
        return;
      }
      if (chatScrollMemory.size >= 32 && !chatScrollMemory.has(sessionId)) {
        const oldest = chatScrollMemory.keys().next();
        if (oldest.done !== true) chatScrollMemory.delete(oldest.value);
      }
      chatScrollMemory.set(sessionId, position);
    }

    /** Per-pane image intake (drag-drop + clipboard paste) wired to each
        pane's re-hosted composer face. */
    const paneImageIntake = new Map();

    /** Per-pane Lexical root guards ({ editor, dispose, retire }) — see
        prepareNative: the hidden stock composer for the same session strips or
        steals the editor's root element on mount/unmount, orphaning the pane's
        editor. */
    const paneEditorGuards = new Map();

    /** Elements carrying a LIVE IME composition (element -> last event stamp).
        Lexical binds its composition listeners — and its keymap's `composing`
        flag — to the editor ROOT element, so anything that re-points that root,
        or re-lays-out its surroundings, while a composition is live ORPHANS the
        preedit: the browser keeps painting the composition underline, Lexical
        never sees the compositionend, and every composition-gated branch
        (Enter above all) misfires from then on. So the plugin stands down on a
        pane while a composition is live inside it.

        Keyed by the element the composition targets (the contenteditable, or a
        TUI textarea). A `focusout` retires the entry, so a composition killed
        without a compositionend cannot wedge a pane forever; the age cap is a
        second backstop. */
    const composingSince = new Map();
    const COMPOSITION_STALE_MS = 30000;
    const noteComposition = (event) => {
      const target = event.target;
      if (target === null || target === undefined || target.nodeType !== 1) return;
      if (event.type === "compositionend") composingSince.delete(target);
      else composingSince.set(target, Date.now());
    };
    const retireComposition = (event) => {
      const target = event.target;
      if (target !== null && target !== undefined && target.nodeType === 1) composingSince.delete(target);
    };
    /** True while `scope` (or anything inside it) has a live composition. */
    const composingIn = (scope) => {
      if (scope === null || scope === undefined) return false;
      const now = Date.now();
      for (const [el, at] of composingSince) {
        if (now - at > COMPOSITION_STALE_MS) { composingSince.delete(el); continue; }
        if (el === scope) return true;
        try { if (typeof scope.contains === "function" && scope.contains(el)) return true; } catch {}
      }
      return false;
    };

    /** Last session the user actually typed into — focus fallback target. */
    let lastTypedSessionId = null;
    const paneTypingUnsubs = new Map();
    try { lastTypedSessionId = window.localStorage.getItem("dsh.split-workspace.last-typed.v1"); } catch {}
    function rememberTypedSession(id) {
      lastTypedSessionId = id;
      try { window.localStorage.setItem("dsh.split-workspace.last-typed.v1", id); } catch {}
    }

    /** Per-pane chat store instances (selection/inspect/draft/view currency). */
    const paneChatStores = new Map();
    function paneChatStore(sessionId) {
      let store = paneChatStores.get(sessionId);
      if (store !== undefined) return store;
      let snapshot = { selection: null, draft: "", view: null, inspect: null, turnProcesses: [] };
      const listeners = new Set();
      const emit = () => {
        for (const fn of [...listeners]) fn();
      };
      store = {
        useStore(selector) {
          const use = makeUseStoreFace(
            { subscribe: (fn) => store.subscribe(fn), getSnapshot: () => snapshot },
            snapshot,
          );
          return use(selector);
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        getSnapshot: () => snapshot,
        actions: {
          select: (target) => {
            snapshot = { ...snapshot, selection: target };
            emit();
          },
          setDraft: (text) => {
            snapshot = { ...snapshot, draft: text };
            emit();
          },
          setView: (view) => {
            snapshot = { ...snapshot, view };
            emit();
          },
          setInspect: (target) => {
            snapshot = { ...snapshot, inspect: target };
            emit();
          },
          // dsh 0.1.5 chat store action: the manually expanded answer per
          // Turn (storedTurnProcessEntry reads snapshot.turnProcesses).
          setTurnProcessOpen: (turn, answerStep, open) => {
            const list = Array.isArray(snapshot.turnProcesses) ? [...snapshot.turnProcesses] : [];
            const index = list.findIndex((entry) => entry !== null && entry !== undefined && entry.turn === turn);
            if (open !== true) {
              if (index >= 0) list.splice(index, 1);
            } else if (index < 0) {
              list.push({ turn, answerStep });
            } else {
              list[index] = { turn, answerStep };
            }
            snapshot = { ...snapshot, turnProcesses: list };
            emit();
          },
        },
      };
      paneChatStores.set(sessionId, store);
      return store;
    }

    /** Standard hook prop naming (matches the slots runtime's
        standardHookPropName): "chat" → "useChat", "chatNode" → "useChatNode". */
    function hookPropName(name) {
      const text = String(name);
      return "use" + text.charAt(0).toUpperCase() + text.slice(1);
    }

    /** Keyed selector hook over a keyed-source resolver — the local port of
        the renderer's keyedObservableHook: use<Name>(key, selector). */
    function makeKeyedUseFace(resolver) {
      const cache = new Map();
      return function useKeyedFace(key, selector, equal) {
        let use = cache.get(key);
        if (use === undefined) {
          let source;
          try { source = resolver(key); } catch { source = undefined; }
          use = makeUseStoreFace(source, undefined);
          cache.set(key, use);
        }
        return use(selector === undefined ? (value) => value : selector);
      };
    }

    /** Per-entry store instances (renderer parity): handle -> session -> instance. */
    const entryStoreCache = new Map();

    /** Instantiate the store an entry declares, exactly like the renderer's
        host.storeOf(entry, scoped binding): the declared handle mints one
        instance per scope key. Components read their own domain store through
        it (ExpandButton reads state.bySession[sessionId], ChatView reads
        state.turnProcesses, …) — handing them any other store crashes their
        selectors.

        `scopeKey` is the renderer's own scope key: a Session binding's key on
        0.2.0 (the session id), the legacy "session-<id>" spelling on 0.1.x.
        The instance is this plugin's own either way (the renderer's cache is
        not reachable), so the key only has to be stable and distinct. */
    function entryStoreInstance(parts, sessionId, scopeKey) {
      if (parts === null || parts === undefined) return null;
      const raw = parts.raw;
      const opts = parts.options;
      let handle = raw !== null && raw !== undefined && raw.store !== undefined ? raw.store
        : (opts !== null && opts !== undefined && opts.store !== undefined ? opts.store : undefined);
      // Registration accepts a handle or a thunk that mints one; the registry
      // resolves the thunk once (`typeof options.store === "function"`).
      if (typeof handle === "function" && handle.create === undefined) {
        try { handle = handle(); } catch (error) { handle = undefined; }
      }
      if (handle === undefined || handle === null || typeof handle.create !== "function") return null;
      let bySession = entryStoreCache.get(handle);
      if (bySession === undefined) {
        bySession = new Map();
        entryStoreCache.set(handle, bySession);
      }
      const key = typeof scopeKey === "string" && scopeKey !== "" ? scopeKey : "session-" + sessionId;
      if (bySession.has(key)) return bySession.get(key);
      let instance = null;
      try { instance = handle.create(key); } catch (error) { instance = null; }
      bySession.set(key, instance);
      return instance;
    }

    /** The useStore/actions pair for one entry, or {} when it declares no store. */
    function entryStoreProps(parts, sessionId, scopeKey) {
      const instance = entryStoreInstance(parts, sessionId, scopeKey);
      if (instance === null || instance === undefined) return {};
      return {
        useStore: makeUseStoreFace(instance, undefined),
        actions: instance.actions,
      };
    }

    /** Mirror the slots runtime's InjectFace semantics: an inject result of
        { hooks: { name: store } } surfaces each store as a `use<Name>` hook
        prop (hooks.duration → useDuration), and { keyedHooks: { name: resolver } }
        surfaces as a keyed `use<Name>(key, selector)` prop (0.1.5's ChatView
        reads useChatNode/useChatNodeProcess this way). Everything else passes
        through. Without this, re-hosted views (TrajectoryView and friends)
        never receive their hook props and render broken. */
    function injectFaceProps(result) {
      if (result === null || result === undefined) return {};
      const out = {};
      for (const key of Object.keys(result)) {
        const value = result[key];
        if (key === "hooks" && value !== null && typeof value === "object") {
          for (const hookName of Object.keys(value)) {
            if (value[hookName] === undefined) continue;
            out[hookPropName(hookName)] = makeUseStoreFace(value[hookName], undefined);
          }
        } else if (key === "keyedHooks" && value !== null && typeof value === "object") {
          for (const hookName of Object.keys(value)) {
            if (value[hookName] === undefined) continue;
            out[hookPropName(hookName)] = makeKeyedUseFace(value[hookName]);
          }
        } else {
          out[key] = value;
        }
      }
      return out;
    }

    /** dsh 0.1.5: materialize one session's standard source exactly like the
        slots renderer does (materializeStandardBinding): plain props verbatim,
        hooks as identity-stable use<Name> selector hooks, keyed hooks as keyed
        selector hooks. The re-hosted native components read standard faces
        (useChat, useConversation, useInput, useSession, ...) off this kit; on
        0.1.5 they come from the uiSession service's registered contributions
        (ui-chat contributes `chat`, ui-conversation `conversation`/`input`
        + inputActions, ui-session `session`, ...). */
    function materializeSessionStandard(sessionId) {
      const binding = resolveSessionBinding(sessionId);
      if (binding === undefined || binding === null) return { faces: {}, key: undefined };
      const out = {};
      const props = binding.props;
      if (props !== null && props !== undefined && typeof props === "object") {
        for (const key of Object.keys(props)) out[key] = props[key];
      }
      const hooks = binding.hooks;
      if (hooks !== null && hooks !== undefined && typeof hooks === "object") {
        for (const key of Object.keys(hooks)) {
          if (hooks[key] === undefined) continue;
          out[hookPropName(key)] = makeUseStoreFace(hooks[key], undefined);
        }
      }
      const keyedHooks = binding.keyedHooks;
      if (keyedHooks !== null && keyedHooks !== undefined && typeof keyedHooks === "object") {
        for (const key of Object.keys(keyedHooks)) {
          if (keyedHooks[key] === undefined) continue;
          out[hookPropName(key)] = makeKeyedUseFace(keyedHooks[key]);
        }
      }
      // 0.2.0 store scope key: the registry mints entry stores with
      // `handle.create(scopeBinding.key)`, and a Session binding's key IS the
      // session id (ui-session's materialize: `key: binding.sessionId`).
      // 0.1.x bindings carried no key, so the legacy "session-<id>" spelling
      // stays as the fallback (the plugin owns these instances either way).
      const key = typeof binding.key === "string" && binding.key !== "" ? binding.key : "session-" + sessionId;
      return { faces: out, key };
    }

    /** The standard session kit for one pane. Built ONCE per (sessionId,
        session) in ChatPane's memo — identities must stay stable so the
        re-hosted native components do not resubscribe every render.

        Returns the component kit, the STANDARD faces alone (root + session,
        exactly what the renderer passes to slot-level inject factories as
        `standard`), and the store scope key for entry stores. */
    function makeKit(sessionId, session, rootFaces) {
      const kit = {
        sessionId,
        useSession: makeUseSession(session),
        useSessions: makeUseSessions(),
        useProjection: makeUseProjection(session),
        t: conversationTranslate(),
      };
      // Root faces are the canonical implementations of the GLOBAL hooks
      // (useSessions over the real list store, useSessionStatus, …): they beat
      // this plugin's own stand-ins, which exist only for compositions that
      // never published a root kit (0.1.5 resolve() merges them itself).
      if (rootFaces !== null && rootFaces !== undefined) {
        for (const key of Object.keys(rootFaces)) kit[key] = rootFaces[key];
      }
      // Session-scoped faces win over everything (0.1.5 injects them here too).
      const sessionStandard = materializeSessionStandard(sessionId);
      for (const key of Object.keys(sessionStandard.faces)) kit[key] = sessionStandard.faces[key];
      const standard = rootFaces !== null && rootFaces !== undefined
        ? { ...rootFaces, ...sessionStandard.faces }
        : { ...sessionStandard.faces };
      // The kit is built once per pane, so a resolution miss here is permanent
      // for that pane. `useChat` is the one that matters most: slot occupants
      // like the composer stats row call it unconditionally, and without it
      // they throw on every render straight into the (silent) pane boundary —
      // the cell just disappears. Say so loudly instead of letting it vanish.
      if (kit.useChat === undefined) {
        const seen = captureLog["kit:useChat:" + sessionId];
        captureLog["kit:useChat:" + sessionId] = (seen === undefined ? 0 : seen) + 1;
        if (seen === undefined) {
          console.warn("[dsh-split-workspace] standard session faces unresolved for " + sessionId
            + " (no useChat); slot occupants that need them will render nothing. keys: "
            + Object.keys(sessionStandard.faces).join(","));
        }
      }
      return { kit, standard, scopeKey: sessionStandard.key };
    }

    /** Clone the kit (shallow) and merge extras — owner props win. */
    function kitProps(kit, extra) {
      const props = { ...kit };
      if (extra !== undefined && extra !== null) {
        for (const key of Object.keys(extra)) props[key] = extra[key];
      }
      return props;
    }

    // ---------------------------------------------------------------------
    // slot-level inject faces (0.1.x + 0.2.0)
    //
    // Beside the entry's own `inject(sessionId, actions)` face, a slot KEY can
    // declare a common inject face on the registration that declares it
    // (`children: { "<key>": { kind, scope, inject } }`). The stock renderer
    // folds it into every entry of that key in two halves:
    //   * `hooks`/`keyedHooks` sources          -> bound use<Name> props
    //   * FUNCTION-valued `hooks` members       -> "slot hook factories",
    //     invoked per render occurrence with (standard, hookContext)
    // The second half is what 0.2.0 introduced for the Chat node seat:
    // ui-chat declares `inject: { hooks: { turnData: …, disclosure:
    // (_standard, { disclosureReset }) => … } }` and ChatView passes the
    // per-node context through its `renderSlot(..., { hookContext })` call.
    // A pane that re-hosts ChatView must therefore honor `hookContext` and run
    // those factories, or every reasoning/tool row dies on
    // "useDisclosure is not a function".
    // ---------------------------------------------------------------------

    const slotInjectCache = new WeakMap();
    const EMPTY_SLOT_INJECT = { props: {} };

    /** Normalize one slot-level inject face by object identity (the declaration
        keeps one face object for the slot's whole life). */
    function cachedSlotInject(face) {
      if (face === undefined || face === null) return EMPTY_SLOT_INJECT;
      let bound = slotInjectCache.get(face);
      if (bound !== undefined) return bound;
      const definitions = face.hooks;
      if (definitions === undefined || definitions === null || typeof definitions !== "object") {
        bound = { props: face };
        slotInjectCache.set(face, bound);
        return bound;
      }
      const props = {};
      for (const key of Object.keys(face)) {
        if (key !== "hooks") props[key] = face[key];
      }
      let factories = null;
      for (const name of Object.keys(definitions)) {
        const definition = definitions[name];
        if (definition === undefined) continue;
        const hookName = hookPropName(name);
        if (typeof definition === "function") {
          if (factories === null) factories = {};
          factories[name] = definition;
        } else {
          props[hookName] = makeUseStoreFace(definition, undefined);
        }
      }
      bound = factories === null ? { props } : { props, slotHookFactories: factories };
      slotInjectCache.set(face, bound);
      return bound;
    }

    /** The declaration-owned inject face of one slot key, or undefined. */
    function slotInjectFaceOf(name) {
      const service = slotsService;
      if (service === undefined || service === null || typeof service.spec !== "function") return undefined;
      try {
        const spec = service.spec(name);
        return spec === undefined || spec === null ? undefined : spec.inject;
      } catch (error) {
        return undefined;
      }
    }

    /** Bind the function-valued slot hooks for ONE render occurrence. */
    function bindSlotHookFactories(factories, standard, hookContext) {
      const hooks = {};
      for (const name of Object.keys(factories)) {
        try {
          hooks[hookPropName(name)] = factories[name](standard, hookContext);
        } catch (error) {
          if (captureLog["slotFactory:" + name] !== true) {
            captureLog["slotFactory:" + name] = true;
            console.warn("[dsh-split-workspace] slot hook factory '" + name + "' failed:", String(error).slice(0, 140));
          }
        }
      }
      return hooks;
    }

    // ---------------------------------------------------------------------
    // factory-slot parity (0.2.1 framework seats)
    //
    // The 0.2.1 renderer attaches `renderFactorySlot` to EVERY re-hosted entry
    // (see renderer `standardKit`). Components migrated to factory slots call it
    // unconditionally — the user-message bubble (`UserStyleBubble` in ui-chat
    // calls `props.renderFactorySlot("conversation.chat.user.content", …)`) and
    // the model selector's label (`ModelSelect` calls
    // `props.renderSlot("conversation.input.model.label", …)` from its factory
    // kit) are the live-breakage cases. Without this seat the re-hosted render
    // throws "renderFactorySlot is not a function" / "renderSlot is not a
    // function" into the pane boundary, so user messages and model-label seats
    // vanish on 0.2.1.
    //
    // This is a GUARDED reimplementation of the renderer's FactoryOutlet on top
    // of the public host face (`slotsService.hostFace()`): version
    // subscription, factory lookup, ancestry recursion guard, its own error
    // boundary that renders the caller's fallback and never escalates to the
    // pane boundary, the factory kit assembled from THIS pane's standard faces
    // (plus the declared-children renderSlot/renderSlotChain seats, locale `t`,
    // store pair and inject face), and a `useFactorySlot` stub for nested local
    // slots. When the host face is unavailable the outlet renders the fallback
    // and logs once — it never throws into React render. Compatible with the
    // 0.2.0 host face too (same subscribeFactory/factoryOf surface).
    // ---------------------------------------------------------------------

    /** Cordis ctx of the plugin, used as the synthetic factory store scope
        owner (`bindStoreScope` wants {key, ctx}). Set in apply(). */
    let pluginCtx = null;
    let hostFaceCache = null;
    function factoryHostFace() {
      const service = slotsService;
      if (service === undefined || service === null || typeof service.hostFace !== "function") return null;
      if (hostFaceCache !== null && hostFaceCache.service === service) return hostFaceCache.face;
      try {
        const face = service.hostFace();
        if (face === undefined || face === null
            || typeof face.subscribeFactory !== "function"
            || typeof face.getFactoryVersion !== "function"
            || typeof face.factoryOf !== "function") return null;
        hostFaceCache = { service, face };
        return face;
      } catch {
        return null;
      }
    }

    const EMPTY_FACTORY_ANCESTRY = new Set();
    let factoryAncestryContext = null;
    function factoryAncestry() {
      // Lazy so module evaluation never depends on React.createContext (the
      // bundle also evaluates under minimal test shims).
      if (factoryAncestryContext === null) factoryAncestryContext = React.createContext(EMPTY_FACTORY_ANCESTRY);
      return factoryAncestryContext;
    }
    const NOOP_FACTORY_COMPONENT = () => null;
    /** `useFactorySlot` replacement: a local-slot factory renders its declared
        fallback (or nothing) instead of throwing outside its occurrence. */
    function factorySlotStub(name, fallback) {
      return fallback !== undefined && fallback !== null ? fallback : NOOP_FACTORY_COMPONENT;
    }
    function bindFactoryLocale(namespace) {
      if (typeof namespace !== "string" || namespace === "" || localeService === undefined || localeService === null) return undefined;
      try {
        const bound = localeService.bind(namespace);
        return typeof bound === "function" ? bound : undefined;
      } catch {
        return undefined;
      }
    }

    class FactorySlotBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        try {
          const key = "factory:" + String(this.props.name);
          if (captureLog[key] !== true) {
            captureLog[key] = true;
            console.warn(LOG_PREFIX + " factory slot '" + String(this.props.name)
              + "' failed to render (showing its fallback; the rest of the pane keeps running):", String(error).slice(0, 200));
          }
        } catch {}
      }
      render() {
        if (this.state.failed === true) {
          return this.props.fallback !== undefined && this.props.fallback !== null ? this.props.fallback : null;
        }
        return this.props.children;
      }
    }

    /** One factory occurrence: mirrors the renderer's FactoryOutlet semantics. */
    function FactorySlotOccurrence({ name, inputProps, slots, fallback, standard, sessionId, scopeKey, kitT, paneRenderers }) {
      const host = factoryHostFace();
      const AncestryContext = factoryAncestry();
      const ancestors = React.useContext(AncestryContext);
      const subscribeFactory = React.useCallback(
        (notify) => (host === null ? NOOP_SUBSCRIBE() : host.subscribeFactory(name, notify)),
        [host, name],
      );
      const readFactoryVersion = React.useCallback(
        () => (host === null ? 0 : host.getFactoryVersion(name)),
        [host, name],
      );
      const factoryVersion = React.useSyncExternalStore(subscribeFactory, readFactoryVersion);
      const occurrence = React.useRef({}).current;
      const nextAncestors = React.useMemo(() => new Set(ancestors).add(name), [ancestors, name]);
      const boundFactorySlot = React.useMemo(
        () => makeFactorySlotRenderer(standard, sessionId, scopeKey, kitT, paneRenderers),
        [standard, sessionId, scopeKey, kitT, paneRenderers],
      );
      React.useEffect(() => {
        if (host === null) return undefined;
        let release = undefined;
        try {
          const definition = host.factoryOf(name);
          if (definition !== undefined && definition !== null && typeof host.retainFactoryOccurrence === "function") {
            release = host.retainFactoryOccurrence(definition, occurrence);
          }
        } catch {}
        return () => {
          if (typeof release === "function") {
            try { release(); } catch {}
          }
        };
      }, [host, name, occurrence]);
      const definition = host === null ? undefined : (() => {
        try { return host.factoryOf(name); } catch { return undefined; }
      })();
      if (host === null || definition === undefined || definition === null) {
        return fallback !== undefined && fallback !== null ? fallback : null;
      }
      if (ancestors.has(name)) {
        // Recursion: the stock outlet throws a SlotOwnershipError here; a throw
        // from a shared content factory would blank every re-hosted row, so
        // degrade to the fallback instead.
        return fallback !== undefined && fallback !== null ? fallback : null;
      }
      const children = definition.children;
      const childrenDeclared = children !== undefined && children !== null && typeof children === "object";
      let registrationKit = null;
      try {
        registrationKit = {
          renderFactorySlot: boundFactorySlot,
          useFactorySlot: factorySlotStub,
        };
        const localeT = definition.locale !== undefined ? bindFactoryLocale(definition.locale) : undefined;
        registrationKit.t = localeT !== undefined ? localeT : (kitT !== undefined ? kitT : conversationTranslate());
        if (childrenDeclared) {
          if (paneRenderers !== null && paneRenderers !== undefined) {
            registrationKit.renderSlot = paneRenderers.renderSlot;
            let hasChain = false;
            for (const childKey of Object.keys(children)) {
              const child = children[childKey];
              if (child !== null && child !== undefined && child.kind === "chain") { hasChain = true; break; }
            }
            if (hasChain) registrationKit.renderSlotChain = paneRenderers.renderSlotChain;
          }
        }
      } catch (error) {
        if (captureLog.factoryKit !== true) {
          captureLog.factoryKit = true;
          console.warn(LOG_PREFIX + " could not assemble the kit for factory slot '" + name + "':", String(error).slice(0, 160));
        }
        registrationKit = { renderFactorySlot: boundFactorySlot, useFactorySlot: factorySlotStub };
      }
      // Factory store: the renderer resolves it from a session scope binding;
      // ours is synthetic ({key, ctx}) because the pane lives outside the stock
      // React scope tree. Every step is guarded — a factory without its store
      // fails into the boundary instead of taking the pane down.
      let store = undefined;
      if (definition.store !== undefined && pluginCtx !== null) {
        try {
          if (typeof host.factoryStoreOf === "function") {
            store = host.factoryStoreOf(definition, { key: scopeKey, ctx: pluginCtx }, occurrence);
          }
        } catch (error) {
          if (captureLog.factoryStore !== true) {
            captureLog.factoryStore = true;
            console.warn(LOG_PREFIX + " factory store resolution failed for '" + name + "' (continuing without it):", String(error).slice(0, 160));
          }
          store = undefined;
        }
      }
      let injected = EMPTY_FACTORY_INJECT;
      try {
        injected = runFactoryInject(definition, sessionId, store !== undefined && store !== null ? store.actions : undefined);
      } catch {}
      const provided = Object.assign({}, standard, registrationKit);
      if (store !== undefined && store !== null) {
        provided.useStore = makeUseStoreFace(store, undefined);
        provided.actions = store.actions;
      }
      const props = Object.assign({}, provided, injected, inputProps !== undefined && inputProps !== null ? inputProps : {});
      if (slots !== undefined && slots !== null && typeof slots === "object") props.slots = slots;
      const Comp = definition.component;
      if (Comp === undefined || Comp === null) return fallback !== undefined && fallback !== null ? fallback : null;
      const body = h(AncestryContext.Provider, { value: nextAncestors }, h(Comp, props));
      return h(FactorySlotBoundary, {
        name,
        fallback,
        key: name + ":" + String(factoryVersion),
      }, body);
    }

    const EMPTY_FACTORY_INJECT = {};

    function runFactoryInject(definition, sessionId, actions) {
      const inject = definition !== null && definition !== undefined ? definition.inject : undefined;
      if (typeof inject !== "function") return EMPTY_FACTORY_INJECT;
      try {
        const args = [sessionId];
        if (actions !== undefined && actions !== null) args.push(actions);
        return injectFaceProps(inject(...args));
      } catch (error) {
        const key = "factoryInject:" + String(definition.name);
        if (captureLog[key] !== true) {
          captureLog[key] = true;
          console.warn(LOG_PREFIX + " factory inject failed for '" + String(definition.name) + "':", String(error).slice(0, 140));
        }
        return EMPTY_FACTORY_INJECT;
      }
    }

    /** `renderFactorySlot(name, inputProps, options)` bound to one pane. Returns
        a React element (never throws): unknown factory => fallback, missing host
        face => fallback + one console note, factory crash => local boundary. */
    function makeFactorySlotRenderer(standard, sessionId, scopeKey, kitT, paneRenderers) {
      return function renderFactorySlot(name, inputProps, options) {
        const fallback = options !== undefined && options !== null ? options.fallback : undefined;
        const safeFallback = fallback !== undefined && fallback !== null ? fallback : null;
        if (typeof name !== "string" || name === "") return safeFallback;
        const host = factoryHostFace();
        if (host === null) {
          if (captureLog.factoryHost !== true) {
            captureLog.factoryHost = true;
            console.warn(LOG_PREFIX + " this host release exposes no slot factory host face; factory-seat content (user bubbles, model labels, …) degrades to its fallback. The panes keep working — see window.__dshSplitWorkspace.health().");
          }
          return safeFallback;
        }
        try {
          return h(FactorySlotOccurrence, {
            name,
            inputProps: inputProps !== undefined && inputProps !== null ? inputProps : {},
            slots: options !== undefined && options !== null ? options.slots : undefined,
            fallback,
            standard,
            sessionId,
            scopeKey,
            kitT,
            paneRenderers,
          });
        } catch (error) {
          return safeFallback;
        }
      };
    }

    /** Cached per-entry `inject(sessionId, actions)` faces, exactly like the
        stock renderer ("cached entry inject"). The plugin used to re-run the
        factory on EVERY render of EVERY captured entry — including the
        per-chat-node renderers on the streaming hot path — which allocated new
        hook props each time (defeating all downstream memoization) and re-ran
        arbitrary per-call side effects the inject contract allows. Keyed by the
        entry RECORD object (a re-registration is a new object) + session +
        store scope, so the cache follows the ledger. Bounded by a generous
        fixed ceiling (the pane count is no longer capped; the cache exists to
        release abandoned scopes, not to ration them). */
    let entryInjectCache = new WeakMap();
    function clearEntryInjectCache() {
      entryInjectCache = new WeakMap();
    }
    function cachedEntryInject(parts, sessionId, scopeKey, compute) {
      const raw = parts !== null && parts !== undefined ? parts.raw : null;
      if (raw === null || raw === undefined || typeof raw !== "object") return compute();
      let byScope = entryInjectCache.get(raw);
      if (byScope === undefined) {
        byScope = new Map();
        entryInjectCache.set(raw, byScope);
      }
      const key = String(sessionId) + "\u0000" + String(scopeKey);
      if (byScope.has(key)) return byScope.get(key);
      const face = compute();
      if (byScope.size > 64) byScope.clear();
      byScope.set(key, face);
      return face;
    }

    /** renderSlot / renderSlotChain / renderList dispatchers routing into the
        captured slot ledger with the pane kit merged in. */
    function makeRenderers(sessionId, session, kit, standard, scopeKey, paneActions) {
      const merge = (props, source) => {
        if (source !== undefined && source !== null) {
          for (const key of Object.keys(source)) props[key] = source[key];
        }
        return props;
      };
      /** Apply a captured entry's inject(sessionId) factory — the stock slots
          runtime does this for every render; the generic dispatchers here
          never did, so slot occupants that need their injected face (the
          cost-meter dock line, header actions, queue/todo strips, chat-node
          context bodies) rendered bare or not at all. Owner props still win.
          The result is CACHED per (entry record, session, scope): see
          cachedEntryInject. */
      const entryInjectProps = (parts) => {
        const raw = parts.raw;
        const fn = raw !== null && raw !== undefined && typeof raw.inject === "function"
          ? raw.inject
          : (parts.options !== null && parts.options !== undefined && typeof parts.options.inject === "function" ? parts.options.inject : null);
        if (fn === null) return {};
        return cachedEntryInject(parts, sessionId, scopeKey, () => {
          try {
            const face = injectFaceProps(fn(sessionId, paneActions));
            // Agent-Teams compatibility. The stock openTeammate (from
            // dsh-experimental-client-ui-agent-team) guards on
            // `retainedBy.mainView > 0` for the pane's session and silently
            // returns otherwise — a pane session is usually retained by the
            // split view, not the main view, so member rows were dead clicks
            // in panes. While the split workspace is active, route the click
            // into the workspace instead: focus the member's pane, or split it
            // in beside this one (see splitAwareOpenTeammate). Not active or
            // not a list-known conversation: stock behavior.
            if (face !== null && face !== undefined && typeof face.openTeammate === "function") {
              face.openTeammate = splitAwareOpenTeammate(face.openTeammate);
            }
            return face;
          } catch (error) {
            const id = parts.options !== null && parts.options !== undefined && parts.options.id !== undefined ? String(parts.options.id) : "entry";
            if (captureLog["inj:" + id] !== true) {
              captureLog["inj:" + id] = true;
              console.warn("[dsh-split-workspace] slot inject failed for '" + id + "':", String(error).slice(0, 140));
            }
            return {};
          }
        });
      };
      /** The slot-level half of one render, in the renderer's own order:
          kit first, then the entry inject, then the slot's static injected
          props, then its contextual hook factories, then the owner props. */
      const slotShare = (name, props, options) => {
        const injected = cachedSlotInject(slotInjectFaceOf(name));
        merge(props, injected.props);
        if (injected.slotHookFactories !== undefined) {
          const hasContext = options !== undefined && options !== null && Object.prototype.hasOwnProperty.call(options, "hookContext");
          if (!hasContext) {
            // The renderer treats this as an assembly failure (it throws): a
            // factory like the Chat node's `disclosure` cannot be bound without
            // its occurrence context. Warn once per slot and skip the entry
            // instead of spamming one thrown render per row.
            if (captureLog["slotCtx:" + name] !== true) {
              captureLog["slotCtx:" + name] = true;
              console.warn("[dsh-split-workspace] slot '" + name + "' declares contextual injected Hooks but the render position passed no hookContext; its entries are skipped in panes.");
            }
            return false;
          }
          merge(props, bindSlotHookFactories(injected.slotHookFactories, standard, options.hookContext));
        }
        return true;
      };
      /** The declared kind of one slot key ("list" | "single" | "keyed" |
          "chain"), or null when the spec is unavailable. The stock outlet
          dispatches on this: a LIST slot renders EVERY entry, single/keyed
          render one. The plugin's renderSlot used to pick entries[0] for
          every kind, so list-kind rows (conversation.session.header.actions:
          agent-team -20, agent-preset -10, cost-meter 1, …;
          conversation.session.header.utilities) silently lost every entry
          after the first in panes. */
      const slotKindOf = (name) => {
        try {
          const spec = slotsService !== undefined && slotsService !== null && typeof slotsService.spec === "function"
            ? slotsService.spec(name)
            : null;
          return spec !== null && spec !== undefined && typeof spec.kind === "string" ? spec.kind : null;
        } catch {
          return null;
        }
      };
      const renderSlot = (name, owner, options) => {
        let entries = capturedEntries(name);
        // Re-hosted panes use THIS dispatcher for the stock session header.
        // The sidebar-right expand button is a session-scoped seat with its own
        // store handle; mounting it inside every pane creates a second store
        // for the same session, and the shared right sidebar then reads a
        // different instance than the pane that nav acts on (dead-looking tab
        // icons). Panes never show that button anyway (the split toolbar owns
        // the rightbar toggle), so drop store-backed corner entries here: the
        // stock header keeps the only sidebar-right store.
        if (name === "conversation.session.header.corner") {
          entries = entries.filter((entry) => entry === null || entry === undefined
            || entry.store === undefined || entry.store === null);
        }
        if (entries.length === 0) {
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        // Stock parity for list-kind slots: renderSlot on a list renders
        // every entry (see slotKindOf) — the runtime's SlotOutlet does the
        // same, and callers like the session header pass a plain {} owner.
        if (slotKindOf(name) === "list") {
          const rows = renderList(name, owner, options);
          if (Array.isArray(rows) && rows.length > 0) return rows;
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        let picked = null;
        if (options !== undefined && options !== null && options.entryKey !== undefined) {
          picked = findEntryInList(entries, (opts) => opts !== null && opts !== undefined && opts.key === options.entryKey);
        } else {
          picked = entryParts(entries[0]);
        }
        if (picked === null) {
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        const props = merge(merge(merge({ ...kit }, entryInjectProps(picked)), entryStoreProps(picked, sessionId, scopeKey)), owner);
        if (!slotShare(name, props, options)) {
          return options !== undefined && options !== null && options.fallback !== undefined ? options.fallback : null;
        }
        // node renderers need the renderer dispatchers + turn-data hook access
        if (name === "conversation.chat.node") {
          const useSession = kit.useSession;
          const useTurnData = (turnKey) =>
            useSession((snapshot) => {
              if (snapshot === null || snapshot === undefined) return undefined;
              try {
                const node = snapshot.chat.nodes.get(options.entryKey);
                const location = node !== undefined && node !== null ? node.location : undefined;
                return location !== undefined && (location.kind === "turn" || location.kind === "step")
                  ? location.turn.data.get(turnKey)
                  : undefined;
              } catch {
                return undefined;
              }
            });
          props.hooks = { ...(props.hooks !== undefined && props.hooks !== null ? props.hooks : {}), turnData: useTurnData };
          props.useTurnData = useTurnData;
        }
        props.renderSlot = renderSlot;
        props.renderSlotChain = renderSlotChain;
        const pickedT = entryTranslate(picked.raw);
        if (pickedT !== undefined) props.t = pickedT;
        return h(PaneBoundary, { fallback: null }, h(picked.component, props));
      };
      const renderSlotChain = (name, owner, options) => {
        const entries = capturedEntries(name);
        const out = [];
        for (const entry of entries) {
          const parts = entryParts(entry);
          if (parts === null) continue;
          const select = entry.select !== undefined ? entry.select : parts.options.select;
          let matched = null;
          try {
            matched = typeof select === "function" ? select(owner) : null;
          } catch {
            matched = null;
          }
          if (matched === null || matched === undefined) continue;
          const props = merge(merge(merge({ ...kit }, entryInjectProps(parts)), entryStoreProps(parts, sessionId, scopeKey)), owner);
          if (!slotShare(name, props, options)) continue;
          props.matched = matched;
          props.renderSlot = renderSlot;
          props.renderSlotChain = renderSlotChain;
          // stock-outlet parity (see renderList's data-slot note)
          if (props["data-slot"] === undefined) props["data-slot"] = name;
          const chainT = entryTranslate(entry);
          if (chainT !== undefined) props.t = chainT;
          out.push(h(PaneBoundary, { key: (parts.options !== null && parts.options !== undefined && parts.options.id) || out.length, fallback: null, slotKey: name }, h(parts.component, props)));
        }
        return out;
      };
      const renderList = (name, extraProps, options) => {
        const entries = capturedEntries(name);
        const skipEntryIds = options !== null && options !== undefined && Array.isArray(options.skipEntryIds)
          ? options.skipEntryIds
          : null;
        const out = [];
        for (const entry of entries) {
          const parts = entryParts(entry);
          if (parts === null) continue;
          const entryId = parts.options !== null && parts.options !== undefined && parts.options.id !== undefined
            ? String(parts.options.id) : "";
          if (skipEntryIds !== null && entryId !== "" && skipEntryIds.indexOf(entryId) !== -1) continue;
          const props = merge(merge(merge({ ...kit }, entryInjectProps(parts)), entryStoreProps(parts, sessionId, scopeKey)), extraProps);
          if (!slotShare(name, props, options)) continue;
          // Stock-outlet parity: every entry the outlet renders also gets the
          // render dispatchers, list-kind rows included. Deliverables
          // (conversation.chat.turnTail) calls props.renderSlot from inside its
          // row map — without this the row threw "renderSlot is not a function"
          // on every render in panes and vanished behind the boundary. The
          // single/chain dispatchers above already attach both.
          props.renderSlot = renderSlot;
          props.renderSlotChain = renderSlotChain;
          if (parts.options !== null && parts.options !== undefined && parts.options.id !== undefined && parts.options.id !== null) {
            props["data-slot-id"] = parts.options.id;
          }
          // Stock-outlet parity: the stock outlet stamps `data-slot="<key>"`
          // on what it renders, and third-party global CSS keys on it (the
          // cost meter lays its dock entries out through
          // `div:has(>[data-slot="conversation.composer.dock"] …)`). Panes
          // used to stamp only `data-slot-id`, so such rules silently did
          // not apply inside panes and the dock area rendered with different
          // geometry than the stock page — the two plugins "fought" over the
          // same row. Stamp both, exactly like the outlet.
          if (props["data-slot"] === undefined) props["data-slot"] = name;
          const listT = entryTranslate(entry);
          if (listT !== undefined) props.t = listT;
          out.push(h(PaneBoundary, { key: (parts.options !== null && parts.options !== undefined && parts.options.id) || out.length, fallback: null, slotKey: name }, h(parts.component, props)));
        }
        return out;
      };
      // `entryInjectProps` is also used by callers that render an entry
      // themselves outside the dispatchers (ChatPane's composer-chain
      // election): the stock rule is that EVERY entry render gets its own
      // inject face, and the ask/approval cards depend on it — the
      // `conversation.composer` elected entry (ui-user-questions QuestionFlow)
      // declares `keyedHooks: { questionCard: … }`, which materializes the
      // `useQuestionCard` prop. Omitting it threw
      // "useQuestionCard is not a function" and left the turn pending forever.
      return { renderSlot, renderSlotChain, renderList, entryInjectProps };
    }

    /** PURE (no React) props assembly for an elected composer-chain entry, in
        the stock renderer's merge order: kit -> entry inject face -> slot-level
        injected props -> entry store pair -> owner props -> matched -> locale
        `t`, plus the render dispatchers and the `data-slot` outlet stamp the
        stock outlet adds. Exposed through `window.__dshSplitWorkspace.__test` so the
        parity contract is regression-tested without a DOM. */
    function composerChainProps(kit, injectFace, slotProps, storeProps, ownerProps, matched, tFn, renderers) {
      const props = Object.assign({}, kit);
      if (injectFace !== undefined && injectFace !== null && typeof injectFace === "object") Object.assign(props, injectFace);
      if (slotProps !== undefined && slotProps !== null && typeof slotProps === "object") Object.assign(props, slotProps);
      if (storeProps !== undefined && storeProps !== null && typeof storeProps === "object") Object.assign(props, storeProps);
      if (ownerProps !== undefined && ownerProps !== null && typeof ownerProps === "object") Object.assign(props, ownerProps);
      props.matched = matched;
      if (tFn !== undefined) props.t = tFn;
      if (renderers !== undefined && renderers !== null) {
        if (props.renderSlot === undefined) props.renderSlot = renderers.renderSlot;
        if (props.renderSlotChain === undefined) props.renderSlotChain = renderers.renderSlotChain;
      }
      if (props["data-slot"] === undefined) props["data-slot"] = "conversation.composer";
      return props;
    }

    /** PURE chain election (stock semantics): the first entry whose
        `select(owner)` returns a non-null value owns the chain; selector
        crashes decline that entry (logged through the debug sink). Returns
        null when nothing matches, which the caller renders as its fallback
        (composerBar for the composer chain). Exposed via the __test seam so the
        ask/approval-card election path is regression-tested without a DOM. */
    function electComposerChain(entries, ownerProps, debug) {
      const list = Array.isArray(entries) ? entries : [];
      for (const entry of list) {
        const parts = entryParts(entry);
        if (parts === null) continue;
        const select = parts.raw !== null && parts.raw !== undefined && typeof parts.raw.select === "function"
          ? parts.raw.select
          : (parts.options !== null && parts.options !== undefined && typeof parts.options.select === "function" ? parts.options.select : null);
        if (select === null) continue;
        let matched = null;
        try {
          matched = select(ownerProps);
        } catch (error) {
          matched = null;
          if (debug !== undefined && debug !== null) debug.electionError = String(error).slice(0, 200);
        }
        if (matched === null || matched === undefined) continue;
        return { parts, matched, entry };
      }
      return null;
    }

    /** Error boundary so one pane's capture problem never kills the workspace.
        It logs EVERY distinct failure (once per message, plus a running total)
        and marks the DOM: the old latch logged only the first failure
        page-wide, so a slot cell that threw on every render — e.g. the
        composer stats row when a face it needs never arrived — simply vanished
        from the pane with nothing in the console to say why. The stock outlet
        logs every crash and stamps `data-slot-error`, so this matches it. */
    class PaneBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidUpdate(prevProps) {
        // Controlled re-attempt: when the pane's prepared bundle/generation
        // changes (resetKey), a latched slot boundary gets one fresh render.
        // Without this a transient capture error removed that slot for the
        // pane's whole life. Note: NO automatic loop — this only runs when the
        // reset key actually changes.
        if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
          this.setState({ error: null });
        }
      }
      componentDidCatch(error, info) {
        try {
          const message = String(error).slice(0, 200);
          const seen = captureLog["boundary:" + message];
          captureLog["boundary:" + message] = (seen === undefined ? 0 : seen) + 1;
          captureLog.boundaryCount = (captureLog.boundaryCount === undefined ? 0 : captureLog.boundaryCount) + 1;
          if (seen === undefined || seen === 0) {
            const where = this.props !== null && this.props !== undefined && this.props.slotKey !== undefined
              ? " in slot '" + this.props.slotKey + "'" : "";
            console.warn("[dsh-split-workspace] pane component failed" + where + " (rendering fallback):", message);
          }
          // Error budget: repeated boundary catches while the workspace is
          // active deactivate it to safe mode (single console.warn from there).
          noteFailure("slot", error);
        } catch {}
      }
      render() {
        if (this.state.error !== null) {
          if (this.props.fallback !== undefined && this.props.fallback !== null) return this.props.fallback;
          return h("div", { "data-dsv-slot-error": this.props.slotKey !== undefined ? String(this.props.slotKey) : "true" });
        }
        return this.props.children;
      }
    }

    /** Per-pane fail isolation (S3): a throw anywhere in the pane body — the
        ChatPane hook graph, NativeViewArea, the editor guard, a re-hosted
        component outside a slot boundary — renders THIS pane's retry card
        instead of unmounting the whole workspace. The retry button re-attempts
        the body; the other panes keep streaming untouched. */
    class PaneShellBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null, attempt: 0 };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try {
          console.warn(LOG_PREFIX + " pane '" + String(this.props.sessionId) + "' failed and was isolated — the other panes keep running. Use the pane's Retry button; see window.__dshSplitWorkspace.health().");
        } catch {}
        noteFailure("pane-shell", error);
      }
      render() {
        if (this.state.error !== null) {
          return h("div", { className: "dsv-pane-error", "data-dsv-pane-error": String(this.props.sessionId) },
            h("div", { className: "dsv-pane-error-title" }, t("paneFailed")),
            h("div", { className: "dsv-pane-error-body" }, String(this.state.error).slice(0, 240)),
            h("button", {
              type: "button",
              className: "dsv-empty-btn",
              onClick: () => { this.setState({ error: null, attempt: this.state.attempt + 1 }); },
            }, t("retryLabel")),
          );
        }
        return this.props.children;
      }
    }

    // ---------------------------------------------------------------------
