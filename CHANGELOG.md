# Changelog

本文件记录 `dsh-split-workspace` 的公开版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

This file records public releases of `dsh-split-workspace`; each version ends with a one-line English summary.

## [0.10.0] - 2026-11-18

### Changed

- **「在系统窗口打开」改为应用内独立窗口，不再打开浏览器。** 右键会话 → **在独立窗口打开** 会在 DSH 应用内部显示该会话，提供关闭 / 最小化 / 最大化-还原 / 全屏；双击标题栏切换最大化，最小化后收成左下角的恢复胶囊。会话仍从分屏 / 浮窗 / 待分屏中移出，关闭窗口后仍在侧栏里。
- 说明：DSH Desktop 的 Electron 主进程拒绝 `window.open` 创建原生窗口，Host 进程也没有 `BrowserWindow` API，当前 DSH 没有插件可用的原生多窗口接口。因此独立窗口是**应用内窗口**（无地址栏、不依赖浏览器），但仍在 DSH 主窗口内部；未来 DSH 开放原生窗口能力时可直接替换这一层。
- **新增系统设置入口**：除侧边栏底部菜单外，插件现在注册 **设置 → 分屏工作区** 页面（`settings.section`）。页面提供版本 / 窗格 / 待分屏 / 浮窗 / 独立窗口状态，性能模式开关，以及添加、退出、最小化、重置分屏、刷新界面、重启 DSH、帮助等操作。
- 删除浏览器独立页与 Host 的 `/dsv/system-window` 路由、`#dsvWindow` 标记；`/dsv/version` 与 `/dsv/restart` 保留。
- 新增 `window.__dshSplitWorkspace.openIndependentWindow(sessionId)`（`openSystemWindow` 的别名）与 `appWindow()` 状态查询。
- 帮助卡片补充独立窗口说明；README、测试与发布文件清单同步更新。

### Added

- `CHANGELOG.md`。

**English summary:** The session context menu's “system window” is now an in-app independent window (close / minimize / maximize / fullscreen, no browser); a new Settings → Split workspace page mirrors the split menu; the old browser standalone page and Host route were removed.

## [0.9.0] - 2026-11-18

### Added

- **重启入口**：桌面版分屏菜单、更新提示和 `restartApp()` API 都可以关闭并重新打开 DSH。Host 半边执行系统级重启——macOS 通过 AppleScript 正常退出，Windows 关闭窗口后终止进程并重新启动。生产版 DSH 没有内置重启菜单，这个入口用来应用需要完整重启的插件变更。
- **兜底分屏入口**：侧边栏 footer 没有渲染或被隐藏时，对话区左下角显示「分屏视图」按钮，菜单仍可打开。
- 更新提示在桌面版直接提供「重启 DSH」按钮；Web 版提供「刷新页面」。

### Changed

- **性能模式默认开启**：只有显式关过一次（存储值 `"0"`）才保持关闭。
- **性能模式下完全不渲染拖动缩略图**：不再克隆对话 DOM、不再逐帧移动预览窗口；拖入目标、布局预览和放置反馈保留。
- 更新 README：DSH 0.2.x 通过 HMR 热加载新安装的插件和重建的客户端 bundle，大多数安装/更新不需要重启；补充开发者工具刷新页面、重启入口和 HMR 的说明。

**English summary:** Added restart actions (menu, update chip, API) with OS-level quit/relaunch, a fallback split launcher, performance mode on by default, and no drag-preview thumbnail in performance mode.

## [0.8.0] - 2026-11-17

### Added

- **系统窗口（浏览器承载）**：右键会话 → 在系统窗口打开，由 Host 生成带 token 的 DSH Web 地址，在系统默认浏览器里打开只显示该会话的窗口。
- **性能模式**：关闭动画、阴影、跑马灯和多个后台观察器/轮询，适合低配机器与 Windows 多窗格场景。
- **更新提示**：运行中的页面读取磁盘上的 `package.json`，检测到新版本时显示更新提示。
- **`client.js` 工程化拆分**：拆成 `src/client/` 下的 18 个有序片段，由 `scripts/build-client.mjs` 拼回单文件；`npm test` 会检查产物是否过期。
- 修复分屏窗格标题栏拖动吞掉关闭按钮点击的问题（标题栏按落点动态启用拖动）。

**English summary:** Added system windows (browser-hosted), performance mode, update notice, modular client sources/build script, and the pane close-button click fix.

## [0.5.0] - 2026-11-17

### Added

- 侧边栏底部分屏菜单：添加分屏 / 退出分屏 / 最小化分屏 / 重置分屏。
- 「添加分屏」多选弹框：可搜索、预选当前窗格、取消或追加会话。
- 会话右键菜单集成：加入分屏 / 退出分屏；未分屏时先进入待分屏，满两个会话才分屏。

**English summary:** Added the sidebar-footer split menu, multi-select add dialog, and session context-menu split actions with a pending split.

## [0.4.3] - 2026-10-21

### Fixed

- 把页面级单例的 composer 插件作用域限定到当前活动窗格。
- 键盘焦点窗格内的浮层保持可见并重新锚定。
- 提示浮层锚定到聚焦窗格，拖动分屏更平滑。

### Added

- 中英双语文档与快速开始。
- GitHub Actions：测试通过且 npm 版本可解析后才创建 GitHub Release。

**English summary:** Fixed composer-plugin scoping and pane-overlay anchoring, added bilingual docs and safer CI release gating.

## [0.4.0] - 2026-10-21

### Added

- 分屏工作区首个公开发布：原生 `ChatPane` 多窗格、自动左右 / L 形 / 田字 / 网格布局、拖动重排、持久化布局、Alt+T 紧凑输入行、Alt+Shift+方向键切换窗格。

**English summary:** First public release of the native multi-pane split workspace with automatic layouts, drag reordering and persisted layouts.

## Earlier versions

`0.1.x`–`0.3.x` were pre-public iterations of the split workspace and were not published as separate tagged releases.
