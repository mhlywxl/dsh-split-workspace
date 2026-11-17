    function StandaloneSessionWindow({ sessionId }) {
      const runtime = useRuntime();
      const sessions = useSessionsList();
      const summary = sessions !== null && sessions !== undefined && sessions.byId !== undefined
        ? sessions.byId[sessionId]
        : undefined;
      const title = summary !== null && summary !== undefined
        ? (summary.displayTitle || summary.title || sessionId)
        : sessionId;
      React.useEffect(() => {
        try { document.title = title + " — DeepSeek Harness"; } catch {}
      }, [title]);
      // The DOM session-list source normally observes only while a split is
      // live. This page is a one-conversation workspace, so keep it warm for
      // the title and the re-hosted header.
      React.useEffect(() => {
        const source = sessionsListSource;
        if (source === undefined || source === null || typeof source.setActive !== "function") return undefined;
        try { source.setActive(true); } catch {}
        try { if (typeof source.refresh === "function") source.refresh(); } catch {}
        return () => {
          try { source.setActive(false); } catch {}
        };
      }, []);
      return h("div", {
        className: "dsv-standalone",
        "data-dsv-standalone-window": sessionId,
      },
        h(RenderLeaf, { id: sessionId, chrome: true, generation: runtime.generation, standalone: true }),
      );
    }

