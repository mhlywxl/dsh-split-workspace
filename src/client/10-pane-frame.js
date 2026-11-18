    // pane frame with drop zones
    // ---------------------------------------------------------------------

    /** True while an OS file/image drag hovers the pane (Explorer, browser
        drags). Session drags ride text/plain instead. */
    function isFileDrag(event) {
      const types = event.dataTransfer !== undefined && event.dataTransfer !== null ? event.dataTransfer.types : null;
      if (types === null || types === undefined) return false;
      try {
        for (let i = 0; i < types.length; i++) {
          if (types[i] === "Files") return true;
        }
      } catch {}
      return false;
    }

    /** Image files out of a DataTransfer / clipboard payload. */
    function imageFilesOf(data) {
      if (data === null || data === undefined || data.files === undefined || data.files === null) return [];
      return Array.from(data.files).filter((file) => file !== null && file !== undefined && typeof file.type === "string" && file.type.startsWith("image/"));
    }

    function zoneFor(rect, x, y) {
      const w = rect.width;
      const hh = rect.height;
      const dx = x - rect.left;
      const dy = y - rect.top;
      const edge = Math.max(48, Math.min(w, hh) * 0.28);
      const left = dx < edge;
      const right = dx > w - edge;
      const top = dy < edge;
      const bottom = dy > hh - edge;
      if (left && !right) return { dir: "h", side: "before", label: "dropSplitLeft", zone: { dir: "h", side: "before" } };
      if (right && !left) return { dir: "h", side: "after", label: "dropSplitRight", zone: { dir: "h", side: "after" } };
      if (top && !bottom) return { dir: "v", side: "before", label: "dropSplitTop", zone: { dir: "v", side: "before" } };
      if (bottom && !top) return { dir: "v", side: "after", label: "dropSplitBottom", zone: { dir: "v", side: "after" } };
      return { dir: null, side: null, label: "dropMove", zone: null };
    }

    function ghostStyle(zone) {
      if (zone === null || zone.dir === null) return { left: 4, top: 4, right: 4, bottom: 4 };
      if (zone.dir === "h") {
        return zone.side === "before" ? { left: 4, top: 4, bottom: 4, width: "50%" } : { right: 4, top: 4, bottom: 4, width: "50%" };
      }
      return zone.side === "before" ? { top: 4, left: 4, right: 4, height: "50%" } : { bottom: 4, left: 4, right: 4, height: "50%" };
    }

    function PaneFrame({ sessionId, session, summary, focused, chrome, onFocus, onClose, pickerFor, floating, standalone, appWindow, appWindowMaximized }) {
      const runtime = useRuntime();
      const performanceMode = runtime.performance === true;
      const maximized = runtime.maximized === sessionId;
      const [renaming, setRenaming] = React.useState(false);
      const [renameDraft, setRenameDraft] = React.useState("");
      const [zone, setZone] = React.useState(null);
      const [invalidDrop, setInvalidDrop] = React.useState(false);
      const frameRef = React.useRef(null);
      const headerRef = React.useRef(null);
      const running = summary ? summary.running === true : false;
      const title = summary ? summary.displayTitle || summary.title || sessionId : sessionId;
      const cwd = summary ? basenameOf(summary.cwd) : "";
      const sessions = useSessionsList();
      // pane geometry: narrow panes get the slim header; short panes
      // (vertically split) default to the TUI composer. Hysteresis keeps the
      // composer mode from flip-flopping while a divider is dragged.
      const [paneSize, setPaneSize] = React.useState({ w: 0, h: 0 });
      const shortRef = React.useRef(false);
      React.useEffect(() => {
        const el = frameRef.current;
        if (el === null || typeof ResizeObserver !== "function") return;
        const observer = new ResizeObserver((entries) => {
          if (inLiveReflow(el)) return;
          for (const entry of entries) {
            const w = Math.round(entry.contentRect.width);
            const h = Math.round(entry.contentRect.height);
            shortRef.current = h < 280 ? true : h > 340 ? false : shortRef.current;
            setPaneSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
          }
        });
        observer.observe(el);
        return () => observer.disconnect();
      }, []);
      const narrow = paneSize.w > 0 && paneSize.w < 560;
      // Below this width the six header actions no longer fit: collapse them
      // into one ⋯ button that opens a menu. The title keeps the row.
      const compactHeader = paneSize.w > 0 && paneSize.w < 320;
      const [menuOpen, setMenuOpen] = React.useState(false);
      React.useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = (event) => {
          const target = event.target;
          if (target !== null && target !== undefined && typeof target.closest === "function"
              && target.closest(".dsv-pane-menu, .dsv-pane-menu-btn") !== null) return;
          setMenuOpen(false);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [menuOpen]);
      React.useEffect(() => {
        if (!compactHeader) setMenuOpen(false);
      }, [compactHeader]);
      const shortPane = paneSize.h === 0 ? false : shortRef.current;
      // explicit mode lives in the module store so the Alt+T chord can
      // toggle the focused pane from the window keydown path; subscribing
      // re-renders this pane only when some pane's mode changes
      const [, bumpModeVersion] = React.useState(0);
      React.useEffect(() => composerModeStore.subscribe(() => bumpModeVersion((v) => v + 1)), []);
      const explicitMode = composerModeStore.getExplicit(sessionId);
      const composerMode = explicitMode !== null ? explicitMode : (shortPane ? "tui" : "full");
      composerModeStore.registerEffective(sessionId, composerMode);
      const toggleComposerMode = () => composerModeStore.toggle(sessionId);
      // the pinned toggle's right edge AND the dock text area both track the
      // LIVE chat box (composer card / TUI line) — measured from the DOM
      // rather than assumed from pane width, so both stay glued to the
      // input's real geometry whatever the bar resolves to. The box rides
      // the pane as CSS vars so deep children (dock row) inherit it.
      const [cardBox, setCardBox] = React.useState(null);
      // the composer card's own typography, mirrored onto the TUI line so
      // Alt+T swaps the input without changing the reader's type scale. The
      // stock card sets font-size/line-height from --dsh-content-font-*; the
      // bare pane is 16px/normal by inheritance, which made the terminal line
      // visibly larger and off the chat's baseline. Held in a ref as well:
      // in TUI mode the native card is unmounted, so the last measured values
      // must survive the swap.
      const [cardFont, setCardFont] = React.useState(null);
      const cardFontRef = React.useRef(null);
      const learnedFull = React.useRef(false);
      // frame width the learned box belongs to — a box measured for another
      // frame width cannot be reused (see the invalidation in measure())
      const learnedAtWidth = React.useRef(-1);
      React.useEffect(() => {
        const frame = frameRef.current;
        if (frame === null || typeof ResizeObserver !== "function") return;
        // TUI mode mounts no native card to measure (the learned box survives
        // in refs across this effect's re-runs), so install no observers at
        // all: streaming commits would otherwise schedule a full measure pass
        // on every token batch for nothing.
        if (composerMode === "tui") return;
        let raf = 0;
        let lastMeasureAt = 0;
        const measure = () => {
          // Visibility + rate gates FIRST: this observer fires on every React
          // commit while a pane streams. A hidden window has nothing to measure,
          // and passes are capped to ~12/s per pane so a streaming burst cannot
          // turn layout reads into per-commit work (S4).
          if (typeof document.visibilityState === "string" && document.visibilityState === "hidden") return;
          const now = Date.now();
          if (now - lastMeasureAt < 80) return;
          lastMeasureAt = now;
          // Cheap gate FIRST: no composer card markers in the frame at all
          // (takeover cards, transient unmounts) → nothing to re-mark or
          // measure, and no forced layout below. This observer fires on every
          // React commit while a pane streams, so the single querySelector
          // here is the only steady-state cost.
          if (frame.querySelector("[data-composer-card], [data-dsv-composer-card]") === null) return;
          // pick the widest VISIBLE composer box: transient or hidden seats
          // can precede the real card in document order with a zero rect,
          // and a stale mount-time measure never self-corrects on a quiet
          // pane — so re-derive from live DOM on every trigger
          // The pane's card carries BOTH markers. The rename used to REMOVE
          // `data-composer-card`, to opt panes out of the vision toolkit's
          // document-level paste hijack — but that hijack also requires the
          // paste target to be an HTMLTextAreaElement, and the 0.1.5 composer
          // is a Lexical contenteditable, so the opt-out stopped protecting
          // anything while the missing attribute kept silently breaking every
          // core consumer that keys on it:
          //   - input-trigger's `closest("[data-composer-card]")` keep-open
          //     guard went falsy, so any pointerdown inside a pane's own
          //     composer closed its / or @ menu;
          //   - the model-selector and message-feedback toasts lost their card
          //     anchor and fell back to the default placement.
          // Publishing the original marker as well restores every consumer
          // that resolves the card from a node INSIDE the pane (nearest
          // ancestor), and consumers that learned the renamed one keep
          // working. A consumer that still does a document-wide
          // `querySelector("[data-composer-card]")` keeps picking the stock
          // page's card, because that one comes first in document order — that
          // is a core-side defect this plugin cannot fix from here.
          for (const node of frame.querySelectorAll("[data-composer-card]")) {
            node.setAttribute("data-dsv-composer-card", "");
          }
          // ONE geometry source: the real full-mode card (must contain the
          // live editor). dsh 0.1.5 renders that editor as a Lexical
          // contenteditable (`[data-composer-input]`) — the stock InputBar
          // only falls back to a <textarea> — so a textarea-only probe never
          // finds the card, `--dsv-card-w` stays unset, and every derived
          // width (queue strip, dock row, TUI line) falls back to full pane
          // width. Once learned, the TUI line never overwrites it — the TUI
          // line lives in a different container, so measuring it would move
          // the toggle on every Alt+T. The learned box is also published as
          // CSS vars for the TUI line and the dock row.
          const hasEditor = (node) => node.querySelector("textarea") !== null || node.querySelector("[data-composer-input]") !== null;
          let best = null;
          let bestNode = null;
          const nodes = frame.querySelectorAll("[data-dsv-composer-card]");
          for (const node of nodes) {
            if (!hasEditor(node)) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width < 80 || rect.height < 12) continue;
            if (best === null || rect.width > best.width) {
              best = rect;
              bestNode = node;
            }
          }
          // The frame's own width keys the learned box: a box measured at a
          // different width cannot be reused (the invalidation below).
          const frameWidth = Math.round(frame.getBoundingClientRect().width);
          if (best !== null) {
            learnedFull.current = true;
            learnedAtWidth.current = frameWidth;
            // mirror the card's OWN typography (the stock card declares
            // font-size: var(--dsh-content-font-size) and the matching line
            // height); a bare pane would otherwise hand the TUI line 16px
            const cardStyle = window.getComputedStyle(bestNode);
            const fontSize = cardStyle.fontSize !== "" ? cardStyle.fontSize : "14px";
            const lineHeight = cardStyle.lineHeight !== "" && cardStyle.lineHeight !== "normal" ? cardStyle.lineHeight : "24px";
            const font = { fontSize, lineHeight };
            const previousFont = cardFontRef.current;
            if (previousFont === null || previousFont.fontSize !== font.fontSize || previousFont.lineHeight !== font.lineHeight) {
              cardFontRef.current = font;
              setCardFont(font);
            }
          } else if (learnedFull.current === true && learnedAtWidth.current === frameWidth) {
            return; // keep the learned full-mode box through TUI sessions
          } else {
            // No full-mode card to measure. The TUI line's own box is NOT a
            // substitute: `.dsv-tui-block` is laid out BY the vars this function
            // publishes, so measuring it feeds the published geometry back into
            // itself and freezes whatever the line happened to be at that
            // instant. A short pane mounts straight into TUI (`composerMode`
            // "tui" below the height threshold) and never sees a card, so it
            // baked its own fallback box in as the card box; the same freeze
            // kept a pre-resize box after the frame changed width, leaving the
            // line pinned to the left of a wider/narrower pane while the card
            // above it stayed centred.
            //
            // Drop the box instead (idempotent — React bails out on an equal
            // state): the vars go unpublished and the CSS fallback lays the
            // line out centred at the card's own width. The next full-mode
            // render re-learns the real box.
            learnedFull.current = false;
            learnedAtWidth.current = -1;
            setCardBox(null);
            return;
          }
          if (best === null) return;
          const frameRect = frame.getBoundingClientRect();
          const left = Math.max(0, Math.round(best.left - frameRect.left));
          const right = Math.max(left, Math.round(best.right - frameRect.left));
          const rightDist = Math.max(0, Math.round(frameRect.right - best.right));
          const bottomDist = Math.max(0, Math.round(frameRect.bottom - best.bottom));
          setCardBox((prev) => (prev !== null && prev.left === left && prev.right === right && prev.bottomDist === bottomDist ? prev : { left, right, rightDist, bottomDist }));
        };
        const schedule = () => {
          if (inLiveReflow(frame)) return;
          if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; measure(); });
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(frame);
        // Perf mode: the pane subtree mutates on EVERY streaming token, and a
        // subtree MutationObserver here used to re-measure geometry (forced
        // layout) for each one. Keep resize-driven measuring + a slow poll.
        const mutation = !performanceMode && typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
        if (mutation !== null) mutation.observe(frame, { childList: true, subtree: true });
        const perfTimer = performanceMode ? window.setInterval(schedule, 1500) : 0;
        schedule();
        return () => {
          if (raf !== 0) cancelAnimationFrame(raf);
          observer.disconnect();
          if (mutation !== null) mutation.disconnect();
          if (perfTimer !== 0) window.clearInterval(perfTimer);
        };
      }, [paneSize.w, composerMode, performanceMode]);
      // a composer is never narrower than this — narrower "boxes" are
      // transient seats, not the real input; fall back to stock geometry
      const cardBoxSane = cardBox !== null && cardBox.right - cardBox.left >= 160;
      // ---- composer-mode toggle placement --------------------------------
      // The toggle must never share pixels with the composer's own controls.
      // Its home is the band between the card's bottom edge and the pane's
      // bottom edge (the stock stats row), where it is centred: a 26px button
      // needs 26 + 2px margins = 30px of band. A pane whose composer is FLUSH
      // with its bottom edge — a vertically split pane — has no such band,
      // and clamping `bottom` to 2px anyway parked the 26px button straight
      // on top of the stock send key. Two fallbacks, in order:
      //   gutter — right of the card's right border, i.e. OUTSIDE the card,
      //            so nothing inside the card can be covered (needs 28px);
      //   header — the pane chrome row (⬎ / ⬏ / ✕), which only exists for
      //            split panes. A lone pane (chrome === false) always keeps
      //            the stock stats band, so the header branch implies one.
      const MODE_BTN = 26;
      const MODE_GAP = 2;
      const bandFits = cardBoxSane && cardBox.bottomDist >= MODE_BTN + MODE_GAP * 2;
      const gutterFits = cardBoxSane && cardBox.rightDist >= MODE_BTN + MODE_GAP * 2;
      const tight = cardBoxSane && !bandFits && !gutterFits;
      // Historical corner anchor (2px inset so the toggle reads as attached to
      // the card's right border, centred in the band). Measured layouts put
      // the band at 30-53px, so this stays the normal path; it is also the
      // last resort for a lone pane, which has no header to dock into.
      const cornerRight = cardBoxSane ? Math.max(10, cardBox.rightDist + MODE_GAP) : 18;
      const cornerBottom = cardBoxSane ? Math.max(MODE_GAP, Math.round((cardBox.bottomDist - MODE_BTN) / 2)) : 4;
      // Only the GUTTER case moves the toggle off the historical corner: the
      // header branch renders it in the header instead, the band branch is the
      // corner, and an unmeasured card (cardBoxSane false) keeps the blind
      // corner rather than snapping to the pane's very edge. `tight` already
      // implies !bandFits && !gutterFits, so testing gutterFits alone is exact.
      const modeBtnInHeader = tight && chrome !== false;
      const modeBtnRight = cardBoxSane && gutterFits ? MODE_GAP : cornerRight;
      const modeBtnBottom = cardBoxSane && gutterFits ? MODE_GAP : cornerBottom;
      // in TUI mode the toggle is an INLINE flex child of the TUI line —
      // structural placement can never overlap the send key, and both stay
      // in the same band at the same size
      const modeBtnNode = chrome !== false ? h("button", {
        type: "button",
        className: "dsv-mode-btn inline",
        title: "TUI composer (Alt+T)",
        "aria-label": "TUI composer (Alt+T)",
        onMouseDown: (event) => event.stopPropagation(),
        onClick: (event) => {
          event.stopPropagation();
          toggleComposerMode();
        },
      }, h(ComposerModeIcon, { tui: composerMode === "tui" })) : null;

      const knownId = (id) => {
        if (typeof id !== "string" || id === "") return false;
        if (sessions !== null && sessions !== undefined && Array.isArray(sessions.ids)) return sessions.ids.indexOf(id) !== -1;
        return false;
      };
      const externalSessionDrag = (event) => {
        if (dragPayload !== null) return false;
        // Only drags that PROVABLY carry a sidebar conversation are claimed:
        // the plugin's dragstart capture (registerDragBridge) stamps
        // MIME_SESSION on the stock row drag. Plain text/plain drags (selected
        // chat text, links, text from another app) are never preventDefault'ed —
        // the old over-broad text/plain claim swallowed stock drops (S6).
        const types = event.dataTransfer ? event.dataTransfer.types : null;
        if (types === null || types === undefined) return false;
        try {
          return Array.prototype.indexOf.call(types, MIME_SESSION) !== -1;
        } catch {
          return false;
        }
      };

      const onDragOver = (event) => {
        if (dragPayload === null && isFileDrag(event)) {
          // image/file drags belong to the composer pipeline, not pane splitting
          event.preventDefault();
          try { event.dataTransfer.dropEffect = "copy"; } catch {}
          return;
        }
        const sourceId = dragPayload !== null ? dragPayload.id : externalDragSessionId;
        // A pane can never hold the same conversation twice. An internal pane
        // drag over its own frame, and any sidebar drag of a conversation that
        // is already a pane, get a red refusal wash instead of a drop zone. We
        // deliberately skip preventDefault so the browser reports "no drop".
        const refused = sourceId !== null && sourceId !== undefined && sourceId !== ""
          && (sourceId === sessionId || (dragPayload === null && treeStore.leafIds().indexOf(sourceId) !== -1));
        if (refused) {
          setZone((current) => (current === null ? current : null));
          setInvalidDrop(true);
          return;
        }
        if (dragPayload === null && !externalSessionDrag(event)) return;
        setInvalidDrop(false);
        event.preventDefault();
        try {
          event.dataTransfer.dropEffect = "move";
        } catch {}
        const rect = frameRef.current === null ? null : frameRef.current.getBoundingClientRect();
        if (rect === null) return;
        const next = zoneFor(rect, event.clientX, event.clientY);
        setZone((current) => (current === null || current.label !== next.label ? next : current));
      };
      const onDragLeave = (event) => {
        if (frameRef.current !== null && event.relatedTarget instanceof Node && frameRef.current.contains(event.relatedTarget)) return;
        setZone((current) => (current === null ? current : null));
        setInvalidDrop(false);
      };
      const onDrop = (event) => {
        setZone(null);
        setInvalidDrop(false);
        if (dragPayload === null && isFileDrag(event)) {
          event.preventDefault();
          event.stopPropagation();
          const files = imageFilesOf(event.dataTransfer);
          const intake = paneImageIntake.get(sessionId);
          if (intake !== undefined && files.length > 0) intake(files);
          // the re-hosted attachment seats listen on document for their
          // overlay reset — a pane drop never reaches them, so release the
          // overlay here through the window "dragend" reset they also watch
          try { window.dispatchEvent(new Event("dragend")); } catch {}
          return;
        }
        const payload = dragPayload;
        dragPayload = null;
        if (payload !== null) {
          event.preventDefault();
          event.stopPropagation();
          const rect = frameRef.current === null ? null : frameRef.current.getBoundingClientRect();
          const hit = rect === null ? { zone: null } : zoneFor(rect, event.clientX, event.clientY);
          if (payload.kind === "pane" && payload.id === sessionId) return;
          if (hit.zone === null) {
            if (payload.kind === "pane") treeStore.movePane(payload.id, sessionId, { dir: "h", side: "after" });
            else treeStore.addPane(payload.id);
            return;
          }
          if (payload.kind === "pane") treeStore.movePane(payload.id, sessionId, hit.zone);
          else treeStore.splitLeaf(sessionId, hit.zone.dir, payload.id, hit.zone.side);
          return;
        }
        // External drop from the native sidebar rows. 1.6.0: the plugin's
        // dragstart capture stamps MIME_SESSION on the stock row drag; the id is
        // read from that MIME first. A plain-text fallback is kept for host
        // compositions where dragstart data is unavailable — but only when the
        // dropped text names a conversation the sidebar actually shows, so an
        // arbitrary text drop is never hijacked.
        let mimeId = "";
        let plainId = "";
        try {
          if (event.dataTransfer) {
            mimeId = event.dataTransfer.getData(MIME_SESSION) || "";
            plainId = event.dataTransfer.getData("text/plain") || "";
          }
        } catch {
          mimeId = "";
          plainId = "";
        }
        const extId = (mimeId || plainId).trim();
        const viaMime = mimeId !== "";
        if (extId === "" || extId === sessionId) return;
        if (!isValidSessionId(extId)) return;
        if (!viaMime && !knownId(extId)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = frameRef.current === null ? null : frameRef.current.getBoundingClientRect();
        const hit = rect === null ? { zone: null } : zoneFor(rect, event.clientX, event.clientY);
        if (hit.zone === null) treeStore.addPane(extId);
        else treeStore.splitLeaf(sessionId, hit.zone.dir, extId, hit.zone.side);
      };

      // Shared action handlers: the full header renders them as icon buttons,
      // the compact header renders the same actions in a ⋯ menu.
      const doMaximize = () => setRuntime({ maximized: maximized ? null : sessionId });
      const doCopy = () => {
        const text = "会话 id：" + sessionId + "\n会话标题：" + (title || "");
        try {
          navigator.clipboard.writeText(text).then(
            () => showPaneToast(t("copied")),
            () => showPaneToast(t("copyFailed")),
          );
        } catch { showPaneToast(t("copyFailed")); }
      };
      const doHelp = () => openHelp();
      const doSplit = (dir, anchor) => pickerFor(sessionId, dir, anchor);
      const doClose = () => onClose(sessionId);
      const actionButton = (key, label, glyph, onClick) => h("button", {
        key,
        type: "button",
        className: "dsv-pane-btn" + (key === "close" ? " dsv-pane-btn-close" : ""),
        title: label,
        "aria-label": label,
        onClick: (event) => {
          event.stopPropagation();
          onClick(event);
        },
      }, glyph);
      const doFullscreen = () => {
        try {
          if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
            if (typeof document.exitFullscreen === "function") document.exitFullscreen();
          } else if (typeof document.documentElement.requestFullscreen === "function") {
            document.documentElement.requestFullscreen();
          }
        } catch {}
      };
      const actionButtons = appWindow === true
        ? [
          actionButton("copy", t("copy"), "⧉", doCopy),
          actionButton("help", t("helpOpen"), "?", doHelp),
          actionButton("fullscreen", t("standaloneFullscreen"), "⛶", doFullscreen),
          actionButton("minimize", t("independentMinimize"), "—", minimizeAppWindow),
          actionButton("maximize", appWindowMaximized === true ? t("restore") : t("maximize"), appWindowMaximized === true ? "⤡" : "⤢", toggleMaximizeAppWindow),
          actionButton("close", t("independentClose"), h(CloseIcon, { size: 14 }), closeAppWindow),
        ]
        : standalone === true
        ? [
          actionButton("copy", t("copy"), "⧉", doCopy),
          actionButton("help", t("helpOpen"), "?", doHelp),
          actionButton("fullscreen", t("standaloneFullscreen"), "⛶", doFullscreen),
        ]
        : floating === true
        ? [
          actionButton("dock", t("floatDock"), "⇲", () => { dockFloatToSplit(sessionId); }),
          actionButton("help", t("helpOpen"), "?", doHelp),
          actionButton("close", t("floatClose"), h(CloseIcon, { size: 14 }), () => { closeFloatWindow(sessionId); }),
        ]
        : [
          actionButton("maximize", maximized ? t("restore") : t("maximize"), maximized ? "⤡" : "⤢", doMaximize),
          actionButton("copy", t("copy"), "⧉", doCopy),
          actionButton("help", t("helpOpen"), "?", doHelp),
          actionButton("splitRight", t("splitRight"), h(SplitIconV, { size: 15 }), (event) => doSplit("h", event.currentTarget)),
          actionButton("splitDown", t("splitDown"), h(SplitIconH, { size: 15 }), (event) => doSplit("v", event.currentTarget)),
          actionButton("close", t("closePane"), h(CloseIcon, { size: 14 }), doClose),
        ];
      const menuItem = (key, label, onClick, danger) => h("button", {
        key,
        type: "button",
        className: "dsv-pane-menu-item" + (danger === true ? " danger" : ""),
        onClick: (event) => {
          event.stopPropagation();
          onClick(event);
        },
      }, label);

      const startHeaderDrag = (event) => {
        if (floating === true) { beginFloatGesture(sessionId, "move", event); return; }
        const target = event.target;
        if (target !== null && target !== undefined && typeof target.closest === "function"
            && target.closest("button,input") !== null) {
          event.preventDefault();
          return;
        }
        dragPayload = { kind: "pane", id: sessionId };
        beginDragPreview(title, t("dragHintPane"), frameRef.current, { w: paneSize.w, h: paneSize.h });
        // Live reflow: from the first dragover on, the pane's slot closes and
        // a hole opens at the destination (see beginPaneReflow).
        beginPaneReflow(sessionId, frameRef.current);
        try {
          event.dataTransfer.setData(MIME_PANE, sessionId);
          event.dataTransfer.setData("text/plain", sessionId);
          event.dataTransfer.effectAllowed = "move";
          const blank = transparentDragImage();
          if (blank !== null) event.dataTransfer.setDragImage(blank, 0, 0);
        } catch {}
      };
      const endHeaderDrag = () => {
        dragPayload = null;
        setZone(null);
        setInvalidDrop(false);
        endDragPreview();
        finishPaneReflowGesture();
        if (headerRef.current !== null) headerRef.current.draggable = false;
      };
      // A drop outside this pane (or a cancelled drag) never reaches the pane's
      // own onDrop, so clear the refusal wash from the document lifecycle too.
      React.useEffect(() => {
        const reset = () => setInvalidDrop(false);
        document.addEventListener("dragend", reset, true);
        document.addEventListener("drop", reset, true);
        return () => {
          document.removeEventListener("dragend", reset, true);
          document.removeEventListener("drop", reset, true);
        };
      }, []);

      return h(
        "div",
        {
          ref: frameRef,
          className: "dsv-pane" + (focused ? " focused" : "") + (chrome !== false ? "" : " bare")
            + (compactHeader ? " dsv-compact" : ""),
          "data-dsv-pane": sessionId,
          style: cardBoxSane ? {
            "--dsv-card-w": (cardBox.right - cardBox.left) + "px",
            "--dsv-card-left": cardBox.left + "px",
            "--dsv-card-right-inset": cardBox.rightDist + "px",
            "--dsv-card-bottom-inset": cardBox.bottomDist + "px",
            // the TUI line reads these so Alt+T keeps the composer's type scale
            "--dsv-composer-font-size": (cardFont !== null ? cardFont.fontSize : "var(--dsh-content-font-size, 14px)"),
            "--dsv-composer-line-height": (cardFont !== null ? cardFont.lineHeight : "calc(24px + var(--dsh-content-font-delta, 0px))"),
          } : (cardFont !== null ? {
            "--dsv-composer-font-size": cardFont.fontSize,
            "--dsv-composer-line-height": cardFont.lineHeight,
          } : undefined),
          onMouseDown: () => onFocus(sessionId),
          onDragOver,
          onDragLeave,
          onDrop,
          onPasteCapture: (event) => {
            // ANY clipboard paste carrying images routes into THIS pane's
            // intake — the same path as drag-drop. Image+text pastes land
            // BOTH (text at the caret, images as attachments). When the
            // clipboard carries only text/html (webpage copies), <img src>
            // references are fetched and attached, and the text still lands.
            const data = event.clipboardData;
            if (data === null || data === undefined) return;
            // Pastes landing in the NATIVE editor are the stock InputBar's
            // business: its Lexical keymap routes files through the upload
            // pipeline and text through keyboard.paste, with limits and
            // toasts. Intercepting here would double-handle (or, on the old
            // intake, drop) them — only the TUI / fallback textareas below
            // need this capture-phase intake.
            const target = event.target;
            if (target !== null && target !== undefined && typeof target.closest === "function"
                && (target.closest("[data-composer-input]") !== null
                    || (target.isContentEditable === true && target.closest("[data-dsv-composer-card]") !== null))) {
              return;
            }
            let files = imageFilesOf(data);
            if (files.length === 0 && data.items !== undefined && data.items !== null) {
              const recovered = [];
              for (const item of data.items) {
                if (item.kind !== "file" || typeof item.type !== "string" || !item.type.startsWith("image/")) continue;
                const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
                if (file !== null) recovered.push(file);
              }
              files = recovered;
            }
            const text = typeof data.getData === "function" ? (data.getData("text/plain") || "") : "";
            const intake = paneImageIntake.get(sessionId);
            if (intake === undefined) return; // fallback composer pastes via its own handler
            if (files.length > 0) {
              event.preventDefault();
              event.stopPropagation();
              intake(files, text);
              return;
            }
            let html = "";
            try { html = typeof data.getData === "function" ? (data.getData("text/html") || "") : ""; } catch { html = ""; }
            const srcs = [];
            const re = /<img[^>]*\ssrc="(https?:\/\/[^"]+)"/gi;
            let match;
            while ((match = re.exec(html)) !== null && srcs.length < 8) srcs.push(match[1]);
            if (srcs.length === 0 || text === "") return; // plain text paste: stock path
            // The TEXT half of a rich paste can only land through the editor's
            // own paste (`intake` → shell.paste at the native editor's
            // selection), so it only lands when THIS pane's native editor holds
            // the caret. In TUI mode — which short panes switch to
            // automatically — that editor is unmounted, and a paste fired with
            // no editable focus has nowhere to go either. preventDefault() here
            // then swallows the whole paste with no trace, which is exactly how
            // a link copied from a web page disappears. Fall through to the
            // browser's own paste whenever we cannot land the text.
            const caret = document.activeElement;
            const paneSel = '.dsv-pane[data-dsv-pane="' + String(sessionId).replace(/"/g, '\\"') + '"]';
            if (caret === null || caret === undefined || typeof caret.closest !== "function"
                || caret.closest(paneSel) === null
                || caret.closest("[data-composer-input]") === null) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            intake([], text); // text lands first
            for (const src of srcs) {
              fetch(src, { mode: "cors" }).then((res) => (res.ok ? res.blob() : null)).then((blob) => {
                if (blob === null || !String(blob.type).startsWith("image/")) return;
                const name = decodeURIComponent(src.split("?")[0].split("/").pop() || "pasted-image");
                const file = new File([blob], name, { type: blob.type || "image/png" });
                const hook = paneImageIntake.get(sessionId);
                if (hook !== undefined) hook([file]);
              }).catch(() => {});
            }
          },
        },
        chrome !== false ? h(
          "div",
          {
            ref: headerRef,
            className: "dsv-pane-header", draggable: false,
            onMouseDown: floating === true || standalone === true ? undefined : (event) => {
              const header = headerRef.current;
              if (header === null) return;
              const target = event.target;
              const interactive = target !== null && target !== undefined && typeof target.closest === "function"
                && target.closest("button,input,.dsv-pane-title-text") !== null;
              header.draggable = !interactive;
            },
            onDragStart: floating === true || standalone === true ? undefined : startHeaderDrag,
            onDragEnd: floating === true || standalone === true ? undefined : endHeaderDrag,
            onPointerDown: floating === true ? startHeaderDrag : undefined,
            onPointerMove: floating === true ? moveFloatGesture : undefined,
            onPointerUp: floating === true ? endFloatGesture : undefined,
            onPointerCancel: floating === true ? endFloatGesture : undefined,
            title: floating === true ? t("floatHint") : title,
            onDoubleClick: floating === true ? undefined : appWindow === true
              ? (event) => {
                  const target = event.target;
                  if (target !== null && target !== undefined && typeof target.closest === "function"
                      && target.closest("button,input,.dsv-pane-title-text") !== null) return;
                  toggleMaximizeAppWindow();
                }
              : standalone === true
              ? (event) => {
                  const target = event.target;
                  if (target !== null && target !== undefined && typeof target.closest === "function"
                      && target.closest("button,input,.dsv-pane-title-text") !== null) return;
                  doFullscreen();
                }
              : (event) => {
                  const target = event.target;
                  if (target !== null && target !== undefined && typeof target.closest === "function"
                      && target.closest("button,input,.dsv-pane-title-text") !== null) return;
                  setRuntime({ maximized: maximized ? null : sessionId });
                },
          },
          // Reserved even when idle: the dot used to appear/disappear and
          // shifted the title's left edge by 15px between panes.
          h("span", { className: "dsv-pane-running" + (running ? "" : " idle"), title: running ? t("running") : undefined }),
          renaming
            ? h("input", {
                className: "dsv-pane-title-input",
                value: renameDraft,
                autoFocus: true,
                onChange: (event) => setRenameDraft(event.target.value),
                onClick: (event) => event.stopPropagation(),
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const next = renameDraft.trim();
                    setRenaming(false);
                    if (next && next !== title) renamePaneSession(sessionId, next);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setRenaming(false);
                  }
                },
                onBlur: () => {
                  const next = renameDraft.trim();
                  setRenaming(false);
                  if (next && next !== title) renamePaneSession(sessionId, next);
                },
                "aria-label": t("renameHint"),
              })
            : h("span", { className: "dsv-pane-title" },
                h("span", {
                  className: "dsv-pane-title-text dsv-pane-title-edit",
                  title: t("renameHint"),
                  onClick: (event) => {
                    event.stopPropagation();
                    if (summary !== null && summary !== undefined && summary.blank === true) {
                      showPaneToast(t("renameBlank"));
                      return;
                    }
                    setRenameDraft(title);
                    setRenaming(true);
                  },
                }, title)),
          cwd !== "" && cwd !== title ? h("span", { className: "dsv-pane-cwd" }, cwd) : null,
          h("span", { className: "dsv-pane-header-spacer" }),
          // no band under the card and no gutter beside it: the toggle docks
          // here, where the composer can never reach it. TUI mode renders the
          // toggle inline in its own line, so the header must stay out of it.
          modeBtnInHeader && composerMode !== "tui" ? modeBtnNode : null,
          compactHeader
            ? h("button", {
                type: "button",
                className: "dsv-pane-btn dsv-pane-menu-btn",
                title: t("moreActions"),
                "aria-label": t("moreActions"),
                onClick: (event) => { event.stopPropagation(); setMenuOpen((v) => !v); },
              }, "⋯")
            : actionButtons,
        ) : null,
        h(ChatPane, { sessionId, session, narrow, summary, composerMode, onToggleComposerMode: toggleComposerMode, toggleNode: composerMode === "tui" ? modeBtnNode : null }),
        composerMode !== "tui" && chrome !== false && !modeBtnInHeader ? h("button", {
          type: "button",
          className: "dsv-mode-btn",
          style: { right: modeBtnRight + "px", bottom: modeBtnBottom + "px" },
          title: "TUI composer (Alt+T)",
          "aria-label": "TUI composer (Alt+T)",
          onClick: (event) => {
            event.stopPropagation();
            toggleComposerMode();
          },
        }, h(ComposerModeIcon, { tui: composerMode === "tui" })) : null,
        compactHeader && menuOpen ? h("div", {
          className: "dsv-pane-menu",
          onPointerDown: (event) => event.stopPropagation(),
        },
          ...(appWindow === true ? [
            menuItem("copy", t("copy"), () => { setMenuOpen(false); doCopy(); }),
            menuItem("help", t("helpOpen"), () => { setMenuOpen(false); doHelp(); }),
            menuItem("fullscreen", t("standaloneFullscreen"), () => { setMenuOpen(false); doFullscreen(); }),
            menuItem("minimize", t("independentMinimize"), () => { setMenuOpen(false); minimizeAppWindow(); }),
            menuItem("maximize", appWindowMaximized === true ? t("restore") : t("maximize"), () => { setMenuOpen(false); toggleMaximizeAppWindow(); }),
            menuItem("close", t("independentClose"), () => { setMenuOpen(false); closeAppWindow(); }, true),
          ] : standalone === true ? [
            menuItem("copy", t("copy"), () => { setMenuOpen(false); doCopy(); }),
            menuItem("help", t("helpOpen"), () => { setMenuOpen(false); doHelp(); }),
            menuItem("fullscreen", t("standaloneFullscreen"), () => { setMenuOpen(false); doFullscreen(); }),
          ] : floating === true ? [
            menuItem("dock", t("floatDock"), () => { setMenuOpen(false); dockFloatToSplit(sessionId); }),
            menuItem("help", t("helpOpen"), () => { setMenuOpen(false); doHelp(); }),
            menuItem("close", t("floatClose"), () => { setMenuOpen(false); closeFloatWindow(sessionId); }, true),
          ] : [
            menuItem("maximize", maximized ? t("restore") : t("maximize"), () => { setMenuOpen(false); doMaximize(); }),
            menuItem("copy", t("copy"), () => { setMenuOpen(false); doCopy(); }),
            menuItem("help", t("helpOpen"), () => { setMenuOpen(false); doHelp(); }),
            menuItem("splitRight", t("splitRight"), (event) => { doSplit("h", event.currentTarget); setMenuOpen(false); }),
            menuItem("splitDown", t("splitDown"), (event) => { doSplit("v", event.currentTarget); setMenuOpen(false); }),
            menuItem("close", t("closePane"), () => { setMenuOpen(false); doClose(); }, true),
          ]),
        ) : null,
        zone !== null
          ? h("div", { className: "dsv-drop-ghost", style: ghostStyle(zone) }, h("span", { className: "dsv-drop-label" }, t(zone.label)))
          : null,
        invalidDrop
          ? h("div", { className: "dsv-pane-invalid", "data-dsv-invalid-drop": "true", "aria-hidden": "true" },
              h("div", { className: "dsv-pane-invalid-card" },
                h("span", { className: "dsv-pane-invalid-icon" }, "⊘"),
                h("span", null, t("sameSessionBody"))))
          : null,
      );
    }

    /** Memoized pane frame: the sessions list mutates on every activity tick,
        which used to re-render every pane's re-hosted native components. The
        comparator treats dispatcher closures as stable (they are pure calls
        into module singletons) and compares summaries by displayed fields. */
    function summaryShallowEqual(a, b) {
      if (a === b) return true;
      if (a === undefined || a === null || b === undefined || b === null) return a === b;
      return a.running === b.running
        && (a.displayTitle !== undefined ? a.displayTitle : a.title) === (b.displayTitle !== undefined ? b.displayTitle : b.title)
        && a.cwd === b.cwd;
    }
    const PaneFrameMemo = React.memo(
      PaneFrame,
      (a, b) => a.sessionId === b.sessionId
        && a.session === b.session
        && a.focused === b.focused
        && a.chrome === b.chrome
        && a.floating === b.floating
        && a.standalone === b.standalone
        && a.appWindow === b.appWindow
        && a.appWindowMaximized === b.appWindowMaximized
        && summaryShallowEqual(a.summary, b.summary),
    );

    // ---------------------------------------------------------------------
    // canvas: recursive split rendering + dividers
    // ---------------------------------------------------------------------

    function childStyle(sizes, index, count, dir) {
      const ratio = sizes && sizes[index] ? sizes[index] : 1 / count;
      const gaps = GAP * (count - 1);
      const basis = "calc(" + (ratio * 100).toFixed(4) + "% - " + (gaps / count).toFixed(4) + "px)";
      return dir === "h" ? { width: basis, height: "100%" } : { height: basis, width: "100%" };
    }

    function RenderLeaf({ id, chrome, generation, floating, standalone, appWindow, appWindowMaximized }) {
      const state = useTree();
      const sessions = useSessionsList();
      const liveSummary = sessions !== null && sessions !== undefined && sessions.byId !== undefined ? sessions.byId[id] : undefined;
      if (liveSummary !== undefined && liveSummary !== null) rememberSessionSummary(id, liveSummary);
      // Sticky: the scraped sidebar is advisory (see useSessionFace). A live
      // pane whose row is filtered/collapsed out keeps its title instead of
      // flipping to "Session ended"/bare-id.
      const summary = liveSummary !== undefined && liveSummary !== null ? liveSummary : lastSessionSummaries.get(id);
      // Retained on demand and re-resolved when the binding appears: a pane
      // added for a session nobody holds has no face on the first render
      // (0.2.0 borrows bindings, it does not create them).
      const session = useSessionFace(id);
      return h(PaneShellBoundary, { sessionId: id, resetKey: generation }, h(PaneFrameMemo, {
        sessionId: id,
        session,
        summary,
        // A lone pane renders without the pane header, so a single
        // conversation looks exactly like the stock view.
        chrome: chrome !== false,
        floating: floating === true,
        standalone: standalone === true,
        appWindow: appWindow === true,
        appWindowMaximized: appWindowMaximized === true,
        focused: floating !== true && standalone !== true && state.focus === id,
        onFocus: floating === true ? (sid) => { floatStore.focus(sid); } : (sid) => treeStore.setFocus(sid),
        // Teardown is NOT done here any more: treeStore.commit schedules the
        // departed leaf for disposal and ChatPane releases on unmount, so every
        // leaf-mutation path (✕, sidebar swap, closeFocused, movePane) is
        // covered by the same idempotent path.
        onClose: floating === true ? () => closeFloatWindow(id) : appWindow === true ? () => closeAppWindow() : (sid) => closePaneAnimated(sid),
        pickerFor: floating === true || standalone === true ? () => {} : (...args) => togglePicker(...args),
      }));
    }

    function RenderSplit({ node, generation }) {
      const kids = Array.isArray(node.kids) ? node.kids : [];
      const dir = node.dir === "v" ? "v" : "h";
      const count = Math.max(1, kids.length);
      const elements = [];
      kids.forEach((kid, index) => {
        const style = childStyle(node.sizes, index, count, dir);
        // The generation is part of the key: a root-standard generation change
        // remounts every pane ONCE, which lets their unmount effects dispose the
        // dead generation's guards/references instead of swapping face
        // identities underneath live panes (the prepareNative storm path).
        if (kid.t === "leaf") {
          elements.push(
            h("div", { key: kid.id + ":" + generation, style, className: "dsv-pane-wrap", "data-dsv-leaf": kid.id },
              h(RenderLeaf, { id: kid.id, chrome: true, generation })),
          );
        } else {
          elements.push(
            h("div", { key: (kid.sid || "s" + index) + ":" + generation, style, className: "dsv-split-wrap" },
              h(RenderSplit, { node: kid, generation })),
          );
        }
        if (index < count - 1) elements.push(h(Divider, { key: "d" + index + "-" + node.sid, dir, node, index }));
      });
      return h("div", { className: "dsv-split", "data-dir": dir }, elements);
    }

    function Divider({ dir, node, index }) {
      const [active, setActive] = React.useState(false);
      const dragRef = React.useRef(null);
      const onPointerDown = (event) => {
        event.preventDefault();
        const parent = event.currentTarget.parentElement;
        if (parent === null) return;
        const rect = parent.getBoundingClientRect();
        const total = (dir === "h" ? rect.width : rect.height) - GAP * (Math.max(1, node.kids.length) - 1);
        const kidCount = Math.max(1, node.kids.length);
        const evenRatio = 1 / kidCount;
        dragRef.current = {
          pointerId: event.pointerId,
          start: dir === "h" ? event.clientX : event.clientY,
          total: Math.max(1, total),
          ratios: Array.isArray(node.sizes) && node.sizes.length === node.kids.length
            ? node.sizes.slice()
            : node.kids.map(() => evenRatio),
          index,
          min: Math.max(0.04, MIN_PANE_PX / Math.max(1, total)),
        };
        setActive(true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
      };
      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const delta = (dir === "h" ? event.clientX : event.clientY) - drag.start;
        const ratios = drag.ratios.slice();
        const a = drag.index;
        const b = drag.index + 1;
        const pair = ratios[a] + ratios[b];
        ratios[a] = Math.min(pair - drag.min, Math.max(drag.min, drag.ratios[a] + delta / drag.total));
        ratios[b] = pair - ratios[a];
        treeStore.setSizes(node.sid, ratios);
      };
      const finish = (event) => {
        if (dragRef.current === null || dragRef.current.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setActive(false);
        treeStore.persistNow();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      };
      return h("div", {
        className: "dsv-divider" + (active ? " active" : ""),
        onPointerDown,
        onPointerMove,
        onPointerUp: finish,
        onPointerCancel: finish,
        role: "separator",
        "aria-orientation": dir === "h" ? "vertical" : "horizontal",
      });
    }

    function addCurrentSession() {
      const id = currentSessionId();
      if (id === undefined || id === null) return;
      // A pane never needs a "complete" kit any more: it re-hosts the stock
      // transcript when the session faces are up and its own renderers when
      // they are not (see sessionFacesReady). Only a genuinely unresolvable
      // session is refused.
      if (!paneKitTrustworthy(id)) warnPaneKitUnavailable(id);
      try {
        treeStore.addPane(id);
      } catch {}
    }

    function Canvas({ generation }) {
      const state = useTree();
      useRuntime();
      if (state.root === null) {
        return h(
          "div",
          { className: "dsv-empty" },
          h(SplitIconV, { size: 34 }),
          h("div", { className: "dsv-empty-title" }, t("emptyTitle")),
          h("div", { className: "dsv-empty-hint" }, t("emptyHint")),
          h("button", { type: "button", className: "dsv-empty-btn", onClick: addCurrentSession },
            h(PrimIcon, { prim: "IconPlusOutline16" }), t("addCurrent")),
        );
      }
      const maximized = runtimeState.maximized;
      if (maximized !== null && findLeafNode(state.root, maximized) !== null) {
        return h(
          "div",
          { className: "dsv-canvas" },
          h("div", { className: "dsv-pane-wrap", "data-dsv-leaf": maximized, style: { flex: 1, display: "flex", minWidth: 0, minHeight: 0 } },
            h(RenderLeaf, { id: maximized, chrome: true, generation })),
        );
      }
      return h(
        "div",
        { className: "dsv-canvas" },
        state.root.t === "leaf"
          ? h("div", { className: "dsv-pane-wrap", "data-dsv-leaf": state.root.id, style: { flex: 1, display: "flex", minWidth: 0, minHeight: 0 } },
              h(RenderLeaf, { id: state.root.id, chrome: false, generation }))
          : h(RenderSplit, { node: state.root, generation }),
      );
    }

    // ---------------------------------------------------------------------
