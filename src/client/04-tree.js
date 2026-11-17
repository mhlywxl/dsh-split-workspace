    // ---------------------------------------------------------------------
    // split-tree store
    // ---------------------------------------------------------------------

    let splitSeq = 0;
    function nextSplitId() {
      splitSeq += 1;
      return "sp" + splitSeq;
    }

    function leafOf(node, out) {
      if (node === null) return out;
      if (node.t === "leaf") out.push(node.id);
      else for (const kid of node.kids) leafOf(kid, out);
      return out;
    }

    function findLeafNode(node, id) {
      if (node === null) return null;
      if (node.t === "leaf") return node.id === id ? node : null;
      for (const kid of node.kids) {
        const found = findLeafNode(kid, id);
        if (found !== null) return found;
      }
      return null;
    }

    function replaceBySid(node, sid, replacer) {
      if (node === null || node.t !== "split") return node;
      if (node.sid === sid) return replacer(node);
      let changed = false;
      const kids = node.kids.map((kid) => {
        const next = replaceBySid(kid, sid, replacer);
        if (next !== kid) changed = true;
        return next;
      });
      return changed ? { t: "split", sid: node.sid, dir: node.dir, kids, sizes: node.sizes.slice() } : node;
    }

    function removeLeaf(node, id) {
      if (node === null) return [null, false];
      if (node.t === "leaf") return [node, false];
      const kids = [];
      let removed = false;
      for (const kid of node.kids) {
        if (kid.t === "leaf" && kid.id === id) {
          removed = true;
          continue;
        }
        const [nextKid, removedHere] = removeLeaf(kid, id);
        removed = removed || removedHere;
        kids.push(nextKid);
      }
      if (!removed) return [node, false];
      if (kids.length === 0) return [null, true];
      if (kids.length === 1) return [kids[0], true];
      const even = 1 / kids.length;
      return [{ t: "split", sid: node.sid, dir: node.dir, kids, sizes: kids.map(() => even) }, true];
    }

    function splitLeafTree(root, leafId, dir, newId, side) {
      const target = findLeafNode(root, leafId);
      if (target === null) return [root, false];
      const fresh = { t: "leaf", id: newId };
      const pair = side === "before" ? [fresh, target] : [target, fresh];
      const replacement = { t: "split", sid: nextSplitId(), dir, kids: pair, sizes: [0.5, 0.5] };
      function walk(node) {
        if (node === null) return null;
        if (node.t === "leaf") return node === target ? replacement : node;
        const kids = node.kids.map(walk);
        for (let i = 0; i < kids.length; i++) {
          if (kids[i] !== node.kids[i]) {
            return { t: "split", sid: node.sid, dir: node.dir, kids, sizes: node.sizes.slice() };
          }
        }
        return node;
      }
      return [walk(root), true];
    }

    /** Session ids are opaque tokens handed out by the host. Persistence is a
        capability grant, so the id grammar stays strict: short strings only,
        no control characters, no separators that could confuse a CSS selector
        or a DOM attribute. */
    function isValidSessionId(id) {
      if (typeof id !== "string" || id === "" || id.length > MAX_SESSION_ID_LENGTH) return false;
      return /^[A-Za-z0-9._:@+-]+$/.test(id);
    }

    /** Validate + bound a persisted split tree.

        Persistence is the only thing that decides whether the plugin covers the
        stock UI at boot, so a stored tree is treated as untrusted input:
          * leaf ids must pass isValidSessionId,
          * ids must be UNIQUE across the whole tree (two panes on one session
            mount two composers on one Lexical editor — the permanently-dead
            composer state the audit describes),
          * at most MAX_TREE_DEPTH levels (a hand-edited or corrupt payload can
            never stack-overflow a recursive render); the number of panes is
            deliberately NOT capped,
          * sizes are normalized again after dropped kids.
        `seen`/`stats` are threaded through the recursion; the caller decides
        whether a repaired tree is kept (repaired) or a null result is discarded. */
    function normalizeTree(value, options) {
      const context = options === undefined || options === null ? {} : options;
      const depth = typeof context.depth === "number" ? context.depth : 0;
      const seen = context.seen instanceof Set ? context.seen : new Set();
      const stats = context.stats !== undefined && context.stats !== null ? context.stats : { duplicates: 0, depthLimited: 0 };
      if (value === null || typeof value !== "object") return null;
      if (depth > MAX_TREE_DEPTH) { stats.depthLimited += 1; return null; }
      if (value.t === "leaf") {
        if (!isValidSessionId(value.id)) return null;
        if (seen.has(value.id)) { stats.duplicates += 1; return null; }
        seen.add(value.id);
        return { t: "leaf", id: value.id };
      }
      if (value.t === "split" && (value.dir === "h" || value.dir === "v") && Array.isArray(value.kids)) {
        const kids = [];
        for (const kid of value.kids) {
          const normalized = normalizeTree(kid, { depth: depth + 1, seen, stats });
          if (normalized !== null) kids.push(normalized);
        }
        if (kids.length === 0) return null;
        if (kids.length === 1) return kids[0];
        const even = 1 / kids.length;
        const sizes = Array.isArray(value.sizes) && value.sizes.length === kids.length
          ? value.sizes.map((s) => (typeof s === "number" && Number.isFinite(s) && s > 0.05 ? s : even))
          : kids.map(() => even);
        const total = sizes.reduce((a, b) => a + b, 0) || 1;
        return {
          t: "split",
          sid: typeof value.sid === "string" && value.sid !== "" ? value.sid : nextSplitId(),
          dir: value.dir,
          kids,
          sizes: sizes.map((s) => s / total),
        };
      }
      return null;
    }

    function replaceLeafId(node, leafId, newId) {
      if (node === null || node === undefined) return null;
      if (node.t === "leaf") return node.id === leafId ? { t: "leaf", id: newId } : node;
      const kids = node.kids.map((kid) => replaceLeafId(kid, leafId, newId));
      let changed = false;
      for (let i = 0; i < kids.length; i++) if (kids[i] !== node.kids[i]) changed = true;
      return changed ? { t: "split", sid: node.sid, dir: node.dir, kids, sizes: node.sizes.slice() } : node;
    }

    function autoLayoutMode(count, aspect) {
      if (count <= 1) return "columns";
      if (count === 2) return aspect >= 1.05 ? "columns" : "rows";
      return "grid";
    }
    function buildArrangedRoot(ids, mode) {
      const leaves = ids.map((id) => ({ t: "leaf", id }));
      const equal = leaves.map(() => 1 / Math.max(1, leaves.length));
      if (leaves.length === 1) return leaves[0];
      if (mode !== "grid" || leaves.length === 2) {
        const dir = mode === "rows" ? "v" : "h";
        return { t: "split", sid: nextSplitId(), dir, kids: leaves, sizes: equal };
      }
      if (leaves.length === 3) {
        return {
          t: "split", sid: nextSplitId(), dir: "v", sizes: [0.5, 0.5],
          kids: [
            { t: "split", sid: nextSplitId(), dir: "h", kids: [leaves[0], leaves[1]], sizes: [0.5, 0.5] },
            leaves[2],
          ],
        };
      }
      // 4+ panes: a balanced row-major grid. Four keeps the familiar 2x2;
      // larger counts grow by roughly sqrt(n) columns, so the grid stays as
      // square as the pane count allows instead of stretching one row.
      const cols = leaves.length === 4 ? 2 : Math.max(2, Math.ceil(Math.sqrt(leaves.length)));
      const rows = Math.ceil(leaves.length / cols);
      const rowKids = [];
      for (let row = 0; row < rows; row += 1) {
        const slice = leaves.slice(row * cols, (row + 1) * cols);
        rowKids.push(slice.length === 1 ? slice[0] : {
          t: "split", sid: nextSplitId(), dir: "h", kids: slice,
          sizes: slice.map(() => 1 / slice.length),
        });
      }
      return {
        t: "split", sid: nextSplitId(), dir: "v", kids: rowKids,
        sizes: rowKids.map(() => 1 / rows),
      };
    }

    function createTreeStore() {
      let state = { root: null, focus: null };
      let revision = 0;
      const listeners = new Set();

      // ---- defensive load: validate, de-duplicate, cap, discard-on-invalid --
      // The persisted tree is the capability grant that decides whether the
      // plugin covers the stock UI at boot; it is never trusted verbatim.
      let persistedStatus = "absent";
      const raw = storageGet(TREE_KEY);
      if (raw !== null) {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        const stats = { duplicates: 0, depthLimited: 0 };
        const root = parsed !== null && parsed !== undefined && typeof parsed === "object"
          ? normalizeTree(parsed.root, { depth: 0, seen: new Set(), stats })
          : null;
        if (root !== null && leafOf(root, []).length < 2) {
          // A one-pane tree is not a split. Older builds could persist one
          // after closing the second-to-last pane; that kept the surviving
          // conversation tagged "in split" while nothing rendered. Discard it.
          storageRemove(TREE_KEY);
          persistedStatus = "absent";
          try {
            console.info(LOG_PREFIX + " dropped a persisted one-pane layout on load (a split needs at least two panes).");
          } catch {}
        } else if (root !== null) {
          state = { root, focus: null };
          const repaired = stats.duplicates > 0 || stats.depthLimited > 0;
          persistedStatus = repaired ? "repaired" : "ok";
          if (repaired) {
            try {
              console.warn(LOG_PREFIX + " the saved split layout was repaired on load (duplicate panes dropped: "
                + stats.duplicates + ", too-deep nodes: " + stats.depthLimited + ").");
            } catch {}
            // Persist the repaired tree immediately: the bad payload must never
            // be re-read after a reload.
            storageSet(TREE_KEY, JSON.stringify({ root }));
          }
        } else {
          persistedStatus = "invalid";
          storageRemove(TREE_KEY);
          try {
            console.warn(LOG_PREFIX + " the saved split layout is invalid and was DISCARDED (the stock view stays in charge)."
              + " Reset: window.__dshSplitWorkspace.reset(). See README > Safety, recovery and diagnostics.");
          } catch {}
        }
      }
      setRuntime({ persistedTree: persistedStatus });

      function commit(next, skipPersist) {
        const before = leafOf(state.root, []);
        state = next;
        const ids = leafOf(state.root, []);
        const after = new Set(ids);
        if (state.focus === null || !ids.includes(state.focus)) state = { root: state.root, focus: ids[0] ?? null };
        // EVERY leaf-mutation path funnels through commit, so this is where
        // departed panes are scheduled for resource disposal (the audit's
        // "only the ✕ button tears down" leak: sidebar swaps, closeFocused and
        // movePane all bypassed the old handler).
        for (const id of before) {
          if (!after.has(id)) deferPaneDisposeCheck(id);
        }
        if (runtimeState.maximized !== null && !after.has(runtimeState.maximized)) {
          setRuntime({ maximized: null });
        }
        if (skipPersist !== true) {
          storageSet(TREE_KEY, JSON.stringify({ root: state.root }));
          setRuntime({ persistedTree: state.root === null ? "absent" : "ok" });
        }
        revision += 1;
        for (const listener of [...listeners]) listener();
      }

      /** The split ended because fewer than two panes remain. Clear the WHOLE
          tree (not just the closed pane): a one-pane tree is not a split, and
          keeping it would leave the surviving conversation tagged "in split"
          in the context menu / add-split dialog while nothing renders. */
      function endSplitBecauseTooSmall() {
        const before = leafOf(state.root, []);
        state = { root: null, focus: null };
        for (const id of before) deferPaneDisposeCheck(id);
        storageRemove(TREE_KEY);
        setRuntime({ persistedTree: "absent", maximized: null, minimized: false });
        writeMinimized(false);
        revision += 1;
        for (const listener of [...listeners]) listener();
      }

      return {
        getSnapshot: () => state,
        getRevision: () => revision,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        leafIds: () => leafOf(state.root, []),
        /** The workspace only takes the viewport when it actually SPLITS:
            two or more panes. With zero or one pane the stock view stays
            untouched (and fully interactive) — see the activation gate notes
            in WorkspaceApp. */
        isActive: () => leafOf(state.root, []).length >= 2,
        /** Hard reset: drop the persisted tree and stay in the stock view. */
        reset() {
          state = { root: null, focus: null };
          storageRemove(TREE_KEY);
          revision += 1;
          setRuntime({ persistedTree: "absent" });
          for (const listener of [...listeners]) listener();
        },
        setFocus(id) {
          if (state.focus === id) return;
          state = { root: state.root, focus: id };
          revision += 1;
          for (const listener of [...listeners]) listener();
        },
        // Swap the focused leaf's session to the native sidebar's current
        // session (click-to-swap). If that session is already a pane, focus it;
        // if there is no focused leaf yet, fall back to addPane.
        swapFocus(id) {
          if (state.focus === id) {
            if (findLeafNode(state.root, id) !== null) return;
          }
          if (findLeafNode(state.root, id) !== null) {
            commit({ root: state.root, focus: id });
            return;
          }
          const focus = state.focus ?? leafOf(state.root, [])[0];
          if (focus === undefined || findLeafNode(state.root, focus) === null) {
            this.addPane(id);
            return;
          }
          const next = replaceLeafId(state.root, focus, id);
          if (next === null) {
            this.addPane(id);
            return;
          }
          commit({ root: next, focus: id });
        },
        addPane(sessionId) {
          if (!isValidSessionId(sessionId)) return;
          // A conversation is either a pane or a float, never both: any path
          // that adds a pane retires its floating window first.
          try { if (floatStore.has(sessionId)) floatStore.remove(sessionId); } catch {}
          if (findLeafNode(state.root, sessionId) !== null) {
            commit({ root: state.root, focus: sessionId });
            return;
          }
          if (state.root === null) {
            commit({ root: { t: "leaf", id: sessionId }, focus: sessionId });
            return;
          }
          const anchor = state.focus ?? leafOf(state.root, [])[0];
          if (anchor === undefined || findLeafNode(state.root, anchor) === null) {
            commit({
              root: { t: "split", sid: nextSplitId(), dir: "h", kids: [state.root, { t: "leaf", id: sessionId }], sizes: [0.5, 0.5] },
              focus: sessionId,
            });
            this.settleAuto();
            return;
          }
          const [next] = splitLeafTree(state.root, anchor, "h", sessionId, "after");
          commit({ root: next, focus: sessionId });
          this.settleAuto();
        },
        settleAuto() {
          const ids = leafOf(state.root, []);
          if (ids.length < 2) return;
          const root = buildArrangedRoot(ids, autoLayoutMode(ids.length, 1.2));
          commit({ root, focus: state.focus !== null && ids.includes(state.focus) ? state.focus : ids[0] });
        },
        // Public `arrange()` compatibility: the menu is gone, so every call
        // re-runs AUTO against the live aspect (an explicit mode is ignored).
        arrange(_mode, aspect) {
          const ids = leafOf(state.root, []);
          if (ids.length === 0) return;
          const root = buildArrangedRoot(ids, autoLayoutMode(ids.length, aspect));
          commit({ root, focus: state.focus !== null && ids.includes(state.focus) ? state.focus : ids[0] });
        },
        splitLeaf(leafId, dir, newId, side) {
          if (!isValidSessionId(newId)) return;
          try { if (floatStore.has(newId)) floatStore.remove(newId); } catch {}
          if (findLeafNode(state.root, newId) !== null) {
            commit({ root: state.root, focus: newId });
            return;
          }
          const [next, ok] = splitLeafTree(state.root, leafId, dir, newId, side);
          // A directional split must keep the direction the user aimed at.
          // settleAuto() used to rewrite every split into the auto layout
          // (2 panes => columns), so dropping on the bottom edge still landed
          // right. Auto-arrange stays on addPane/closeLeaf, where no direction
          // was requested.
          if (ok) commit({ root: next, focus: newId });
        },
        closeLeaf(id) {
          const before = leafOf(state.root, []);
          const [next, removed] = removeLeaf(state.root, id);
          if (!removed) return;
          // Closing the second-to-last pane ends the split: clear every pane
          // instead of keeping an invisible one-pane tree with stale membership.
          if (before.length >= 2 && leafOf(next, []).length < 2) {
            endSplitBecauseTooSmall();
            return;
          }
          commit({ root: next, focus: state.focus });
          this.settleAuto();
        },
        movePane(srcId, dstId, zone) {
          if (srcId === dstId) return;
          const [afterRemove, removed] = removeLeaf(state.root, srcId);
          if (!removed) {
            this.splitLeaf(dstId, zone.dir, srcId, zone.side);
            return;
          }
          if (afterRemove === null) {
            commit({ root: { t: "leaf", id: dstId }, focus: state.focus });
            this.splitLeaf(dstId, zone.dir, srcId, zone.side);
            return;
          }
          const [next, ok] = splitLeafTree(afterRemove, dstId, zone.dir, srcId, zone.side);
          if (ok) commit({ root: next, focus: state.focus });
        },
        /** Commit a tree that was computed OUTSIDE the store (the live drag
            preview). The preview already knows the exact tree the drop must
            produce, so recomputing it here could only introduce a mismatch
            (the split ids are fresh, and a set of new ids would remount the
            panes the preview was showing). */
        replaceRoot(root) {
          if (root === null) return;
          commit({ root, focus: state.focus });
        },
        setSizes(sid, sizes) {
          const root = replaceBySid(state.root, sid, (node) => ({ t: "split", sid: node.sid, dir: node.dir, kids: node.kids, sizes }));
          if (root !== state.root) commit({ root, focus: state.focus }, true); // live drag: no persist per move
        },
        persistNow() {
          storageSet(TREE_KEY, JSON.stringify({ root: state.root }));
        },
      };
    }

    const treeStore = createTreeStore();

