# Changelog

本文件记录 `dsh-split-workspace` 的公开版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

This file records public releases of `dsh-split-workspace`; each version ends with a one-line English summary.

## [0.13.2] - 2026-11-19

### Fixed

- **真正修复「分屏最小化后再恢复，窗格标题栏按钮点不动」。** 根因是桌面端原生窗口的拖动区：被分屏盖住的原生会话仍然挂在画布下面，它的标题栏（栈顶 0–76px）声明了 Electron 的 `-webkit-app-region: drag`。原生拖动区在 DOM 之前吞掉鼠标事件，所以画布看着正常、`elementFromPoint` 也指向按钮，但点击根本进不了页面（实测没有任何 pointerdown；同一位置在浏览器里正常，因此 Web 端无法复现）。
  - 从「分屏视图」面板直接创建分屏时下面没有原生会话，按钮一直是好的；一旦最小化回到会话再恢复，原生会话挂载在画布下方，它的拖动区正好覆盖窗格标题栏（44–81px），按钮就全部失效。
  - 修复：给窗格标题栏声明 `-webkit-app-region: no-drag`，把这块区域从原生拖动区里扣掉。桌面端实测：恢复分屏后点击标题栏的 ⤢/⧉/?/分屏/关闭 全部恢复响应，帮助卡片正常弹出。

### Changed

- **面板里「最小化分屏」不再卡住点击。** 原来在“分屏视图”面板里最小化会同步离开面板并挂载整棵原生会话视图（实测点击后约 580ms 才完成这一帧，期间界面冻结）。现在先隐藏画布、显示恢复胶囊和「正在返回会话」提示卡（点击后一两帧内可见），再把“切回原生会话”放到下一帧任务里执行；剩余的对话视图挂载成本仍在，但不再阻塞点击反馈。
- 面板最小化期间，「分屏视图」页不会再被“选中面板即恢复分屏”的逻辑撤销（内部加了 in-flight 标记）。

**English summary:** The real cause of dead pane-header buttons after restoring a minimized split was Electron's native window-drag region: the covered stock conversation stays mounted behind the overlay and its header declares `-webkit-app-region: drag` over the top ~76px of the column, so the compositor swallowed those clicks before they reached the DOM (no pointerdown at all; browsers ignore app-region, which is why the web build never reproduced it). The pane header now declares `-webkit-app-region: no-drag`, carving itself out of that region. Also, minimizing from the split-view panel no longer freezes the click: the canvas hides and a "returning to the conversation" card paints first, while the main-column switch (a full native conversation mount) runs in the next task.

## [0.13.1] - 2026-11-19

### Fixed

- **修复「分屏最小化 → 恢复分屏」后窗格内顶部按钮点不动的问题。** 恢复出来的画布如果残留了隐藏阶段的交互样式（暖缓存隐藏、窗口缩放冻结被最小化打断、被取消的窗格拖动），画面会正常绘制但整块区域对鼠标透明，窗格标题栏的 ⤢ / ⧉ / ? / 分屏 / 关闭 全部失效。现在：
  - 暖缓存隐藏只使用 `visibility: hidden`（它本身就不参与命中测试），不再写 `pointer-events: none`，从源头消除「可见但点不到」的状态；
  - 新增不变量样式：画布只要不是暖缓存隐藏，就强制可见且 `pointer-events: auto`；窗格标题栏及其按钮再单独声明 `pointer-events: auto`，即使祖先被误设为透明也能点；
  - 画布每次显示后一帧做一次自检：清理残留的冻结 transform/尺寸、恢复为可交互、清掉被中断拖动遗留的 `data-dsv-source` 透明面板，并把修复次数记录到 `health().canvasRepairs`（正常应为 0）。
- `health()` 新增 `canvasRepairs`。

**English summary:** Fixed pane header buttons staying dead after restoring a minimized split: a canvas that is visible but left with hidden-phase interaction styles (warm hold, a window-resize freeze interrupted by minimize, a cancelled pane drag) now gets repaired. The warm hold only uses `visibility: hidden` (which already excludes hit-testing), a new invariant rule keeps every non-warm canvas visible and clickable, pane header buttons re-assert `pointer-events: auto`, and a one-frame self-check after each show clears leftover freeze/transform styles and interrupted-drag sources. Repairs are counted in `health().canvasRepairs` (0 in normal use).

## [0.13.0] - 2026-11-19

### Added

- **最小化胶囊可放在边缘任意位置。** 最小化分屏后出现的「恢复分屏」胶囊现在可以拖到工作区任意位置，松手吸附到**最近的边缘**，沿边的位置保留拖动时的位置（不再只限四个角），并且位置会持久化，下次最小化仍在原处。
- `health()` 新增 `panelSelected`（当前主区是否选中「分屏视图」）与 `panelWarm`（画布是否处于暖缓存隐藏状态）；`blockedReason` 在插件面板占用主区时返回 `panel`。

### Changed

