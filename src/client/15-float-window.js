    function FloatWindow({ id, x, y, width, height, zIndex, focused }) {
      const runtime = useRuntime();
      const style = {
        left: x + "px", top: y + "px", width: width + "px", height: height + "px",
        zIndex: zIndex,
      };
      return h("div", {
        className: "dsv-float-window" + (focused ? " focused" : ""),
        "data-dsv-float": id,
        style,
        onPointerDownCapture: () => { try { floatStore.focus(id); } catch {} },
      },
        h("div", { className: "dsv-float-body" },
          h(RenderLeaf, { id, chrome: true, generation: runtime.generation, floating: true })),
        ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((dir) => h("div", {
          key: dir,
          className: "dsv-float-resize dsv-float-resize-" + dir,
          "data-dsv-float-resize": dir,
          onPointerDown: (event) => beginFloatGesture(id, dir, event),
          onPointerMove: moveFloatGesture,
          onPointerUp: endFloatGesture,
          onPointerCancel: endFloatGesture,
        })),
      );
    }

    /** Always-mounted floating layer. It renders above the split overlay and
        is independent of the split activation gate: one conversation can float
        with zero panes. The composer bridge is acquired only while at least one
        window exists, so the inactive plugin still observes nothing. */
    function FloatLayer() {
      const runtime = useRuntime();
      const floats = useFloats();
      const windows = floats.windows;
      const count = windows.length;
      const appWindow = runtime.appWindow;
      const appWindowOpen = appWindow !== null && appWindow !== undefined && appWindow.minimized !== true;
      React.useEffect(() => {
        if (runtime.enabled !== true || count === 0) return undefined;
        floatLayerMounted = true;
        const release = acquireComposerAnchorBridge();
        return () => { floatLayerMounted = false; release(); };
      }, [runtime.enabled, count === 0]);
      React.useEffect(() => {
        if (count === 0) return undefined;
        const clampAll = () => {
          const work = chipWorkRect();
          for (const win of floatStore.getSnapshot().windows) {
            const next = clampFloatRect(win, work);
            if (next.x !== win.x || next.y !== win.y || next.w !== win.w || next.h !== win.h) {
              floatStore.setRect(win.id, next, false);
            }
          }
        };
        clampAll();
        window.addEventListener("resize", clampAll);
        // The column can change without a window resize (right-sidebar open/
        // close, shell layout transitions), so re-clamp on a low-frequency
        // backstop while floats exist. setRect is a no-op when nothing moved.
        // Perf mode keeps only the resize path.
        const timer = performanceModeOn() ? 0 : window.setInterval(clampAll, 1000);
        return () => {
          window.removeEventListener("resize", clampAll);
          if (timer !== 0) {
            try { window.clearInterval(timer); } catch {}
          }
        };
      }, [count, runtime.performance]);
      if (runtime.enabled !== true || count === 0 || appWindowOpen) return null;
      // Stacking is a z-index swap, never a DOM reorder: moving a live editor
      // subtree (keyed React children) would blur the composer.
      const ranks = new Map();
      windows.slice().sort((a, b) => a.z - b.z).forEach((win, index) => ranks.set(win.id, index + 1));
      return h("div", {
        className: "dsv-float-layer",
        "data-dsv-float-layer": "true",
        "data-plugin": PLUGIN_ID,
      }, windows.map((win) => h(FloatWindow, {
        key: win.id,
        id: win.id,
        x: win.x,
        y: win.y,
        width: win.w,
        height: win.h,
        zIndex: ranks.get(win.id) || 1,
        focused: floats.focused === win.id,
      })));
    }

    /** Whole-page view used inside a standalone system window: one native
        conversation, native window controls, no split / floats / launcher. */
