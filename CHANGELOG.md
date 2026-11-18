# Changelog

本文件记录 `dsh-split-workspace` 的公开版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

This file records public releases of `dsh-split-workspace`; each version ends with a one-line English summary.

## [0.11.1] - 2026-11-18

### Fixed

- **修复重建后的客户端 bundle 无法热替换、必须刷新页面或重启 DSH 才能恢复菜单的问题。** 插件在浏览器端的工厂每次执行都会把只读诊断接口 `__test` 定义到 `window.__dshSplitWorkspace` 上（`configurable: false`）。DSH 在打开的页面里热替换重建后的客户端 bundle 时会再次执行同一个工厂，第二次定义抛出 `TypeError: Cannot redefine property: __test`，整个工厂就此中断：**左下角分屏按钮、会话右键「分屏插件」菜单和「设置 → 分屏工作区」同时消失**，DSH 把该插件记为“本页面的插件未能完成同步”，只能刷新页面或重启才能恢复。此前为了让改动生效而反复重启 DSH，原因就是这个异常，而不是 DSH 的热加载不生效。
  - 现在每次 bundle 执行都创建一个**新的** `window.__dshSplitWorkspace` 对象，`__test` / `__svc` 等诊断成员改为通过带保护的安装函数定义：任何诊断接口都不能再让插件加载失败，被替换的 bundle 也不会再把上一次加载的闭包（`health()`、`retry()`、`__test` 里的各个函数）继续暴露出去。
  - 覆盖的路径：热替换重建后的客户端 bundle、在设置 → 插件里禁用后再启用、以及从 0.11.0 热升级到 0.11.1——三种情况都在同一个页面内就地生效，不需要刷新或重启。
  - 新增离线断言，防止重新引入“在继承的旧全局对象上重复定义成员”的写法。

**English summary:** Fixed the client bundle failing to hot-swap after a rebuild: the factory re-defined the read-only `__test` diagnostics seam on the inherited `window.__dshSplitWorkspace` object and threw `Cannot redefine property: __test`, which aborted the whole factory and left the footer button, session menus and Settings page missing until the page reloaded. Each bundle execution now publishes a fresh API object, and `__test` / `__svc` are installed through a guarded helper, so bundle replacement, disable→enable and the 0.11.0→0.11.1 hot upgrade all apply in place.

## [0.11.0] - 2026-11-18

### Added

- **系统窗口（macOS 原生独立窗口）**：会话右键菜单新增 **分屏插件** 一级菜单，把 **加入分屏 / 退出分屏**、**进入浮窗 / 退出浮窗**、**进入独立窗口 / 退出独立窗口**、**进入系统窗口 / 退出系统窗口** 都收进它的二级菜单。其中「加入分屏 / 退出分屏」合并为同一个按状态显示的开关（在分屏/待分屏中显示「退出分屏」，否则显示「加入分屏」）。系统窗口打开一个真正的操作系统窗口（AppKit `NSWindow` + `WKWebView`，由 Host 通过 `osascript` 启动 `native/system-window.jxa`），可以拖到 DSH 主窗口之外、独立缩放和关闭；**不打开浏览器**，窗口内**不显示左侧栏**，右侧栏等其他区域照常保留。
- **窗口菜单状态跟随窗口开关**：浮窗、独立窗口、系统窗口都在打开后把菜单项变成 **退出浮窗 / 退出独立窗口 / 退出系统窗口**；关闭窗口（包括点窗口自身的关闭按钮，或关闭系统窗口 Helper）后菜单自动回到“进入”状态。独立窗口跟随时运行时 store，系统窗口状态由 Host 维护并通过 `/dsv/system-window` 查询（菜单打开期间轮询），退出/关闭立即更新。
- 新增 Host 侧 `nativeWindowSessions()` 与关闭动作：`POST /dsv/system-window` 支持 `{ sessionId, action: "open" | "close" }`，`GET` 返回当前系统窗口的会话列表；同一会话只保留一个系统窗口。
- 窗口加载 Host 本机认证的 Web 客户端：认证 URL 由 Host 在进程内生成并只交给本机 Helper，**不会返回给渲染层**；URL 哈希标记让同一份客户端代码在窗口内进入「系统窗口模式」——隐藏左侧栏与其网格轨道、隐藏插件自己的入口，并激活目标会话。
- **左下角分屏菜单新增「分屏帮助」入口**：底部分屏按钮菜单里可以直接打开带截图的帮助卡片。
- **分屏帮助新增界面指引截图**：帮助卡片（「分屏帮助」/窗格 `?` / 设置页「分屏帮助」）里新增三张截图缩略图——会话右键「分屏插件」菜单、左下角分屏按钮菜单、设置 → 分屏工作区；点击缩略图打开大图（Esc 或点击遮罩关闭）。Host 新增同源静态路由 `/dsv/help/...`，从 `docs/screenshots/` 读取，桌面端与 Web 客户端均可显示。
- 新增 API `window.__dshSplitWorkspace.openNativeWindow(sessionId)`、`closeNativeWindow(sessionId)` 与 `nativeWindows()`。
- Windows / Linux 点击时提示改用「在独立窗口打开」，不会退回浏览器；关闭窗口会结束后台 Helper 进程，退出 DSH 时也会关闭这些窗口。

### Changed

- Host 新增 `/dsv/system-window` 路由（POST + 确认头 + 同源校验 + 会话 id 白名单），平台不支持时返回 `unsupported-platform`；新增 `native/system-window.jxa` 并加入 npm 发布文件清单。
- README 增加系统窗口章节、限制说明与平台注意事项；测试补充系统窗口、Helper 与客户端入口断言。

**English summary:** Session context menu gains **Open in system window**: on macOS the Host opens a real OS window (AppKit NSWindow + WKWebView, no browser) showing one conversation with no left sidebar and the stock right sidebar intact. Adds the `/dsv/system-window` Host route, `openNativeWindow()`, and a packaged `native/system-window.jxa` helper.

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
