    // inactive-mode drag bridge — the split entry point while the overlay is
    // off. Dragging a conversation from the stock sidebar onto the
    // conversation column (still showing the stock view) splits it: a fixed
    // ghost previews the target half, edge drops split there, a center drop
    // opens the second pane to the right. Document-level listeners, all
    // disposables-managed; they stand down the moment the workspace is
    // active (panes own their own drop zones then).
    // ---------------------------------------------------------------------

    /** Fixed ghost box over one half/zone of the conversation column. */
    function bridgeGhostStyle(rect, zone) {
      if (zone === null || zone.dir === null) {
        return { left: rect.left + 4, top: rect.top + 4, width: rect.width - 8, height: rect.height - 8 };
      }
      if (zone.dir === "h") {
        return zone.side === "before"
          ? { left: rect.left + 4, top: rect.top + 4, width: Math.round(rect.width / 2) - 8, height: rect.height - 8 }
          : { left: rect.left + Math.round(rect.width / 2) + 4, top: rect.top + 4, width: Math.round(rect.width / 2) - 8, height: rect.height - 8 };
      }
      return zone.side === "before"
        ? { left: rect.left + 4, top: rect.top + 4, width: rect.width - 8, height: Math.round(rect.height / 2) - 8 }
        : { left: rect.left + 4, top: rect.top + Math.round(rect.height / 2) + 4, width: rect.width - 8, height: Math.round(rect.height / 2) - 8 };
    }

    /** A session id the rendered sidebar actually knows (cheap single-row
        probe — no full-list scrape; the DOM source is idle while inactive). */
    function sidebarKnowsSession(id) {
      if (typeof id !== "string" || id === "") return false;
      try {
        const selector = '[data-row-key="session:' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id) + '"]';
        return document.querySelector(selector) !== null;
      } catch {
        return false;
      }
    }

    /** A session id the live list source knows (store path first, DOM probe
        as the 0.2.0 fallback). */
    function sessionKnownToList(id) {
      try {
        const snapshot = sessionsListSource !== undefined && sessionsListSource !== null
          && typeof sessionsListSource.getSnapshot === "function"
          ? sessionsListSource.getSnapshot()
          : null;
        if (snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.ids) && snapshot.ids.indexOf(id) !== -1) return true;
      } catch {}
      return sidebarKnowsSession(id);
    }

    /** Split-aware replacement for the Agent-Teams header action's
        openTeammate (wrapped per pane in entryInjectProps). Stock behavior
        navigates the MAIN view and guards on main-view retention, which a
        pane session rarely has — while the split workspace is active the
        click routes into the workspace instead: focus the member's existing
        pane, or split its conversation in beside the focused pane. Falls
        back to the stock action when the workspace is inactive or the target
        is not a list-known conversation (e.g. a detached member session the
        sidebar does not list). */
    function splitAwareOpenTeammate(original) {
      return (sessionId, childSessionId) => {
        try {
          if (treeStore.isActive() && typeof childSessionId === "string" && childSessionId !== "") {
            const leafIds = treeStore.leafIds();
            if (leafIds.indexOf(childSessionId) !== -1) {
              treeStore.setFocus(childSessionId);
              return;
            }
            if (sessionKnownToList(childSessionId)) {
              treeStore.addPane(childSessionId);
              return;
            }
            // Unknown to the list: let the stock action try the main view.
          }
        } catch {}
        try {
          original(sessionId, childSessionId);
        } catch {}
      };
    }

    function registerDragBridge() {
      let ghost = null;
      let invalidGhost = null;
      const removeGhost = () => {
        if (ghost !== null) {
          try { ghost.remove(); } catch {}
          ghost = null;
        }
      };
      const removeInvalidGhost = () => {
        if (invalidGhost !== null) {
          try { invalidGhost.remove(); } catch {}
          invalidGhost = null;
        }
      };
      /** Red refusal wash over the stock conversation while the dragged
          sidebar conversation is the one already on screen. */
      const showInvalidGhost = (rect) => {
        if (invalidGhost === null) {
          invalidGhost = document.createElement("div");
          invalidGhost.className = "dsv-pane-invalid";
          invalidGhost.dataset.plugin = PLUGIN_ID;
          invalidGhost.dataset.dsvFixed = "true";
          const card = document.createElement("div");
          card.className = "dsv-pane-invalid-card";
          const icon = document.createElement("span");
          icon.className = "dsv-pane-invalid-icon";
          icon.textContent = "⊘";
          const text = document.createElement("span");
          text.textContent = t("sameSessionCurrent");
          card.appendChild(icon);
          card.appendChild(text);
          invalidGhost.appendChild(card);
          document.body.appendChild(invalidGhost);
        }
        invalidGhost.style.left = rect.left + "px";
        invalidGhost.style.top = rect.top + "px";
        invalidGhost.style.width = rect.width + "px";
        invalidGhost.style.height = rect.height + "px";
      };
      const showGhost = (rect, zone) => {
        if (ghost === null) {
          ghost = document.createElement("div");
          ghost.className = "dsv-drop-ghost";
          ghost.dataset.plugin = PLUGIN_ID;
          ghost.dataset.dsvFixed = "true";
          const label = document.createElement("span");
          label.className = "dsv-drop-label";
          ghost.appendChild(label);
          document.body.appendChild(ghost);
        }
        const style = bridgeGhostStyle(rect, zone);
        ghost.style.left = style.left + "px";
        ghost.style.top = style.top + "px";
        ghost.style.width = style.width + "px";
        ghost.style.height = style.height + "px";
        ghost.firstChild.textContent = t(zone === null || zone.dir === null ? "dropMove" : zone.label);
      };
      /** S6 FIX: the bridge claims ONLY drags that provably carry a sidebar
          conversation. A capture-phase `dragstart` listener stamps the
          plugin's MIME (`application/x-dsv-session`) onto a stock session-row
          drag before any target handler runs; plain text/plain drags (selected
          chat text, links, text from other apps) are left entirely to the
          browser/stock drop targets. */
      const sessionDragInFlight = (event) => {
        if (dragPayload !== null) return false; // internal pane drag: panes own it
        const data = event.dataTransfer !== undefined && event.dataTransfer !== null ? event.dataTransfer : null;
        if (data === null) return false;
        try {
          if (Array.prototype.indexOf.call(data.types, "Files") !== -1) return false; // file drag: composer pipeline
          return Array.prototype.indexOf.call(data.types, MIME_SESSION) !== -1;
        } catch {
          return false;
        }
      };
      const onDragStart = (event) => {
        // Runs for every dragstart in the document (capture), but only stamps
        // when the drag source is a sidebar session row. Adding a data type is
        // allowed in dragstart and does not disturb the stock row's own
        // text/plain payload.
        try {
          const target = event.target;
          if (target === null || target === undefined || typeof target.closest !== "function") return;
          const row = target.closest('[data-row-key^="session:"]');
          if (row === null) return;
          const key = row.getAttribute("data-row-key");
          if (key === null || key.indexOf("session:") !== 0) return;
          const id = key.slice("session:".length);
          if (!isValidSessionId(id)) return;
          if (event.dataTransfer === null || event.dataTransfer === undefined) return;
          event.dataTransfer.setData(MIME_SESSION, id);
          beginDragPreview(rowDragTitle(row), t("dragHint"), paneElementForSession(id));
          externalDragSessionId = id;
          const blank = transparentDragImage();
          if (blank !== null) event.dataTransfer.setDragImage(blank, 0, 0);
        } catch {}
      };
      const onPreviewOver = (event) => {
        moveDragPreview(event.clientX, event.clientY);
      };
      const onDragOver = (event) => {
        if (!dsvOperational()) return;
        if (treeStore.isActive()) return; // panes handle drops while split
        if (!sessionDragInFlight(event)) return;
        const rect = columnRect();
        if (rect === null) return;
        const inside = event.clientX >= rect.left && event.clientX <= rect.left + rect.width
          && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
        if (!inside) {
          removeGhost();
          removeInvalidGhost();
          return;
        }
        const current = selectedSidebarSessionId() ?? currentSessionId();
        if (externalDragSessionId !== null
          && current !== undefined && current !== null
          && externalDragSessionId === current) {
          // Dropping the conversation that already fills the workspace is a
          // no-op; show why instead of a misleading split target.
          removeGhost();
          showInvalidGhost(rect);
          return;
        }
        removeInvalidGhost();
        event.preventDefault();
        try { event.dataTransfer.dropEffect = "move"; } catch {}
        const hit = zoneFor(rect, event.clientX, event.clientY);
        // A centre drop in the stock view lands as a right split (the first
        // pane keeps the current conversation). Show that half — the old
        // full-column "move here" ghost promised a move that cannot happen.
        const zone = hit.zone === null
          ? { dir: "h", side: "after", label: "dropSplitRight" }
          : { dir: hit.dir, side: hit.side, label: hit.label };
        showGhost(rect, zone);
      };
      const onDrop = (event) => {
        removeGhost();
        removeInvalidGhost();
        if (!dsvOperational()) return;
        if (treeStore.isActive() || dragPayload !== null) return;
        if (!sessionDragInFlight(event)) return;
        const rect = columnRect();
        if (rect === null) return;
        const inside = event.clientX >= rect.left && event.clientX <= rect.left + rect.width
          && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
        if (!inside) return;
        let droppedId = "";
        try {
          if (event.dataTransfer !== undefined && event.dataTransfer !== null) {
            droppedId = event.dataTransfer.getData(MIME_SESSION) || "";
            if (droppedId === "") droppedId = event.dataTransfer.getData("text/plain") || "";
          }
        } catch {
          droppedId = "";
        }
        droppedId = (droppedId || "").trim();
        if (droppedId === "" || !sidebarKnowsSession(droppedId)) return;
        const current = selectedSidebarSessionId() ?? currentSessionId();
        if (current === undefined || current === null || current === droppedId) return;
        event.preventDefault();
        event.stopPropagation();
        // First pane = the conversation the user is looking at; the dropped
        // one goes beside it. Two leaves ⇒ the activation gate turns the
        // workspace on.
        if (treeStore.leafIds().length === 0) treeStore.addPane(current);
        const anchor = treeStore.getSnapshot().focus ?? treeStore.leafIds()[0];
        const hit = zoneFor(rect, event.clientX, event.clientY);
        if (hit.zone === null) treeStore.splitLeaf(anchor, "h", droppedId, "after");
        else treeStore.splitLeaf(anchor, hit.zone.dir, droppedId, hit.zone.side);
      };
      const onDragLeaveWindow = (event) => {
        if (event.relatedTarget === null || event.relatedTarget === undefined) {
          removeGhost();
          removeInvalidGhost();
        }
      };
      document.addEventListener("dragstart", onDragStart, true);
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("dragover", onPreviewOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("drop", endDragPreview, true);
      document.addEventListener("dragleave", onDragLeaveWindow, true);
      document.addEventListener("dragend", removeGhost, true);
      document.addEventListener("dragend", removeInvalidGhost, true);
      document.addEventListener("dragend", endDragPreview, true);
      return () => {
        document.removeEventListener("dragstart", onDragStart, true);
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("dragover", onPreviewOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("drop", endDragPreview, true);
        document.removeEventListener("dragleave", onDragLeaveWindow, true);
        document.removeEventListener("dragend", removeGhost, true);
        document.removeEventListener("dragend", removeInvalidGhost, true);
        document.removeEventListener("dragend", endDragPreview, true);
        removeGhost();
        removeInvalidGhost();
        endDragPreview();
      };
    }

    // ---------------------------------------------------------------------
    // plugin apply
    // ---------------------------------------------------------------------

    /** Bring the split back. If a plugin/skills/settings panel is showing, the
        overlay would cover it, so first return the main view to the focused
        pane's conversation. */
    // ---------------------------------------------------------------------
    // transitions: minimize / exit / close used to swap the DOM in one frame.
    // They now play a short fade on the element that is about to disappear;
    // the new layout's width transitions + the pane entry animation carry the
    // rest. (View transitions are deliberately not used: the split overlay
    // contains live editors and dozens of panes re-render on a drop, and the
    // snapshot cost is not worth a 150ms effect.)
    // ---------------------------------------------------------------------
    let minimizeTimer = 0;
    let exitTimer = 0;
    const closingPaneSessions = new Set();
    function prefersReducedMotion() {
      try {
        return typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch { return false; }
    }
    function scheduleRightbarHeal(delay) {
      try { window.setTimeout(() => { try { rightbarSelfHeal(); } catch {} }, delay === undefined ? 400 : delay); } catch {}
    }
    function minimizeWorkspace() {
      // While the split-view panel owns the main column, "minimize" means
      // "step back to the conversation": hide the split and return the column
      // to the stock conversation view in the same commit (the panel is
      // leaving, so there is no overlay to fade).
      if (splitPanelActive()) {
        try {
          setRuntime({ minimized: true });
          writeMinimized(true);
        } catch {}
        leaveSplitPanel();
        scheduleRightbarHeal(450);
        return;
      }
      const finish = () => {
        try { setRuntime({ minimized: true }); writeMinimized(true); } catch {}
        scheduleRightbarHeal(450);
      };
      try {
        const overlay = document.querySelector(".dsv-overlay");
        if (overlay === null || overlay === undefined || prefersReducedMotion()) { finish(); return; }
        overlay.classList.add("dsv-leaving");
        clearTimeout(minimizeTimer);
        minimizeTimer = setTimeout(finish, 150);
      } catch { finish(); }
    }
    function exitWorkspace() {
      const finish = () => {
        try {
          treeStore.reset();
          setRuntime({ minimized: false });
          writeMinimized(false);
        } catch {}
        // Exiting from the split-view panel returns the main column to the
        // stock conversation view instead of leaving an empty picker page.
        leaveSplitPanel();
        // The stock view owns the rightbar again; repair a stale open/collapse
        // state the split teardown may have left behind.
        scheduleRightbarHeal(450);
      };
      // The panel page leaves with its own router switch; fading the canvas
      // first would only delay the return to the conversation.
      if (splitPanelActive()) {
        finish();
        return;
      }
      try {
        const overlay = document.querySelector(".dsv-overlay");
        const target = overlay !== null && overlay !== undefined
          ? overlay
          : document.querySelector(".dsv-minimized-chip");
        if (target === null || target === undefined || prefersReducedMotion()) { finish(); return; }
        target.classList.add("dsv-leaving");
        clearTimeout(exitTimer);
        exitTimer = setTimeout(finish, 150);
      } catch { finish(); }
    }
    function closePaneAnimated(sessionId) {
      if (closingPaneSessions.has(sessionId)) return;
      // Closing one of the last two panes ends the split. The store clears the
      // whole tree in that case (see endSplitBecauseTooSmall), so the other
      // conversation immediately loses its "in split" membership.
      if (treeStore.leafIds().length <= 2) {
        try { treeStore.closeLeaf(sessionId); } catch {}
        scheduleRightbarHeal(450);
        showPaneToast(t("splitExited"), true);
        return;
      }
      const pane = paneElementForSession(sessionId);
      if (pane === null || pane === undefined || prefersReducedMotion()) {
        try { treeStore.closeLeaf(sessionId); } catch {}
        return;
      }
      closingPaneSessions.add(sessionId);
      pane.classList.add("dsv-pane-closing");
      setTimeout(() => {
        closingPaneSessions.delete(sessionId);
        try { treeStore.closeLeaf(sessionId); } catch {}
      }, 150);
    }

    // ---------------------------------------------------------------------
