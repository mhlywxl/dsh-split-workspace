    // ---------------------------------------------------------------------
    // live pane reflow
    //
    // Dragging a pane by its header behaves like dragging a grid tile: the
    // dragged pane's slot closes immediately (the remaining panes fill it),
    // and moving over another pane opens a hole on the side the gesture is
    // heading for, so the destination is visible before the mouse is
    // released. The preview is PURE GEOMETRY — the React tree is untouched
    // until the drop. Rebuilding the tree on every hover would remount every
    // re-hosted ChatView (transcript reload, composer state) and would make
    // the preview jitter; the wrappers are absolutely placed for the length
    // of the drag instead, and the real tree is swapped in once on drop.
    // ---------------------------------------------------------------------
    const REFLOW_HOLE_ID = "__dsv_hole__";
    const reflowState = {
      active: false,     // drag is ours; document listeners act on it
      armed: false,      // preview applied (never inside dragstart itself)
      settling: false,   // cancel animation is running, class still applied
      sourceId: null,
      root: null,        // tree snapshot taken at drag start
      canvas: null,
      canvasRect: null,  // client rect of the canvas at drag start
      originalRects: null, // leaf id -> { left, top, width, height } (canvas space)
      sourceRect: null,  // the dragged pane's slot at drag start
      collapsedRects: null, // layout after removing the source (what is on screen)
      leftSource: false, // pointer has left the source slot at least once
      wrappers: null,    // leaf id -> .dsv-pane-wrap element
      rects: null,       // geometry currently applied
      hole: null,
      targetId: null,
      zone: null,        // { dir, side, label }
      acc: { x: 0, y: 0 }, // movement since the last direction decision
      direction: null,   // last committed gesture direction (pauses keep it)
      last: null,
      start: null,
      timer: 0,          // settle animation timer
      pendingTimer: 0,   // deferred dragend finish (a drop may arrive after it)
      dropped: false,
      overCount: 0,
      dropCount: 0,
      endCount: 0,
      lastOver: null,
      lastDrop: null,
    };

    function setReflowBox(el, rect) {
      // Diff before writing. Every write invalidates style/layout for the
      // whole pane (and its transcript), so a zone change used to dirty all
      // panes even when only one box actually moved.
      const prev = el.__dsvReflowBox;
      if (prev !== undefined
        && prev.left === rect.left && prev.top === rect.top
        && prev.width === rect.width && prev.height === rect.height) return;
      el.__dsvReflowBox = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      el.style.setProperty("--dsv-rl", rect.left + "px");
      el.style.setProperty("--dsv-rt", rect.top + "px");
      el.style.setProperty("--dsv-rw", rect.width + "px");
      el.style.setProperty("--dsv-rh", rect.height + "px");
    }
    function clearReflowBox(el) {
      delete el.__dsvReflowBox;
      el.style.removeProperty("--dsv-rl");
      el.style.removeProperty("--dsv-rt");
      el.style.removeProperty("--dsv-rw");
      el.style.removeProperty("--dsv-rh");
    }
    /** True while a pane-drag preview is laying panes out. Geometry-derived
        React state and dock measurements are frozen for the duration: every
        preview frame would otherwise re-render each pane and re-measure its
        composer, which is what made a drag feel heavy. */
    function inLiveReflow(el) {
      try {
        return el !== null && el !== undefined && typeof el.closest === "function"
          && el.closest(".dsv-canvas.dsv-reflowing") !== null;
      } catch { return false; }
    }

    function reflowWrappers(canvas) {
      const map = new Map();
      for (const el of canvas.querySelectorAll(".dsv-pane-wrap[data-dsv-leaf]")) {
        map.set(el.getAttribute("data-dsv-leaf"), el);
      }
      return map;
    }

    /** Rects for a tree laid out in `box`, measured in canvas space. Mirrors
        RenderSplit/childStyle: dividers take GAP px out of the axis, the
        kids split the rest by ratio. */
    function reflowLayoutRects(node, box, out) {
      if (node === null || node === undefined) return out;
      if (node.t === "leaf") {
        out[node.id] = { left: box.left, top: box.top, width: box.width, height: box.height };
        return out;
      }
      const kids = Array.isArray(node.kids) ? node.kids : [];
      if (kids.length === 1) {
        reflowLayoutRects(kids[0], box, out);
        return out;
      }
      const horizontal = node.dir === "h";
      const avail = Math.max(0, (horizontal ? box.width : box.height) - GAP * (kids.length - 1));
      const sizes = Array.isArray(node.sizes) && node.sizes.length === kids.length
        ? node.sizes
        : kids.map(() => 1 / kids.length);
      let offset = 0;
      for (let i = 0; i < kids.length; i++) {
        const size = Math.max(0, sizes[i] * avail);
        reflowLayoutRects(
          kids[i],
          horizontal
            ? { left: box.left + offset, top: box.top, width: size, height: box.height }
            : { left: box.left, top: box.top + offset, width: box.width, height: size },
          out,
        );
        offset += size + GAP;
      }
      return out;
    }

    function reflowZoneFor(direction) {
      if (direction === "left") return { dir: "h", side: "before", label: "dropSplitLeft" };
      if (direction === "right") return { dir: "h", side: "after", label: "dropSplitRight" };
      if (direction === "up") return { dir: "v", side: "before", label: "dropSplitTop" };
      if (direction === "down") return { dir: "v", side: "after", label: "dropSplitBottom" };
      return null;
    }

    /** The tree the drop would produce: the source is removed first (its slot
        closes) and then re-inserted beside the target — the same arithmetic
        as treeStore.movePane, with the new leaf named either the preview's
        placeholder or the real session id. */
    function reflowTree(root, sourceId, targetId, zone, newLeafId) {
      if (root === null) return null;
      const [base] = removeLeaf(root, sourceId);
      if (targetId === null || zone === null) return base;
      if (base === null) return null;
      const [tree, ok] = splitLeafTree(base, targetId, zone.dir, newLeafId, zone.side);
      return ok ? tree : base;
    }

    /** Commit a direction after ~8px of movement, whichever way that motion
        pointed. Accumulating (rather than reading the last event) makes slow
        drags work, keeps a pause from erasing the hole, and lets a deliberate
        L-shaped move switch the drop side in one gesture. */
    function reflowNoteMotion(dx, dy) {
      reflowState.acc.x += dx;
      reflowState.acc.y += dy;
      if (Math.hypot(reflowState.acc.x, reflowState.acc.y) < 8) return;
      const ax = Math.abs(reflowState.acc.x);
      const ay = Math.abs(reflowState.acc.y);
      if (ax >= ay) reflowState.direction = reflowState.acc.x >= 0 ? "right" : "left";
      else reflowState.direction = reflowState.acc.y >= 0 ? "down" : "up";
      reflowState.acc.x = 0;
      reflowState.acc.y = 0;
    }

    function reflowHole() {
      if (reflowState.hole !== null && reflowState.hole.isConnected) return reflowState.hole;
      const hole = document.createElement("div");
      hole.className = "dsv-reflow-hole";
      hole.dataset.plugin = PLUGIN_ID;
      hole.dataset.dsvFixed = "true";
      const label = document.createElement("span");
      label.className = "dsv-drop-label";
      hole.appendChild(label);
      hole.hidden = true;
      document.body.appendChild(hole);
      reflowState.hole = hole;
      return hole;
    }

    function reflowApply(tree, zone) {
      const canvas = reflowState.canvas;
      if (canvas === null || tree === null || reflowState.canvasRect === null) return;
      const rects = reflowLayoutRects(tree, { left: 0, top: 0, width: reflowState.canvasRect.width, height: reflowState.canvasRect.height }, {});
      for (const [id, el] of reflowState.wrappers) {
        const rect = rects[id];
        if (rect !== undefined) setReflowBox(el, rect);
      }
      const holeRect = zone !== null ? rects[REFLOW_HOLE_ID] : undefined;
      const hole = reflowHole();
      if (holeRect === undefined) {
        hole.hidden = true;
      } else {
        hole.hidden = false;
        const left = reflowState.canvasRect.left + holeRect.left;
        const top = reflowState.canvasRect.top + holeRect.top;
        hole.style.left = left + "px";
        hole.style.top = top + "px";
        hole.style.width = holeRect.width + "px";
        hole.style.height = holeRect.height + "px";
        hole.firstChild.textContent = t(zone.label);
      }
      reflowState.rects = rects;
    }

    function beginPaneReflow(sessionId, frameEl) {
      try {
        if (!treeStore.isActive()) return;
        if (runtimeState.maximized !== null) return;
        if (frameEl === null || frameEl === undefined || typeof frameEl.closest !== "function") return;
        const canvas = frameEl.closest(".dsv-canvas");
        if (canvas === null) return;
        endPaneReflow(false);
        const origin = canvas.getBoundingClientRect();
        const wrappers = reflowWrappers(canvas);
        if (wrappers.size < 2) return;
        const rects = {};
        for (const [id, el] of wrappers) {
          const r = el.getBoundingClientRect();
          rects[id] = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
        }
        reflowState.active = true;
        reflowState.armed = false;
        reflowState.settling = false;
        reflowState.sourceId = sessionId;
        reflowState.root = treeStore.getSnapshot().root;
        reflowState.canvas = canvas;
        reflowState.canvasRect = origin;
        reflowState.originalRects = rects;
        reflowState.sourceRect = rects[sessionId] !== undefined ? rects[sessionId] : null;
        const [baseTree] = removeLeaf(reflowState.root, sessionId);
        reflowState.collapsedRects = baseTree === null
          ? {}
          : reflowLayoutRects(baseTree, { left: 0, top: 0, width: origin.width, height: origin.height }, {});
        reflowState.leftSource = false;
        reflowState.wrappers = wrappers;
        reflowState.rects = null;
        reflowState.targetId = null;
        reflowState.zone = null;
        reflowState.acc = { x: 0, y: 0 };
        reflowState.direction = null;
        reflowState.last = null;
        reflowState.start = null;
        reflowState.timer = 0;
        reflowState.pendingTimer = 0;
        reflowState.dropped = false;
        reflowState.overCount = 0;
        reflowState.dropCount = 0;
        reflowState.endCount = 0;
        reflowState.lastOver = null;
        reflowState.lastDrop = null;
      } catch {
        endPaneReflow(false);
      }
    }

    /** First dragover: the drag is definitely in flight, so hiding the drag
        source now can no longer cancel it. Seed the absolute boxes with the
        live flex geometry, force one layout, then let the collapse run. */
    function reflowArm() {
      if (!reflowState.active || reflowState.armed) return;
      const canvas = reflowState.canvas;
      if (canvas === null || !canvas.isConnected) {
        endPaneReflow(false);
        return;
      }
      reflowState.wrappers = reflowWrappers(canvas);
      canvas.classList.add("dsv-reflowing");
      document.body.classList.add("dsv-layout-previewing");
      for (const [id, el] of reflowState.wrappers) {
        const rect = reflowState.originalRects[id];
        if (rect !== undefined) setReflowBox(el, rect);
        if (id === reflowState.sourceId) {
          el.setAttribute("data-dsv-source", "");
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        }
      }
      // Positions transitioned from `auto` do not animate: establish the
      // start values with a synchronous layout read first.
      void canvas.offsetWidth;
      reflowApply(reflowTree(reflowState.root, reflowState.sourceId, null, null, REFLOW_HOLE_ID), null);
      reflowState.armed = true;
    }

    function updatePaneReflow(event) {
      if (!reflowState.active) return;
      if (!reflowState.armed) reflowArm();
      if (!reflowState.active || !reflowState.armed) return;
      const origin = reflowState.canvasRect;
      if (origin === null) return;
      const x = event.clientX;
      const y = event.clientY;
      reflowState.overCount += 1;
      reflowState.lastOver = { x: Math.round(x), y: Math.round(y) };
      if (reflowState.start === null) {
        reflowState.start = { x, y };
        reflowState.last = { x, y, t: event.timeStamp };
      } else {
        reflowNoteMotion(x - reflowState.last.x, y - reflowState.last.y);
        reflowState.last = { x, y, t: event.timeStamp };
      }
      const moved = Math.hypot(x - reflowState.start.x, y - reflowState.start.y);
      if (moved < 8) return;
      const rx = x - origin.left;
      const ry = y - origin.top;
      const sourceRect = reflowState.sourceRect;
      if (sourceRect !== null
        && (rx < sourceRect.left || rx > sourceRect.left + sourceRect.width
          || ry < sourceRect.top || ry > sourceRect.top + sourceRect.height)) {
        // The source slot answers "no target" only UNTIL the pointer leaves
        // it once. After that the same screen area belongs to the pane that
        // expanded into it, so dragging back over the old slot must show a
        // hole again (the returned-to-home case).
        reflowState.leftSource = true;
      }
      // Hit-test the COLLAPSED layout: that is exactly what the screen shows
      // after the source slot closed, and it is fixed for the whole drag, so
      // the preview can never steer its own next target.
      let targetId = null;
      if (reflowState.leftSource && rx >= 0 && ry >= 0 && rx <= origin.width && ry <= origin.height) {
        for (const [id, rect] of Object.entries(reflowState.collapsedRects)) {
          if (rx >= rect.left && rx <= rect.left + rect.width && ry >= rect.top && ry <= rect.top + rect.height) {
            targetId = id;
            break;
          }
        }
      }
      // A pause before release can deliver one final zero-delta dragover;
      // letting that erase the direction would close the hole under the
      // cursor and drop as a no-op. reflowNoteMotion only commits on movement.
      const direction = reflowState.direction;
      const zone = targetId !== null && direction !== null ? reflowZoneFor(direction) : null;
      const sameZone = zone === null
        ? reflowState.zone === null
        : reflowState.zone !== null && reflowState.zone.label === zone.label;
      if (targetId === reflowState.targetId && sameZone) return;
      reflowState.targetId = targetId;
      reflowState.zone = zone;
      reflowApply(reflowTree(reflowState.root, reflowState.sourceId, targetId, zone, REFLOW_HOLE_ID), zone);
    }

    function sameTreeShape(a, b) {
      if (a === b) return true;
      if (a === null || b === null || a === undefined || b === undefined) return false;
      if (a.t !== b.t) return false;
      if (a.t === "leaf") return a.id === b.id;
      if (a.dir !== b.dir || !Array.isArray(a.kids) || !Array.isArray(b.kids) || a.kids.length !== b.kids.length) return false;
      for (let i = 0; i < a.kids.length; i += 1) {
        if (!sameTreeShape(a.kids[i], b.kids[i])) return false;
      }
      return true;
    }

    function collapsePaneReflow() {
      const state = reflowState;
      if (state.timer !== 0) {
        try { window.clearTimeout(state.timer); } catch {}
        state.timer = 0;
      }
      if (state.pendingTimer !== 0) {
        try { window.clearTimeout(state.pendingTimer); } catch {}
        state.pendingTimer = 0;
      }
      const canvas = state.canvas;
      if (canvas !== null) canvas.classList.remove("dsv-reflowing", "dsv-reflow-settling");
      document.body.classList.remove("dsv-layout-previewing");
      scheduleTocGripSync(260);
      if (state.wrappers !== null) {
        for (const el of state.wrappers.values()) {
          if (el !== null && el !== undefined) {
            el.removeAttribute("data-dsv-source");
            el.style.opacity = "";
            el.style.pointerEvents = "";
            clearReflowBox(el);
          }
        }
      }
      if (state.hole !== null) {
        const hole = state.hole;
        state.hole = null;
        try { hole.remove(); } catch {}
      }
      state.active = false;
      state.armed = false;
      state.settling = false;
      state.sourceId = null;
      state.root = null;
      state.canvas = null;
      state.canvasRect = null;
      state.originalRects = null;
      state.sourceRect = null;
      state.collapsedRects = null;
      state.leftSource = false;
      state.wrappers = null;
      state.rects = null;
      state.targetId = null;
      state.zone = null;
      state.last = null;
      state.start = null;
      state.direction = null;
      state.acc = { x: 0, y: 0 };
      state.dropped = false;
    }

    /** End the drag: on a drop the committed tree already equals the preview,
        so the class is removed in the same frame as the commit. On a cancel,
        the panes glide back to the boxes measured at drag start first. */
    function endPaneReflow(animateBack) {
      if (!reflowState.active && !reflowState.settling) return;
      const canAnimate = animateBack !== false
        && reflowState.armed
        && reflowState.canvas !== null
        && reflowState.canvas.isConnected
        && reflowState.wrappers !== null
        && reflowState.originalRects !== null
        && !prefersReducedMotion();
      if (!canAnimate) {
        collapsePaneReflow();
        return;
      }
      // Arm the transition only for the glide-back, never for the live
      // preview (see the stylesheet comment).
      const settleCanvas = reflowState.canvas;
      if (settleCanvas !== null && settleCanvas.isConnected) settleCanvas.classList.add("dsv-reflow-settling");
      for (const [id, el] of reflowState.wrappers) {
        const rect = reflowState.originalRects[id];
        if (rect !== undefined) setReflowBox(el, rect);
        el.removeAttribute("data-dsv-source");
        el.style.opacity = "";
        el.style.pointerEvents = "";
      }
      if (reflowState.hole !== null) reflowState.hole.hidden = true;
      reflowState.active = false;
      reflowState.settling = true;
      reflowState.timer = window.setTimeout(() => {
        reflowState.timer = 0;
        collapsePaneReflow();
      }, 220);
    }

    function dropPaneReflow() {
      if (!reflowState.active && !reflowState.settling) return;
      if (reflowState.pendingTimer !== 0) {
        try { window.clearTimeout(reflowState.pendingTimer); } catch {}
        reflowState.pendingTimer = 0;
      }
      const root = reflowState.root;
      const sourceId = reflowState.sourceId;
      const targetId = reflowState.targetId;
      const zone = reflowState.zone;
      // A tree changed under the drag (a pane closed from a keyboard path,
      // a session swap) invalidates the preview: do not resurrect leaves.
      const current = treeStore.getSnapshot().root;
      const finalTree = targetId !== null && zone !== null && current === root
        ? reflowTree(root, sourceId, targetId, zone, sourceId)
        : null;
      reflowState.dropCount += 1;
      reflowState.lastDrop = {
        sourceId,
        targetId,
        zone: zone === null ? null : zone.label,
        active: reflowState.active,
        settling: reflowState.settling,
        treeChanged: current !== root,
        commit: finalTree !== null && !sameTreeShape(finalTree, current),
      };
      collapsePaneReflow();
      if (finalTree !== null && !sameTreeShape(finalTree, current)) {
        treeStore.replaceRoot(finalTree);
      }
    }

    /** dragend does not always arrive after drop: Chromium's synthesized
        drag gestures have delivered it first, and the old immediate cancel
        swallowed the drop. Defer one task; if a drop lands in that window the
        commit wins, otherwise the preview glides back. */
    function finishPaneReflowGesture() {
      if (!reflowState.active && !reflowState.settling) return;
      if (reflowState.pendingTimer !== 0) return;
      reflowState.pendingTimer = window.setTimeout(() => {
        reflowState.pendingTimer = 0;
        if (!reflowState.active && !reflowState.settling) return;
        reflowState.endCount += 1;
        if (reflowState.dropped) dropPaneReflow();
        else endPaneReflow(true);
      }, 0);
    }

    function registerPaneReflow() {
      const onDragOver = (event) => {
        if (!reflowState.active) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = "move"; } catch {}
        event.stopPropagation();
        updatePaneReflow(event);
      };
      const onDrop = (event) => {
        if (!reflowState.active && !reflowState.settling) return;
        event.preventDefault();
        event.stopPropagation();
        reflowState.dropped = true;
        dropPaneReflow();
      };
      const onDragEnd = () => {
        finishPaneReflowGesture();
      };
      // Escape is deliberately NOT handled here: Chromium cancels the native
      // drag itself and fires dragend, and deactivating the preview mid-flight
      // would let a later drop fall through to the pane's own handler.
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("dragend", onDragEnd, true);
      window.addEventListener("blur", onDragEnd);
      return () => {
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("dragend", onDragEnd, true);
        window.removeEventListener("blur", onDragEnd);
        if (reflowState.timer !== 0) {
          try { window.clearTimeout(reflowState.timer); } catch {}
          reflowState.timer = 0;
        }
        if (reflowState.pendingTimer !== 0) {
          try { window.clearTimeout(reflowState.pendingTimer); } catch {}
          reflowState.pendingTimer = 0;
        }
        collapsePaneReflow();
      };
    }

    // ---------------------------------------------------------------------
    // live EXTERNAL drop preview (sidebar conversation -> workspace)
    //
    // Dropping a conversation dragged out of the stock sidebar onto a pane
    // edge splits that pane. A dashed 50% ghost used to be the only feedback,
    // so the user never saw what the split would actually look like until the
    // mouse was released. The preview below lays the REAL tree out before the
    // drop: every existing pane is absolutely placed at its post-drop box and
    // the new pane's slot is a hole showing the dragged conversation's title.
    // Nothing is committed until the drop; the store's own splitLeaf/addPane
    // then performs the exact mutation the geometry promised.
    // ---------------------------------------------------------------------
    const EXT_REFLOW_LEAF = "__dsv_ext__";
    const extReflow = {
      active: false,
      armed: false,
      canvas: null,
      canvasRect: null,
      wrappers: null,
      originalRects: null,
      root: null,
      sessionId: null,
      title: "",
      targetId: null,
      zone: null,      // { dir, side, label, zone } | null (centre = auto add)
      hit: false,      // pointer is over a pane right now
      hole: null,
      timer: 0,
    };

    /** Sidebar row title for the hole; falls back to the list snapshot/id. */
    function extSessionTitle(sessionId) {
      try {
        const selector = '[data-row-key="session:' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sessionId) : sessionId) + '"]';
        const row = document.querySelector(selector);
        if (row !== null) {
          const title = rowDragTitle(row);
          if (typeof title === "string" && title !== "") return title;
        }
      } catch {}
      try {
        const snap = sessionsListSource !== undefined && sessionsListSource !== null
          && typeof sessionsListSource.getSnapshot === "function" ? sessionsListSource.getSnapshot() : null;
        const entry = snap !== null && snap !== undefined && snap.byId !== undefined ? snap.byId[sessionId] : null;
        const title = entry !== null && entry !== undefined ? (entry.displayTitle || entry.title) : "";
        if (typeof title === "string" && title !== "") return title;
      } catch {}
      return sessionId;
    }

    function extHoleEl() {
      if (extReflow.hole !== null && extReflow.hole.isConnected) return extReflow.hole;
      const hole = document.createElement("div");
      hole.className = "dsv-reflow-hole dsv-ext-hole";
      hole.dataset.plugin = PLUGIN_ID;
      hole.dataset.dsvFixed = "true";
      const title = document.createElement("span");
      title.className = "dsv-hole-title";
      const hint = document.createElement("span");
      hint.className = "dsv-hole-sub";
      hole.appendChild(title);
      hole.appendChild(hint);
      hole.hidden = true;
      document.body.appendChild(hole);
      extReflow.hole = hole;
      return hole;
    }

    /** The tree `addPane` would build for the dragged session. Mirrors
        treeStore.addPane (anchor on the focused leaf, settleAuto in auto
        mode) so the centre preview and the drop cannot disagree. */
    function extAddPaneTree(root) {
      const ids = leafOf(root, []);
      const snapshot = treeStore.getSnapshot();
      const anchor = snapshot.focus ?? ids[0];
      let next;
      if (anchor === undefined || anchor === null || findLeafNode(root, anchor) === null) {
        next = {
          t: "split", sid: nextSplitId(), dir: "h", sizes: [0.5, 0.5],
          kids: [root, { t: "leaf", id: EXT_REFLOW_LEAF }],
        };
      } else {
        const [tree, ok] = splitLeafTree(root, anchor, "h", EXT_REFLOW_LEAF, "after");
        if (!ok) return root;
        next = tree;
      }
      const all = leafOf(next, []);
      next = buildArrangedRoot(all, autoLayoutMode(all.length, 1.2));
      return next;
    }

    function extPreviewTree(root, targetId, zone) {
      if (zone === null || zone.dir === null) return extAddPaneTree(root);
      const [tree, ok] = splitLeafTree(root, targetId, zone.dir, EXT_REFLOW_LEAF, zone.side);
      return ok ? tree : root;
    }

    function extSetBoxes(rects) {
      for (const [id, el] of extReflow.wrappers) {
        const rect = rects[id];
        if (rect !== undefined) setReflowBox(el, rect);
      }
    }

    function extShowHole(rects) {
      const hole = extHoleEl();
      const rect = rects[EXT_REFLOW_LEAF];
      if (rect === undefined) {
        hole.hidden = true;
        return;
      }
      const origin = extReflow.canvasRect;
      hole.hidden = false;
      hole.style.left = origin.left + rect.left + "px";
      hole.style.top = origin.top + rect.top + "px";
      hole.style.width = rect.width + "px";
      hole.style.height = rect.height + "px";
      hole.firstChild.textContent = extReflow.title;
      hole.lastChild.textContent = t("extDropHint");
    }

    function extApply(tree) {
      const origin = extReflow.canvasRect;
      if (origin === null) return;
      const rects = reflowLayoutRects(tree, { left: 0, top: 0, width: origin.width, height: origin.height }, {});
      extSetBoxes(rects);
      extShowHole(rects);
    }

    function extArm() {
      const canvas = extReflow.canvas;
      if (canvas === null || !canvas.isConnected) return;
      extReflow.wrappers = reflowWrappers(canvas);
      canvas.classList.add("dsv-reflowing");
      document.body.classList.add("dsv-layout-previewing");
      extSetBoxes(extReflow.originalRects);
      // positions that transitioned from `auto` need a synchronous start value
      void canvas.offsetWidth;
      extReflow.armed = true;
    }

    function extBegin(canvas, sessionId) {
      if (extReflow.active) return;
      if (extReflow.timer !== 0) {
        try { window.clearTimeout(extReflow.timer); } catch {}
        extReflow.timer = 0;
      }
      if (runtimeState.maximized !== null) return;
      if (treeStore.leafIds().length === 0) return;
      const root = treeStore.getSnapshot().root;
      if (root === null) return;
      const wrappers = reflowWrappers(canvas);
      if (wrappers.size === 0) return;
      const origin = canvas.getBoundingClientRect();
      const rects = {};
      for (const [id, el] of wrappers) {
        const r = el.getBoundingClientRect();
        rects[id] = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
      }
      extReflow.active = true;
      extReflow.armed = false;
      extReflow.canvas = canvas;
      extReflow.canvasRect = origin;
      extReflow.wrappers = wrappers;
      extReflow.originalRects = rects;
      extReflow.root = root;
      extReflow.sessionId = sessionId;
      extReflow.title = extSessionTitle(sessionId);
      extReflow.targetId = null;
      extReflow.zone = null;
      extReflow.hit = false;
      extReflow.timer = 0;
    }

    /** Apply the post-drop layout while the pointer moves. `targetId` is the
        pane under the cursor; a centre position previews addPane (auto). */
    function extUpdate(event) {
      if (!extReflow.active) return;
      const canvas = extReflow.canvas;
      if (canvas === null || !canvas.isConnected) {
        extEnd(false);
        return;
      }
      if (!extReflow.armed) extArm();
      if (!extReflow.armed) return;
      const origin = extReflow.canvasRect;
      const x = event.clientX;
      const y = event.clientY;
      if (x < origin.left || x > origin.left + origin.width || y < origin.top || y > origin.top + origin.height) {
        extEnd(true);
        return;
      }
      const rx = x - origin.left;
      const ry = y - origin.top;
      let targetId = null;
      for (const [id, rect] of Object.entries(extReflow.originalRects)) {
        if (rx >= rect.left && rx <= rect.left + rect.width && ry >= rect.top && ry <= rect.top + rect.height) {
          targetId = id;
          break;
        }
      }
      if (targetId === null) {
        if (extReflow.hit) {
          extReflow.hit = false;
          extReflow.targetId = null;
          extReflow.zone = null;
          extApply(extReflow.root);
        }
        return;
      }
      // originalRects are CANVAS-relative; zoneFor works on viewport
      // coordinates (it subtracts rect.left/top from the pointer).
      const rect = extReflow.originalRects[targetId];
      const hit = zoneFor({
        left: rect.left + origin.left,
        top: rect.top + origin.top,
        width: rect.width,
        height: rect.height,
      }, x, y);
      const zone = hit.zone === null ? null : { dir: hit.dir, side: hit.side, label: hit.label, zone: hit.zone };
      const same = extReflow.hit && extReflow.targetId === targetId
        && (zone === null ? extReflow.zone === null : extReflow.zone !== null && extReflow.zone.label === zone.label);
      if (same) return;
      extReflow.hit = true;
      extReflow.targetId = targetId;
      extReflow.zone = zone;
      extApply(extPreviewTree(extReflow.root, targetId, zone));
    }

    function extCollapse() {
      if (extReflow.timer !== 0) {
        try { window.clearTimeout(extReflow.timer); } catch {}
        extReflow.timer = 0;
      }
      const canvas = extReflow.canvas;
      if (canvas !== null) canvas.classList.remove("dsv-reflowing", "dsv-reflow-settling");
      document.body.classList.remove("dsv-layout-previewing");
      scheduleTocGripSync(260);
      if (extReflow.wrappers !== null) {
        for (const el of extReflow.wrappers.values()) {
          if (el !== null && el !== undefined) clearReflowBox(el);
        }
      }
      if (extReflow.hole !== null) {
        const hole = extReflow.hole;
        extReflow.hole = null;
        try { hole.remove(); } catch {}
      }
      extReflow.active = false;
      extReflow.armed = false;
      extReflow.canvas = null;
      extReflow.canvasRect = null;
      extReflow.wrappers = null;
      extReflow.originalRects = null;
      extReflow.root = null;
      extReflow.sessionId = null;
      extReflow.title = "";
      extReflow.targetId = null;
      extReflow.zone = null;
      extReflow.hit = false;
      extReflow.timer = 0;
    }

    /** Cancel: glide the panes back to the boxes they had before the drag. */
    function extEnd(animate) {
      if (!extReflow.active) return;
      const canAnimate = animate !== false
        && extReflow.armed
        && extReflow.canvas !== null
        && extReflow.canvas.isConnected
        && extReflow.wrappers !== null
        && extReflow.originalRects !== null
        && !prefersReducedMotion();
      if (!canAnimate) {
        extCollapse();
        return;
      }
      const settleCanvas = extReflow.canvas;
      if (settleCanvas !== null && settleCanvas.isConnected) settleCanvas.classList.add("dsv-reflow-settling");
      extSetBoxes(extReflow.originalRects);
      if (extReflow.hole !== null) extReflow.hole.hidden = true;
      extReflow.active = false;
      extReflow.timer = window.setTimeout(() => {
        extReflow.timer = 0;
        extCollapse();
      }, 200);
    }

    /** Drop: perform exactly the mutation the preview showed. */
    function extDrop(sessionId) {
      if (!extReflow.active) return false;
      const hit = extReflow.hit;
      const targetId = extReflow.targetId;
      const zone = extReflow.zone;
      extCollapse();
      if (!hit || targetId === null) return false;
      if (treeStore.leafIds().indexOf(sessionId) !== -1) return false;
      if (zone === null || zone.dir === null) {
        treeStore.addPane(sessionId);
      } else {
        treeStore.splitLeaf(targetId, zone.dir, sessionId, zone.side);
      }
      treeStore.setFocus(sessionId);
      return true;
    }

    function registerExternalReflow() {
      const isSessionDrag = (event) => {
        if (dragPayload !== null) return false;
        if (externalDragSessionId === null) return false;
        const data = event.dataTransfer;
        if (data === null || data === undefined) return false;
        try {
          if (Array.prototype.indexOf.call(data.types, "Files") !== -1) return false;
          return Array.prototype.indexOf.call(data.types, MIME_SESSION) !== -1;
        } catch {
          return false;
        }
      };
      const onDragOver = (event) => {
        if (!treeStore.isActive()) return;
        if (runtimeState.maximized !== null) return;
        if (!isSessionDrag(event)) return;
        const canvas = document.querySelector(".dsv-canvas");
        if (canvas === null) return;
        const id = externalDragSessionId;
        if (id === null) return;
        // An already-open conversation gets the pane's red refusal wash, not a
        // split preview — leave the event to the pane for that case.
        if (treeStore.leafIds().indexOf(id) !== -1) {
          if (extReflow.active) extEnd(true);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        try { event.dataTransfer.dropEffect = "move"; } catch {}
        if (!extReflow.active) extBegin(canvas, id);
        if (extReflow.active) extUpdate(event);
      };
      const onDrop = (event) => {
        if (!extReflow.active) return;
        event.preventDefault();
        event.stopPropagation();
        let id = externalDragSessionId;
        try {
          const mime = event.dataTransfer !== null && event.dataTransfer !== undefined
            ? event.dataTransfer.getData(MIME_SESSION) : "";
          if (typeof mime === "string" && mime !== "") id = mime;
        } catch {}
        if (id === null || id === undefined || id === "") {
          extEnd(false);
          return;
        }
        extDrop(id);
      };
      const onDragEnd = () => {
        if (extReflow.active) extEnd(true);
      };
      const onDragLeave = (event) => {
        if (!extReflow.active) return;
        if (event.relatedTarget === null || event.relatedTarget === undefined) extEnd(true);
      };
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("dragend", onDragEnd, true);
      document.addEventListener("dragleave", onDragLeave, true);
      return () => {
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("dragend", onDragEnd, true);
        document.removeEventListener("dragleave", onDragLeave, true);
        extCollapse();
      };
    }

    // ---------------------------------------------------------------------
    // "会话目录" (TOC) grip containment
    //
    // dsh-prompt-history portals one draggable .dsh-ph-toc-grip to <body> per
    // mounted conversation instance. In split view that is one per pane PLUS
    // one for the stock conversation hidden under the overlay and one for the
    // IM view — all of them read the same saved position, so they stack
    // exactly on top of each other (the "several overlapping buttons" report).
    // The workspace keeps one grip per LIVE pane, hides the non-pane copies,
    // and pushes a grip whose saved position sits outside its pane (e.g. over
    // the sidebar) back inside that pane. Repositioning uses a synthetic drag
    // so the plugin's own state, its TOC panel anchor and the saved position
    // all stay in sync.
    // ---------------------------------------------------------------------
    const TOC_GRIP_SELECTOR = ".dsh-ph-toc-grip";
    const TOC_GRIP_HIDDEN = "dsv-toc-hidden";
    /** Last pane box each grip was placed against. A geometry change (split,
       close, arrange, divider drag, maximize, rightbar push) re-centers that
       pane's grip on the left edge; an unchanged box leaves the user's own
       vertical position alone. */
    const tocGripGeometry = new Map();
    const tocGripTries = new Map();
    /** Pane-id signature of the last sync. A structural change (add, close,
       swap, re-arrange) remounts the portal grips at their default stop, so
       every surviving pane re-centers once even when its own box is unchanged. */
    let tocPaneKey = "";

    /** Session id + "this grip was mounted by a split pane" for a portal grip.
        The pane check uses component IDENTITY (RenderLeaf/PaneFrame), not
        display names, so it survives a minified host build. */
    function tocGripInfo(grip) {
      let key = null;
      try {
        for (const name of Object.keys(grip)) {
          if (name.indexOf("__reactFiber$") === 0) { key = name; break; }
        }
      } catch { key = null; }
      if (key === null) return null;
      let fiber = grip[key];
      let sessionId = null;
      let inPane = false;
      let hops = 0;
      while (fiber !== null && fiber !== undefined && hops < 80) {
        const props = fiber.memoizedProps;
        if (sessionId === null && props !== null && props !== undefined && typeof props.sessionId === "string") {
          sessionId = props.sessionId;
        }
        if (fiber.type === RenderLeaf || fiber.type === PaneFrame) inPane = true;
        fiber = fiber.return;
        hops += 1;
      }
      return { sessionId, inPane };
    }

    /** Move a grip with real mouse events: the plugin's drag handler updates
        its React state, the TOC panel anchor and localStorage from these. */
    function tocGripMoveTo(grip, left, top) {
      let rect;
      try { rect = grip.getBoundingClientRect(); } catch { return; }
      if (rect.width <= 0 || rect.height <= 0) return;
      if (Math.abs(rect.left - left) < 1.5 && Math.abs(rect.top - top) < 1.5) return;
      const sx = rect.left + rect.width / 2;
      const sy = rect.top + rect.height / 2;
      const tx = left + 10;
      const ty = top + 26;
      try {
        grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
        window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: tx, clientY: ty, button: 0, buttons: 1 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: tx, clientY: ty, button: 0 }));
      } catch {}
    }

    function tocGripsRestore() {
      try {
        for (const grip of document.querySelectorAll(TOC_GRIP_SELECTOR)) {
          grip.classList.remove(TOC_GRIP_HIDDEN);
        }
      } catch {}
    }

    /** Re-place the grips a beat after a preview/drop settles, when the pane
       boxes have their final geometry. */
    function scheduleTocGripSync(delay) {
      try {
        window.setTimeout(() => {
          try { tocGripSync(); } catch {}
        }, delay);
      } catch {}
    }

    function tocGripSync() {
      let grips;
      try { grips = Array.prototype.slice.call(document.querySelectorAll(TOC_GRIP_SELECTOR)); } catch { return; }
      if (grips.length === 0) return;
      if (reflowState.active || extReflow.active) return;
      if (document.body.classList.contains("dsv-layout-previewing")) {
        // Self-heal a flag left behind by an interrupted/crashed preview.
        if (reflowState.timer === 0 && extReflow.timer === 0) {
          document.body.classList.remove("dsv-layout-previewing");
        } else {
          return;
        }
      }
      const canvas = document.querySelector(".dsv-canvas");
      if (canvas !== null && canvas.classList.contains("dsv-reflowing")) return;
      if (document.querySelector(".dsv-divider.active") !== null) return;
      for (const grip of grips) {
        // A grip being dragged right now owns the pointer; never fight it.
        if (grip.style.cursor === "grabbing") return;
      }
      const active = treeStore.isActive() && runtimeState.active === true && runtimeState.maximized === null;
      if (!active) {
        tocGripGeometry.clear();
        tocGripTries.clear();
        tocPaneKey = "";
        tocGripsRestore();
        return;
      }
      const panes = new Map();
      try {
        for (const el of document.querySelectorAll(".dsv-canvas .dsv-pane[data-dsv-pane]")) {
          const id = el.getAttribute("data-dsv-pane");
          if (id === null || id === "") continue;
          panes.set(id, el.getBoundingClientRect());
        }
      } catch {}
      if (panes.size === 0) return;
      const paneKey = [...panes.keys()].sort().join("|");
      const structChanged = paneKey !== tocPaneKey;
      tocPaneKey = paneKey;
      const keep = new Map();
      for (const grip of grips) {
        const info = tocGripInfo(grip);
        const pane = info !== null && info.inPane && info.sessionId !== null ? panes.get(info.sessionId) : undefined;
        if (pane === undefined || pane === null || keep.has(info.sessionId)) {
          grip.classList.add(TOC_GRIP_HIDDEN);
          continue;
        }
        keep.set(info.sessionId, grip);
        grip.classList.remove(TOC_GRIP_HIDDEN);
      }
      // Drop bookkeeping for panes that no longer exist.
      for (const id of [...tocGripGeometry.keys()]) if (!keep.has(id)) tocGripGeometry.delete(id);
      for (const [id, grip] of keep) {
        const pane = panes.get(id);
        const r = grip.getBoundingClientRect();
        const minTop = pane.top + 40;
        const maxTop = Math.max(minTop, pane.bottom - 60);
        // The grip lives on the pane's LEFT edge (the TOC panel opens to its
        // right) and, after every layout adjustment, is re-homed to the
        // VERTICAL CENTER of that pane. A pane box that did not change keeps
        // the user's own vertical drag; only a changed box re-centers.
        const boxKey = Math.round(pane.left) + ":" + Math.round(pane.top) + ":"
          + Math.round(pane.width) + ":" + Math.round(pane.height);
        const recenter = structChanged || tocGripGeometry.get(id) !== boxKey;
        tocGripGeometry.set(id, boxKey);
        const targetLeft = pane.left + 12;
        const rawTop = recenter
          ? pane.top + Math.max(0, pane.height - Math.max(1, r.height)) / 2
          : (r.height > 0 ? r.top : pane.top + pane.height * 0.34);
        const targetTop = Math.max(minTop, Math.min(maxTop, rawTop));
        const offTarget = Math.abs(r.left - targetLeft) >= 1.5 || Math.abs(r.top - targetTop) >= 1.5;
        if (!offTarget) {
          tocGripGeometry.set(id, boxKey);
          tocGripTries.delete(id);
          continue;
        }
        if (recenter) {
          // A portal grip that just remounted may not have its drag handler
          // attached yet; a single synthetic move would silently no-op and
          // leave it at the plugin's default stop (top+40). Retry a few times
          // instead of recording the box as "done".
          const tries = tocGripTries.get(id) ?? 0;
          if (tries >= 3) {
            tocGripGeometry.set(id, boxKey);
            tocGripTries.delete(id);
            continue;
          }
          tocGripTries.set(id, tries + 1);
          tocGripGeometry.delete(id);
          tocGripMoveTo(grip, targetLeft, targetTop);
          scheduleTocGripSync(140);
          continue;
        }
        tocGripMoveTo(grip, targetLeft, targetTop);
      }
    }

    // ---------------------------------------------------------------------
    // services (bound in apply)
    // ---------------------------------------------------------------------

    let sessionsService = undefined;
    let sessionsListSource = undefined;
    let domListSourceDispose = null;
    let slotsService = undefined;
    let localeService = undefined;
    let uiSessionService = undefined;
    let conversationT = null;

    // ---------------------------------------------------------------------
