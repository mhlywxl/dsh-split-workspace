    function restoreSplit() {
      try {
        const tree = treeStore.getSnapshot();
        const sid = tree !== null && tree !== undefined
          ? (tree.focus !== null && tree.focus !== undefined ? tree.focus : treeStore.leafIds()[0])
          : undefined;
        const layout = pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
          ? pluginCtx.get("layout")
          : null;
        if (layout !== null && layout !== undefined && typeof layout.selectPanel === "function") {
          layout.selectPanel(null);
        }
        if (sid !== undefined && sid !== null) {
          const workspace = pluginCtx !== null && pluginCtx !== undefined && typeof pluginCtx.get === "function"
            ? pluginCtx.get("uiWorkspace")
            : null;
          if (workspace !== null && workspace !== undefined && typeof workspace.openSession === "function") {
            workspace.openSession(sid);
          }
        }
      } catch {}
      setRuntime({ minimized: false });
      writeMinimized(false);
    }

    /** Sidebar-footer entry point: opens the split menu (add / exit / minimize
        / reset). Adding a split from the menu makes the feature discoverable
        without a pane already open; drag-to-split stays the primary gesture. */
    function FooterSplitButton() {
      const launcher = useLauncherState();
      const pending = usePendingSplit();
      const open = launcher.mode !== "closed";
      return h("button", {
        type: "button",
        className: "dsv-footer-btn",
        title: pending.length > 0 ? t("pendingBadge", { n: pending.length }) : t("menuTitle"),
        "aria-label": t("menuTitle"),
        "aria-haspopup": "menu",
        "aria-expanded": open ? "true" : "false",
        "data-open": launcher.mode === "menu" ? "true" : "false",
        onClick: (event) => {
          if (open) {
            closeLauncher();
            return;
          }
          openLauncherMenu(event.currentTarget);
        },
      },
        h(SplitIconV, { size: 15 }),
        pending.length > 0 ? h("span", { className: "dsv-footer-badge" }, String(pending.length)) : null,
      );
    }

    /** True while apply() has installed the plugin; guards double-apply (a
        Cordis reload used to stack a second registration and a second batch
        of effects on top of the live one). */
    let appliedOnce = false;

    function apply(ctx) {
      if (appliedOnce) return;
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      appliedOnce = true;
      const locale = ctx.get("locale");
      pluginCtx = ctx;
      sessionsService = ctx.get("sessions");
      // 0.1.x exposes the live list store on the sessions service; 0.2.0 does
      // not, so the rendered sidebar stands in (same snapshot shape, see
      // createDomSessionListSource).
      const serviceList = sessionsService !== undefined && sessionsService !== null ? sessionsService.list : undefined;
      if (serviceList !== undefined && serviceList !== null) {
        sessionsListSource = serviceList;
      } else {
        const domSource = createDomSessionListSource();
        sessionsListSource = domSource;
        domListSourceDispose = () => domSource.dispose();
      }
      uiSessionService = ctx.get("uiSession");
      slotsService = slots;
      localeService = locale;

      if (locale !== undefined) {
        try {
          ctx.effect(() => {
            const d1 = locale.register("splitView", "zh-CN", ZH);
            const d2 = locale.register("splitView", "zh", ZH);
            const d3 = locale.register("splitView", "en", EN);
            return () => {
              d1();
              d2();
              d3();
            };
          });
          const bound = locale.bind("splitView");
          const previous = translate;
          translate = (key) => {
            try {
              const value = bound(key);
              if (typeof value === "string" && value !== "" && value !== key) return value;
            } catch {}
            return previous(key);
          };
        } catch {}
      }

      ctx.effect(() => {
        // ONE composition tracker for the whole document — see composingIn.
        document.addEventListener("compositionstart", noteComposition, true);
        document.addEventListener("compositionupdate", noteComposition, true);
        document.addEventListener("compositionend", noteComposition, true);
        document.addEventListener("focusout", retireComposition, true);
        return () => {
          document.removeEventListener("compositionstart", noteComposition, true);
          document.removeEventListener("compositionupdate", noteComposition, true);
          document.removeEventListener("compositionend", noteComposition, true);
          document.removeEventListener("focusout", retireComposition, true);
          composingSince.clear();
        };
      }, "dsh-split-workspace: IME composition tracker");

      ctx.effect(() => insertStyle(DSV_CSS), "dsh-split-workspace: stylesheet");

      // Performance mode is a CSS class on <html>; mirror the persisted flag
      // on every apply so a reload keeps it.
      ctx.effect(() => {
        applyPerformanceClass();
        return () => {
          try { document.documentElement.removeAttribute("data-dsv-performance"); } catch {}
        };
      }, "dsh-split-workspace: performance class");

      // Acknowledge the freshly loaded bundle. When the stored version is older
      // than this client, the user just got an update (usually after a reload
      // or a DSH restart) — say so once. The update-ready chip covers the
      // opposite direction: a newer version sitting on disk while this page
      // still runs the old bundle.
      ctx.effect(() => {
        try {
          const seen = storageGet(SEEN_VERSION_KEY);
          storageSet(SEEN_VERSION_KEY, PLUGIN_VERSION);
          if (seen !== null && seen !== undefined && seen !== "" && seen !== PLUGIN_VERSION) {
            const timer = window.setTimeout(() => {
              try { showPaneToast(t("updatedToast", { v: PLUGIN_VERSION }), true); } catch {}
            }, 1400);
            return () => { try { window.clearTimeout(timer); } catch {} };
          }
        } catch {}
        return () => {};
      }, "dsh-split-workspace: version notice");

      // Global chords (Alt+T, Alt+Shift+Arrows) ride the plugin's OWN
      // lifetime now: the old module-scope listeners stacked on every reload
      // and were never removed.
      ctx.effect(registerGlobalKeys, "dsh-split-workspace: global keys");

      // Inactive-mode drag bridge: dragging a conversation onto the stock
      // conversation column starts the split.
      ctx.effect(registerDragBridge, "dsh-split-workspace: drag bridge");

      // Session-row context menu contributions (加入分屏 / 退出分屏). The host's
      // contextMenus service owns the popup; this plugin only contributes
      // actions, so the stock menu keeps its look and the rows disappear on
      // unload.
      ctx.effect(installSplitSessionMenu, "dsh-split-workspace: session menu");

      // Right-sidebar repair: the split teardown could leave the sidebar-right
      // store open while its column was closed (the corner button then vanished
      // with no way back) or leave a stock control writing to a seat nobody
      // rendered (clicks looked dead). Watch those controls and heal the state.
      ctx.effect(() => {
        document.addEventListener("click", onRightbarStockClick, true);
        const kick = window.setTimeout(() => { try { rightbarSelfHeal(); } catch {} }, 1400);
        const timer = window.setInterval(() => { try { rightbarSelfHeal(); } catch {} }, 2000);
        return () => {
          document.removeEventListener("click", onRightbarStockClick, true);
          window.clearTimeout(kick);
          window.clearInterval(timer);
        };
      }, "dsh-split-workspace: rightbar repair");

      // Live reflow while a pane is dragged inside the split (move + hole
      // preview). Capture-phase so the reflow owns the drop before a pane's
      // own HTML5 drop handler can also move it.
      ctx.effect(registerPaneReflow, "dsh-split-workspace: pane reflow");

      // Live preview while a conversation is dragged from the stock sidebar
      // into the split: the panes take their post-drop boxes and a hole shows
      // the new pane before the mouse is released.
      ctx.effect(registerExternalReflow, "dsh-split-workspace: external drop preview");

      ctx.effect(
        () => () => {
          closeLauncher();
          pendingSplitStore.clear();
          try { document.querySelectorAll(".dsv-launcher-menu").forEach((element) => element.remove()); } catch {}
          sessionsService = undefined;
          sessionsListSource = undefined;
          if (domListSourceDispose !== null) {
            try {
              domListSourceDispose();
            } catch {}
            domListSourceDispose = null;
          }
          uiSessionService = undefined;
          slotsService = undefined;
          localeService = undefined;
          conversationT = null;
          dragPayload = null;
          pluginCtx = null;
          hostFaceCache = null;
          paneChatStores.clear();
          // Full teardown of the module-level registries: every retained
          // session reference, editor guard, intake hook and subscription
          // used to survive a plugin unload and leak into the next load.
          for (const reference of paneSessionReferences.values()) {
            try {
              if (reference !== null && typeof reference.release === "function") reference.release();
            } catch {}
          }
          paneSessionReferences.clear();
          for (const guard of paneEditorGuards.values()) {
            try {
              if (guard !== null && typeof guard.dispose === "function") guard.dispose();
            } catch {}
          }
          paneEditorGuards.clear();
          for (const timer of paneDisposeChecks.values()) {
            try { window.clearTimeout(timer); } catch {}
          }
          paneDisposeChecks.clear();
          paneLiveRefs.clear();
          for (const resolver of sessionFaceResolvers.values()) {
            try { resolver.dispose(); } catch {}
          }
          sessionFaceResolvers.clear();
          paneRetainFailures.clear();
          for (const unsubscribe of paneTypingUnsubs.values()) {
            try { unsubscribe(); } catch {}
          }
          paneTypingUnsubs.clear();
          chatScrollMemory.clear();
          lastSessionSummaries.clear();
          entryStoreCache.clear();
          clearEntryInjectCache();
          paneImageIntake.clear();
          paneKitWarned.clear();
          rootPendingBySession.clear();
          rootPendingListeners.clear();
          for (const key of Object.keys(captureLog)) delete captureLog[key];
          paneDebug.faces = {};
          paneDebug.last = null;
          composerChainDebug.last = null;
          rootStandard.value = null;
          rootStandard.pending = null;
          rootStandard.pendingGeneration = false;
          rootStandard.listeners.clear();
          composerModeStore.clear();
          composingSince.clear();
          lastTypedSessionId = null;
          // S9: translate used to wrap itself on every apply (closure chain
          // growth); reset to the EN fallback so a reload starts clean.
          translate = FALLBACK_TRANSLATE;
          activationMarked = false;
          failureWindow.length = 0;
          failureLog.clear();
          setRuntime({ active: false, geometryBlocked: false, helpOpen: false, tipVisible: false });
          appliedOnce = false;
        },
        "dsh-split-workspace: service cleanup",
      );

      // The workspace rides inside a fail-open boundary AND hosts the plugin's
      // own chrome (safe-mode / blocked chip). SplitWorkspaceSeat is keyed by
      // the retry epoch, so a latched boundary can be remounted deliberately
      // instead of looping.
      slots.inject("shell.overlay", () =>
        slots.register({ name: "shell.overlay", id: "split-view-workspace", order: 0, label: () => t("label") }, (props) =>
          h(SplitWorkspaceSeat, props),
        ),
      );
      slots.inject("sidebar.footer.action", () =>
        slots.register({ name: "sidebar.footer.action", id: "split-workspace", order: 30, label: () => t("openSplit") }, () =>
          h(FooterSplitButton),
        ),
      );
    }

    // dsh 0.1.5: client services (sessions/locale) are provided asynchronously
    // after the module map finishes loading. Without this declaration the
    // client plugin boots first, caches undefined services, and silently
    // renders empty panes. Cordis holds apply() until every listed service is
    // live; all three are available within ~3s on 0.1.5-rc.2.
    exports.inject = ["slots", "sessions", "locale", "uiSession"];
    exports.apply = apply;
    return module.exports;
  },
});