- **切换「分屏视图」/普通会话 / 最小化 / 插件面板不再重建窗格。** 分屏画布改为单一常驻的覆盖层：选中「分屏视图」时主区页面本身是空的，画布覆盖同一列；隐藏时画布保留挂载 **20 秒**（暖缓存），期间来回切换几乎瞬时，不再重连会话、重建编辑器与对话视图。超过 20 秒才释放窗格树；隐藏期间保留布局，恢复是可见性切换而不是整棵树重排。
- 打开插件 / 技能 / 设置面板时分屏不再自动最小化成胶囊：画布暂时隐藏（窗格保持挂载），回到会话或「分屏视图」后自动恢复。点击其他会话仍会把分屏收成胶囊。
- **恢复分屏先显示画布**：原来会先同步切换被覆盖会话区的原生会话（`uiWorkspace.openSession`），这段原生切换可达数百毫秒，用户要等它完成才看到分屏；现在先恢复显示，再把被覆盖会话区的会话对齐延后 150ms、且当前已经是该会话时跳过。
- 暖缓存隐藏期间画布仍参与布局（这样恢复几乎零重排），因此最小化后的流式输出仍会产生布局开销，直到 20 秒窗口结束释放窗格树——这是「恢复瞬时」与「最小化省资源」之间的取舍。

### Fixed

- 修复「分屏视图 ⇄ 非分屏会话」「最小化 ⇄ 恢复分屏」切换卡顿：不再在每次切换时卸载并重新挂载全部原生窗格。

**English summary:** The minimized split's restore chip can now be dragged anywhere and snaps to the nearest edge (any position along that edge, persisted), instead of only the four corners. The split canvas is now a single always-mounted overlay layer: selecting the Split view panel, switching to a plain conversation, minimizing, or opening a plugin panel only shows/hides it, with a 20-second warm hold that keeps the native pane tree mounted so those switches are near-instant; after the warm window the tree is dropped. Opening a plugin panel no longer minimizes the split into the chip (the canvas hides and reappears automatically), and restoring a minimized split shows the canvas first while the covered stock view's session alignment is deferred. `health()` gains `panelSelected` / `panelWarm`.

## [0.12.0] - 2026-11-19

### Added

- **左侧栏新增「分屏视图」面板入口（与「插件」同级，0.12.0）。** 左侧栏顶部的全局面板导航里多了一行 **分屏视图**，行首是插件的分屏图标；点击它把主区切换到分屏视图面板：
  - 已有两个及以上窗格时，面板直接显示和「恢复分屏」相同的界面（窗格、分隔条、窗格工具栏）。
  - 还没有分屏时，面板显示 **添加分屏** 多选框；勾选两个或更多会话并确定后，立即在同一面板里显示分屏界面。
  - 从面板里「最小化分屏」回到会话界面，「退出分屏」清空窗格并返回会话；切到其他会话或插件面板时分屏布局保留，随时点回「分屏视图」继续。
  - 设置页「操作」里新增 **打开分屏视图**；主面板行、底部按钮、右键菜单用的是同一枚绘制图标。
- **会话右键「分屏插件」菜单增加图标。** 一级菜单和 **加入分屏 / 进入浮窗 / 进入独立窗口 / 进入系统窗口** 四个二级条目都带上了对应的 SVG 图标（contextMenu.icon 内联图标槽）。

### Changed

- 左下角分屏按钮与底部菜单的入口图标统一为侧栏「分屏视图」所用的同一枚图标。
- 设置页的「操作」新增「打开分屏视图」，并把状态区与菜单行为保持一致。

### Fixed

- **修复 Windows 上「重启 DSH」菜单图标显示为乱码方框的问题。** 旧图标使用 U+23FB（POWER SYMBOL），Windows 默认 CJK 字体栈没有该字形，显示成方框/乱码。现在改为内嵌 SVG 绘制的重启（循环箭头）图标，不再依赖系统字体；新增的图标同样全部是 SVG。
- **优化窗口缩放卡顿（性能模式下同样卡）。** 拖动窗口边缘时，每个窗格的尺寸观察器会在每一帧提交新的窗格尺寸，触发整块窗格重渲染、composer 卡片重新测量与对齐行重算，窗格越多越卡；同时窗格容器还有 180ms 的宽高过渡在“追”窗口边缘。0.12.0 引入布局忙时（窗口缩放 / 拖动分隔条）的收敛机制：
  - 缩放/拖动期间只保留浏览器自身的 CSS 重排；窗格尺寸、composer 几何、对齐行宽、浮窗钳制等 JS 测量与派生状态统一延迟到手势结束后执行一次。
  - composer 测量副作用不再依赖窗格宽度，不再在每次宽度变化时重建 ResizeObserver。
  - 缩放期间关闭窗格过渡/动画（html 上的 data-dsv-resizing 标记），去掉逐帧追赶窗口边缘的过渡成本。
  - 分隔条拖动同样按“手势结束再测量”处理，拖动更顺滑。
  - 新增 `window.__dshSplitWorkspace.resizeFreeze()` / `setResizeFreeze(true|false)`（默认开启，持久化），可在不喜欢“拖动时文字轻微拉伸”时关闭。
  - **性能模式下，窗口缩放期间冻结画布内部布局**：画布保持手势开始时的内部布局，用 CSS transform 跟随窗口边缘缩放到新尺寸（拖动时文字轻微拉伸），松手后一次性重排为真实尺寸——这样每个窗格里的原生对话不会每一帧重新测量滚动区域。普通模式保留逐帧重排与过渡动画。

**English summary:** Adds a **Split view** entry to the sidebar's global-panel navigation (next to **Plugins**) that opens the split workspace as a main panel — the same canvas when two or more panes exist, or an inline add-split picker that opens the split as soon as two conversations are confirmed. The footer button, sidebar row and session context-menu group now share one drawn icon; every session-menu row gets an icon; the Windows mojibake on the **Restart DSH** row is fixed by replacing the U+23FB power symbol with a drawn SVG; and window resizing is much smoother because pane measurement, composer geometry, dock alignment and float clamping are deferred to the end of the resize/divider gesture instead of running on every frame (with pane transitions cut while the layout is busy).

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
