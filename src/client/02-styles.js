    // ---------------------------------------------------------------------
    // stylesheet (native ui-conversation rules copied under dsv- names —
    // used by the built-in fallback renderer and the workspace chrome)
    // ---------------------------------------------------------------------

    const DSV_CSS = `
    .dsv-overlay {
      position: fixed; top: 0; bottom: 0; right: 0; z-index: 60;
      animation: dsv-overlay-in .18s ease-out;
      background: var(--dsw-alias-bg-base);
      display: flex; flex-direction: column;
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      /* mirrors the stock ConversationRoot values so panes render the
         composer card and transcript at the same 748px content width
         (CSS has no // comments — a // line here used to swallow this
         declaration and uncapped every composer card in split view) */
      --dsh-chat-content-width: 748px;
      --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
      --dsh-composer-side-clearance: 16px;
      --dsh-composer-dock-inset: 8px;
    }
    .dsv-overlay:focus { outline: none; }
    .dsv-overlay.dsv-leaving { opacity: 0; pointer-events: none; transition: opacity .15s ease; }
    .dsv-minimized-chip { animation: dsv-fade-in .15s ease-out; transition: opacity .15s ease; }
    .dsv-minimized-chip.dsv-leaving { opacity: 0; pointer-events: none; }

    .dsv-topbar {
      flex: none; height: 40px; display: flex; align-items: center; gap: 8px;
      padding: 0 10px 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-base);
    }
    .dsv-topbar-title { font-size: 13px; font-weight: 600; line-height: 18px; }
    .dsv-topbar-count { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-left: 2px; }
    .dsv-topbar-spacer { flex: 1; }
    .dsv-topbar-btn {
      display: inline-flex; align-items: center; gap: 6px; height: 28px;
      padding: 0 8px; border: none; border-radius: 8px; cursor: pointer;
      background: transparent; color: var(--dsw-alias-label-secondary);
      font-size: 12px; line-height: 18px; font-family: inherit;
    }
    .dsv-topbar-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .dsv-topbar-btn.accent { color: var(--dsw-static-deepseek-500); }
    .dsv-topbar-btn.accent:hover { background: color-mix(in srgb, var(--dsw-static-deepseek-500) 10%, transparent); }

    .dsv-body-column { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .dsv-layout-bar {
      position: relative;
      flex: none; height: 32px; display: flex; align-items: center; gap: 8px;
      padding: 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1); user-select: none;
      white-space: nowrap; overflow: hidden;
      -webkit-app-region: drag;
    }
    /* A dedicated drag surface behind every child: the whole bar (including
       the 8px gaps around buttons and the last stretch before 右侧栏) moves the
       window. Buttons and labels sit above it and keep their no-drag hit area. */
    .dsv-layout-dragfill {
      position: absolute; inset: 0; z-index: 0;
      -webkit-app-region: drag;
    }
    .dsv-layout-bar > :not(.dsv-layout-dragfill) { position: relative; z-index: 1; }
    .dsv-layout-bar button { -webkit-app-region: no-drag; }
    /* Labels never wrap: the bar has a fixed 32px height, so a squeezed flex
       item used to stack 布局/右侧栏/最小化 into two or three lines. Every
       fixed child refuses to shrink; only the drag spacer gives width back.
       Very narrow columns switch to the compact variants below. */
    .dsv-layout-title { flex: none; white-space: nowrap; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
    .dsv-layout-count { flex: none; white-space: nowrap; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
    .dsv-layout-bar[data-compact] { gap: 6px; padding: 0 8px; }
    .dsv-layout-bar[data-compact] .dsv-layout-title,
    .dsv-layout-bar[data-compact="2"] .dsv-layout-count { display: none; }
    .dsv-layout-bar[data-compact] .dsv-layout-exit { padding-left: 6px; padding-right: 6px; }
    /* The blank stretch between the layout modes and the right-aligned actions
       is a window-drag handle, like the stock titlebar. pointer-events:none
       makes the BAR the hit target (the span itself is anonymous chrome), so no
       default no-drag child can swallow the gesture. */
    .dsv-layout-spacer {
      flex: 1; align-self: stretch;
      -webkit-app-region: drag;
    }
    .dsv-layout-exit {
      flex: none; white-space: nowrap;
      height: 24px; padding: 0 9px; border: 1px solid transparent; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
      font: 11px/1 inherit; font-family: inherit;
    }
    .dsv-layout-exit:hover { color: #e5484d; background: color-mix(in srgb, #e5484d 10%, transparent); }
    /* Same panel icon + ghost treatment as the stock right-sidebar control
       that the split overlay covers (see the LayoutBar). */
    .dsv-layout-icon {
      flex: none; width: 24px; height: 24px; padding: 0;
      display: grid; place-items: center;
      border: 0; border-radius: 6px; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-secondary);
    }
    .dsv-layout-icon:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
    /* Open state: accent glyph on a tinted seat, so the panel toggle reads as
       ON even before the pointer hovers it. */
    .dsv-layout-icon.is-open {
      color: var(--dsw-static-deepseek-500);
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 12%, transparent);
    }
    .dsv-layout-icon.is-open:hover {
      color: var(--dsw-static-deepseek-500);
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 20%, transparent);
    }
    .dsv-layout-icon svg { display: block; }
    .dsv-footer-btn {
      position: relative;
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px;
      background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
    }
    .dsv-footer-btn:hover,
    .dsv-footer-btn[data-open="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .dsv-footer-btn[data-open="true"] { color: var(--dsw-static-deepseek-500); }
    .dsv-footer-badge {
      position: absolute; top: -3px; right: -3px; min-width: 13px; height: 13px; padding: 0 3px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px; background: var(--dsw-static-deepseek-500); color: #fff;
      font-size: 9px; line-height: 1; font-weight: 600; pointer-events: none;
      box-shadow: 0 0 0 1.5px var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
    }

    /* Fallback launcher: shown only when the stock sidebar footer does not
       render the plugin's action, so the split menu stays reachable from the
       conversation column's bottom-left corner. */
    .dsv-fallback-launcher {
      position: fixed; left: 16px; bottom: 16px; z-index: 130;
      display: inline-flex; align-items: center; gap: 6px;
      height: 30px; padding: 0 10px; border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-label-secondary);
      font-family: var(--dsw-font-family, system-ui, sans-serif); font-size: 12px;
      cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    }
    .dsv-fallback-launcher:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-fallback-label { white-space: nowrap; }
    html[data-dsv-performance="1"] .dsv-fallback-launcher { box-shadow: none; }

    /* ---- settings page (0.10.0): the same controls as the footer menu,
       contributed to the system Settings panel through settings.section. ---- */
    .dsv-settings {
      display: flex; flex-direction: column; gap: 14px;
      padding: 2px 2px 28px;
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
    }
    .dsv-settings-desc { font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-tertiary); }
    .dsv-settings-group {
      display: flex; flex-direction: column;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      padding: 4px 14px;
    }
    .dsv-settings-group-title {
      margin: 0; padding: 10px 0 6px;
      font-size: 12px; font-weight: 600; line-height: 18px;
      color: var(--dsw-alias-label-secondary);
    }
    .dsv-settings-row {
      display: flex; align-items: center; gap: 12px; min-height: 44px;
      padding: 6px 0; border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 62%, transparent);
    }
    .dsv-settings-group-title + .dsv-settings-row { border-top: 0; }
    .dsv-settings-label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .dsv-settings-row-label { flex: 1; min-width: 0; font-size: 13px; line-height: 20px; }
    .dsv-settings-value {
      flex: none; max-width: 52%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-tertiary);
    }
    .dsv-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 0 12px; }
    .dsv-settings-btn {
      height: 30px; padding: 0 12px; border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px;
      cursor: pointer;
    }
    .dsv-settings-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-settings-btn:disabled { opacity: 0.42; cursor: default; }
    .dsv-settings-btn.accent { background: var(--dsw-static-deepseek-500); border-color: transparent; color: #fff; }
    .dsv-settings-btn.accent:hover:not(:disabled) { background: var(--dsw-static-deepseek-500); filter: brightness(1.05); }
    .dsv-settings-btn.danger { color: #e5484d; }

    /* ---- 0.5.0 launcher: the sidebar footer menu and the multi-select
       "add split" dialog. Both mount through the shell overlay seat, so they
       are never clipped by the sidebar column or the split overlay. ---- */
    .dsv-launcher-menu {
      position: fixed; z-index: 140; width: 200px; padding: 6px;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      animation: dsv-launcher-in 0.12s ease-out;
    }
    .dsv-launcher-header {
      padding: 4px 8px 6px; font-size: 11px; line-height: 15px;
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-launcher-item {
      display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px;
      border: 0; border-radius: 8px; background: transparent; color: inherit;
      font: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .dsv-launcher-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-launcher-item:disabled { opacity: 0.42; cursor: default; }
    .dsv-launcher-item.danger { color: #e5484d; }
    .dsv-launcher-item.danger:hover:not(:disabled) { background: color-mix(in srgb, #e5484d 12%, transparent); }
    .dsv-launcher-icon { flex: none; width: 18px; display: grid; place-items: center; font-size: 13px; line-height: 1; opacity: 0.85; }
    .dsv-launcher-separator { height: 1px; margin: 5px 8px; background: var(--dsw-alias-border-l2); }
    @keyframes dsv-launcher-in { from { opacity: 0; transform: translateY(4px); } }

    .dsv-modal-backdrop {
      position: fixed; inset: 0; z-index: 2147483002;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.32);
      animation: dsv-fade-in 0.12s ease-out;
      font-family: var(--dsw-font-family, system-ui, sans-serif);
    }
    .dsv-modal {
      width: min(520px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 64px));
      display: flex; flex-direction: column; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-label-primary);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
    }
    .dsv-modal-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 16px 8px; }
    .dsv-modal-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; }
    .dsv-modal-close {
      flex: none; width: 26px; height: 26px; display: grid; place-items: center;
      border: 0; border-radius: 7px; background: transparent;
      color: var(--dsw-alias-label-secondary); font: inherit; font-size: 16px; cursor: pointer;
    }
    .dsv-modal-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .dsv-modal-hint { flex: none; padding: 0 16px 10px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
    .dsv-modal-search {
      flex: none; margin: 0 16px 10px; height: 30px; padding: 0 10px;
      border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2);
      background: transparent; color: var(--dsw-alias-label-primary);
      font: inherit; font-size: 12px; outline: none;
    }
    .dsv-modal-search:focus { border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 45%, transparent); }
    .dsv-modal-search::placeholder { color: var(--dsw-alias-label-caption); }
    .dsv-modal-body {
      flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 10px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .dsv-pick-row {
      display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px;
      border: 0; border-radius: 10px; background: transparent; color: inherit;
      font: inherit; text-align: left; cursor: pointer;
    }
    .dsv-pick-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-pick-check {
      flex: none; box-sizing: border-box;
      width: 16px; height: 16px;
      display: grid; place-items: center;
      border: 1.5px solid var(--dsw-alias-border-l2); border-radius: 4px;
      font-size: 11px; line-height: 1; color: #fff; background: transparent;
    }
    .dsv-pick-row[aria-checked="true"] .dsv-pick-check {
      background: var(--dsw-static-deepseek-500); border-color: transparent;
    }
    .dsv-pick-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .dsv-pick-title { font-size: 13px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dsv-pick-sub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dsv-pick-tag {
      flex: none; padding: 0 6px; border-radius: 999px; font-size: 10px; line-height: 16px;
      color: var(--dsw-static-deepseek-500);
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 12%, transparent);
    }
    .dsv-pick-empty { padding: 22px 12px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
    .dsv-modal-foot {
      flex: none; display: flex; align-items: center; gap: 8px;
      padding: 10px 16px 14px; border-top: 1px solid var(--dsw-alias-border-l2);
    }
    .dsv-modal-count { flex: 1; min-width: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
    .dsv-modal-btn {
      flex: none; height: 30px; padding: 0 14px; border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer;
    }
    .dsv-modal-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-modal-btn.accent { background: var(--dsw-static-deepseek-500); border-color: transparent; color: #fff; }
    .dsv-modal-btn.accent:hover { filter: brightness(1.05); background: var(--dsw-static-deepseek-500); }
    @keyframes dsv-fade-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-launcher-menu, .dsv-modal-backdrop { animation: none; }
    }
    /* ---- 0.6.0 floating windows: a movable/resizable in-app window that
       hosts ONE native conversation. Floats render from the always-mounted
       shell.overlay seat, sit above the split overlay, and are mutually
       exclusive with split panes per session (enter/leave switches modes). ---- */
    .dsv-float-layer {
      position: fixed; inset: 0; z-index: 85; pointer-events: none;
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      color: var(--dsw-alias-label-primary);
    }
    .dsv-float-window {
      position: fixed; display: flex; flex-direction: column;
      box-sizing: border-box;
      min-width: 320px; min-height: 220px; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-base);
      box-shadow: 0 18px 48px rgba(15, 23, 42, .22), 0 2px 6px rgba(15, 23, 42, .12);
      pointer-events: auto;
      animation: dsv-float-in .16s ease-out;
      transition: box-shadow .16s ease, border-color .16s ease;
      --dsh-chat-content-width: 748px;
      --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
      --dsh-composer-side-clearance: 16px;
      --dsh-composer-dock-inset: 8px;
    }
    .dsv-float-window.focused {
      border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 32%, var(--dsw-alias-border-l2));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-static-deepseek-500) 28%, transparent),
        0 22px 56px rgba(15, 23, 42, .26);
    }
    .dsv-float-body { flex: 1; min-height: 0; display: flex; }
    .dsv-float-body > .dsv-pane { flex: 1; min-width: 0; min-height: 0; }
    /* The outer window owns the frame: the re-hosted pane drops its card
       chrome (border/radius/glow) and keeps only its header + content. */
    .dsv-float-window .dsv-pane,
    .dsv-float-window .dsv-pane.focused {
      border: 0; border-radius: 0; box-shadow: none; background: transparent;
    }
    .dsv-float-window .dsv-pane-header { height: 34px; border-top-left-radius: 14px; border-top-right-radius: 14px; }
    .dsv-float-resize { position: absolute; z-index: 2; touch-action: none; }
    .dsv-float-resize-n, .dsv-float-resize-s { left: 12px; right: 12px; height: 6px; cursor: row-resize; }
    .dsv-float-resize-n { top: -3px; }
    .dsv-float-resize-s { bottom: -3px; }
    .dsv-float-resize-e, .dsv-float-resize-w { top: 12px; bottom: 12px; width: 6px; cursor: col-resize; }
    .dsv-float-resize-e { right: -3px; }
    .dsv-float-resize-w { left: -3px; }
    .dsv-float-resize-ne, .dsv-float-resize-nw, .dsv-float-resize-se, .dsv-float-resize-sw { width: 16px; height: 16px; }
    .dsv-float-resize-ne { right: -4px; top: -4px; cursor: nesw-resize; }
    .dsv-float-resize-nw { left: -4px; top: -4px; cursor: nwse-resize; }
    .dsv-float-resize-se { right: -4px; bottom: -4px; cursor: nwse-resize; }
    .dsv-float-resize-sw { left: -4px; bottom: -4px; cursor: nesw-resize; }
    @keyframes dsv-float-in { from { opacity: 0; transform: translateY(6px) scale(.992); } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-float-window { animation: none; transition: none; }
    }
    /* ---- independent window: one conversation fills the surface, rendered
       inside the in-app window frame with its own close / minimize /
       maximize / fullscreen controls. ---- */
    html[data-dsv-standalone] { overflow: hidden; }
    html[data-dsv-standalone] body { overflow: hidden; }
    .dsv-standalone {
      position: fixed; inset: 0; z-index: 1200;
      display: flex; flex-direction: column; min-width: 0; min-height: 0;
      background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      --dsh-chat-content-width: 748px;
      --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
      --dsh-composer-side-clearance: 16px;
      --dsh-composer-dock-inset: 8px;
    }
    .dsv-standalone > .dsv-pane {
      flex: 1; min-width: 0; min-height: 0;
      border: 0; border-radius: 0; box-shadow: none;
    }

    /* ---- independent window (0.10.0): a first-class in-app window for one
       conversation. DSH exposes no plugin-facing BrowserWindow API, so this
       replaces the old browser window with an application surface. ---- */
    .dsv-app-window-layer {
      position: fixed; inset: 0; z-index: 999;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, #000 18%, transparent);
    }
    .dsv-app-window {
      position: relative; overflow: hidden;
      width: min(1120px, calc(100vw - 96px));
      height: min(780px, calc(100vh - 96px));
      min-width: 0; min-height: 0;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-base);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.12);
    }
    .dsv-app-window.maximized {
      width: 100vw; height: 100vh; border: 0; border-radius: 0; box-shadow: none;
    }
    .dsv-app-window .dsv-standalone-embedded {
      position: absolute; inset: 0; z-index: auto;
    }
    .dsv-app-window-chip { left: 16px; right: auto; bottom: 16px; z-index: 1200; }
    .dsv-app-window-chip .dsv-chip-text {
      max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    html[data-dsv-performance="1"] .dsv-app-window { box-shadow: none; }
    @media (max-width: 900px) {
      .dsv-app-window { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
    }
    .dsv-standalone .dsv-pane-header { height: 40px; }
    /* One title per pane: the pane header owns it. The stock header keeps its
       view tabs and action rows but not its breadcrumb; the slim header's own
       title span is removed in JSX. */
    .dsv-pane nav[class*="_crumbs"] { display: none !important; }
    .dsv-pane .dsv-slim-title { display: none !important; }
    /* The stock conversation header's action cluster deliberately overhangs a
       16px window gutter (margin-right:-16px) to reach the window edge. A split
       pane has no gutter: overflow:hidden clipped the last icon (open right
       sidebar) by ~15px. Pull the corner back inside the pane so every action
       is fully visible — including in a maximized/fullscreen pane. */
    .dsv-pane [class*="_headerCorner"] { margin-right: 0 !important; }
    /* Every pane re-hosts a stock conversation header, and that header injects
       its own "open right sidebar" affordance from the PANE session's sidebar
       store. The right sidebar is one global column driven by the workspace
       toolbar, so the per-pane copy is both redundant and clipped at the pane
       edge (its stock -16px overhang has no window gutter to land in). The
       split toolbar's 右侧栏 button is the single owner. */
    .dsv-pane [data-sidebar-right-expand] { display: none !important; }
    .dsv-minimized-chip { bottom: 18px; right: 18px; cursor: grab; touch-action: none; user-select: none; }
    .dsv-minimized-chip.dragging { cursor: grabbing; opacity: .96; }
    .dsv-minimized-chip .dsv-chip-text { pointer-events: none; }
    .dsv-minimized-grip {
      flex: none; cursor: grab; user-select: none; pointer-events: auto;
      color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 1;
      letter-spacing: 1px; padding: 0 2px;
    }
    .dsv-minimized-chip.dragging .dsv-minimized-grip { cursor: grabbing; }
    .dsv-pane-title-edit { cursor: text; }
    .dsv-pane-title-edit:hover { color: var(--dsw-static-deepseek-500); }
    .dsv-pane-title-input {
      box-sizing: border-box;
      flex: 0 1 170px; width: 170px; min-width: 80px; max-width: 170px; height: 20px; padding: 0 5px;
      border: 1px solid var(--dsw-static-deepseek-500); border-radius: 5px;
      background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
      font: 12px/1.2 inherit; font-family: inherit; outline: none;
    }
    .dsv-body { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 10px; }

    .dsv-rail {
      flex: none; width: 232px; min-height: 0; display: flex; flex-direction: column;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-layer-1, transparent); overflow: hidden;
    }
    .dsv-rail-search {
      flex: none; margin: 10px 10px 6px; height: 30px; border-radius: 10px;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); padding: 0 10px; font-size: 13px;
      font-family: inherit; outline: none;
    }
    .dsv-rail-search:focus { border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 45%, transparent); }
    .dsv-rail-search::placeholder { color: var(--dsw-alias-label-caption); }
    .dsv-rail-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px 10px; display: flex; flex-direction: column; gap: 2px; }
    .dsv-rail-item {
      display: flex; align-items: center; gap: 8px; padding: 7px 8px;
      border-radius: 10px; cursor: grab; border: none; background: transparent;
      color: inherit; text-align: left; font-family: inherit; width: 100%;
    }
    .dsv-rail-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-rail-item:active { cursor: grabbing; }
    .dsv-rail-item-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; flex: 1; }
    .dsv-rail-item-title { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dsv-rail-item-sub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dsv-rail-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); }
    .dsv-rail-dot.running { background: var(--dsw-static-deepseek-500); animation: dsv-pulse 1.6s ease-in-out infinite; }
    .dsv-rail-dot.open { background: color-mix(in srgb, var(--dsw-static-deepseek-500) 55%, var(--dsw-alias-label-tertiary)); }
    @keyframes dsv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    .dsv-rail-empty { padding: 18px 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }

    .dsv-canvas { flex: 1; min-width: 0; min-height: 0; position: relative; display: flex; }
    .dsv-split { display: flex; min-width: 0; min-height: 0; flex: 1; }
    .dsv-split[data-dir="h"] { flex-direction: row; }
    .dsv-split[data-dir="v"] { flex-direction: column; }
    .dsv-pane-wrap, .dsv-split-wrap { display: flex; min-width: 0; min-height: 0; }
    .dsv-pane-wrap > .dsv-pane { flex: 1; }
    .dsv-split-wrap > .dsv-split { flex: 1; }

    .dsv-divider { flex: none; position: relative; z-index: 3; touch-action: none; }
    .dsv-split[data-dir="h"] .dsv-divider { width: 10px; cursor: col-resize; }
    .dsv-split[data-dir="v"] .dsv-divider { height: 10px; cursor: row-resize; }
    .dsv-divider::after {
      content: ""; position: absolute; border-radius: 999px;
      background: transparent; transition: background .12s ease;
    }
    .dsv-split[data-dir="h"] .dsv-divider::after { top: 20%; bottom: 20%; left: 3px; width: 4px; }
    .dsv-split[data-dir="v"] .dsv-divider::after { left: 20%; right: 20%; top: 3px; height: 4px; }
    .dsv-divider:hover::after, .dsv-divider.active::after {
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 40%, transparent);
    }

    .dsv-pane {
      position: relative; display: flex; flex-direction: column;
      min-width: 0; min-height: 0; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;
      background: var(--dsw-alias-bg-base);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      transition: box-shadow .18s ease, border-color .18s ease, opacity .15s ease, transform .15s ease;
    }
    .dsv-pane.dsv-pane-closing { opacity: 0; transform: scale(.986); pointer-events: none; }
    /* Split geometry animates when panes are added/closed. Divider drags hand
       the browser a fresh ratio on every pointermove, so transitions are cut
       while a divider is active (otherwise the pane would lag the pointer). */
    .dsv-pane-wrap, .dsv-split-wrap { transition: width .18s ease, height .18s ease; }
    .dsv-canvas:has(.dsv-divider.active) .dsv-pane-wrap,
    .dsv-canvas:has(.dsv-divider.active) .dsv-split-wrap { transition: none; }
    .dsv-pane-wrap { animation: dsv-fade-in .18s ease-out; }
    @keyframes dsv-fade-in { from { opacity: 0; } }
    @keyframes dsv-overlay-in { from { opacity: 0; } }
    @keyframes dsv-preview-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-pane-wrap, .dsv-split-wrap { transition: none; animation: none; }
      .dsv-pane, .dsv-overlay, .dsv-drag-preview { transition: none !important; animation: none !important; }
    }
    /* Light & shadow focus: a thin luminous rim over a modest ambient drop —
       elevation, not a selection rectangle. Deliberately TWO shadow layers
       (1px rim + 12px drop): the old four-layer stack (36px blur + 30px glow)
       read heavy and multiplied GPU compositing cost per focused pane during
       streaming. Single-pane mode never lights up (see the .flush gate below). */
    .dsv-pane.focused {
      border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 24%, var(--dsw-alias-border-l2));
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--dsw-static-deepseek-500) 22%, transparent),
        0 4px 16px rgba(15, 23, 42, 0.14);
    }
    .dsv-body.flush .dsv-pane.focused {
      border-color: var(--dsw-alias-border-l2);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    @media (prefers-reduced-motion: reduce) {
      .dsv-pane { transition: none; }
    }
    /* A lone pane loses the card chrome entirely: it reads as the stock view. */
    .dsv-pane.bare { border: none; border-radius: 0; box-shadow: none; }
    .dsv-body.flush { padding: 0; gap: 0; }
    .dsv-pane-header {
      flex: none; height: 36px; display: flex; align-items: center; gap: 8px;
      padding: 0 4px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      cursor: grab; user-select: none;
    }
    .dsv-pane-header:active { cursor: grabbing; }
    /* Slim header for narrow panes: one 30px row instead of the tall stock
       header stack (breadcrumb + tabs + actions). */
    .dsv-slim-header {
      flex: none; height: 30px; display: flex; align-items: center; gap: 8px;
      padding: 0 6px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2);
      min-width: 0;
    }
    .dsv-slim-title {
      font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      min-width: 0; flex: 0 1 auto;
      max-width: 40%; cursor: grab; user-select: none;
    }
    .dsv-slim-title:active { cursor: grabbing; }
    .dsv-slim-tabs { display: flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
    /* Re-hosted conversation.session.header.actions (agent-team trigger,
       agent-preset label, cost-meter statistics) for narrow panes. It is a
       container context on purpose: the entries' own CSS collapses their
       labels via @container (width<=480px) — the stock header provides the
       same context, so the entries behave identically here. */
    .dsv-slim-actions {
      display: flex; align-items: center; gap: 2px; flex: none; min-width: 0;
      max-width: 58%; overflow: hidden; justify-content: flex-end;
      margin-left: auto; container-type: inline-size;
    }
    .dsv-slim-header[data-actions] .dsv-slim-tabs { margin-left: 0; }
    .dsv-slim-tab {
      border: none; background: transparent; cursor: pointer; height: 22px;
      padding: 0 8px; border-radius: 6px; font-size: 11.5px; line-height: 22px;
      color: var(--dsw-alias-label-secondary); font-family: inherit; white-space: nowrap;
    }
    .dsv-slim-tab:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
    .dsv-slim-tab.active {
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 14%, transparent);
      color: var(--dsw-static-deepseek-500); font-weight: 600;
    }
    /* TUI composer: a terminal-grade single line wired to the real input
       machine — for short (vertically split) panes. */
    /* the TUI line rides the SAME measured card geometry as the full-mode
       composer (PaneFrame's --dsv-card-* vars) so Alt+T never moves the
       input's edges — the toggle and the send key keep their positions.
       Center alignment puts the prompt arrow, the text line, the send key
       and the toggle on ONE vertical midline between the box's edges. */
    /* the block owns the TUI frame (edges + measured card geometry) so the
       queued-messages line and the input line read as ONE terminal surface;
       with no queue the block renders only the input line — pixel-identical
       to the pre-queue layout. */
    .dsv-tui-block {
      flex: none;
      width: var(--dsv-card-w, calc(100% - 32px));
      max-width: calc(var(--dsh-chat-content-width) + 32px);
      /* auto margins CENTER the line when no card box has been measured. The
         stock card is centred in its own root (.uV2eYG_root sets
         align-items: center; the card itself is width: 100% with
         max-width: var(--dsh-composer-card-max-width)), so a fixed 16px left
         fallback pinned the line to the LEFT of a wide pane — combined with the
         780px cap it read as "the TUI line sits on the left instead of
         centred". A measured box still wins: both vars are published together,
         and an explicit value beats auto. (No backticks in this comment — it
         lives inside a template literal.) */
      margin: 0 var(--dsv-card-right-inset, auto) 0 var(--dsv-card-left, auto);
      border-top: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-base);
    }
    .dsv-tui {
      flex: none; display: flex; align-items: center; gap: 6px;
      /* 14px left = the stock composer card's own text inset (the native
         editor carries padding-left:14px inside the card), so Alt+T keeps the
         line start on the same vertical as the full composer's text; 12px
         right keeps the send key on its previous band. */
      padding: 6px 12px 6px 14px;
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      /* the composer card's type scale, not the bare pane's inherited 16px */
      font-size: var(--dsv-composer-font-size, 14px);
      line-height: var(--dsv-composer-line-height, 24px);
    }
    /* queued-messages badge: one dim monospace line under the block's top
       rule — terminal-adjacent, no card chrome. Count in brand color, first
       queued message as a truncated preview, full list in the tooltip. */
    .dsv-tui-queue {
      display: flex; align-items: baseline; gap: 6px;
      min-width: 0; padding: 5px 12px 0;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
      font-size: 11px; line-height: 15px;
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; user-select: none;
    }
    .dsv-tui-queue-glyph, .dsv-tui-queue-count {
      flex: none; color: var(--dsw-static-deepseek-500); font-weight: 700;
    }
    .dsv-tui-queue-preview {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; opacity: .9;
      border-left: 1px solid var(--dsw-alias-border-l2); padding-left: 7px;
    }
    .dsv-tui-attach {
      flex: none; width: calc(100% - 32px); max-width: calc(var(--dsh-chat-content-width) + 32px);
      margin: 0 auto;
    }
    .dsv-tui-prompt {
      color: var(--dsw-static-deepseek-500); font-weight: 700; user-select: none;
      display: flex; align-items: center;
    }
    .dsv-tui-input {
      flex: 1; min-width: 0; resize: none; border: none; outline: none; background: transparent;
      color: var(--dsw-alias-label-primary);
      /* native caret token (InputBar.module.css), not a brand colour guess */
      caret-color: var(--dsw-alias-state-business-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      /* the composer card's own type scale — a textarea does NOT inherit the
         row's font, so this has to be explicit or the terminal line renders
         at the pane's 16px/normal and visibly larger than the chat */
      font-size: var(--dsv-composer-font-size, 14px);
      line-height: var(--dsv-composer-line-height, 24px);
      /* border-box is REQUIRED for the centered first line: the auto-grow
         effect sets height = scrollHeight, and scrollHeight already includes
         this 4px+4px padding — under the UA-default content-box that height
         grows the box another 8px past the text, leaving dead space at the
         bottom so the glyphs ride high of the TUI band's midline (the flex
         row still centers the box itself, so buttons stayed centered while
         the text did not). border-box makes the box exactly hug the text
         (native editor: padding 4px 8px 0 14px, min-height 36px). */
      box-sizing: border-box;
      padding: 4px 0;
      max-height: 96px;
    }
    .dsv-tui-btn {
      flex: none; border: none; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-secondary); display: grid; place-items: center;
      height: 26px; width: 26px; border-radius: 6px; padding: 0;
      /* bottom 0 puts the button's band exactly on the pinned toggle's
         band (the row's 7px bottom padding doubles as the toggle offset) */
      margin-bottom: 0;
    }
    .dsv-tui-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
    .dsv-tui-btn:disabled { opacity: 0.4; cursor: default; }
    /* one-line dock: a fixed text area mirroring the chat box geometry.
       DockLine pins margin-left/width inline from the LIVE composer box
       (wrapper-anchored via useComposerAlignedRow): the left edge lands on
       the card's left border + 4px buffer, and the right edge 60px short of
       the card's right — 24px+ clear of the pinned toggle. Nothing is ever
       hidden — overflowing cells are revealed by dragging the row. */
    .dsv-dock-line {
      display: flex; align-items: center; min-width: 0;
      margin: 5px 0 0 4px;
      padding: 2px 0;
      border: 1px solid transparent; border-radius: 12px;
      background: var(--dsw-alias-bg-base);
      overflow: hidden; user-select: none; cursor: default;
    }
    /* the native stats root centers itself with 32px side padding for the
       stock layout — inside a dock cell the row owns the geometry, so the
       cell starts flush and the row's buffers decide the edges */
    .dsv-dock-cell > * { max-width: none !important; margin: 0 !important; padding-left: 0 !important; padding-right: 0 !important; text-align: left !important; }
    /* queue strip: the native merge-into-card design. The stock QueueDock
       panel styles itself (radius 12 12 0 0, hairline border top/left/right,
       no bottom) and only needs the card's measured width plus the native
       bottom tuck. */
    .dsv-queue-strip {
      flex: none;
      /* Native geometry, straight from QueueDock.module.css: the dock is
         card − 2×side-clearance(16) − 2×dock-inset(8) = card − 48px wide and
         carries padding 0 8px, so the PANEL inside is card − 64px. The
         earlier card − 16px guess made the queued-message block ~32px wider
         than the input card it merges into (and at wide panes the stock card
         is capped at 780px, so the overhang was much larger than that). */
      box-sizing: border-box;
      width: calc(var(--dsv-card-w, calc(100% - 32px)) - 48px);
      max-width: 100%;
      margin: 0 auto;
      padding: 0 8px;
      min-width: 0;
    }
    /* Native vertical rhythm: the stock dock lives in .composerStack, which
       sets --dsh-composer-stack-gap:6px and gap:6px, and the dock carries
       margin-bottom: calc(0px - stack-gap - 3px) = -9px — so the card overlaps
       the panel's bottom by exactly 3px and its rounded top corners cover that
       edge. The pane's column has no gap, so the net -3px rides the strip.
       :not(:empty) is load-bearing: the wrapper div exists even when QueueDock
       renders nothing, and an unconditional negative margin would lift the
       whole composer card off its stock position while the queue is empty.
       (The old -15px hid the bottom of the 28px edit/remove/steer buttons.) */
    .dsv-queue-strip:not(:empty) { margin-bottom: -3px; }
    .dsv-queue-strip > * {
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
    }
    .dsv-input-dock {
      min-width: 0;
      /* exact card box via the sticky measured vars */
      margin-left: var(--dsv-card-left, 16px);
      width: var(--dsv-card-w, calc(100% - 32px));
    }
    /* Reserve a stable band under the composer card for the pinned TUI
       toggle. Without it the band is only the composer container's ~10px
       bottom padding, so the 26px toggle (centered in that band) rides up
       into the card's bottom-right corner — straight over the send key.
       Dock lines (stats, queue) widen the band when present, which is why
       the overlap appeared and disappeared with the stats line. 22px plus
       the stock padding keeps the toggle fully below the card whether or
       not a dock line renders, so its position stops depending on them. */
    .dsv-pane [data-dsv-composer-card] { margin-bottom: 22px; }
    /* Composer-anchored floating overlays (prompt-history browse pill,
       slash/mention menus, model popovers) belong to the pane's own input.
       Each pane mounts its own overlay slot, so after focus moves the old
       pane kept painting its pill above a composer the user was no longer
       typing in — with several panes that read as a hint "in the wrong
       place". Hidden (not unmounted) while the pane is inactive, so a
       plugin's browse state survives a focus round-trip. */
    .dsv-pane:not([data-dsv-composer-active]) [data-composer-overlay] { visibility: hidden; }
    /* queue dock (card−48/764) and todo panel (card−64/748) carry different
       stock width formulas — neutralize them so every strip spans the strip
       zone (= the measured chat box) edge to edge; vertical margins survive
       so the queue panel keeps its merge-into-card rhythm */
    .dsv-input-dock > * {
      width: 100% !important;
      max-width: none !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
    }
    /* programmatic transcript focus is silent — the UA focus ring here is
       just a white rectangle around the chat area (Alt+Shift+Arrow used to
       leave one behind; the chord now targets the input, and the Esc path
       keeps its silent focus too) */
    .dsv-silent-focus:focus, .dsv-silent-focus:focus-visible { outline: none !important; }
    .dsv-dock-line.overflown { cursor: grab; }
    .dsv-dock-line.dragging { cursor: grabbing; }
    .dsv-dock-inner { display: flex; align-items: center; gap: 12px; flex: none; width: max-content; }
    .dsv-dock-cell { flex: none; white-space: nowrap; }
    /* pinned composer-mode button: absolute bottom-right of the pane, so its
       position is pixel-identical in full and TUI modes — repeated clicks
       never require moving the cursor. */
    .dsv-mode-btn {
      position: absolute; bottom: 4px; z-index: 6;
      width: 26px; height: 26px; border-radius: 8px; padding: 0;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
      display: grid; place-items: center; cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      transition: color .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    .dsv-mode-btn:hover {
      color: var(--dsw-static-deepseek-500);
      border-color: color-mix(in srgb, var(--dsw-static-deepseek-500) 40%, var(--dsw-alias-border-l2));
      box-shadow: 0 0 10px color-mix(in srgb, var(--dsw-static-deepseek-500) 25%, transparent);
    }
    /* inline variant: a flex child of the TUI line (no absolute positioning,
       so it can never overlap the send key) */
    .dsv-mode-btn.inline { position: static; }
    /* Fixed title slot: equal panes align their titles (and the cwd after
       them) on the same column. The slot can shrink on a narrow pane, but it
       never hugs the text, so short titles no longer leave a ragged row. */
    .dsv-pane-title {
      flex: 0 1 170px; width: 170px; max-width: 170px; min-width: 0;
      display: flex; align-items: center; overflow: hidden;
    }
    /* The rename target stays content-width INSIDE the slot: blank space
       after a short title still starts a drag, never a rename. */
    .dsv-pane-title-text {
      display: block; min-width: 0; max-width: 100%;
      font-size: 13px; font-weight: 500; line-height: 18px;
      color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-pane.dsv-compact .dsv-pane-title { flex: 1 1 auto; width: auto; max-width: none; }
    .dsv-pane.dsv-compact .dsv-pane-cwd { display: none; }
    /* The blank stretch between the title and the action cluster is a drag
       handle, not part of the rename target. pointer-events:none lets the
       header itself receive the drag. */
    .dsv-pane-header-spacer {
      flex: 1 1 auto; min-width: 8px; align-self: stretch;
      pointer-events: none; user-select: none;
    }
    .dsv-pane-menu {
      position: absolute; top: 36px; right: 6px; z-index: 25;
      min-width: 156px; padding: 4px; display: flex; flex-direction: column; gap: 1px;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      box-shadow: 0 10px 30px rgba(15, 23, 42, .18);
      animation: dsv-fade-in .12s ease-out;
    }
    .dsv-pane-menu-item {
      display: flex; align-items: center; gap: 8px;
      height: 28px; padding: 0 8px; border: 0; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-primary);
      font: 12px/1 inherit; font-family: inherit; text-align: left; cursor: pointer;
    }
    .dsv-pane-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-pane-menu-item.danger { color: #e5484d; }
    .dsv-pane-menu-item.danger:hover { background: color-mix(in srgb, #e5484d 12%, transparent); }
    .dsv-pane-cwd {
      flex: 0 1 auto; min-width: 0; max-width: 130px; font-size: 11px; line-height: 16px;
      color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-pane-running { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-static-deepseek-500); animation: dsv-pulse 1.6s ease-in-out infinite; }
    /* Idle panes keep the dot's slot so titles start on the same column. */
    .dsv-pane-running.idle { background: transparent; animation: none; }
    .dsv-pane-btn {
      flex: none; width: 26px; height: 26px; display: grid; place-items: center;
      border: none; border-radius: 8px; background: transparent; cursor: pointer;
      color: var(--dsw-alias-label-secondary); padding: 0;
    }
    .dsv-pane-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    /* Close is a destructive action: tinted at rest so it reads as the
       close control at a glance, not just another ghost icon. */
    .dsv-pane-btn-close {
      color: #e5484d;
      background: color-mix(in srgb, #e5484d 12%, transparent);
      /* an inset ring, not a border: the 26px hit box of every action button
         stays identical, so the header cluster never shifts */
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #e5484d 30%, transparent);
      border-radius: 8px;
    }
    .dsv-pane-btn-close:hover {
      color: #fff; background: #e5484d;
      box-shadow: inset 0 0 0 1px #e5484d;
    }
    .dsv-pane-btn-close svg { display: block; }

    .dsv-drop-ghost {
      position: absolute; z-index: 6; pointer-events: none;
      border-radius: 12px; display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 13%, transparent);
      border: 1.5px dashed color-mix(in srgb, var(--dsw-static-deepseek-500) 65%, transparent);
      transition: all 60ms ease;
    }
    .dsv-drop-label {
      font-size: 12px; line-height: 18px; font-weight: 500;
      color: var(--dsw-static-deepseek-500); background: var(--dsw-alias-bg-base);
      border: 1px solid color-mix(in srgb, var(--dsw-static-deepseek-500) 45%, transparent);
      border-radius: 999px; padding: 2px 10px; white-space: nowrap;
    }
    /* fixed-position variant for the inactive-mode drag bridge (ghost floats
       over the conversation column before any pane exists); inline styles
       carry the pixel box, this only lifts it above the stock chrome */
    .dsv-drop-ghost[data-dsv-fixed] { z-index: 90; }

    /* Live pane reflow (dragging a pane by its header). The wrappers are
       absolutely placed from the split tree for the duration of the drag, so
       the preview can close the dragged pane's slot and open a hole at the
       destination without rebuilding (and remounting) the React tree. The
       split containers become display:contents so the leaf wrappers resolve
       their containing block against the canvas; dividers are hidden. */
    .dsv-canvas.dsv-reflowing .dsv-split-wrap,
    .dsv-canvas.dsv-reflowing .dsv-split { display: contents; }
    .dsv-canvas.dsv-reflowing .dsv-divider { display: none; }
    /* The drag preview is geometry-only, so it must NOT transition the
       pane boxes while the pointer moves. A 180ms width/height transition
       laid out every re-hosted transcript on every frame (the jank users
       felt when dragging a conversation window around), and the pane-local
       ResizeObservers re-rendered each pane in the same rhythm. Live drags
       therefore snap; only the animate-back path opts into the transition
       through .dsv-reflow-settling. */
    .dsv-canvas.dsv-reflowing .dsv-pane-wrap {
      position: absolute !important;
      left: var(--dsv-rl, 0px) !important;
      top: var(--dsv-rt, 0px) !important;
      width: var(--dsv-rw, 0px) !important;
      height: var(--dsv-rh, 0px) !important;
      z-index: 1;
      will-change: auto;
      transition: opacity .12s ease;
    }
    .dsv-canvas.dsv-reflowing.dsv-reflow-settling .dsv-pane-wrap {
      will-change: left, top, width, height;
      transition:
        left .18s cubic-bezier(.22, .61, .36, 1),
        top .18s cubic-bezier(.22, .61, .36, 1),
        width .18s cubic-bezier(.22, .61, .36, 1),
        height .18s cubic-bezier(.22, .61, .36, 1),
        opacity .12s ease;
    }
    .dsv-canvas.dsv-reflowing .dsv-pane-wrap[data-dsv-source] {
      z-index: 0; opacity: 0 !important; pointer-events: none;
    }
    /* The hole is the exact box the drop will fill. It lives on <body> so a
       React commit inside the canvas can never reclaim the node. */
    .dsv-reflow-hole {
      /* Above every stock chrome layer: the stock composer + desktop pet
         are fixed overlays that otherwise paint through an empty slot. */
      position: fixed; z-index: 9998; pointer-events: none;
      left: var(--dsv-rl, 0px); top: var(--dsv-rt, 0px);
      width: var(--dsv-rw, 0px); height: var(--dsv-rh, 0px);
      box-sizing: border-box; border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      /* Opaque: the stock conversation is still mounted underneath the
         split overlay, and an empty slot must not show it through. */
      background: color-mix(in srgb, var(--dsw-static-deepseek-500) 6%, var(--dsw-alias-bg-base));
      border: 1.5px dashed color-mix(in srgb, var(--dsw-static-deepseek-500) 55%, transparent);
      box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.04);
      animation: dsv-hole-in .16s ease-out;
      transition:
        left .18s cubic-bezier(.22, .61, .36, 1),
        top .18s cubic-bezier(.22, .61, .36, 1),
        width .18s cubic-bezier(.22, .61, .36, 1),
        height .18s cubic-bezier(.22, .61, .36, 1),
        opacity .12s ease;
    }
    .dsv-reflow-hole[hidden] { display: none; }
    /* External (sidebar → split) hole: names the conversation that will land
       here, so the preview reads as the post-drop pane, not an empty slot. */
    .dsv-ext-hole { flex-direction: column; gap: 4px; padding: 10px; text-align: center; }
    .dsv-hole-title {
      max-width: 92%; font-size: 13px; font-weight: 600; line-height: 18px;
      color: var(--dsw-alias-label-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-hole-sub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
    /* A TOC grip that belongs to the hidden stock conversation, to a
       non-pane view, or to a duplicate pane copy (see tocGripSync). */
    .dsv-toc-hidden { display: none !important; }
    /* While a pane/external drop preview lays the panes out, the grips would
       float over the hole at their old (pre-preview) stops; hide them until
       the layout settles and tocGripSync re-places them. */
    body.dsv-layout-previewing .dsh-ph-toc-grip { display: none !important; }
    @keyframes dsv-hole-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-canvas.dsv-reflowing .dsv-pane-wrap,
      .dsv-canvas.dsv-reflowing.dsv-reflow-settling .dsv-pane-wrap,
      .dsv-reflow-hole { transition: none !important; animation: none !important; }
    }

    /* Virtual window that follows the pointer during a conversation drag. It
       replaces the browser's opaque drag snapshot (setDragImage uses a 1x1
       transparent canvas) so the gesture reads as "carrying a window". */
    .dsv-drag-preview {
      position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none;
      width: 224px; border-radius: 10px; overflow: hidden;
      animation: dsv-preview-in .12s ease-out;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      border: .5px solid var(--dsw-alias-border-l2);
      box-shadow: 0 14px 36px rgba(15, 23, 42, .22), 0 2px 6px rgba(15, 23, 42, .12);
      opacity: .96; will-change: transform; user-select: none;
      contain: strict; backface-visibility: hidden;
      font-family: inherit; color: var(--dsw-alias-label-primary);
      transform: translate3d(-9999px, -9999px, 0);
    }
    /* A cloned conversation can carry hundreds of running animations,
       backdrop filters and shadows; none of them need to repaint inside a
       moving miniature. Killing them keeps the drag at compositor speed. */
    .dsv-drag-preview-clone,
    .dsv-drag-preview-clone * {
      animation: none !important;
      transition: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      box-shadow: none !important;
      text-shadow: none !important;
      filter: none !important;
    }
    .dsv-drag-preview-bar {
      display: flex; align-items: center; gap: 6px; height: 26px;
      padding: 0 9px; background: var(--dsw-alias-bg-layer-2, transparent);
      border-bottom: .5px solid var(--dsw-alias-border-l2);
    }
    .dsv-drag-preview-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; }
    .dsv-drag-preview-dot.r { background: #ff5f57; }
    .dsv-drag-preview-dot.y { background: #febc2e; }
    .dsv-drag-preview-dot.g { background: #28c840; }
    .dsv-drag-preview-title {
      flex: 1; min-width: 0; margin-left: 4px;
      font-size: 11.5px; line-height: 16px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-drag-preview-body {
      padding: 7px 10px 8px; font-size: 11px; line-height: 16px;
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Same-conversation drop guard: a red wash over the pane that cannot take
       the dragged conversation. pointer-events:none keeps HTML5 drag events
       flowing so the wash clears as soon as the pointer leaves. */
    .dsv-pane-invalid[data-dsv-fixed] { position: fixed; inset: auto; z-index: 92; }
    .dsv-drag-preview.leaving { opacity: 0; transition: opacity .12s ease; }
    .dsv-drag-preview.dsv-drag-preview-thumb {
      width: auto; border-radius: 12px;
      background: var(--dsw-alias-bg-base);
      border: 1px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
      box-shadow: 0 18px 44px rgba(15, 23, 42, .26), 0 2px 8px rgba(15, 23, 42, .12);
    }
    /* Lightweight live-text miniature: the real header/title, the visible
       transcript text and a composer strip. A full DOM clone of a long
       conversation cost ~1.7s to rasterise on the first drag frame, so this is
       the default; the full clone remains behind __DSV_REAL_THUMB. */
    .dsv-preview-mini {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      overflow: hidden; background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary); font-family: inherit;
    }
    .dsv-preview-mini-head {
      flex: none; height: 13px; display: flex; align-items: center; gap: 2.5px;
      padding: 0 4px; border-bottom: .5px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, transparent);
    }
    .dsv-preview-mini-dot { flex: none; width: 3px; height: 3px; border-radius: 50%; }
    .dsv-preview-mini-dot.r { background: #ff5f57; }
    .dsv-preview-mini-dot.y { background: #febc2e; }
    .dsv-preview-mini-dot.g { background: #28c840; }
    .dsv-preview-mini-title {
      flex: 1; min-width: 0; margin-left: 2px;
      font-size: 5px; line-height: 1.2; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dsv-preview-mini-body {
      flex: 1 1 auto; min-height: 0; overflow: hidden;
      padding: 3px 5px; color: var(--dsw-alias-label-secondary);
      font-size: 4.2px; line-height: 1.55; white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .dsv-preview-mini-composer {
      flex: none; margin: 3px 4px 4px; height: 13px; box-sizing: border-box;
      display: flex; align-items: center; padding: 0 3px;
      border: .5px solid var(--dsw-alias-border-l2); border-radius: 3px;
      background: var(--dsw-alias-bg-layer-1, transparent);
      font-size: 4px; color: var(--dsw-alias-label-tertiary);
      white-space: nowrap; overflow: hidden;
    }
    .dsv-drag-preview-clone {
      position: absolute; left: 0; top: 0; margin: 0 !important;
      transform-origin: top left; pointer-events: none;
      border-radius: 0 !important; box-shadow: none !important;
    }
    .dsv-pane-invalid {
      position: absolute; inset: 0; z-index: 30; pointer-events: none;
      animation: dsv-fade-in .14s ease-out;
      display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
      border: 1.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 55%, transparent);
      border-radius: inherit;
    }
    .dsv-pane-invalid-card {
      display: flex; align-items: center; gap: 8px;
      max-width: 80%; padding: 8px 13px; border-radius: 10px;
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-state-error-primary, #e5484d);
      box-shadow: 0 6px 20px rgba(15, 23, 42, .16);
      font-size: 12px; line-height: 18px; font-weight: 500;
    }
    .dsv-pane-invalid-icon { flex: none; font-size: 15px; line-height: 1; }
    .dsv-picker-empty {
      padding: 14px 12px; text-align: center;
      font-size: 12px; line-height: 18px;
      color: var(--dsw-alias-label-tertiary);
    }

    .dsv-empty {
      flex: 1; border: 1.5px dashed var(--dsw-alias-border-l2); border-radius: 16px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; color: var(--dsw-alias-label-tertiary); text-align: center; padding: 20px;
    }
    .dsv-empty-title { font-size: 15px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
    .dsv-empty-hint { font-size: 12px; line-height: 18px; max-width: 420px; }
    .dsv-empty-btn {
      margin-top: 6px; height: 32px; padding: 0 14px; border: none; border-radius: 999px;
      background: var(--dsw-static-deepseek-500); color: #fff; font-size: 13px;
      font-weight: 500; cursor: pointer; font-family: inherit;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .dsv-empty-btn:hover { background: color-mix(in srgb, var(--dsw-static-deepseek-500) 88%, #000); }

    /* ---- fallback transcript (ui-conversation ChatView.module.css) ---- */
    .dsv-chat-root { flex-direction: column; flex: auto; min-height: 0; display: flex; position: relative; }
    .dsv-chat-scroll {
      min-height: 0; padding: 16px calc(var(--dsh-composer-side-clearance) + 12px);
      flex: auto; overflow-y: auto; container-type: inline-size;
    }
    .dsv-chat-column {
      max-width: var(--dsh-chat-content-width); flex-direction: column; gap: 16px;
      width: 100%; margin: 0 auto; display: flex;
    }
    .dsv-flow-item { min-width: 0; }
    .dsv-flow-item:empty { display: none; }
    .dsv-turn-status {
      height: 26px; font: var(--dsw-font-s-strong-14, 600 14px/26px var(--dsw-font-family, system-ui)); white-space: nowrap;
      background: linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);
      color: #0000; -webkit-text-fill-color: transparent; background-position: 100% 0; background-size: 250% 100%;
      -webkit-background-clip: text; background-clip: text; flex: none; align-self: flex-start;
      align-items: center; animation: 1.8s linear infinite dsv-shimmer; display: inline-flex;
    }
    .dsv-turn-status-clock {
      font: var(--dsw-font-xs-13, 400 13px/18px var(--dsw-font-family, system-ui)); font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-caption); -webkit-text-fill-color: var(--dsw-alias-label-caption);
      margin-left: 8px; font-weight: 400;
    }
    @keyframes dsv-shimmer { to { background-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-turn-status { background-position: 0 0; background-size: 100% 100%; animation: none; }
    }
    .dsv-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .dsv-open-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
    .dsv-older { justify-content: center; display: flex; }
    .dsv-older button {
      color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover));
      cursor: pointer; border: none; border-radius: 14px; padding: 4px 12px; font-size: 12px; font-family: inherit;
    }
    .dsv-older button:disabled { cursor: default; opacity: 0.6; }
    .dsv-to-bottom-slot {
      z-index: 8; height: 0; padding-right: 0; pointer-events: none;
      justify-content: flex-end; display: flex; position: sticky; bottom: 12px;
    }
    .dsv-to-bottom {
      border: 1px solid var(--dsw-alias-border-l2); width: 34px; height: 34px;
      color: var(--dsw-alias-label-primary); background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base)));
      box-shadow: var(--dsw-shadow-lv2); cursor: pointer; pointer-events: auto;
      border-radius: 100px; justify-content: center; align-items: center; margin-top: -34px; padding: 0; display: flex;
    }
    .dsv-to-bottom:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover)); }

    /* ---- fallback user bubble (MessageItem.module.css) ---- */
    .dsv-user-row { flex-direction: column; align-items: flex-end; gap: 6px; display: flex; }
    .dsv-user-row[data-pending-steering] { opacity: 0.72; }
    .dsv-user-stack { flex-direction: column; align-items: flex-end; gap: 8px; min-width: 0; max-width: min(525px, 82%); display: flex; }
    .dsv-bubble {
      background: var(--dsw-specific-bubble); max-width: 100%; color: var(--dsw-alias-label-primary);
      border-radius: 22px; padding: 10px 16px; font-size: 16px; line-height: 24px;
      white-space: pre-wrap; overflow-wrap: anywhere;
    }

    /* ---- fallback assistant markdown (AssistantMarkdown.module.css) ---- */
    .dsv-md-root { color: var(--dsw-alias-label-primary); flex-direction: column; font-size: 16px; line-height: 28px; display: flex; }
    .dsv-md-body { flex-direction: column; gap: 16px; display: flex; }
    .dsv-md-stopped {
      background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary);
      border-radius: 6px; align-self: flex-start; padding: 0 6px; font-size: 11px; line-height: 18px;
    }

    /* ---- fallback think row (ReasoningRow.module.css) ---- */
    .dsv-think-root { flex-direction: column; display: flex; }
    .dsv-think-row { position: relative; overflow: hidden; }
    .dsv-think-root[data-state="running"] .dsv-think-row::after {
      content: ""; inset-block: 0; width: 300px; position: absolute; left: 0;
      background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
      pointer-events: none; animation: 2.6s ease-out infinite dsv-row-sweep;
    }
    @keyframes dsv-row-sweep { 0% { left: -300px; } 90%, 100% { left: 100%; } }
    @media (prefers-reduced-motion: reduce) {
      .dsv-think-root[data-state="running"] .dsv-think-row::after { animation: none; }
      .dsv-rowcard-root[data-state="running"] .dsv-rowcard-row::after { animation: none; }
    }
    .dsv-think-leading { flex-shrink: 0; }
    .dsv-think-chevron { color: var(--dsw-alias-label-secondary); }
    .dsv-think-title { font-weight: 400; }
    .dsv-think-separator { background: var(--dsw-alias-label-caption); border-radius: 1px; flex: none; width: 2px; height: 2px; margin: 0 8px; }
    .dsv-think-summary { min-width: 0; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; flex: auto; font-size: 14px; line-height: 24px; overflow: hidden; }
    .dsv-think-summary[data-follow-end] { text-overflow: clip; }
    .dsv-think-body { color: var(--dsw-alias-label-tertiary); white-space: pre-wrap; word-break: break-word; padding: 4px 0 4px 22px; font-size: 14px; line-height: 24px; }

    /* ---- fallback command / tool rows (GenericCommandCard.module.css) ---- */
    .dsv-rowcard-root { flex-direction: column; display: flex; }
    .dsv-rowcard-row { position: relative; overflow: hidden; }
    .dsv-rowcard-root[data-state="running"] .dsv-rowcard-row::after {
      content: ""; inset-block: 0; width: 300px; position: absolute; left: 0;
      background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
      pointer-events: none; animation: 2.6s ease-out infinite dsv-row-sweep;
    }
    .dsv-rowcard-leading { flex-shrink: 0; }
    .dsv-rowcard-chevron { color: var(--dsw-alias-label-secondary); }
    .dsv-rowcard-title { font-weight: 400; }
    .dsv-rowcard-separator { background: var(--dsw-alias-label-caption); border-radius: 1px; flex: none; width: 2px; height: 2px; margin: 0 8px; }
    .dsv-rowcard-summary { min-width: 0; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; flex: auto; font-size: 14px; line-height: 24px; overflow: hidden; }
    .dsv-rowcard-summary[data-error] { color: var(--dsw-alias-state-error-primary); }
    .dsv-rowcard-body {
      border: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2)); background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-1, transparent));
      max-height: 260px; color: var(--dsw-alias-label-primary);
      font: var(--dsw-font-markdown-code-block-small, 400 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      white-space: pre-wrap; border-radius: 12px; margin: 4px 0 4px 4px; padding: 12px 16px; overflow: auto;
    }
    .dsv-rowcard-body[data-error] { color: var(--dsw-alias-state-error-primary); }
    .dsv-turn-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; align-self: center; text-align: center; }

    /* ---- fallback composer (InputBar.module.css, simplified) ---- */
    .dsv-composer { flex: none; padding: 0 var(--dsh-composer-side-clearance) 10px; display: flex; flex-direction: column; }
    .dsv-composer-card {
      box-sizing: border-box; width: 100%;
      border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, var(--dsw-alias-border-l2));
      background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, transparent));
      box-shadow: var(--dsw-shadow-lv2); border-radius: 22px;
      flex-direction: column; gap: 8px; padding-top: 10px; font-size: 16px; line-height: 24px; display: flex; position: relative;
    }
    .dsv-composer-text {
      resize: none; width: 100%; color: var(--dsw-alias-label-primary);
      caret-color: var(--dsw-alias-state-business-primary); background: transparent;
      border: none; outline: none; font-family: var(--dsw-font-family, inherit);
      font-size: 16px; line-height: 24px; white-space: pre-wrap; overflow-y: auto;
      padding: 4px 14px 0 16px; max-height: 168px; box-sizing: border-box;
    }
    .dsv-composer-text::placeholder { color: var(--dsw-alias-label-caption); }
    .dsv-composer-text:disabled { cursor: not-allowed; }
    .dsv-composer-row {
      flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;
      min-width: 0; padding: 2px 8px 6px; display: flex;
    }
    .dsv-composer-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); padding-left: 8px; }
    /* The stock hero row (workspace chip + agent-preset chooser) that a pane
       otherwise never renders — see ChatPane's heroBlank note. Geometry rides
       the same clearance/width vars as the composer it sits above, plus the
       card's own 8px text inset on the left, so the seat lines up with the
       workspace chip on the stock page. */
    .dsv-hero-row {
      flex: none; display: flex; align-items: center; gap: 8px; min-width: 0;
      box-sizing: border-box; width: 100%;
      max-width: var(--dsh-composer-card-max-width);
      margin: 0 auto; padding: 0 calc(var(--dsh-composer-side-clearance) + 8px) 6px;
    }
    .dsv-composer-trailing { flex: none; display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .dsv-send {
      background: var(--dsw-alias-button-info-fill, var(--dsw-static-deepseek-500)); color: #fff; cursor: pointer;
      border: none; border-radius: 999px; flex: none; place-items: center; width: 34px; height: 34px;
      transition: background-color .1s; display: grid; transform: translateY(-2px); padding: 0;
    }
    .dsv-send:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, var(--dsw-static-deepseek-500)); }
    .dsv-send:disabled { opacity: 0.4; cursor: default; }
    .dsv-send.stop { background: var(--dsw-alias-state-error-primary); }
    .dsv-send.stop:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 88%, #000); }

    .dsv-visually-hidden { clip: rect(0 0 0 0); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden; }

    /* ---- 1.6.0 safety chrome: every element here is plugin-owned and small,
       fixed to a corner or inside the plugin overlay — it must never cover a
       stock control, and everything respects reduced motion. ---- */
    .dsv-chip {
      position: fixed; right: 12px; bottom: 12px; z-index: 95;
      display: flex; align-items: center; gap: 8px;
      max-width: min(420px, calc(100vw - 24px));
      padding: 8px 10px 8px 12px; border-radius: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-label-primary);
      font-family: var(--dsw-font-family, system-ui, sans-serif);
      font-size: 12px; line-height: 18px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
    }
    .dsv-chip-text { min-width: 0; }
    .dsv-chip-btn {
      flex: none; height: 24px; padding: 0 10px; border-radius: 7px;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px;
      cursor: pointer;
    }
    .dsv-chip-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsv-chip-btn.accent { background: var(--dsw-static-deepseek-500); border-color: transparent; color: #fff; }
    .dsv-chip-btn.icon { width: 24px; padding: 0; display: grid; place-items: center; }
    .dsv-help-card, .dsv-tip-card {
      position: absolute; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 9;
      max-width: min(560px, calc(100% - 32px));
      padding: 14px 16px; border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base));
      color: var(--dsw-alias-label-primary);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      font-size: 12px; line-height: 18px;
    }
    .dsv-help-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
    /* fixed variant: used by the inactive "could not start" chip path, where
       the plugin overlay (the card's normal containing block) is not rendered */
    .dsv-help-card-fixed { position: fixed; bottom: 56px; z-index: 2147482999; }
    .dsv-help-row { display: flex; gap: 10px; padding: 2px 0; }
    .dsv-help-keys {
      flex: none; min-width: 150px; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
      color: var(--dsw-static-deepseek-500);
    }
    .dsv-help-body { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
    .dsv-help-actions { display: flex; gap: 8px; margin-top: 10px; }
    .dsv-pane-error {
      flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 8px; padding: 20px; text-align: center;
    }
    .dsv-pane-error-title { font-size: 13px; font-weight: 600; }
    .dsv-pane-error-body { font-size: 11px; color: var(--dsw-alias-label-tertiary); max-width: 90%; overflow-wrap: anywhere; }
    @media (prefers-reduced-motion: reduce) {
      .dsv-drop-ghost { transition: none; }
    }
    /* ---- performance mode -------------------------------------------------
       One HTML attribute turns off every non-essential paint/animation cost:
       no card shadows, no focus glow, no fade/zoom transitions, no render-loop
       animations. JS-side observers are reduced by performanceModeOn() gates. */
    html[data-dsv-performance="1"] .dsv-pane,
    html[data-dsv-performance="1"] .dsv-overlay,
    html[data-dsv-performance="1"] .dsv-float-window,
    html[data-dsv-performance="1"] .dsv-minimized-chip,
    html[data-dsv-performance="1"] .dsv-chip,
    html[data-dsv-performance="1"] .dsv-launcher-menu,
    html[data-dsv-performance="1"] .dsv-modal,
    html[data-dsv-performance="1"] .dsv-drop-ghost,
    html[data-dsv-performance="1"] .dsv-drag-preview {
      animation: none !important;
      transition: none !important;
    }
    html[data-dsv-performance="1"] .dsv-pane,
    html[data-dsv-performance="1"] .dsv-float-window,
    html[data-dsv-performance="1"] .dsv-chip,
    html[data-dsv-performance="1"] .dsv-launcher-menu,
    html[data-dsv-performance="1"] .dsv-modal {
      box-shadow: none !important;
    }
    html[data-dsv-performance="1"] .dsv-pane.focused {
      border-color: var(--dsw-alias-border-l2) !important;
      box-shadow: none !important;
    }
    html[data-dsv-performance="1"] .dsv-pane-wrap,
    html[data-dsv-performance="1"] .dsv-split-wrap,
    html[data-dsv-performance="1"] .dsv-divider::after,
    html[data-dsv-performance="1"] .dsv-pane-btn,
    html[data-dsv-performance="1"] .dsv-mode-btn {
      animation: none !important;
      transition: none !important;
    }
    html[data-dsv-performance="1"] .dsv-pane,
    html[data-dsv-performance="1"] .dsv-float-window {
      border-radius: 8px;
    }
    html[data-dsv-performance="1"] .dsv-think-root[data-state="running"] .dsv-think-row::after,
    html[data-dsv-performance="1"] .dsv-rowcard-root[data-state="running"] .dsv-rowcard-row::after {
      animation: none !important;
      display: none !important;
    }
    /* update-ready chip: shown when the on-disk plugin version differs from
       the client bundle this page loaded. */
    .dsv-update-chip {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px 8px 12px; border-radius: 10px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
      color: var(--dsw-alias-label-primary);
      box-shadow: 0 6px 24px rgba(0, 0, 0, .16);
      font-family: var(--dsw-font-family, system-ui, sans-serif); font-size: 12px;
    }
    .dsv-update-chip-btn {
      height: 24px; padding: 0 10px; border-radius: 7px; cursor: pointer;
      border: 1px solid var(--dsw-alias-border-l2); background: transparent;
      color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px;
    }
    .dsv-update-chip-btn.accent { background: var(--dsw-static-deepseek-500); border-color: transparent; color: #fff; }
    .dsv-update-chip-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
    html[data-dsv-performance="1"] .dsv-update-chip { box-shadow: none; }
    `;

    function insertStyle(css) {
      const tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = "split-view";
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

