    // native pane (re-hosted ChatView + InputBar with graceful fallback)
    // ---------------------------------------------------------------------

    /** Prepare everything needed to re-host the native transcript + composer
        for one pane. Built ONCE per (sessionId, session, root faces): inject
        factories can have per-call side effects, so they run exactly once
        here. Returns null fields when a capture is unavailable. */
    function prepareNative(sessionId, session, rootFaces) {
      const bundle = makeKit(sessionId, session, rootFaces);
      const kit = bundle.kit;
      const store = paneChatStore(sessionId);
      const renderers = makeRenderers(sessionId, session, kit, bundle.standard, bundle.scopeKey, store.actions);
      // Framework seats EVERY re-hosted entry receives from the stock renderer
      // (standardKit): `renderFactorySlot` always, and the declared-children
      // render dispatchers. 0.2.1 components call them unconditionally (user
      // bubbles, model labels), so they belong on the shared pane kit — the
      // dispatchers spread the kit, and kitProps-based consumers inherit them.
      kit.renderFactorySlot = makeFactorySlotRenderer(bundle.standard, sessionId, bundle.scopeKey, kit.t, renderers);
      kit.useFactorySlot = factorySlotStub;
      kit.renderSlot = renderers.renderSlot;
      kit.renderSlotChain = renderers.renderSlotChain;

      // transcript: the stock chat view entry
      const view = findEntry("conversation.view", (opts) => opts !== null && opts !== undefined && (opts.id === "chat" || opts.key === "chat"));
      let transcriptInjected = null;
      if (view !== null) {
        try {
          const injectFn = view.raw.inject !== undefined ? view.raw.inject : view.options.inject;
          if (typeof injectFn === "function") transcriptInjected = injectFaceProps(injectFn(sessionId, store.actions));
        } catch (error) {
          console.warn("[dsh-split-workspace] chat view inject failed:", String(error).slice(0, 140));
          transcriptInjected = null;
        }
      }

      // composer: the stock InputBar entry + its per-session input face
      const bar = findEntry("conversation.composer.bar");
      let composer = null;
      if (bar !== null) {
        let face = null;
        try {
          const injectFn = bar.raw.inject !== undefined ? bar.raw.inject : bar.options.inject;
          face = typeof injectFn === "function" ? injectFn(sessionId) : null;
        } catch (error) {
          console.warn("[dsh-split-workspace] composer inject failed:", String(error).slice(0, 140));
          face = null;
        }
        if (face !== null && face !== undefined) {
          const shell = face.keyboard;
          if (shell === undefined || shell === null) {
            // silent fallback cliff: without the keyboard shell the pane drops
            // to the plain-textarea composer — say so, loudly, once
            if (captureLog.composerFace !== true) {
              captureLog.composerFace = true;
              console.warn("[dsh-split-workspace] composer inject face has no keyboard shell; face keys: " + Object.keys(face !== null && face !== undefined ? face : {}).join(","));
            }
          } else {
            const inputSource = shell.state !== undefined && shell.state !== null && typeof shell.state.subscribe === "function"
              ? shell.state
              : shell;
            const useInput = makeUseStoreFace(inputSource, undefined);
            const inputActions = {
              setDraft: (text) => (typeof shell.setDraft === "function" ? shell.setDraft(text) : undefined),
              // dsh 0.1.5 action names (the stock InputBar reads these —
              // e.g. its attachment-prune effect calls pruneAttachments, and
              // a missing member throws mid-render and takes the bar down)
              addAttachments: (ids) => (typeof shell.addAttachments === "function" ? shell.addAttachments(ids) : false),
              removeAttachment: (id) => (typeof shell.removeAttachment === "function" ? shell.removeAttachment(id) : undefined),
              pruneAttachments: (ids) => (typeof shell.pruneAttachments === "function" ? shell.pruneAttachments(ids) : undefined),
              submit: () => (typeof shell.submit === "function" ? shell.submit() : undefined),
              // 0.1.4 aliases, kept for older cores
              addImages: (ids) => (typeof shell.addImages === "function" ? shell.addImages(ids) : (typeof shell.addAttachments === "function" ? shell.addAttachments(ids) : false)),
              removeImage: (id) => (typeof shell.removeImage === "function" ? shell.removeImage(id) : (typeof shell.removeAttachment === "function" ? shell.removeAttachment(id) : undefined)),
              pruneImages: (ids) => (typeof shell.pruneImages === "function" ? shell.pruneImages(ids) : (typeof shell.pruneAttachments === "function" ? shell.pruneAttachments(ids) : undefined)),
            };
            // pane-level intake for drag-drop + clipboard paste. (files,
            // text): files ride the stock draft pipeline and clipboard TEXT
            // lands at the input's caret — mixed text+image pastes land BOTH,
            // exactly like the stock handler. dsh 0.1.5 replaced the 0.1.4
            // image intake (face.addImages / shell.pasteBegin) with
            // face.addFiles (= createDrafts + addAttachments, error string or
            // null) and shell.paste (Lexical insert at selection); both
            // generations are supported, 0.1.5 first.
            const paneAddFiles = typeof face.addFiles === "function" ? face.addFiles
              : (typeof face.addImages === "function" ? face.addImages : null);
            paneImageIntake.set(sessionId, (files, text) => {
              try {
                if (Array.isArray(files) && files.length > 0) {
                  if (paneAddFiles === null) {
                    console.warn("[dsh-split-workspace] image intake unavailable: composer face has no addFiles/addImages");
                  } else {
                    const outcome = paneAddFiles.call(face, files);
                    if (typeof outcome === "string" && outcome !== "") {
                      console.warn("[dsh-split-workspace] image intake rejected:", outcome);
                    }
                  }
                }
                if (typeof text === "string" && text !== "") {
                  const el = document.activeElement;
                  const inPane = el !== null && el !== undefined
                    && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable === true);
                  if (!inPane) return;
                  if (typeof shell.paste === "function") {
                    // 0.1.5: inserts at the editor's current selection (or
                    // document end when collapsed), undo-boundaried like stock
                    shell.paste(text);
                  } else if (typeof shell.pasteBegin === "function" && el.tagName === "TEXTAREA") {
                    // legacy 0.1.4 caret-span path
                    const start = typeof el.selectionStart === "number" ? el.selectionStart : String(el.value || "").length;
                    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
                    shell.pasteBegin(text, { start, end });
                    const caret = start + text.length;
                    try { el.setSelectionRange(caret, caret); } catch {}
                  }
                }
              } catch (error) {
                console.warn("[dsh-split-workspace] image intake failed:", String(error).slice(0, 140));
              }
            });
            // Root guard for the pane's composer. The pane's contenteditable
            // hosts this session's Lexical editor, but the HIDDEN stock page
            // still mounts/unmounts its own composer for the same session —
            // its mount calls editor.setRootElement(stockEl) and its unmount
            // cleanup unconditionally calls editor.setRootElement(null), so
            // every sidebar session switch strips the root from whichever
            // pane owns that editor. The pane's editor turns into an orphan
            // plain contenteditable: typed text appears, but Lexical and the
            // input machine never see it — the grey placeholder stays, Enter
            // and attachments go dead. This listener re-claims the root for
            // the pane the instant anyone else takes or clears it.
            if (shell.editor !== undefined && shell.editor !== null && typeof shell.editor.registerRootListener === "function") {
              const paneEditor = shell.editor;
              const paneSelector = '.dsv-pane[data-dsv-pane="' + String(sessionId).replace(/"/g, '\\"') + '"]';
              // The composer div this pane currently hosts, if any — but only
              // while the pane is actually RENDERED. The workspace toggle
              // (session-hotkeys' Alt+W) hides the whole overlay with
              // `display:none`, and a hidden element is still `isConnected`, so
              // a visibility-blind check let the invisible pane keep the
              // session's Lexical root hostage. The visible stock composer was
              // then an orphan: typing painted characters into a plain
              // contenteditable while the input machine never heard them, the
              // send key stayed disabled and Enter did nothing — the stock
              // chatbox looked completely dead.
              const paneHost = () => {
                const pane = document.querySelector(paneSelector);
                if (pane === null) return null;
                // FIRST VISIBLE input, not just the first: transient/hidden
                // seats (a takeover card mid-transition, an unmounting bar)
                // can precede the live editor in document order with a zero
                // rect — returning null for those parked the editor on the
                // covered stock composer while a perfectly good host sat
                // right behind it.
                let found = null;
                try {
                  for (const candidate of pane.querySelectorAll("[data-composer-input]")) {
                    if (!candidate.isConnected) continue;
                    try { if (candidate.getClientRects().length === 0) continue; } catch {}
                    found = candidate;
                    break;
                  }
                } catch {}
                return found;
              };
              /** A host this editor may hand the root to: connected, and
                  rendered when the platform can tell us. */
              const usableHost = (candidate) => {
                if (candidate === null || candidate === undefined || !candidate.isConnected) return false;
                try { if (candidate.getClientRects().length === 0) return false; } catch {}
                return true;
              };
              // Whatever ELSE this editor was rooted at and is still in the
              // document — in practice the covered stock page's composer for
              // this same session. Only ever an element this very editor
              // occupied, so handing the root back can never land it on a
              // different session's composer.
              let displacedHost = null;
              // Seed it from whatever the editor is rooted at RIGHT NOW. At
              // guard-installation time this pane has not claimed the root yet,
              // so if the stock page mounted first (the normal boot order) that
              // element IS this session's other composer — and without the seed
              // the guard has no hand-over target when the pane later stops
              // being rendered, which leaves the visible stock chatbox an
              // orphan with typing that never reaches the input machine.
              try {
                const seed = paneEditor.getRootElement();
                if (seed !== null && seed !== undefined && typeof seed.closest === "function"
                    && seed.closest(paneSelector) === null) {
                  displacedHost = seed;
                }
              } catch {}
              let alive = true;
              let repairRaf = 0;
              let deferredRepairRaf = 0;
              let retireTimer = 0;
              // Re-point rate limiter (1.7.0: no more permanent breaker). Every
              // setRootElement rebuilds the editor's whole DOM, so two owners
              // contesting the root (the hidden stock composer vs this pane — and
              // on desktop compositions both may believe they are the visible
              // one) can ping-pong forever, which reads as a frozen app. The
              // limiter therefore keeps a minimum spacing and a rolling budget.
              // It used to TRIP A BREAKER and stand down for good when the
              // budget was spent; ordinary main-view navigation legitimately
              // re-points the shared editor once per session switch, so a few
              // switches between two split conversations spent the budget and
              // left the visible pane composer as a plain contenteditable
              // (typing painted, Enter / Ctrl+A / the "/" trigger feed dead).
              // When the budget is spent now the limiter only THROTTLES to one
              // repair per second — it never stops repairing — and it re-arms
              // once ownership is stable again. The give-back path (pane closed /
              // not rendering) stays armed so teardown still hands the root back
              // to the stock composer.
              const GUARD_MIN_REPOINT_MS = 250;
              const GUARD_WINDOW_MS = 10000;
              const GUARD_MAX_REPOINTS = 24;
              const GUARD_THROTTLE_MS = 1000;
              let repointTimes = [];
              let guardThrottled = false;
              const noteThrottle = () => {
                if (guardThrottled) return;
                guardThrottled = true;
                console.warn("[dsh-split-workspace] editor-root guard: the shared composer editor is being re-pointed often (main-view switches between split conversations do this); repairs are throttled to one per second until it settles. The pane composer stays live.");
              };
              const mayRepoint = () => {
                const now = Date.now();
                repointTimes = repointTimes.filter((t) => now - t < GUARD_WINDOW_MS);
                const last = repointTimes.length > 0 ? repointTimes[repointTimes.length - 1] : 0;
                if (repointTimes.length >= GUARD_MAX_REPOINTS) {
                  noteThrottle();
                  if (now - last < GUARD_THROTTLE_MS) return false;
                }
                if (repointTimes.length > 0 && now - last < GUARD_MIN_REPOINT_MS) return false;
                return true;
              };
              const noteRepoint = () => { repointTimes.push(Date.now()); };
              const guardRoot = (defer) => {
                if (!alive) return;
                let changed = false;
                try {
                  const el = paneHost();
                  const root = paneEditor.getRootElement();
                  if (el !== null) {
                    if (root !== el) {
                      // Lexical binds keydown, paste, copy, cut, drop,
                      // beforeinput and BOTH composition events to the root
                      // element, and it rebuilds that element's whole DOM when
                      // the root is re-pointed. Doing that while an IME
                      // composition is live in this div is what leaves the
                      // composition underline painted for good and strands
                      // `isComposing() === true` (which in turn makes the root
                      // keydown handler drop every later Enter). So while a
                      // composition is live here, leave the root exactly where
                      // it is; the flush below runs on compositionend, and on
                      // focusout or the next event if that never arrives.
                      if (composingIn(el)) return;
                      if (!mayRepoint()) return; // throttled: a later event retries
                      if (root !== null && root.isConnected) displacedHost = root;
                      paneEditor.setRootElement(el); // reclaim from the stock page
                      noteRepoint();
                      changed = true;
                    } else if (guardThrottled && repointTimes.length > 0
                        && Date.now() - repointTimes[repointTimes.length - 1] > 3000) {
                      // Ownership has been stable for a few seconds: re-arm the
                      // throttle warning (and the full budget) so a later genuine
                      // contention fight is still reported and repairable.
                      repointTimes = [];
                      guardThrottled = false;
                    }
                  } else {
                    // No RENDERED pane composer. Either the pane is tucked away
                    // (the workspace toggle), in TUI mode, or its composer is
                    // unmounted — and in every one of those cases the pane must
                    // not keep this session's editor: if the root is still
                    // parked in an invisible/unusable host, hand it to the
                    // session's other composer so the view the user is actually
                    // looking at keeps working. This path is deliberately NOT
                    // rate-limited: it is self-limiting by construction (it needs
                    // root === null or a root parked inside this pane) and it is
                    // what teardown uses — blocking it would strand the stock
                    // composer rootless after a pane closes, i.e. "the input is
                    // focused but completely dead".
                    const hostage = root !== null && root !== undefined
                      && (!root.isConnected || (typeof root.closest === "function" && root.closest(paneSelector) !== null));
                    if (hostage && usableHost(displacedHost) && !composingIn(root)) {
                      paneEditor.setRootElement(displacedHost);
                      noteRepoint();
                      changed = true;
                    } else if (root === null && usableHost(displacedHost) && !composingIn(displacedHost)) {
                      // the pane is gone (closed, or the composer is unmounted):
                      // the session's editor must not be left rootless — the
                      // stock page still shows this session
                      paneEditor.setRootElement(displacedHost);
                      noteRepoint();
                      changed = true;
                    }
                  }
                } catch {}
                // One deferred pass. A pane teardown nulls the root while its
                // own div is STILL connected (React runs the layout-effect
                // cleanup before it removes the host node), so the useful
                // re-check only lands after that commit.
                if (changed && defer !== false && repairRaf === 0) {
                  repairRaf = requestAnimationFrame(() => { repairRaf = 0; guardRoot(false); });
                }
              };
              let offGuard = null;
              try { offGuard = paneEditor.registerRootListener(guardRoot); } catch { offGuard = null; }
              // The root listener only fires on ownership changes that go
              // THROUGH the editor API after it exists. A pane whose editor is
              // already orphaned by then — the hidden stock page claimed the
              // root before this pane mounted, or its teardown raced the
              // mount — produces no further root event at all, and the pane's
              // contenteditable stays a plain div: typed characters paint, the
              // grey placeholder sticks, and Enter plus the attachment
              // pipeline are dead while the send key still works. Re-validate
              // on every event that lands inside this pane (idempotent while
              // the root is healthy) so that race cannot outlive the first
              // keystroke or click.
              const paneTargetOf = (event) => {
                const target = event.target;
                if (target === null || target === undefined || typeof target.closest !== "function") return null;
                let inPane = false;
                try { inPane = target.closest(paneSelector) !== null; } catch { return null; }
                // Also react to the session's OTHER composer (the covered stock
                // page). When the workspace is tucked away that is the visible
                // one, and a click or a keystroke landing in it is exactly the
                // moment to hand the editor root over — the toggle only flips a
                // class on <html>, which fires no event the pane could see.
                if (!inPane) {
                  try { if (target.closest("[data-composer-input]") === null) return null; } catch { return null; }
                }
                return target;
              };
              // Typing must NOT rebuild the focused editor's DOM inside the
              // keydown/beforeinput that carries it — that is what destroyed the
              // caret/selection and swallowed the model update. Key events only
              // schedule the repair for the next frame (idempotent while the
              // root is healthy); focus and pointer events repair immediately.
              const repairGuardSoon = () => {
                if (deferredRepairRaf !== 0) return;
                deferredRepairRaf = requestAnimationFrame(() => {
                  deferredRepairRaf = 0;
                  if (alive) guardRoot(false);
                });
              };
              const guardOnPointer = (event) => {
                if (paneTargetOf(event) === null) return;
                guardRoot();
              };
              const guardOnTyping = (event) => {
                if (paneTargetOf(event) === null) return;
                if (event.type === "keydown" && event.key === "a"
                    && (event.ctrlKey === true || event.metaKey === true)
                    && event.altKey !== true && event.shiftKey !== true) {
                  // Ctrl/Cmd+A on an orphaned host would select stray native
                  // characters on the covered page (Lexical never sees the
                  // chord). Repair first, then select this pane's text
                  // ourselves so "select all" keeps working.
                  const el = paneHost();
                  let root = null;
                  try { root = paneEditor.getRootElement(); } catch {}
                  if (el !== null && root !== el) {
                    event.preventDefault();
                    guardRoot(false);
                    window.requestAnimationFrame(() => {
                      const host = paneHost();
                      if (host === null) return;
                      try { host.focus({ preventScroll: true }); } catch { try { host.focus(); } catch {} }
                      try {
                        const range = document.createRange();
                        range.selectNodeContents(host);
                        const selection = window.getSelection();
                        if (selection !== null) {
                          selection.removeAllRanges();
                          selection.addRange(range);
                        }
                      } catch {}
                    });
                  }
                  return;
                }
                repairGuardSoon();
              };
              // Flush a reclaim that was deferred for a live composition. The
              // retirement is done here rather than left to the document-wide
              // tracker so this cannot depend on listener registration order.
              const guardOnCompositionEnd = (event) => {
                const target = event.target;
                if (target !== null && target !== undefined && target.nodeType === 1) composingSince.delete(target);
                guardRoot();
              };
              document.addEventListener("focusin", guardOnPointer, true);
              document.addEventListener("pointerdown", guardOnPointer, true);
              document.addEventListener("beforeinput", guardOnTyping, true);
              document.addEventListener("keydown", guardOnTyping, true);
              document.addEventListener("compositionend", guardOnCompositionEnd, true);
              const dispose = () => {
                if (!alive) return;
                // ORDER MATTERS: Lexical REPLAYS a root listener with
                // (null, prevRoot) when it is unregistered, so clearing `alive`
                // first is what stops a disposal from re-pointing the shared
                // root at an element React is about to delete.
                alive = false;
                if (repairRaf !== 0) { try { cancelAnimationFrame(repairRaf); } catch {} repairRaf = 0; }
                if (deferredRepairRaf !== 0) { try { cancelAnimationFrame(deferredRepairRaf); } catch {} deferredRepairRaf = 0; }
                if (retireTimer !== 0) { try { clearTimeout(retireTimer); } catch {} retireTimer = 0; }
                document.removeEventListener("focusin", guardOnPointer, true);
                document.removeEventListener("pointerdown", guardOnPointer, true);
                document.removeEventListener("beforeinput", guardOnTyping, true);
                document.removeEventListener("keydown", guardOnTyping, true);
                document.removeEventListener("compositionend", guardOnCompositionEnd, true);
                try { if (typeof offGuard === "function") offGuard(); } catch {}
              };
              const retire = () => {
                // Pane close: do NOT dispose synchronously. The pane's own
                // unmount is still ahead of us and will call
                // editor.setRootElement(null); the guard has to survive that
                // to hand the root back to the stock composer, and only then
                // can it be retired.
                if (retireTimer !== 0) return;
                retireTimer = window.setTimeout(() => { retireTimer = 0; dispose(); }, 400);
              };
              const previousGuard = paneEditorGuards.get(sessionId);
              if (previousGuard !== undefined) {
                // useMemo re-runs when the session face changes identity; the
                // superseded guard must not keep listening. Safe to do at once:
                // `dispose` clears `alive` before unregistering, so the replay
                // is a no-op.
                try { previousGuard.dispose(); } catch {}
              }
              paneEditorGuards.set(sessionId, { editor: paneEditor, dispose, retire, repair: () => guardRoot(false) });
            }
            // remember the last pane the user actually typed into (focus
            // fallback target when no pane is focused)
            try {
              const stateStore = shell.state !== undefined && shell.state !== null && typeof shell.state.subscribe === "function" ? shell.state : shell;
              if (stateStore !== undefined && stateStore !== null && typeof stateStore.subscribe === "function") {
                let lastDraft = null;
                try {
                  const snap = typeof stateStore.getSnapshot === "function" ? stateStore.getSnapshot() : null;
                  if (snap !== null && snap !== undefined && snap.draft !== undefined) lastDraft = snap.draft;
                } catch {}
                const unsubTyping = stateStore.subscribe(() => {
                  try {
                    const snap = typeof stateStore.getSnapshot === "function" ? stateStore.getSnapshot() : null;
                    const draft = snap !== null && snap !== undefined ? snap.draft : undefined;
                    if (typeof draft === "string" && draft !== lastDraft) {
                      lastDraft = draft;
                      if (draft !== "") rememberTypedSession(sessionId);
                    }
                  } catch {}
                });
                const previousTypingUnsub = paneTypingUnsubs.get(sessionId);
                if (previousTypingUnsub !== undefined) {
                  // A rebuilt prepared bundle installs a fresh typing
                  // subscription; the superseded one must not stay behind (the
                  // old code just overwrote the map entry and leaked it).
                  try { previousTypingUnsub(); } catch {}
                  paneTypingUnsubs.delete(sessionId);
                }
                if (typeof unsubTyping === "function") paneTypingUnsubs.set(sessionId, unsubTyping);
              }
            } catch {}
            composer = {
              bar,
              face,
              useInput,
              inputActions,
              // The bar entry's own store pair (stock standardKit supplies
              // useStore/actions when the registration declares a store).
              storeProps: entryStoreProps(bar, sessionId, bundle.scopeKey),
              // synchronous snapshot read for non-React guards (the pane's
              // last-resort Enter path in ChatPane) — the same store useInput
              // subscribes to
              readInput: () => {
                try { return typeof inputSource.getSnapshot === "function" ? inputSource.getSnapshot() : null; } catch { return null; }
              },
              useNotices: makeUseStoreFace(face.hooks !== undefined ? face.hooks.notices : undefined, null),
              useLexicon: makeUseStoreFace(face.hooks !== undefined ? face.hooks.lexicon : undefined, new Map()),
              useMenuLauncher: makeUseStoreFace(face.hooks !== undefined ? face.hooks.menuLauncher : undefined, null),
              renderSlot: (name, owner, options) => {
                if (name === "conversation.input.model" || name === "conversation.input.plan" || name === "conversation.input.attachments") {
                  const parts = findEntry(name);
                  if (parts === null) return null;
                  let seatInject = null;
                  try {
                    const injectFn = parts.raw.inject !== undefined ? parts.raw.inject : parts.options.inject;
                    if (typeof injectFn === "function") seatInject = injectFaceProps(injectFn(sessionId));
                  } catch {}
                  // Stock parity: the entry's own store pair rides the props
                  // too when it declares one (the kit otherwise supplies only
                  // the pane's standard faces).
                  const seatStore = entryStoreProps(parts, sessionId, bundle.scopeKey);
                  const props = kitProps(kit, {
                    locked: false,
                    inputActions,
                    ...(seatInject !== null && seatInject !== undefined ? seatInject : {}),
                    ...seatStore,
                  });
                  const seatT = entryTranslate(parts.raw);
                  if (seatT !== undefined) props.t = seatT;
                  if (owner !== undefined && owner !== null) {
                    for (const key of Object.keys(owner)) props[key] = owner[key];
                  }
                  return h(PaneBoundary, { fallback: null, slotKey: name }, h(parts.component, props));
                }
                return renderers.renderSlot(name, owner, options);
              },
            };
          }
        }
      }

      // header strip: the stock breadcrumb title, view tabs, and action row
      const header = findEntry("conversation.session.header");
      let headerFace = null;
      let headerInjected = null;
      if (header !== null) {
        try {
          const injectFn = header.raw.inject !== undefined ? header.raw.inject : header.options.inject;
          if (typeof injectFn === "function") {
            headerFace = injectFn(sessionId, store.actions);
            headerInjected = injectFaceProps(headerFace);
          }
        } catch (error) {
          console.warn("[dsh-split-workspace] header inject failed:", String(error).slice(0, 140));
          headerFace = null;
          headerInjected = null;
        }
      }

      // every registered view tab (chat, trajectory, context, …) with its
      // per-pane injected props, so tabs switch inside the pane.
      // The roster comes from the SLOT LEDGER, not from the header face:
      // 0.1.5's header inject carries `conversationViews` (a hook) and no
      // `.views` array at all, so gating this capture on `headerFace.views`
      // left `viewEntries` permanently empty — the header could list Chat /
      // Trajectory / Context while the pane always fell back to the chat view.
      const viewLedger = headerFace !== null && headerFace !== undefined && headerFace.views !== undefined
        ? headerFace.views
        : null;
      const viewEntries = [];
      for (const entry of capturedEntries("conversation.view")) {
        const parts = entryParts(entry);
        if (parts === null) continue;
        let injected = null;
        try {
          const injectFn = parts.raw.inject !== undefined ? parts.raw.inject : parts.options.inject;
          if (typeof injectFn === "function") injected = injectFaceProps(injectFn(sessionId, store.actions));
        } catch {}
        viewEntries.push({
          id: parts.options !== null && parts.options !== undefined ? (parts.options.id ?? parts.options.key ?? null) : null,
          parts,
          injected,
          t: entryTranslate(entry),
        });
      }

      paneDebug.last = {
        sessionId,
        scopeKey: bundle.scopeKey,
        rootFaces: Object.keys(rootFaces ?? {}),
        standardFaces: Object.keys(bundle.standard ?? {}),
        kitFaces: Object.keys(kit),
        view: view === null ? null : String(view.options?.id ?? view.options?.key ?? view.component?.name ?? "?"),
        composer: composer === null ? null : true,
        header: header === null ? null : true,
        viewEntries: viewEntries.length,
      };

      return { kit, standard: bundle.standard, scopeKey: bundle.scopeKey, renderers, store, view, transcriptInjected, composer, header, headerInjected, viewLedger, viewEntries };
    }
    /** Shared extra props for re-hosted view components. Injected faces come
        first; the pane-scoped store/render dispatchers always win so every
        view (chat, trajectory, …) routes into this pane's captured ledger. */
    function viewExtras(prepared, session, injected, storeProps) {
      const extra = {
        ...(injected !== null && injected !== undefined ? injected : {}),
        useStore: prepared.store.useStore,
        actions: prepared.store.actions,
        renderSlot: prepared.renderers.renderSlot,
        // Declared-children parity (stock standardKit attaches this when any
        // child kind is "chain"); a re-hosted view that dispatches a chain slot
        // threw "renderSlotChain is not a function" without it.
        renderSlotChain: prepared.renderers.renderSlotChain,
      };
      // 0.1.5: a view entry that declares its own store (ChatView → the chat
      // store) must read THAT store; the pane store backs only the plugin's
      // own tab/inspect currency.
      if (storeProps !== undefined && storeProps !== null && storeProps.useStore !== undefined) {
        extra.useStore = storeProps.useStore;
        extra.actions = storeProps.actions !== undefined ? storeProps.actions : extra.actions;
      }
      if (extra.loadOlder === undefined) extra.loadOlder = () => { try { session.loadOlder(); } catch {} };
      // per-session scroll memory (mirrors the shell's chatScrollPositions map)
      if (extra.chatScroll === undefined) {
        extra.chatScroll = {
          save: (position) => {
            try { rememberChatScroll(prepared.kit.sessionId, position); } catch {}
          },
          read: () => {
            try {
              const position = chatScrollMemory.get(prepared.kit.sessionId);
              return position !== undefined ? position : null;
            } catch { return null; }
          },
        };
      }
      if (extra.fileMentions === undefined) extra.fileMentions = () => undefined;
      // route inspect into the trajectory tab exactly like the stock shell does
      if (extra.inspectCall === undefined) extra.inspectCall = (callId) => {
        try {
          prepared.store.actions.setInspect({ callId });
          prepared.store.actions.setView("trajectory");
        } catch {}
      };
      if (extra.forkAt === undefined) extra.forkAt = () => {};
      if (extra.openFile === undefined) extra.openFile = () => Promise.resolve(null);
      if (extra.loadImage === undefined) extra.loadImage = () => Promise.resolve(null);
      // Required props of the stock ChatView (0.2.0 AND 0.2.1 destructure them
      // unconditionally): the plugin never supplied them, so an in-pane
      // "load through" / external-link click threw into the pane boundary and
      // blanked the transcript. Degrade safely; only when the captured kit does
      // not already carry a real implementation.
      if (extra.loadThrough === undefined && prepared.kit.loadThrough === undefined) {
        extra.loadThrough = () => Promise.resolve();
      }
      if (extra.openExternalLink === undefined && prepared.kit.openExternalLink === undefined) {
        extra.openExternalLink = (url) => {
          try { window.open(url, "_blank", "noopener,noreferrer"); } catch {}
        };
      }
      return extra;
    }

    function NativeTranscript({ prepared, session, fallback }) {
      const view = prepared.view;
      if (view === null || view === undefined) return fallback;
      const injected = prepared.transcriptInjected;
      const props = kitProps(prepared.kit, viewExtras(prepared, session, injected, entryStoreProps(view, prepared.kit.sessionId, prepared.scopeKey)));
      const viewT = entryTranslate(view.raw);
      if (viewT !== undefined) props.t = viewT;
      return h(PaneBoundary, { fallback }, h(view.component, props));
    }

    /** The stock session header per pane: breadcrumb title, view tabs
        (chat / trajectory / …), and the action row — fully traceable. */
    function NativeHeader({ prepared }) {
      const header = prepared.header;
      if (header === null || header === undefined) return null;
      const injected = prepared.headerInjected;
      if (injected === null || injected === undefined) return null;
      const props = kitProps(prepared.kit, {
        ...injected,
        // the header's OWN view state lives in the pane store: its injected
        // selectView writes through the actions this pane handed the face, so
        // useStore must read the same store. Nested header entries (the
        // utilities/actions rows) get their own entry stores via the
        // renderSlot dispatcher.
        useStore: prepared.store.useStore,
        actions: prepared.store.actions,
        renderSlot: prepared.renderers.renderSlot,
        renderSlotChain: prepared.renderers.renderSlotChain,
      });
      const headerT = entryTranslate(header.raw);
      if (headerT !== undefined) props.t = headerT;
      return h(PaneBoundary, { fallback: null }, h(header.component, props));
    }

    /** Renders the pane's ACTIVE view (tab) with the same ledger the stock
        header tabs write into — so switching tabs re-renders in the pane. */
    const NOOP_SUBSCRIBE = () => () => {};

    /** RULES OF HOOKS (M1): this component deliberately calls ZERO hooks. The
        old implementation called useSyncExternalStore/useStore AFTER early
        returns, and `prepared` is rebuilt when root faces/session identity
        change — a rebuild could flip those branches and throw "Rendered
        more/fewer hooks than expected". The closest boundary was the
        workspace-wide one, so a hook-order throw unmounted EVERY pane; with a
        persisted tree that made a boot crash loop. All hook state now lives in
        NativeViewTabs (a separate component type that only appears when there
        is a tab roster), so the branch decision costs no hook order at all. */
    function NativeViewArea({ prepared, session, fallback }) {
      const ledger = prepared.viewLedger;
      // dsh 0.1.5: the header face no longer carries a `.views` ledger — the
      // tab roster rides the standard session hook `conversationViews`
      // (injectFaceProps materialized it onto headerInjected as
      // useConversationViews). Without it the pane could never switch views.
      const viewsHook = prepared.headerInjected !== null && prepared.headerInjected !== undefined && typeof prepared.headerInjected.useConversationViews === "function"
        ? prepared.headerInjected.useConversationViews
        : null;
      if ((ledger === null || ledger === undefined) && viewsHook === null) {
        return h(NativeTranscript, { prepared, session, fallback });
      }
      if (prepared.viewEntries.length === 0) {
        return h(NativeTranscript, { prepared, session, fallback });
      }
      return h(NativeViewTabs, {
        prepared,
        session,
        fallback,
        ledger: ledger === undefined ? null : ledger,
        viewsHook,
      });
    }

    /** Hooky half of the pane view area. Its hook list is FIXED for the
        component's lifetime (one ledger subscription callback pair + two store
        hooks), so nothing downstream of a `prepared` rebuild can change it. */
    function NativeViewTabs({ prepared, session, fallback, ledger, viewsHook }) {
      const ledgerReadable = ledger !== null && ledger !== undefined && typeof ledger.subscribe === "function";
      const subscribeLedger = React.useCallback(
        (notify) => (ledgerReadable ? ledger.subscribe(notify) : NOOP_SUBSCRIBE()),
        [ledger, ledgerReadable],
      );
      const readLedgerVersion = React.useCallback(() => {
        if (ledger === null || ledger === undefined) return null;
        try { return typeof ledger.version === "function" ? ledger.version() : ledger.version; } catch { return null; }
      }, [ledger]);
      React.useSyncExternalStore(subscribeLedger, readLedgerVersion);
      const currentView = prepared.store.useStore((s) => (s !== null && s !== undefined ? s.view : null));
      // Always called (never behind `props.inspect === undefined`): the old
      // conditional call was the second Rules-of-Hooks violation here.
      const paneInspect = prepared.store.useStore((s) => (s !== null && s !== undefined ? s.inspect : null));
      let tabs = [];
      if (ledger !== null && ledger !== undefined) {
        try {
          tabs = ledger.list() || [];
        } catch {
          tabs = [];
        }
      } else {
        try {
          tabs = viewsHook((value) => value) || [];
        } catch {
          tabs = [];
        }
      }
      if (!Array.isArray(tabs)) tabs = [];
      let activeId = null;
      if (typeof currentView === "string" && tabs.some((tab) => tab !== null && tab !== undefined && tab.id === currentView)) {
        activeId = currentView;
      }
      if (activeId === null) {
        const chatTab = tabs.find((tab) => tab !== null && tab !== undefined && tab.id === "chat");
        activeId = chatTab !== undefined ? chatTab.id : (tabs.length > 0 && tabs[0] !== null && tabs[0] !== undefined ? tabs[0].id : "chat");
      }
      let found = prepared.viewEntries.find((ve) => ve.id === activeId);
      if (found === undefined) {
        // a tab the header offered has no ledger entry: say so once instead of
        // silently rendering the chat view under another tab's selection
        const key = "view:" + String(activeId);
        if (captureLog[key] !== true) {
          captureLog[key] = true;
          console.warn("[dsh-split-workspace] view '" + String(activeId) + "' is not in the pane's view ledger (have: "
            + prepared.viewEntries.map((ve) => String(ve.id)).join(",") + ") — falling back to chat");
        }
        found = prepared.viewEntries.find((ve) => ve.id === "chat");
      }
      if (found === undefined) return h(NativeTranscript, { prepared, session, fallback });
      const props = kitProps(prepared.kit, viewExtras(prepared, session, found.injected, entryStoreProps(found.parts, prepared.kit.sessionId, prepared.scopeKey)));
      // ConvViewProps carry the inspect selection + its dismissal — views like
      // trajectory render their detail panes through them
      if (props.inspect === undefined) {
        props.inspect = paneInspect;
        props.onInspectDone = () => {
          try { prepared.store.actions.setInspect(null); } catch {}
        };
      }
      if (found.t !== undefined) props.t = found.t;
      return h(PaneBoundary, { fallback: found.id === "chat" ? fallback : null }, h(found.parts.component, props));
    }

    // ---------------------------------------------------------------------
    // active-composer pane store (input-enhancement plugin scoping)
    //
    // Some input plugins (dsh-prompt-history) are page singletons: their
    // prediction overlay is one module-level DOM node and every mounted
    // composer instance shares it. With one instance per pane, arrow keys and
    // Tab were handled by every instance, and the single ghost stayed glued to
    // whichever pane painted it last. These plugins are therefore mounted only
    // in the ACTIVE pane; the store below tells each pane's composer whether
    // it is the active one and re-renders the right-hand slot when focus moves.
    // ---------------------------------------------------------------------
    const GLOBAL_COMPOSER_ENTRY_IDS = ["dsh-prompt-history", "dsh-prompt-for-me"];
    /** sessionId -> the pane composer's inputActions (active pane only). */
    const composerActionsBySession = new Map();
    let activeComposerPaneId = null;
    const activeComposerPaneListeners = new Set();
    function getActiveComposerPaneId() { return activeComposerPaneId; }
    function subscribeActiveComposerPane(listener) {
      activeComposerPaneListeners.add(listener);
      return () => { activeComposerPaneListeners.delete(listener); };
    }
    function setActiveComposerPaneId(id) {
      const next = typeof id === "string" && id !== "" ? id : null;
      if (activeComposerPaneId === next) return;
      activeComposerPaneId = next;
      for (const listener of [...activeComposerPaneListeners]) {
        try { listener(); } catch {}
      }
    }
    function useActiveComposerPaneId() {
      if (typeof React.useSyncExternalStore === "function") {
        return React.useSyncExternalStore(subscribeActiveComposerPane, getActiveComposerPaneId, getActiveComposerPaneId);
      }
      return activeComposerPaneId;
    }

    /** Revert draft writes that land in an INACTIVE pane. Page-singleton input
        plugins (and the hidden stock page's copy) call their own
        inputActions.setDraft when the user presses ↑/↓/Tab in any composer;
        with several panes mounted that wrote the same history line into every
        conversation. Legitimate edits always make their pane active first
        (focusin/pointerdown), so an inactive draft change is an external
        write; restore the last value the pane owned. */
    function ComposerDraftGuard({ composer, active }) {
      const draft = composer.useInput((state) => (state !== null && state !== undefined ? state.draft : ""));
      const last = React.useRef(draft);
      React.useEffect(() => {
        if (active === true) { last.current = draft; return; }
        if (draft === last.current) return;
        const restore = last.current;
        last.current = restore;
        try { composer.inputActions.setDraft(restore); } catch {}
      }, [draft, active, composer]);
      return null;
    }

    function NativeComposer({ prepared, session, fallback, sessionId: composerSessionId }) {
      const activeComposerPane = useActiveComposerPaneId();
      // null = the bridge has not measured a pane yet: keep every entry so a
      // first render never drops chrome. Once a pane is active, only it may
      // mount page-singleton input plugins.
      const composerIsActive = activeComposerPane === null || activeComposerPane === composerSessionId;
      const composer = prepared.composer;
      // the stock zone carries the input machine STATE snapshot (with
      // .occurrences) — dock entries like the vision toolkit's paste dock
      // read props.input.occurrences and crash on the raw shell
      const inputState = composer === null || composer === undefined
        ? null
        : composer.useInput((s) => (s !== null && s !== undefined ? s : null));
      if (composer === null || composer === undefined) return fallback;
      const draftGuard = h(ComposerDraftGuard, { composer, active: composerIsActive });
      if (composerIsActive && composerSessionId !== undefined) {
        composerActionsBySession.set(composerSessionId, composer.inputActions);
      }
      // the stock page renders left/right/dock/overlay entries with a zone
      // owner ({ session, input }) — mirror it so entries keyed on the session
      // (cost line, context meter, attachment rail) bind to THIS pane
      const zone = {
        session,
        input: inputState !== null && inputState !== undefined
          ? inputState
          : (composer.face.keyboard !== undefined ? composer.face.keyboard : composer.face),
      };
      const dockEntries = prepared.renderers.renderList("conversation.composer.dock", zone);
      const props = kitProps(prepared.kit, {
        // The bar entry's own store pair, stock order: kit -> store -> inject.
        ...(composer.storeProps !== undefined && composer.storeProps !== null ? composer.storeProps : {}),
        // forward the WHOLE injected face, hooks materialized to use<Name>
        // props the way the slots runtime does — 0.1.5's InputBar reads
        // useBusyEnter/useFileUploads/useNotices off the face's hooks block.
        // Any prop the stock InputBar expects that the explicit whitelist
        // below does not know about still lands.
        ...injectFaceProps(composer.face),
        useInput: composer.useInput,
        inputActions: composer.inputActions,
        keyboard: composer.face.keyboard,
        addImages: composer.face.addImages,
        removeImage: composer.face.removeImage,
        draftImages: composer.face.draftImages,
        resolveSubmitMode: composer.face.resolveSubmitMode,
        toggleCommandMenu: composer.face.toggleCommandMenu,
        stop: composer.face.stop,
        command: composer.face.command,
        renderSlot: composer.renderSlot,
        renderSlotChain: prepared.renderers.renderSlotChain,
        renderFactorySlot: prepared.kit.renderFactorySlot,
        useNotices: composer.useNotices,
        useLexicon: composer.useLexicon,
        useMenuLauncher: composer.useMenuLauncher,
        variant: "composer",
        leftItems: prepared.renderers.renderList("conversation.input.left", zone),
        rightItems: prepared.renderers.renderList(
          "conversation.input.right",
          zone,
          composerIsActive ? undefined : { skipEntryIds: GLOBAL_COMPOSER_ENTRY_IDS },
        ),
        footer: h(DockLine, { entries: dockEntries }),
        overlay: prepared.renderers.renderList("conversation.input.overlay", zone),
      });
      // the stock composition renders the conversation.input.dock strips
      // (plan/todo, queue) ABOVE the bar — re-host them too, or panes lose them
      const dock = prepared.renderers.renderList("conversation.input.dock", zone);
      // The queue strip merges INTO the composer card natively (top-rounded
      // panel tucked under the card's top edge), which the one-line dock box
      // (draggable overflow + 60px-right text alignment) structurally breaks
      // — queue buttons (edit / remove / send-now) ended up clipped off the
      // draggable row's right edge and the strip sat misaligned. Queue
      // entries therefore render in their own native-geometry wrapper below,
      // and only the remaining strips stay in the dock line.
      // Identifying the queue entry is NOT about the data-queue-dock DOM
      // attribute: QueueDock paints that on its own root node, so it never
      // reaches this React element. What renderList DOES stamp onto the
      // element props is data-slot-id (the registrant's slot id); the stock
      // dock registrations are "todo" (order 0) and "queue" (order 20), and
      // the component itself is the exported QueueDock. renderList also wraps
      // every entry in a PaneBoundary element, so the component and its props
      // live one level down. Collect EVERY signal and accept a match on any
      // of them — a wrong-but-present data-slot-id must not mask the others.
      const isQueueEntry = (el) => {
        if (el === null || el === undefined || typeof el !== "object") return false;
        const props = el.props;
        if (props === null || props === undefined) return false;
        const child = props.children;
        const childProps = child !== null && child !== undefined && typeof child === "object" ? child.props : null;
        const component = child !== null && child !== undefined && typeof child === "object" ? child.type : null;
        const name = component !== null && component !== undefined ? (component.displayName || component.name) : null;
        const signals = [
          props["data-slot-id"],
          props["data-queue-dock"] !== undefined ? "queue" : null,
          childProps !== null && childProps !== undefined ? childProps["data-slot-id"] : null,
          childProps !== null && childProps !== undefined && childProps["data-queue-dock"] !== undefined ? "queue" : null,
          typeof name === "string" ? name : null,
        ];
        for (const signal of signals) {
          if (typeof signal !== "string") continue;
          if (signal === "queue" || signal.indexOf("QueueDock") !== -1) return true;
        }
        return false;
      };
      const queueEntries = [];
      const otherEntries = [];
      for (const el of dock) {
        if (isQueueEntry(el)) queueEntries.push(el);
        else otherEntries.push(el);
      }
      return h(PaneBoundary, { fallback }, h(React.Fragment, null,
        draftGuard,
        otherEntries.length > 0 ? h(DsvInputDock, null, h(DockLine, { entries: otherEntries })) : null,
        queueEntries.length > 0 ? h("div", { className: "dsv-queue-strip" }, queueEntries) : null,
        h(composer.bar.component, props),
      ));
    }

    /** Composer-mode toggle glyph: terminal (go TUI) vs maximize (go full). */
    function ComposerModeIcon({ tui }) {
      return tui === true
        ? h("svg", { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
            h("polyline", { points: "15 3 21 3 21 9" }),
            h("polyline", { points: "9 21 3 21 3 15" }),
            h("line", { x1: 21, y1: 3, x2: 14, y2: 10 }),
            h("line", { x1: 3, y1: 21, x2: 10, y2: 14 }))
        : h("svg", { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
            h("polyline", { points: "4 17 10 11 4 5" }),
            h("line", { x1: 12, y1: 19, x2: 20, y2: 19 }));
    }

    /** Queued-message / todo / plan strips (conversation.input.dock): the
        stock entries carry DIFFERENT width formulas (queue is card−16,
        todo is card−32), so they never line up with each other or with the
        input box. Pin the strip zone to the exact measured card box and
        neutralize each entry's horizontal metrics — every strip is then
        exactly as wide as the chat box above it. */
    /** The widest VISIBLE composer box (native card / TUI line) inside a
        scope. Transient or hidden seats can precede the real card in
        document order with a zero rect, so skip anything tiny — and only
        accept boxes that actually CONTAIN a textarea (the live input), so
        card-shaped decorations can never win the measurement. */
    function visibleComposerRect(scope) {
      let best = null;
      const nodes = scope.querySelectorAll("[data-composer-card], [data-dsv-composer-card], .dsv-tui");
      for (const node of nodes) {
        // dsh 0.1.5 renders the composer as a Lexical contenteditable, so a
        // textarea-only probe never matches the real card and every derived
        // width (queue strip, dock row) silently fell back to the full pane.
        // Accept the real input marker too — the same predicate `hasEditor`
        // uses for the geometry measurement.
        if (node.querySelector("textarea") === null && node.querySelector("[data-composer-input]") === null) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 12) continue;
        if (best === null || rect.width > best.width) best = rect;
      }
      return best;
    }

    /** Pin a row's left edge and width to the LIVE composer box, measured
        relative to the row's OWN wrapper — the footer/dock containers have
        their own offset, so pane-relative coordinates land shifted.
        Negative margins are required and valid: the wrapper can start
        right of the card's left edge. Writes only changed values: style
        writes would otherwise retrigger the subtree MutationObserver into
        an rAF-loop. */
    function useComposerAlignedRow(rowRef, leftBuffer, rightInset) {
      const performanceMode = useRuntime().performance === true;
      React.useLayoutEffect(() => {
        const row = rowRef.current;
        if (row === null) return;
        const pane = row.closest("[data-dsv-pane]");
        if (pane === null) return;
        let raf = 0;
        let applied = "";
        let stableCount = 0;
        // Re-apply briefly after mount/switch (mode flips and late-mounted
        // bars produce transient layouts), but BOUNDED: ~12 frames with an
        // early exit once the same geometry lands twice in a row. The old
        // fixed 90-tick loop kept measuring (forced layout per tick) for
        // ~1.5s on EVERY dock line of EVERY pane — pure cost once the layout
        // had already settled.
        const SETTLE_TICKS = 12;
        let settleTicks = SETTLE_TICKS;
        const apply = () => {
          const best = visibleComposerRect(pane);
          if (best === null) return;
          // Do not re-lay-out the composer's surroundings under a live IME:
          // the browser paints the composition underline at a cached position
          // and a shifted box can strand it there. The observer fires again on
          // the DOM churn the commit causes, so the alignment catches up.
          if (composingIn(pane)) return;
          const rowRect = row.getBoundingClientRect();
          const cs = getComputedStyle(row);
          const baseLeft = rowRect.left - (parseFloat(cs.marginLeft) || 0);
          const left = Math.round(best.left - baseLeft) + leftBuffer;
          const width = Math.max(120, Math.round(best.width) - leftBuffer - rightInset);
          const sig = left + "/" + width;
          if (sig === applied) {
            stableCount += 1;
            return;
          }
          stableCount = 0;
          applied = sig;
          row.style.marginLeft = left + "px";
          row.style.width = width + "px";
          row.style.maxWidth = "none";
        };
        const tick = () => {
          if (inLiveReflow(pane)) { settleTicks = 0; raf = 0; return; }
          apply();
          if (stableCount >= 2) { settleTicks = 0; raf = 0; return; }
          if (settleTicks > 0) { settleTicks -= 1; raf = requestAnimationFrame(tick); }
          else raf = 0;
        };
        const schedule = () => {
          if (raf === 0) raf = requestAnimationFrame(tick);
        };
        apply();
        if (typeof ResizeObserver !== "function") return;
        const observer = new ResizeObserver(schedule);
        observer.observe(pane);
        let mutation = null;
        if (!performanceMode && typeof MutationObserver === "function") {
          mutation = new MutationObserver(schedule);
          mutation.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-composer-card", "data-dsv-composer-card"] });
        }
        const perfTimer = performanceMode ? window.setInterval(schedule, 1500) : 0;
        raf = requestAnimationFrame(tick);
        return () => {
          if (raf !== 0) cancelAnimationFrame(raf);
          observer.disconnect();
          if (mutation !== null) mutation.disconnect();
          if (perfTimer !== 0) window.clearInterval(perfTimer);
        };
      }, [leftBuffer, rightInset, performanceMode]);
    }

    function DsvInputDock({ children }) {
      const ref = React.useRef(null);
      useComposerAlignedRow(ref, 0, 0);
      return h("div", { ref, className: "dsv-input-dock" }, children);
    }

    /** Fixed one-line dock: a limited text area mirroring the chat box, left
        aligned. Cells are never hidden or shrunk — when they overflow, the
        row becomes draggable and panning reveals the clipped right side
        (the area itself never changes size). Drag skips real controls so
        their clicks keep working. */
    function DockLine({ entries }) {
      const rowRef = React.useRef(null);
      const innerRef = React.useRef(null);
      const [overflown, setOverflown] = React.useState(false);
      useComposerAlignedRow(rowRef, 4, 60);
      React.useEffect(() => {
        const row = rowRef.current;
        const inner = innerRef.current;
        if (row === null || inner === null || typeof ResizeObserver !== "function") return;
        const measure = () => {
          if (inLiveReflow(row)) return;
          setOverflown(row.scrollWidth > row.clientWidth + 1);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        observer.observe(inner);
        return () => observer.disconnect();
        // `entries`, not `entries.length`: the cells re-render with new text
        // (a growing tok/s or token count) without changing the cell COUNT, and
        // the overflow flag has to follow that or a longer value stays clipped
        // behind the row's `overflow: hidden` with no pan affordance.
      }, [entries]);
      const onRowMouseDown = (event) => {
        if (event.button !== 0) return;
        const row = rowRef.current;
        if (row === null || row.scrollWidth <= row.clientWidth + 1) return;
        const target = event.target;
        if (target !== null && target !== undefined && typeof target.closest === "function" && target.closest("button, a, input, textarea, select") !== null) return;
        // Do NOT preventDefault on mousedown. It cancels the browser's focus
        // move for the whole click, so any press landing on this row (the
        // stats line / a cost-meter dock entry makes it long enough to
        // overflow) used to leave the composer unfocused — "cannot click
        // into the input". The drag now engages only after real movement;
        // until then the click behaves like a normal click.
        const startX = event.clientX;
        const startLeft = row.scrollLeft;
        let engaged = false;
        const onMove = (e) => {
          const dx = e.clientX - startX;
          if (!engaged) {
            if (Math.abs(dx) < 3) return;
            engaged = true;
            row.classList.add("dragging");
            try { window.getSelection().removeAllRanges(); } catch {}
          }
          row.scrollLeft = startLeft - dx;
        };
        const onUp = () => {
          if (engaged) row.classList.remove("dragging");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      };
      return h("div", { ref: rowRef, className: "dsv-dock-line" + (overflown ? " overflown" : ""), onMouseDown: onRowMouseDown },
        h("div", { ref: innerRef, className: "dsv-dock-inner" },
          entries.map((el, index) => h("div", { key: index, className: "dsv-dock-cell" }, el)),
        ),
      );
    }

    /** Minimal terminal-style composer wired to the pane's REAL input machine:
        same draft, same submit path (images/slash/mode semantics included).
        Pasted / dropped images ride the same draft as in full mode — the
        native attachments strip renders above the line so they stay
        visible (and removable) instead of silently sitting in the draft. */
    /** Queued-messages badge for TUI mode: the stock dock strip is part of
        the full composer, so TUI panes had NO sign of queued sends. One dim
        monospace line under the block's top rule — a glyph, the count in
        brand color, the first queued message as a truncated preview, and the
        full list in the tooltip. Steering sends are excluded: the native
        transcript already renders those as pending bubbles. */
    function TuiQueueLine({ useSession }) {
      const queue = useSession((s) => (s !== null && s !== undefined && Array.isArray(s.queue) ? s.queue : []));
      const items = [];
      for (const item of queue) {
        if (item !== null && item !== undefined && item.placement !== "steering") items.push(item);
      }
      if (items.length === 0) return null;
      const textOf = (item) => {
        const content = item !== null && item !== undefined ? item.content : null;
        return typeof content === "string" ? content : blockText(content);
      };
      const first = firstLine(textOf(items[0]), 48).trim();
      const all = items.map((item, i) => String(i + 1) + ". " + firstLine(textOf(item), 120)).join("\n");
      return h("div", { className: "dsv-tui-queue", title: all },
        h("span", { className: "dsv-tui-queue-glyph" }, "\u2261"),
        h("span", { className: "dsv-tui-queue-count" }, String(items.length) + " " + t("queuedBadge")),
        first !== "" ? h("span", { className: "dsv-tui-queue-preview" }, first) : null,
      );
    }

    function TuiMachineComposer({ prepared, running, toggle, useSession }) {
      const composer = prepared.composer;
      const draft = composer.useInput((s) => (s !== null && s !== undefined && s.draft !== undefined ? s.draft : ""));
      // dsh 0.1.5 input state carries `attachmentIds` (images AND files);
      // the 0.1.4 face exposed `imageIds` — read both, prefer the live one.
      const attachmentIds = composer.useInput((s) => {
        if (s === null || s === undefined) return [];
        if (Array.isArray(s.attachmentIds)) return s.attachmentIds;
        if (Array.isArray(s.imageIds)) return s.imageIds;
        return [];
      });
      const attachments = React.useMemo(() => {
        const face = composer.face;
        if (attachmentIds.length === 0 || face === null || face === undefined) return [];
        try {
          if (typeof face.resolveDraftAttachments === "function") {
            const list = face.resolveDraftAttachments(attachmentIds);
            return Array.isArray(list) ? list : [];
          }
        } catch {}
        try {
          if (typeof face.draftImages === "function") {
            const list = face.draftImages(attachmentIds);
            return Array.isArray(list) ? list : [];
          }
        } catch {}
        return [];
      }, [attachmentIds, composer.face]);
      const inputRef = React.useRef(null);
      React.useLayoutEffect(() => {
        const el = inputRef.current;
        if (el === null) return;
        el.style.height = "auto";
        el.style.height = Math.min(Math.max(el.scrollHeight, 18), 96) + "px";
      }, [draft]);
      const submit = () => { try { composer.inputActions.submit(); } catch {} };
      const onKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        }
      };
      const attachStrip = attachments.length > 0
        ? h("div", { className: "dsv-tui-attach" },
            composer.renderSlot("conversation.input.attachments", {
              attachments,
              canAcceptDrop: true,
              // 0.1.5 seat props (onAddFiles / onRemoveAttachment) with the
              // 0.1.4 names kept for older faces — the seat renders whichever
              // callbacks its generation knows
              onAddFiles: (files) => {
                const face = composer.face;
                try {
                  if (face !== null && face !== undefined && typeof face.addFiles === "function") { face.addFiles(files); return; }
                  if (face !== null && face !== undefined && typeof face.addImages === "function") face.addImages(files);
                } catch {}
              },
              onRemoveAttachment: (id) => {
                const face = composer.face;
                try {
                  if (face !== null && face !== undefined && typeof face.removeAttachment === "function") { face.removeAttachment(id); return; }
                  if (face !== null && face !== undefined && typeof face.removeImage === "function") face.removeImage(id);
                } catch {}
              },
              onAddImages: (files) => { try { composer.face.addImages(files); } catch {} },
              onRemoveImage: (id) => { try { composer.face.removeImage(id); } catch {} },
            }),
          )
        : null;
      return h(React.Fragment, null, attachStrip,
        h("div", { className: "dsv-tui-block" },
          h(TuiQueueLine, { useSession }),
          h("div", { className: "dsv-tui" },
        h("span", { className: "dsv-tui-prompt" }, "›"),
        h("textarea", {
          ref: inputRef, rows: 1, className: "dsv-tui-input", value: draft,
          placeholder: t("composerPlaceholder"), "aria-label": t("composerPlaceholder"),
          "data-dsv-tui-input": "true",
          spellCheck: false,
          onChange: (event) => { try { composer.inputActions.setDraft(event.target.value); } catch {} },
          onKeyDown,
        }),
        // stock primary-button semantics (primaryStops): while running, Stop
        // owns the key only when the draft is empty — a non-empty draft keeps
        // the send key, which delivers through submit()'s queue placement
        (running && String(draft).trim() === "")
          ? h("button", { type: "button", className: "dsv-tui-btn", title: t("stop"), "aria-label": t("stop"), onClick: () => { try { composer.face.stop(); } catch {} } }, h(PrimIcon, { prim: "IconStopFill16" }))
          : h("button", { type: "button", className: "dsv-tui-btn", title: t("send"), "aria-label": t("send"), disabled: String(draft).trim() === "", onClick: submit }, h(PrimIcon, { prim: "IconSendOutline14" })),
        toggle,
      )));
    }

    /** Plain fallback TUI composer (no native face captured): local draft over
        session.prompt / session.command. */
    function TuiPlainComposer({ sessionId, session, running, toggle, useSession }) {
      const [draft, setDraft] = React.useState("");
      const submit = () => {
        const text = draft.trim();
        // running must NOT gate the submit: stock semantics deliver the draft
        // with placement "queue" and the host resolves it — a plain send when
        // idle, a queued item when the agent is busy. Refusing here made
        // Enter dead exactly while a pane's session was running.
        if (text === "") return;
        try {
          const result = text.startsWith("/") ? session.command(text) : session.prompt([{ type: "text", text }], "queue");
          if (result !== undefined && result !== null && typeof result.then === "function") result.catch(() => {});
          setDraft("");
        } catch {}
      };
      const onKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
      };
      return h(React.Fragment, null,
        h("div", { className: "dsv-tui-block" },
          h(TuiQueueLine, { useSession }),
          h("div", { className: "dsv-tui" },
        h("span", { className: "dsv-tui-prompt" }, "›"),
        h("textarea", { rows: 1, className: "dsv-tui-input", value: draft, placeholder: t("composerPlaceholder"), "aria-label": t("composerPlaceholder"), "data-dsv-tui-input": "true", spellCheck: false, onChange: (event) => setDraft(event.target.value), onKeyDown }),
        toggle
      )));
    }

    /** One slim row for narrow panes: title + header actions + view tabs.
        The actions cluster re-hosts `conversation.session.header.actions`
        (agent-team trigger, agent-preset label, cost-meter statistics, …) so
        narrow panes keep the same menu-bar functionality the stock header
        shows — the slim row used to drop it entirely. */
    function SlimHeader({ prepared, summary, sessionId }) {
      const currentView = prepared.store.useStore((s) => (s !== null && s !== undefined ? s.view : null));
      const title = summary ? summary.displayTitle || summary.title || sessionId : sessionId;
      const actions = prepared.renderers.renderSlot("conversation.session.header.actions", {});
      const hasActions = Array.isArray(actions) ? actions.length > 0 : actions !== null && actions !== undefined;
      const tabs = [];
      for (const ve of prepared.viewEntries) {
        let labelText = ve.id;
        try {
          const label = ve.parts.options !== null && ve.parts.options !== undefined ? ve.parts.options.label : null;
          if (typeof label === "function") labelText = label() || ve.id;
        } catch {}
        tabs.push({ id: ve.id, label: labelText });
      }
      const titleRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const onTitleMouseDown = (event) => {
        const el = titleRef.current;
        if (el === null || el.scrollWidth <= el.clientWidth + 1) return;
        dragRef.current = { x: event.clientX, left: el.scrollLeft };
        const onMove = (e) => {
          const st = dragRef.current;
          if (st === null) return;
          el.scrollLeft = st.left + (st.x - e.clientX);
        };
        const onUp = () => {
          dragRef.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      };
      return h("div", { className: "dsv-slim-header", "data-actions": hasActions ? "" : undefined },
        hasActions ? h("div", { className: "dsv-slim-actions" }, actions) : null,
        h("div", { className: "dsv-slim-tabs" },
          tabs.map((tab) => h("button", {
            key: tab.id !== null && tab.id !== undefined ? tab.id : tab.label,
            type: "button",
            className: "dsv-slim-tab" + (currentView === tab.id || (currentView === null && tab.id === "chat") ? " active" : ""),
            onClick: () => { try { prepared.store.actions.setView(tab.id); } catch {} },
          }, tab.label)),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // fallback transcript + composer (built-in renderer, no captures needed)
    // ---------------------------------------------------------------------

    function PrimDisclosure(props) {
      const C = P.DisclosureRow;
      if (C !== undefined && C !== null) return h(C, props);
      const body = props.open ? [props.collapsedContent, props.children] : props.collapsedContent;
      return h(
        "div",
        { className: props.rowClassName, onClick: props.expandOnRowClick ? props.onToggle : undefined, style: { cursor: "pointer" } },
        h("span", { className: props.leadingClassName }, props.icon),
        h("span", { className: props.titleClassName }, props.title),
        body,
      );
    }

    function UserBubble({ content, pending }) {
      const text = blockText(content);
      if (text === "") return null;
      return h(
        "div",
        { className: "dsv-user-row", "data-pending-steering": pending || undefined },
        h("div", { className: "dsv-user-stack" }, h("div", { className: "dsv-bubble" }, text)),
      );
    }

    function ReasoningRow({ text, running }) {
      const [expanded, setExpanded] = React.useState(false);
      const summaryRef = React.useRef(null);
      const visible = String(text || "");
      const summary = running
        ? visible.trimEnd().split("\n").pop() || ""
        : visible.split("\n").find((c) => c.trim() !== "") || "";
      React.useEffect(() => {
        const el = summaryRef.current;
        if (el !== null) el.scrollLeft = running ? el.scrollWidth - el.clientWidth : 0;
      }, [running, summary]);
      return h(
        "div",
        { className: "dsv-think-root", "data-variant": "think", "data-state": running ? "running" : "ok" },
        h(PrimDisclosure, {
          rowClassName: "dsv-think-row",
          leadingClassName: "dsv-think-leading",
          titleClassName: "dsv-think-title",
          chevronClassName: "dsv-think-chevron",
          icon: h(PrimIcon, { prim: "IconThinkOutline14", size: 14 }),
          title: "Think",
          open: expanded,
          expandable: true,
          expandOnRowClick: true,
          onToggle: () => setExpanded((v) => !v),
          collapsedContent: [
            h("span", { className: "dsv-think-separator", "aria-hidden": true }),
            h("span", { ref: summaryRef, className: "dsv-think-summary", "data-follow-end": running || undefined }, summary),
          ],
          children: h("div", { className: "dsv-think-body" }, visible),
        }),
      );
    }

    function RowCard({ state, icon, title, summary, error, bodies }) {
      const [expanded, setExpanded] = React.useState(false);
      const expandedBody = bodies.filter((b) => b !== null && b !== undefined);
      return h(
        "div",
        { className: "dsv-rowcard-root", "data-state": state },
        h(PrimDisclosure, {
          rowClassName: "dsv-rowcard-row",
          leadingClassName: "dsv-rowcard-leading",
          titleClassName: "dsv-rowcard-title",
          chevronClassName: "dsv-rowcard-chevron",
          icon,
          title,
          open: expanded,
          expandable: expandedBody.length > 0,
          expandOnRowClick: expandedBody.length > 0,
          onToggle: () => setExpanded((v) => !v),
          collapsedContent: [
            h("span", { className: "dsv-rowcard-separator", "aria-hidden": true }),
            h("span", { className: "dsv-rowcard-summary", "data-error": error || undefined }, summary),
          ],
          children: expandedBody.length > 0 ? h("div", {}, expandedBody) : null,
        }),
      );
    }

    function monoBody(text, error) {
      if (text === null || text === undefined || text === "") return null;
      return h("pre", { className: "dsv-rowcard-body", "data-error": error || undefined }, String(text));
    }

    function callRows(root, depth) {
      if (root === null || root === undefined || typeof root !== "object") return [];
      const rows = [];
      const name = typeof root.name === "string" ? root.name : "tool";
      const settled = root.result !== undefined && root.result !== null;
      const state = !settled ? "running" : root.error !== undefined && root.error !== null ? "error" : "ok";
      const argsRaw = typeof root.argsRaw === "string" ? root.argsRaw : "";
      let resultText = null;
      let isError = false;
      if (settled) {
        if (Array.isArray(root.result.content)) {
          resultText = root.result.content
            .map((item) => (item !== null && typeof item === "object" && item.type === "text" && typeof item.text === "string" ? item.text : JSON.stringify(item)))
            .join("\n");
        } else if (typeof root.result === "string") {
          resultText = root.result;
        }
        isError = root.result.isError === true || (root.error !== undefined && root.error !== null);
      }
      rows.push(
        h(RowCard, {
          key: String(root.callId || name) + ":" + depth + ":" + rows.length,
          state,
          icon: h(PrimIcon, { prim: "IconCodeOutline16", size: 14 }),
          title: name,
          summary: firstLine(argsRaw, 120) || (!settled ? "Running…" : isError ? "Error" : "Completed"),
          error: isError,
          bodies: [monoBody(argsRaw, false), monoBody(resultText, isError)],
        }),
      );
      if (Array.isArray(root.subCalls)) {
        for (const sub of root.subCalls) rows.push(...callRows(sub, depth + 1));
      }
      return rows;
    }

    function ToolCallNode({ data }) {
      return h("div", {}, callRows(data && data.root, 0));
    }

    function CommandNode({ data }) {
      const name = (data && data.name) || (data && data.commandId) || "command";
      const args = data && typeof data.args === "string" ? data.args : "";
      const outcome = data ? data.outcome : undefined;
      const failed = outcome !== null && outcome !== undefined && outcome.kind === "error";
      const state = outcome === null || outcome === undefined ? "running" : failed ? "error" : "ok";
      const outcomeText = outcome !== null && outcome !== undefined && typeof outcome.text === "string" ? outcome.text : "";
      const summary = (outcomeText !== "" && firstLine(outcomeText, 120)) || (failed ? "Failed" : state === "running" ? "Running…" : "Completed");
      return h(RowCard, {
        state,
        icon: h("span", { style: { fontSize: 12, lineHeight: "16px" } }, "⌘"),
        title: "/" + name,
        summary,
        error: failed,
        bodies: [monoBody(args, false), outcomeText !== "" ? monoBody(outcomeText, failed) : null],
      });
    }

    function AssistantBlocks({ blocks, streaming, interrupted }) {
      const list = Array.isArray(blocks) ? blocks : [];
      const last = list.length - 1;
      const rendered = [];
      for (let i = 0; i < list.length; i++) {
        const block = list[i];
        if (block === null || block === undefined) continue;
        if (block.kind === "text") {
          rendered.push(
            P.MarkdownText !== undefined && P.MarkdownText !== null
              ? h(P.MarkdownText, { key: i, text: block.text, streaming, codeLabels: { copyLabel: "Copy", copiedLabel: "Copied" } })
              : h("div", { key: i }, block.text),
          );
        } else if (block.kind === "reasoning") {
          rendered.push(h(ReasoningRow, { key: i, text: block.text, running: streaming && i === last }));
        } else if (block.kind === "image") {
          rendered.push(h("div", { key: i, className: "dsv-hint" }, "🖼"));
        } else if (block.kind === "tool-call") {
          // tool calls render as their own flow nodes
        } else {
          rendered.push(h("pre", { key: i, className: "dsv-rowcard-body" }, JSON.stringify(block, null, 2)));
        }
      }
      if (rendered.length === 0 && !interrupted) return null;
      return h(
        "div",
        { className: "dsv-md-root", "data-streaming": streaming || undefined },
        h(
          "div",
          { className: "dsv-md-body" },
          rendered,
          interrupted ? h("span", { className: "dsv-md-stopped" }, "Stopped") : null,
        ),
      );
    }

    function TurnStatusLine({ startTime }) {
      const [mountedAt] = React.useState(() => Date.now());
      const anchor = startTime || mountedAt;
      const [elapsed, setElapsed] = React.useState(() => Math.max(0, Date.now() - anchor));
      React.useEffect(() => {
        const tick = () => setElapsed(Math.max(0, Date.now() - anchor));
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
      }, [anchor]);
      return h(
        "div",
        { className: "dsv-turn-status", role: "status", "aria-live": "polite" },
        t("running"),
        elapsed >= 15000 ? h("span", { className: "dsv-turn-status-clock", "aria-hidden": true }, formatClock(elapsed)) : null,
      );
    }

    function FlowNode({ node }) {
      const data = node.data || {};
      switch (node.kind) {
        case "user":
        case "steering":
          return h(UserBubble, { content: data.content, pending: false });
        case "assistant-step":
          return h(AssistantBlocks, {
            blocks: data.blocks,
            streaming: data.status === "running",
            interrupted: data.status === "interrupted",
          });
        case "tool-call":
          return h(ToolCallNode, { data });
        case "command":
        case "command-input":
          return h(CommandNode, { data });
        case "turn-error":
          return h("div", { className: "dsv-turn-error" }, typeof data.message === "string" ? data.message : "Turn failed");
        case "turn-max-tokens":
          return h("div", { className: "dsv-turn-error" }, "Turn stopped by the output-token limit");
        default:
          return null;
      }
    }

    function FallbackTranscript({ useSession, session }) {
      const scrollerRef = React.useRef(null);
      const atBottomRef = React.useRef(true);
      const [, forceTick] = React.useState(0);

      const order = useSession((s) => (s !== null && s.chat !== undefined && s.chat !== null ? s.chat.order : []));
      const nodes = useSession((s) => (s !== null && s.chat !== undefined && s.chat !== null ? s.chat.nodes : null));
      const running = useSession((s) => (s !== null ? s.running === true : false));
      const openState = useSession((s) => (s !== null && s.openState !== undefined && s.openState !== null ? s.openState : "open"));
      const openError = useSession((s) => (s !== null ? s.openError : null));
      const hasMore = useSession((s) => (s !== null ? s.hasMore === true : false));
      const loadingOlder = useSession((s) => (s !== null ? s.loadingOlder === true : false));
      const queue = useSession((s) => (s !== null && Array.isArray(s.queue) ? s.queue : []));
      const timeline = useSession((s) => (s !== null && s.chat !== undefined && s.chat !== null && s.chat.timeline !== undefined ? s.chat.timeline : null));

      let runningStart = null;
      if (timeline !== null && timeline !== undefined && timeline.turns !== undefined) {
        try {
          for (const turn of timeline.turns.values()) {
            if (turn.status === "open" && turn.start !== undefined) runningStart = turn.start.time;
          }
        } catch {}
      }

      const toBottom = React.useCallback(() => {
        const el = scrollerRef.current;
        if (el === null) return;
        el.scrollTop = el.scrollHeight;
        atBottomRef.current = true;
        forceTick((v) => v + 1);
      }, []);

      // Auto-follow ONLY when the flow actually grew (new nodes, run state,
      // queued items) — not on EVERY render. The effect reads scrollHeight
      // (forced layout); with no deps it ran per streaming token batch per
      // pane, a constant reflow storm.
      React.useLayoutEffect(() => {
        if (atBottomRef.current) {
          const el = scrollerRef.current;
          if (el !== null) el.scrollTop = el.scrollHeight;
        }
      }, [order, running, queue.length]);

      const onScroll = () => {
        const el = scrollerRef.current;
        if (el === null) return;
        const next = el.scrollHeight - el.scrollTop - el.clientHeight <= 25;
        if (next !== atBottomRef.current) {
          atBottomRef.current = next;
          forceTick((v) => v + 1);
        }
      };

      const kids = [];
      if (openState === "loading") kids.push(h("div", { className: "dsv-hint", key: "hint" }, t("loadingHistory")));
      if (openState === "error") {
        kids.push(h("div", { className: "dsv-open-error", key: "error" }, t("loadError") + (openError && openError.message ? ": " + openError.message : "")));
      }
      if (hasMore) {
        kids.push(
          h("div", { className: "dsv-older", key: "older" },
            h("button", {
              type: "button",
              disabled: loadingOlder,
              onClick: () => { try { session.loadOlder(); } catch {} },
            }, loadingOlder ? "…" : t("loadOlder"))),
        );
      }
      if (openState === "open") {
        if (order.length === 0) {
          kids.push(h("div", { className: "dsv-hint", key: "empty", style: { alignSelf: "center", padding: "32px 0" } }, t("emptyTranscript")));
        } else {
          for (let i = 0; i < order.length; i++) {
            const key = order[i];
            let node = null;
            try {
              node = nodes !== null && nodes !== undefined ? nodes.get(key) : null;
            } catch {
              node = null;
            }
            if (node === null || node === undefined) continue;
            kids.push(
              h("div", { className: "dsv-flow-item", key, "data-chat-flow-key": key, "data-chat-flow-kind": String(node.kind || "") },
                h(FlowNode, { node })),
            );
          }
        }
      }
      if (running) kids.push(h(TurnStatusLine, { key: "status", startTime: runningStart }));
      let pendingIndex = 0;
      for (const item of queue) {
        if (item === null || item === undefined || item.placement !== "steering") continue;
        pendingIndex += 1;
        kids.push(h(UserBubble, { key: "steer-" + (item.id || pendingIndex), content: item.content, pending: true }));
      }

      return h(
        "div",
        { className: "dsv-chat-root" },
        h("div", { className: "dsv-chat-scroll", ref: scrollerRef, onScroll }, h("div", { className: "dsv-chat-column" }, kids)),
        !atBottomRef.current
          ? h("div", { className: "dsv-to-bottom-slot" },
              h("button", { type: "button", className: "dsv-to-bottom", "aria-label": t("toBottom"), title: t("toBottom"), onClick: toBottom },
                h(PrimIcon, { prim: "IconChevronDownOutline14" })))
          : null,
      );
    }

    function FallbackComposer({ sessionId, session, running }) {
      const [draft, setDraft] = React.useState("");
      const [imageIds, setImageIds] = React.useState([]);
      const inputRef = React.useRef(null);

      /** Upload pasted image files through the conversation service (same
          createDraftImages pipeline the stock composer uses) and keep the
          returned draft ids for the next submit. */
      const conversationService = () => {
        try {
          const scope = sessionsService !== undefined && sessionsService !== null && typeof sessionsService.scope === "function"
            ? sessionsService.scope(sessionId)
            : undefined;
          return scope !== undefined && scope !== null ? scope.get("conversation") : undefined;
        } catch {
          return undefined;
        }
      };
      const uploadPastedFiles = (files) => {
        const conversation = conversationService();
        if (conversation === undefined || conversation === null) return 0;
        // dsh 0.1.5: createDrafts(sessionId, files) registers image drafts
        // (and starts background uploads for files); 0.1.4 exposed the
        // image-only createDraftImages — prefer whichever the service carries
        const ids = [];
        try {
          if (typeof conversation.createDrafts === "function") {
            const drafts = conversation.createDrafts(sessionId, files);
            for (const draft of (drafts !== null && drafts !== undefined ? drafts : [])) {
              if (draft !== null && draft !== undefined && draft.id !== undefined) ids.push(draft.id);
            }
          } else if (typeof conversation.createDraftImages === "function") {
            const attachments = conversation.createDraftImages(files);
            for (const attachment of (attachments !== null && attachments !== undefined ? attachments : [])) {
              if (attachment !== null && attachment !== undefined && attachment.id !== undefined) ids.push(attachment.id);
            }
          } else {
            return 0;
          }
        } catch {
          return 0;
        }
        if (ids.length === 0) return 0;
        setImageIds((prev) => [...prev, ...ids]);
        return ids.length;
      };
      const onPaste = (event) => {
        const data = event.clipboardData;
        const files = data !== null && data !== undefined && data.files !== undefined && data.files !== null
          ? Array.from(data.files).filter((file) => file !== null && file !== undefined && typeof file.type === "string" && file.type.startsWith("image/"))
          : [];
        if (files.length === 0) return;
        if (uploadPastedFiles(files) > 0) event.preventDefault();
      };

      React.useLayoutEffect(() => {
        const el = inputRef.current;
        if (el === null) return;
        el.style.height = "auto";
        const natural = Math.min(el.scrollHeight, 168);
        el.style.height = Math.max(natural, 28) + "px";
      }, [draft]);

      const submit = () => {
        const text = draft.trim();
        // running must NOT gate the submit (see TuiPlainComposer): the "queue"
        // placement below is resolved host-side — a plain send when idle, a
        // queued item when the agent is busy. The old `|| running` refusal
        // made Enter dead exactly while the pane's session was running.
        if (text === "" && imageIds.length === 0) return;
        try {
          let result;
          if (text.startsWith("/") && imageIds.length === 0) {
            result = session.command(text);
          } else {
            let sent = false;
            if (imageIds.length > 0) {
              const conversation = conversationService();
              if (conversation !== undefined && conversation !== null && typeof conversation.sendSession === "function") {
                result = conversation.sendSession(session, text, imageIds, "queue");
                sent = true;
              }
            }
            if (!sent) result = session.prompt([{ type: "text", text }], "queue");
          }
          if (result !== undefined && result !== null && typeof result.then === "function") result.catch(() => {});
          setDraft("");
          setImageIds([]);
        } catch {}
      };

      const onKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        }
      };

      return h(
        "div",
        { className: "dsv-composer" },
        h(
          "div",
          { className: "dsv-composer-card" },
          h("textarea", {
            ref: inputRef,
            className: "dsv-composer-text",
            rows: 1,
            value: draft,
            placeholder: t("composerPlaceholder"),
            "aria-label": t("composerPlaceholder"),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown,
            onPaste,
          }),
          h(
            "div",
            { className: "dsv-composer-row" },
            h("div", { className: "dsv-composer-hint" },
              imageIds.length > 0 ? imageIds.length + " 🖼 · Enter ↵" : "Enter ↵"),
            h(
              "div",
              { className: "dsv-composer-trailing" },
              // stock primaryStops rule: Stop only for an empty draft while
              // running; a non-empty draft keeps a (queue-)send button
              (running && draft.trim() === "" && imageIds.length === 0)
                ? h("button", {
                    type: "button",
                    className: "dsv-send stop",
                    title: t("stop"),
                    "aria-label": t("stop"),
                    onClick: () => { try { session.cancel(); } catch {} },
                  }, h(PrimIcon, { prim: "IconStopFill16" }))
                : h("button", {
                    type: "button",
                    className: "dsv-send",
                    disabled: draft.trim() === "" && imageIds.length === 0,
                    title: t("send"),
                    "aria-label": t("send"),
                    onClick: submit,
                  }, h(PrimIcon, { prim: "IconSendOutline14" })),
            ),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // pane assembly
    // ---------------------------------------------------------------------

    function ChatPane({ sessionId, session, narrow, summary, composerMode, onToggleComposerMode, toggleNode }) {
      const useSession = React.useMemo(() => makeUseSession(session), [session]);
      const running = useSession((s) => (s !== null ? s.running === true : false));
      // Pane resources ride the React MOUNT: retain on mount, release on
      // unmount. Together with treeStore.commit's departed-leaf sweep this
      // covers EVERY leaf mutation path (✕, sidebar click-to-load, closeFocused,
      // movePane) — the old cleanup list lived only in the ✕ handler, so a
      // sidebar click leaked a retained SessionReference, an editor guard with
      // five document capture listeners, a typing subscription and the image
      // intake, and every stale guard then ran on every keystroke app-wide.
      React.useEffect(() => {
        retainPaneSession(sessionId);
        return () => { releasePaneSession(sessionId); };
      }, [sessionId]);
      // Pending user interactions (ask_user_question / plan-review, approvals)
      // come from the ROOT standard hook `useSessionStatus` — the same source the
      // stock ConversationRoot reads — because the 0.2.x UiSession service has
      // NO `pendingInteractions` property (the old read silently returned
      // nothing, so in-pane question/approval cards never appeared). The legacy
      // uiSession source remains only as the 0.1.x fallback. A root hook can only
      // be called from a component, so RootPendingProbe (rendered below) feeds
      // the value into a module store; this pane's hook list stays fixed.
      const rootFaces = useRootStandard();
      const useSessionStatus = rootFaces !== null && rootFaces !== undefined && typeof rootFaces.useSessionStatus === "function"
        ? rootFaces.useSessionStatus
        : null;
      const legacyPending = useLegacySessionPendingInteraction((snapshot) =>
        snapshot === null || snapshot === undefined || typeof snapshot.get !== "function"
          ? undefined
          : snapshot.get(sessionId),
      );
      const rootPending = useRootPendingInteraction(sessionId);
      const pendingInteraction = useSessionStatus !== null ? rootPending : legacyPending;
      // the native re-hosting bundle (kit, inject faces, hook factories) is
      // built once per (sessionId, session, root faces) — identities stay
      // stable. On 0.2.0 the session faces only exist once the retained
      // SessionReference has opened, so the build waits for it instead of
      // freezing an empty kit; the ROOT faces arrive on this plugin's own
      // `shell.overlay` entry, so subscribing here lets a pane that was opened
      // before the root roster settled pick them up without a remount.
      const bindingReady = useSessionBindingReady(sessionId);
      // "Not yet" vs "gone": while the bounded retain retries are still armed,
      // a pane without a session face shows the loading hint, NOT "Session
      // ended" (the 1.6.0 regression: the first retain raced the host catalog
      // and the pane settled into the ended state permanently).
      const faceStatus = useSessionFaceStatus(sessionId);
      const prepared = React.useMemo(
        () => (session === undefined || session === null || !bindingReady ? null : prepareNative(sessionId, session, rootFaces)),
        [sessionId, session, bindingReady, rootFaces],
      );

      React.useEffect(() => {
        if (session === undefined || session === null) return;
        // runtime-internal staging bridge: history window + live events
        try {
          const result = session.open();
          if (result !== undefined && result !== null && typeof result.catch === "function") result.catch(() => {});
        } catch {}
      }, [session]);

      if (session === undefined || session === null) {
        const stillRetrying = faceStatus !== undefined && faceStatus !== null
          && faceStatus.exhausted !== true && faceStatus.face === undefined;
        return h("div", { style: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" } },
          h("div", { className: "dsv-hint" }, t(stillRetrying === true ? "loadingHistory" : "sessionEnded")));
      }
      // Waiting for the retained SessionReference to open (bounded by
      // SESSION_BINDING_GRACE_MS). Hold the frame with a hint for that one
      // render — the native components below dereference the prepared bundle.
      if (prepared === null) {
        return h("div", { style: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" } },
          h("div", { className: "dsv-hint" }, t("loadingHistory")));
      }
      // TUI mode strips the stock session header entirely (breadcrumb, view
      // tabs, actions) — only the plugin's own pane header remains. Otherwise:
      // slim header for narrow panes, full stock header for wide ones.
      const header = composerMode === "tui"
        ? null
        : (narrow === true
          ? h(SlimHeader, { prepared, summary, sessionId })
          : h(NativeHeader, { prepared }));

      const transcript = h(NativeViewArea, {
        prepared,
        session,
        fallback: h(FallbackTranscript, { useSession, session }),
      });
      const composerBar = h(NativeComposer, {
        prepared,
        session,
        sessionId,
        fallback: h(FallbackComposer, { sessionId, session, running }),
      });
      // conversation.composer chain: entries such as the ask_user question
      // editor, approval prompts, and plan reviews TAKE OVER the composer
      // while they match. Stock semantics: every chain entry receives the SAME
      // owner props and the first entry whose `select()` returns non-null owns
      // the composer — `pendingInteraction` (this pane's Session, from
      // uiSession) is the carrier they all read, so it must ride the props.
      // The stock page renders this chain with the bar as fallback.
      let composer = composerBar;
      const chainOwner = { sessionId, session, pendingInteraction };
      const chainEntries = capturedEntries("conversation.composer");
      // Static slot-level injected props for the chain declaration, plus the
      // entry inject face per elected entry — the stock renderer merges
      // kit -> entry inject -> slot inject -> store -> owner, and entries like
      // ui-user-questions declare their face as an entry inject with
      // `keyedHooks: { questionCard }` (=> `useQuestionCard`). Without the
      // entry inject the elected QuestionFlow throws
      // "useQuestionCard is not a function" and the turn stays pending.
      const chainSlotProps = cachedSlotInject(slotInjectFaceOf("conversation.composer")).props;
      const chainDebug = {
        sessionId,
        entries: chainEntries.length,
        pendingKind: pendingInteraction === null || pendingInteraction === undefined
          ? null
          : String(pendingInteraction.kind ?? pendingInteraction.constructor?.name ?? typeof pendingInteraction),
        elected: null,
        electionError: null,
        store: false,
        inject: false,
      };
      composerChainDebug.last = chainDebug;
      const elected = electComposerChain(chainEntries, chainOwner, chainDebug);
      if (elected !== null) {
        const parts = elected.parts;
        const matched = elected.matched;
        const chainT = entryTranslate(elected.entry);
        // Entry-declared stores ride the SAME per-entry kit share the stock
        // renderer builds (standardKit: useStore + actions). Without it the
        // question composer's QuestionFlow throws "useStore is not a function"
        // and the pane falls back to the plain InputBar — the card never shows.
        const storeProps = entryStoreProps(parts, sessionId, prepared.scopeKey);
        const injectFace = prepared.renderers.entryInjectProps(parts);
        chainDebug.elected = String(parts.options?.id ?? parts.options?.key ?? parts.component?.name ?? "entry");
        chainDebug.store = typeof storeProps.useStore === "function";
        chainDebug.inject = injectFace !== undefined && injectFace !== null && Object.keys(injectFace).length > 0;
        const props = composerChainProps(
          prepared.kit,
          injectFace,
          chainSlotProps,
          storeProps,
          chainOwner,
          matched,
          chainT !== undefined ? chainT : prepared.kit.t,
          prepared.renderers,
        );
        composer = h(PaneBoundary, { fallback: composerBar, slotKey: "conversation.composer" }, h(parts.component, props));
      }
      // TUI mode: a terminal-grade single line. A matching chain entry
      // (question / approval / plan review) still takes precedence over it.
      const composerNode = composer !== composerBar
        ? composer
        : (composerMode === "tui"
          ? (prepared.composer !== null && prepared.composer !== undefined
              ? h(TuiMachineComposer, { prepared, running, toggle: toggleNode, useSession })
              : h(TuiPlainComposer, { sessionId, session, running, toggle: toggleNode, useSession }))
          : composerBar);
      // Last-resort Enter for the re-hosted native editor. Its Enter is run by
      // a keymap registered on the SHARED per-session Lexical editor — the
      // hidden stock page registers the same keymap for the same session, and
      // whoever owns the editor root at that moment decides. Whenever the
      // keymap does not run (root re-pointed behind the pane's back, the
      // registration disposed with the stock composer, a keymap of another
      // generation answering for this editor), Lexical just inserts a
      // paragraph: the draft stays put, nothing is sent, and no toast says so.
      // The stock keymap preventDefaults the key in every branch that consumed
      // it, so a plain Enter that reaches this pane's React tree unconsumed is
      // by definition a dead submit — run it through the pane's own input
      // machine. Gated on a non-empty draft so it can never fire blind, and
      // scoped to the native editor so the TUI line and the fallback card keep
      // their own handlers.
      const onComposerKeyDown = (event) => {
        if (event.key !== "Enter" || event.shiftKey === true || event.altKey === true
            || event.ctrlKey === true || event.metaKey === true) return;
        const native = event.nativeEvent;
        if (native !== undefined && native !== null && (native.isComposing === true || native.keyCode === 229)) return;
        if (event.defaultPrevented === true) return; // the stock keymap owns it
        const target = event.target;
        if (target === null || target === undefined || typeof target.closest !== "function") return;
        const editorEl = target.closest("[data-composer-input]");
        if (editorEl === null) return; // TUI line / fallback card submit themselves
        // Only when the editor's root really is this div. A root that was just
        // re-claimed can lag the visible text, and sending a half-typed draft
        // would be worse than sending nothing — the guard repairs the root and
        // the next Enter works.
        const editor = editorEl.__lexicalEditor;
        if (editor === undefined || editor === null || typeof editor.getRootElement !== "function") return;
        if (editor.getRootElement() !== editorEl) {
          // Orphaned host: repair the ownership and REQUIRE the next Enter. The
          // keystroke that triggered the repair was never in the Lexical model,
          // and the repair rebuilds the DOM from that model — submitting now
          // would send a stale draft.
          const guard = paneEditorGuards.get(sessionId);
          if (guard !== undefined && guard !== null && typeof guard.repair === "function") {
            try { guard.repair(); } catch {}
          }
          return;
        }
        if (composer !== composerBar) return; // a question / approval card owns the composer
        const machine = prepared.composer;
        if (machine === null || machine === undefined) return;
        const snapshot = typeof machine.readInput === "function" ? machine.readInput() : null;
        const draft = snapshot !== null && snapshot !== undefined && typeof snapshot.draft === "string" ? snapshot.draft : "";
        if (draft.trim() === "") return;
        event.preventDefault();
        try { machine.inputActions.submit(); } catch {}
      };
      // ---- hero row: the agent-preset ("模式") chooser --------------------
      // The agent-preset seat lives in ConversationRoot's hero row
      // (`heroWorkspaceRow`, ui-conversation), and a pane NEVER renders that
      // component: a pane hosts the chat VIEW (ui-chat's transcript), the
      // composer bar and the session header — not the ConversationRoot that owns
      // the hero. On a blank session the stock page therefore offers
      // "标准模式 / PTC 模式 / Creator 模式 / 极简模式" next to the workspace
      // chip while every pane offered nothing, and this seat is the ONLY
      // chooser that exists (the header label is read-only — its own hint reads
      // "本会话运行的 Agent 预设，开始时即固定"), so split view could never
      // start a session in a non-default preset.
      //
      // `blank`/`awaitingFirstTurn`/`promptAttempted`/`running` are the SAME
      // session-face fields ui-conversation folds into `conversationPhase()`:
      //   phase === "blank"  ⟺  (blank || awaitingFirstTurn) && !running &&
      //                          !promptAttempted   (&& activeTargets.size === 0)
      // and the stock hero shows while `shellPhase === "blank"`. The sessions
      // LIST entry's own `blank` field is NOT usable here — it reads true for
      // long-lived conversations too, which put a preset chooser on panes whose
      // stock page shows no hero at all.
      const heroBlank = session !== undefined && session !== null
        && (session.blank === true || session.awaitingFirstTurn === true)
        && session.running !== true
        && session.promptAttempted !== true;
      const heroSeat = heroBlank
        ? prepared.renderers.renderSlot("conversation.hero.agentPreset", {}, undefined)
        : null;
      const heroRow = heroSeat !== null && heroSeat !== undefined
        ? h("div", { className: "dsv-hero-row", "data-dsv-hero": "" }, heroSeat)
        : null;
      return h(
        "div",
        { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }, onKeyDown: onComposerKeyDown },
        // Root-hook probe: subscribes this pane's session to the harvested
        // `useSessionStatus` and publishes the pending interaction for the
        // composer chain above. A separate component so ChatPane's own hook
        // list never changes when the root source appears/disappears.
        useSessionStatus !== null ? h(RootPendingProbe, { useSessionStatus, sessionId }) : null,
        header,
        transcript,
        heroRow,
        composerNode,
      );
    }

    // ---------------------------------------------------------------------
