# dsh-split-workspace

**中文（默认）** · [English](#english)

把 DeepSeek Harness 的对话区拆成原生多窗格工作区——左右分屏、上下分屏、田字 2×2 或自动网格，窗口放得下多少会话就开多少。每个窗格都是真实会话，拥有自己的输入框、流式输出、停止、队列、待办、附件、`/` 命令、`ask_user_question`、审批与视图页，桌面端（`dsh-app://`）同样可用。还可以把任意会话变成可拖动、可缩放的**浮窗**，在分屏与浮窗两种模式之间来回切换；或把它放进**应用内独立窗口**（关闭 / 最小化 / 最大化 / 全屏），桌面版还可以把它放进**真正的系统窗口**（macOS 用系统 WebView、Windows 用 WebView2，独立于 DSH 主窗口，不经过浏览器）；并支持从侧边栏菜单和**系统设置**两个入口操作。版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## 快速开始

### 先选运行方式

| 方式 | 适用场景 | 插件安装位置 |
| --- | --- | --- |
| Web（`dsh web`，浏览器打开） | 先在浏览器里试用、远程机器 | `web` profile |
| 桌面端 DSH Desktop（`dsh-app://`） | 日常使用，支持完整桌面能力，推荐 | `desktop` profile，由桌面端管理 |

- 支持 DSH 0.2.0 / 0.2.1，当前针对 0.2.1-rc.2 构建。
- 包内 `lib/client.js` 已预构建，无 Node 原生模块、无安装脚本，客户端的 macOS / Windows / Linux 行为一致；Windows 的「系统窗口」随包附带 WebView2 SDK（约 1.1 MB，BSD-3-Clause），无需本地编译，但需要机器已安装 Microsoft Edge WebView2 运行时（Windows 11 自带，Windows 10 装过新版 Edge 即有）。
- 插件本身运行时不联网。

### Web：在线安装

```sh
dsh plugin --profile web add dsh-split-workspace
dsh --profile web
```

`dsh --profile web` 会启动 Web 服务并打印带 token 的地址；如果服务已在运行，安装后重启它，再硬刷新页面。

### Web：离线安装

在联网机器上打包，或从 GitHub Release 下载 `.tgz`，然后拷到目标机器：

```sh
# 联网机器
npm pack dsh-split-workspace

# 目标机器：.tgz 绝对路径
dsh plugin --profile web add /absolute/path/dsh-split-workspace-<version>.tgz

# 或者解压后安装目录
dsh plugin --profile web add /absolute/path/dsh-split-workspace
dsh --profile web
```

- 只有源码 ZIP 时，先解压；发布包已包含 `lib/client.js`，通常不需要再构建。仓库根目录必须能直接看到 `package.json`。
- 目标机器不需要访问 npm，也不需要访问 GitHub。

### Desktop：在线安装

1. 打开 DSH Desktop，侧边栏 **插件市场**，搜索 `dsh-split-workspace` 并安装；或进入 **插件 → 添加插件 → 安装第三方插件**，填入包名。
2. 打开 **设置 → 插件**，启用 `dsh-split-workspace`。
3. 安装完成后插件通常会被 DSH 的 HMR 立即加载，无需重启；如果几秒后侧边栏底部仍没有分屏图标，再完全退出并重开 DSH Desktop（插件加载后，菜单/更新提示也提供「重启 DSH」入口）。

> 桌面端的 `desktop` profile 由 Electron 应用独占管理。不要在终端执行 `dsh plugin --profile desktop add ...`，该命令会拒绝执行；桌面端请用上面的插件市场 / 添加插件界面。

### Desktop：离线安装

1. 在联网机器执行 `npm pack dsh-split-workspace`，或从 Release 下载 `.tgz`，拷到目标机器。
2. DSH Desktop → **插件 → 添加插件 → 安装第三方插件**：
   - 优先填 `.tgz` 的**绝对路径**（安装器会识别为「压缩包」）；
   - 如果当前版本只接受目录，先把 `.tgz` 解压，再填解压后的目录路径（目录根下要有 `package.json`）。
3. 在 **设置 → 插件** 启用；通常会被 HMR 立即加载。若侧边栏底部没有出现分屏图标，完全退出并重开 DSH Desktop，或使用插件菜单里的「重启 DSH」。
4. 离线机器不需要网络；插件运行时不联网。

### 启用与验证

- 打开 **设置 → 插件**，确认 `dsh-split-workspace` 已启用。DSH 0.2.x 会通过 HMR 热加载新安装的插件；如果没有出现界面，见下方「更新、重载与重启」。
- 分屏入口：点击侧边栏底部（设置旁）的分屏图标，或把侧边栏里的会话拖到对话区。
- 打开浏览器/桌面端控制台执行 `window.__dshSplitWorkspace.health()`，可看到版本、窗格数和几何状态。
- 如果看不到分屏入口：确认插件已启用且没有报错；如果侧边栏底部的 footer 没有渲染，插件会在对话区左下角显示兜底的分屏按钮。
- 恢复分屏后窗格标题栏的按钮点不动：0.13.1 及更早版本在桌面端会把被覆盖会话的原生窗口拖动区留在画布上方，点击被 Electron 原生层吞掉（浏览器里不会出现，所以 Web 端测不出来）。0.13.2 给窗格标题栏声明 `-webkit-app-region: no-drag` 修复。
- 恢复分屏后窗格标题栏的按钮点不动：0.13.1 及更早版本在桌面端会把被覆盖会话的原生窗口拖动区留在画布上方，点击被 Electron 原生层吞掉（浏览器里不会出现，所以 Web 端测不出来）。0.13.2 给窗格标题栏声明 `-webkit-app-region: no-drag` 修复。

### 开始分屏

- 点击侧边栏底部的分屏图标会弹出分屏菜单：**添加分屏 / 退出分屏 / 最小化分屏 / 重置分屏**。
- **添加分屏** 会打开多选弹框；勾选两个或更多会话后点确定即可分屏。已经处于分屏时弹框会默认勾选当前窗格的会话，可以取消勾选来移除窗格，也可以继续添加新会话，最终按勾选结果重新分屏。
- 也可以直接在会话列表里操作：右键会话（或点行尾的「⋯」）→ **加入分屏** / **退出分屏**。还没进入分屏时，第一次「加入分屏」会先放进**待分屏**，再加一个会话才会真正进入分屏；已经在分屏时则直接加入当前分屏。反向「退出分屏」会把该会话移出分屏，只剩一个会话时自动退出分屏。
- 或者把侧边栏里的会话拖到对话区：放下的会话成为第二个窗格。
- 分屏后，把另一个会话拖到某个窗格即可替换；也可以用窗格标题栏的分屏按钮为新窗格选择会话。
- 拖动侧边栏会话经过窗格边缘时，窗格会预览放下后的布局，并用虚线占位标出即将加入的会话；松开即应用该布局。
- **重置分屏** 会清空本插件在 localStorage / sessionStorage 里的分屏相关键、已保存布局、崩溃保护、最小化标记和窗格临时缓存（性能模式偏好会保留）；当分屏因为缓存或异常状态怎么都起不来时，点它即可恢复到干净状态。
- 右键任意会话（或点行尾的「⋯」）→ **进入浮窗**，即可把该会话变成一个可自由摆放的浮窗；浮窗标题栏可以拖动、边缘可以缩放，点 **⇲ 回到分屏** 放回分屏，点 **✕** 直接关闭浮窗。同一会话不会同时出现在分屏和浮窗里：进入浮窗时会自动从分屏/待分屏中移出。
- 右键会话 → **分屏插件**：一级菜单集中了会话的分屏与窗口操作，二级菜单包括 **加入分屏 / 退出分屏**（同一个开关，按当前状态显示）、**进入浮窗 / 退出浮窗**、**进入独立窗口 / 退出独立窗口**、**进入系统窗口 / 退出系统窗口**。每个条目都按当前状态显示“进入”或“退出”；窗口关闭（包括点窗口自身的关闭按钮）后，菜单会自动回到“进入”状态。
- **关闭窗格（标题栏 ✕）或退出分屏时，只要剩余会话少于两个就整体退出分屏**：窗格树和所有会话的分屏状态会一起清空，不会留下「菜单里显示分屏中、却没有被选中」的残留状态。只剩一个窗格的分屏不成立，所以不保留隐藏的单窗格树。

## 分屏视图菜单（左侧栏，0.12.0）

- 左侧栏顶部的面板导航新增 **分屏视图** 一行，和 **插件** 同级；行首是插件的分屏图标。左下角分屏按钮、会话右键 **分屏插件** 一级菜单也用同一个图标。
- 点击 **分屏视图**，主区切换到 **分屏视图面板**：已经有两个及以上窗格时，直接显示与“恢复分屏”相同的界面（窗格、分隔条、窗格工具栏都在这里）；还没有分屏时，页面里是 **添加分屏** 多选框，勾选两个或更多会话并确定后立即显示分屏界面。
- 在面板里点左下角菜单的 **最小化分屏** 会回到会话界面；**退出分屏** 会清空窗格并返回会话。切到左侧栏的某个会话或插件面板时布局会保留，随时点回 **分屏视图** 继续。
- **切换不再重建窗格（0.13.0）**：画布始终挂载在覆盖层里，只是在「分屏视图」、普通会话、最小化和插件面板之间显示/隐藏。隐藏后的 **20 秒内**窗格保持挂载（暖缓存），所以在「分屏视图 ⇄ 会话」「最小化 ⇄ 恢复分屏」之间来回切换时几乎瞬时，不会重新挂载每次都要重连会话和编辑器的原生对话；超过 20 秒才释放窗格树（对长时间最小化省资源）。隐藏期间画布的布局仍保留，因此恢复是可见性切换而不是整棵树重排。
- **最小化胶囊（0.13.0）**：最小化后出现的「恢复分屏」胶囊可以拖到工作区任意位置，松手吸附到**最近的边缘**——沿边的位置随你放，不再只限四个角；位置会记住，下次最小化仍在原处。
- 左下角按钮菜单里的 **重启 DSH** 图标改为绘制的 SVG（旧版使用 U+23FB 电源符号，Windows 默认字体缺这个字形，会显示成乱码方框）；菜单、侧栏、右键菜单里的图标全部是内嵌 SVG，不依赖系统字体。

## 使用帮助（界面指引）

插件内的 **分屏帮助**（菜单里的「分屏帮助」、窗格标题栏的 `?`，或设置页的「分屏帮助」）现在已经带三张界面指引截图，点击缩略图可以查看大图：

| 会话右键菜单（分屏插件） | 左下角分屏按钮菜单 | 设置 → 分屏工作区 |
| --- | --- | --- |
| [![右键会话 → 分屏插件二级菜单](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/help-session-menu.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/help-session-menu.png) | [![左下角分屏按钮菜单](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/help-footer-menu.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/help-footer-menu.png) | [![设置 → 分屏工作区](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/help-settings.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/help-settings.png) |

截图由插件 Host 从 `docs/screenshots/` 以同源路径 `/dsv/help/...` 提供，因此桌面端（`dsh-app://`）和 Web 客户端都能直接显示，无需外网。

## 浮窗模式（独立窗口）

分屏和浮窗是同一个工作区的两种形态，可以随时互相切换：

- **分屏 → 浮窗**：右键会话 → **进入浮窗**。该会话会从分屏（或待分屏）中移出，变成一个浮动窗口；窗口内仍然是这个会话的真实原生界面（输入框、流式输出、停止、队列、工具行、附件、审批、视图页都可用）。
- **浮窗 → 分屏**：右键浮窗里的会话 → **加入分屏**（或标题栏的 **⇲ 回到分屏**）。若当前已有分屏，会话直接追加为窗格；若还没有分屏，会先进入「待分屏」，再加一个会话即开始分屏；右键 → **退出浮窗** 只关闭浮窗，不放回分屏。
- **浮窗操作**：拖动标题栏移动窗口，拖动任意边缘/角落缩放，点击窗口自动置顶；位置、大小和层叠顺序会持久化，DSH 重启后浮窗仍在。窗口缩放或右侧栏开合后，浮窗会自动回到可见范围。
- **与分屏共存**：浮窗可以浮在分屏之上，每个浮窗独立占用一个真实会话；从 2 窗格分屏抽出一个会话会结束分屏并清除另一个会话的分屏状态（浮窗 ⇲ 回分屏时进入「待分屏」，再加一个会话即可重新分屏）；3 个及以上窗格抽取时，分屏继续显示剩余窗格。
- 浮窗和分屏窗格互斥：一个会话只会存在一种形态，避免同一会话被两个输入框同时编辑。

### 为什么浮窗不是系统级独立窗口？

这不是偷懒，而是当前 DSH 宿主没有提供第二个原生窗口：

- DSH Desktop 的 Electron 主进程只创建一个主窗口；主窗口的 `setWindowOpenHandler` 对 `window.open` 一律返回 `{ action: "deny" }`（仅把 http/https 链接交给系统浏览器打开），也没有按会话开窗的 IPC 或菜单项。
- DSH Web 客户端是单页应用，没有 `?session=` 之类的会话深链路由；会话切换由 `uiWorkspace.openSession` 在页面内完成，不存在“打开一个只显示某会话的新窗口”的 URL。
- 插件运行在渲染层，无法创建 Electron `BrowserWindow`；因此浮窗实现为 `shell.overlay` 之上的**应用内窗口**：它可以移动、缩放、置顶、持久化，并且宿主是真实的 `ChatPane`，但与主窗口共享同一个客户端和页面。

如果 DSH 未来开放原生多窗口能力，浮窗层可以直接换成原生窗口，而“分屏 ⇄ 浮窗”的会话切换逻辑不需要改。

## 独立窗口（应用内，不依赖浏览器）

- **进入独立窗口**（0.11.0 起收在「分屏插件」二级菜单；早期版本为「在独立窗口打开」）：在 DSH 应用内部打开一个只显示该会话的窗口，提供 **关闭 / 最小化 / 最大化-还原 / 全屏**；双击标题栏切换最大化，最小化后收成左下角的恢复胶囊。该会话已经在这个窗口里时，菜单显示 **退出独立窗口**；关闭窗口后菜单回到「进入独立窗口」。
- 打开时该会话会从分屏 / 浮窗 / 待分屏中移出，避免同一会话同时被两个输入框编辑；关闭独立窗口不会删除会话，它仍在侧栏里，可随时重新加入分屏。
- **为什么不是 Electron 原生窗口？** DSH Desktop 的 Electron 主进程只保留一个应用窗口，主窗口的 `setWindowOpenHandler` 拒绝用 `window.open` 创建第二个原生窗口（http/https 只交给系统浏览器）；插件的 Host 进程是 Node 子进程，没有 Electron `BrowserWindow` API。所以 0.10.0 把这一层做成**应用内独立窗口**（不再打开浏览器、没有地址栏，窗口控制由插件自己绘制）；macOS / Windows 上另见下一节的「系统窗口」，分别用系统 WebView 与 WebView2 实现真正的独立窗口。
- 限制：它仍在 DSH 主窗口内部（不是操作系统级第二窗口），不能拖到 DSH 窗口之外。

## 系统窗口（原生独立窗口，0.11.0 macOS / 0.14.0 Windows）

- 右键会话 → **分屏插件** → **进入系统窗口**：在 macOS 或 Windows 上打开一个**真正的操作系统窗口**。它不是 DSH 主窗口里的一层浮层，可以拖到主窗口之外、单独缩放和关闭，不会打开浏览器，也没有地址栏。该会话的系统窗口已经打开时，菜单显示 **退出系统窗口**；在窗口里点关闭（或从菜单退出）后，菜单会自动回到「进入系统窗口」。
- 窗口内容仍然是这个会话的真实客户端：**左侧栏不显示**（会话占满窗口），**右侧栏、对话头部、输入框、视图页等都照常保留**，右上角的「打开右侧边栏」依然可用。
- **实现方式（macOS）**：DSH 没有向插件开放 Electron `BrowserWindow`，所以插件 Host 用系统自带的 AppKit `NSWindow` + `WKWebView`（`osascript` 运行 `native/system-window.jxa`）打开窗口，并让这个 WebView 加载 Host 的**本机认证 Web 客户端**。认证 URL 由 Host 在进程内生成，只传给本机 Helper，**不会返回给渲染层**；哈希标记让同一份客户端代码在窗口内切换成「系统窗口模式」。
- **实现方式（Windows）**：Host 用 `powershell.exe` 启动 `native/system-window.ps1`，由 PowerShell + WinForms 建窗口、内嵌 WebView2 控件加载同一份认证 Web 客户端。`native/webview2/` 随包附带 WebView2 SDK（`Microsoft.Web.WebView2.Core.dll`、`Microsoft.Web.WebView2.WinForms.dll` 与 x64/arm64 的 `WebView2Loader.dll`，BSD-3-Clause），每个窗口使用独立的临时 WebView2 配置目录；关窗或退出 DSH 时连同 `msedgewebview2` 进程树一起结束。
- **平台**：macOS 与 Windows。Linux（或 Web 客户端）上点击会提示改用「进入独立窗口」，不会退回浏览器。Windows 缺少 **Microsoft Edge WebView2 运行时**时会提示先安装再试。窗口标题跟随会话标题；关闭窗口即结束 Helper 进程，退出 DSH 时也会一并关闭这些窗口。
- macOS 的 Helper 是辅助型进程，不占 Dock 图标，因此**没有最小化按钮**（避免最小化后无法从 Dock 恢复）；提供关闭、缩放和标题栏拖动。Windows 使用系统标题栏，最小化 / 最大化 / 关闭都可用。
- **菜单定位**：DSH 的弹层菜单用 CSS Anchor Positioning（`position-anchor` + `anchor()`）把自己挂在触发按钮旁边；Chromium（主窗口）支持，但 macOS 的 WKWebView 不支持，菜单会退到窗口左上角、盖住标题栏。系统窗口模式下插件会检测这一能力缺失，并按菜单自带的 `data-anchor-side` / `data-anchor-align`（以及模型选择器的锚点自定义属性）在触发按钮旁重新定位：向上打开的菜单贴着按钮上沿、右对齐，并限制最大高度。
- **注意**：系统窗口是独立的 Web 客户端，所以桌面端专属能力（如原生文件拖拽、系统目录选择器）在窗口内的行为以 Web 客户端为准；会话数据与主窗口共享同一个 Host，输入、流式输出和右侧栏功能正常。

![系统窗口：不再显示左侧栏，右侧栏与对话区照常保留](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/system-window.png)

## 系统设置入口

除了侧边栏底部的分屏按钮，插件还在 **设置 → 分屏工作区** 注册了一个设置页（`settings.section`），方便在菜单不可见时进入。页面包括：

- **状态**：插件版本、窗格数、待分屏数、浮窗数、当前独立窗口。
- **性能模式**：开关（默认开启），影响动画、后台观察器和拖动缩略图。
- **操作**：打开分屏视图、添加分屏、退出分屏、最小化分屏、重置分屏、刷新界面、重启 DSH（桌面版）、帮助。

设置页里的“添加分屏”会先关闭设置面板再打开多选弹框，避免弹框被设置面板遮挡；其余操作就地执行并实时刷新状态。

## 性能模式与卡顿排查

**性能模式默认开启**（从 0.9.0 起；显式关过一次的保留关闭状态）。在侧边栏底部分屏按钮的菜单里点 **性能模式** 可切换（也可用 `window.__dshSplitWorkspace.setPerformanceMode(true/false)`，设置会持久化）。开启后：

- 关闭所有窗格 / 浮窗 / 菜单 / 提示的动画、过渡、卡片阴影和焦点光晕，并停掉工具行跑马灯动画。
- 关闭**每个窗格的 composer 几何测量 MutationObserver**。这是最可疑的开销之一：流式输出每个 token 都会改动窗格 DOM，旧逻辑会在每次改动时排队测量（`getBoundingClientRect` + 样式读取），窗格越多越明显；性能模式改为 ResizeObserver + 1.5s 轮询。
- 暂停 TOC 握把同步（`dsh-prompt-history` 的 ☰ 定位）、压缩结果监听、浮窗位置巡检、右侧栏 800ms 轮询（保留 resize 监听），几何测量从 1s 降到 3.5s，侧栏会话扫描从 200ms 降到 1s。
- 拖动会话/窗格时**完全不渲染缩略图预览**（不克隆对话 DOM，也没有逐帧移动的预览窗口）；拖入目标、布局预览和放置反馈仍然保留。
- 真实会话、输入、停止、审批、分屏 / 浮窗 / 独立窗口功能全部保留。

- **0.12.0：窗口缩放不再逐帧测量。** 拖动窗口边缘缩放时，每个窗格的尺寸观察器过去会在每一帧提交新的窗格尺寸（并重建 composer 测量、重算对齐行宽），窗格越多越卡。现在缩放窗口 / 拖动分隔条期间只保留浏览器自身的 CSS 重排，所有 JS 测量与派生状态（窗格窄/短判定、composer 卡片几何、对齐行宽、浮窗钳制）统一等待手势结束后执行一次；缩放期间同时关闭窗格过渡，避免 180ms 的宽度过渡“追着”窗口边缘跑。性能模式下更进一步：**窗口缩放时画布保持手势开始时的内部布局，用 CSS transform 跟随窗口边缘缩放到新尺寸**，这样每个窗格里的原生对话不会在每一帧重新测量滚动区域，松手后再一次性重排到真实尺寸（拖动过程中文字会有轻微拉伸，松手即恢复清晰）。性能模式同样受益。

开发机实测（Chromium 无头、性能模式、2 窗格、连续拖动窗口 40 步）：冻结开启 vs 关闭，整段手势的主线程任务时长中位数 **2.1s vs 3.2s**，长任务 **1 个 vs 17 个**，阻塞时间 **9ms vs 461ms**，平均帧间隔 **25.7ms vs 59.1ms**；4 窗格时长任务 **6 个 vs 38 个**、阻塞时间 **85ms vs 989ms**。面板模式（`分屏视图`）因为不再有被遮住的原生会话，剩余开销更低。

**仍然可能卡的原因**：每个窗格都是一个完整的原生对话视图，N 个会话同时流式输出就是 N 份 React/DOM 渲染与滚动更新，这是 DSH 客户端本身的主要成本，插件无法消除（除非上游支持离屏暂停/虚拟化）。在 Windows + 低单核性能的机器上，建议同时保持 2–3 个活动窗格、少开浮窗、把不用的分屏最小化；输入框可切到紧凑 TUI 模式；如果装了 `dsh-prompt-history`，它的 TOC 同步在性能模式下会被暂停。

诊断入口：`window.__dshSplitWorkspace.health()` 查看 `performance`、`panes`、`geometry`、`active`；用 DevTools Performance 对比开启性能模式前后的长任务。

## 更新、重载与重启

DSH 0.2.x（含 Desktop 0.2.2-rc.3）带 HMR：新安装的插件会被热加载，重建后的客户端 bundle 也会自动替换，**大多数安装/更新不需要重启 DSH**。以下情况才需要重启：

- 插件管理器明确提示 `restart-required`（Host 半边、被链接包的宿主模块发生变化，或包目录被移动）；
- 安装后侧边栏底部几秒内没有出现分屏图标（少数没有 HMR 的旧版 DSH）。

**0.12.0 / 0.13.0 的新面板、图标、切换暖缓存和缩放优化都在客户端 bundle 里**，重建 `lib/client.js` 后同样由 HMR 热替换，不需要重启 DSH。

**0.11.1 修复：重建客户端 bundle 后不再需要重启。** 之前每次重建 `lib/client.js` 后分屏按钮、右键菜单和「设置 → 分屏工作区」都会消失，必须刷新页面或重启 DSH 才回来——原因是插件工厂重复定义只读诊断接口 `__test` 时抛出 `Cannot redefine property`，整次加载被中断（DSH 会把它记为“本页面的插件未能完成同步”）。现在每次 bundle 执行都会创建一个新的公开对象，所以**热替换重建后的 bundle、在设置 → 插件里禁用后再启用、以及从 0.11.0 热升级到 0.11.1，都在同一个页面内就地生效**，不需要刷新或重启。

DSH **生产版没有内置的“重启”菜单项**（开发版才有 `Restart App and Host`）。从本插件的 0.9.0 起：

- 侧边栏底部 **分屏菜单 → 重启 DSH**：先确认（运行中的任务会中断），再由 Host 半调用系统级“退出并重新打开”（macOS 通过 AppleScript 正常退出，Windows 关闭窗口后终止进程并重启）。
- 检测到磁盘版本比页面新时，右下角的更新提示直接提供 **重启 DSH** 按钮；Web 版提供 **刷新页面**。
- 也可以用 `window.__dshSplitWorkspace.restartApp()`，或按老办法手动退出后重新打开：Windows 从托盘/开始菜单彻底退出，macOS 用 ⌘Q。
- 底部菜单的 **刷新界面** 只重新加载页面（适合浮层卡住、布局异常），不会应用需要重启的 Host 变化。
- 首次安装时插件客户端可能尚未加载，因此插件自身无法显示重启按钮；插件管理器会在安装结果里提示重启，按提示或手动退出重开即可。
- **安装后看不到分屏入口时，先尝试刷新页面而不是重启**：DSH Desktop 生产版没有页面刷新菜单，但自带 **开发者工具**（macOS `⌘⌥I`，Windows `Ctrl+Shift+I`，或菜单 View → Toggle Developer Tools）；在开发者工具里点刷新按钮、按 `⌘R` / `F5`，或在 Console 执行 `location.reload()`，都会重新加载页面并取回最新的插件图，通常无需重启 DSH。仍不生效再完全退出重开。

## 功能

- **切换零重建 + 手势暖缓存（0.13.0）**：分屏画布常驻，切换「分屏视图 / 普通会话 / 最小化 / 插件面板」不再卸载重挂原生窗格；最小化胶囊可拖到任意位置并吸附最近边缘。
- **左侧栏「分屏视图」面板（0.12.0）**：左侧栏顶部与「插件」同级的面板入口，点击在主区打开分屏视图；已有分屏时直接显示窗格界面，没有分屏时显示添加分屏多选框，选满两个会话立即分屏。
- **侧边栏分屏菜单**：底部分屏按钮弹出「添加分屏 / 退出分屏 / 最小化分屏 / 性能模式 / 刷新界面 / 重启 DSH / 分屏帮助 / 重置分屏」，其中退出和最小化与顶部工具栏完全一致，「分屏帮助」直接打开带截图的帮助卡片。
- **多选添加分屏**：弹框可搜索、可多选；已分屏时默认勾选当前窗格，可取消或追加，按最终勾选结果分屏。
- **会话右键集成**：原生右键菜单新增「分屏插件」二级菜单，其中「加入分屏 / 退出分屏」按状态显示为同一个开关；未分屏时先进入待分屏，满两个才分屏，退出到只剩一个自动退出分屏。
- **浮窗模式**：右键会话 → 「进入浮窗」，把会话变成可拖动、可缩放的独立窗口；标题栏 ⇲ 放回分屏、✕ 关闭，浮窗位置/大小/层叠顺序持久化。
- **分屏 ⇄ 浮窗双向切换**：同一会话互斥存在于一种形态；进入浮窗自动移出分屏，回到分屏自动关闭浮窗。
- **独立窗口（应用内）**：右键会话 → 「在独立窗口打开」，在应用内单独显示该会话，提供关闭 / 最小化 / 最大化 / 全屏；不打开浏览器，打开时自动从分屏和浮窗移出。
- **系统设置入口**：除了侧边栏底部分屏菜单，**设置 → 分屏工作区** 也提供同一组操作（添加 / 退出 / 最小化 / 重置分屏、性能模式、刷新、重启 DSH、帮助和状态）。
- **性能模式（默认开启）**：一键关闭动画、阴影、跑马灯和多个后台轮询/观察器，适合低配或 Windows 上多窗格卡顿的场景；设置持久化。性能模式下**不再渲染拖动会话时的缩略图预览**（拖入目标与放置反馈保留），可以再明显减少拖动时的 DOM/合成开销。
- **更新提示 / 重启 DSH / 刷新界面**：检测到磁盘上的新版本时右下角提示，并提供「重启 DSH」（桌面版）或「刷新页面」（Web 版）；分屏菜单同时提供「刷新界面」与「重启 DSH」。
- **兜底分屏入口**：如果所在 DSH 布局没有渲染侧边栏 footer（或 footer 被隐藏），插件会在对话区左下角显示一个分屏按钮，保证菜单仍可打开。
- **一键重置**：清空插件相关的 localStorage / sessionStorage、布局、崩溃保护和临时缓存，避免异常状态卡住分屏。
- **不限数量的原生窗格**：没有四窗格上限，窗口放得下多少会话就能开多少。
- **自动布局**：2 个窗格左右分栏，3 个呈 L 形，4 个田字 2×2，5 个以上按行优先的均衡网格排列。
- **拖拽自由排布**：拖动窗格标题栏到另一个窗格的左/右/上/下，可手动堆叠或分栏。
- **原生会话，不是 iframe**：每个窗格复用原生会话组件，输入框、流式输出、停止、队列、待办、审批和视图页都能正常工作。
- **桌面端就绪**：为 DSH Desktop（`dsh-app://`）构建，preload 只在顶层框架运行。
- **共享侧边栏**：原生侧边栏跟随当前聚焦的窗格；把会话拖到分屏区域即可新增或替换窗格。
- **右侧栏控制**：打开/关闭有不同图标状态，由分屏工具栏统一控制。
- **最小化 / 恢复**：隐藏分屏但保留窗格树。
- **持久化布局**：重启后恢复上次的布局。

## 布局

- 自动策略：2 个并排，3 个 L 形，4 个 2×2，5 个以上按约 `sqrt(n)` 列的均衡行优先网格。没有模式菜单——增删窗格都会重新适配网格。想要上下堆叠，把第二个窗格的标题拖到第一个上，再移到底部边缘；手动拖拽的结果会被保留，自动网格只是起点。
- 拖动分隔条调整大小。
- 拖动标题栏移动窗格：原位置立即闭合（其他窗格填充空间），并在将落下的位置出现虚线占位——左、右、上、下，跟随手势方向。松开即放下；松开在原来的位置或按 `Esc` 取消。预览只计算几何，不重新挂载正在运行的会话。
- 双击标题栏（或 `⤢` 按钮）最大化/还原。
- 没有固定窗格上限：窗口能显示多少会话就能加多少（窗格变窄时标题栏会自动紧凑）。
- 存在分屏时，共享的原生侧边栏跟随聚焦窗格；点击会话即载入该窗格，或把会话拖到分屏区域新增/替换窗格。
- 窗格树在刷新和重启后保留（包括手工拖出的堆叠或 L 形布局）；增删窗格会重新适配自动网格，重启不会。
- **最小化**（工具栏或底部菜单）会隐藏分屏、显示原生单会话视图，同时保留窗格树；「恢复分屏」胶囊可以恢复（可拖到任意位置、吸附最近边缘，位置会记住）。点击其他会话会把分屏收成胶囊；打开插件/技能/设置面板时画布只是暂时隐藏（窗格保持挂载），回到会话或「分屏视图」后自动恢复，不再需要点恢复胶囊。
- 每个窗格只有一个标题：标题由窗格标题栏负责；原生标题栏保留视图页和操作，不重复面包屑。关闭按钮是红底描边的 **✕**，不是低对比度圆点。
- 如果安装了 `dsh-prompt-history`，它的可拖动 **会话目录 (☰)** 握把会在每个活动窗格的左边缘垂直居中显示一次。每次分屏调整（新增、关闭、重排、拖动分隔条、最大化或右侧栏推挤）都会把受影响的握把重新放回窗格左边缘与垂直中心；没有变化的窗格保留手动拖动的位置。隐藏的原生会话和非窗格视图里的副本会被隐藏，握把不再堆叠。
- 分屏工具栏的右侧栏按钮有**两种状态**：面板关闭时是右箭头（点击打开），打开时是高亮的左箭头（点击收起）。修复监听器会在分屏拆除后接管原生的打开/收起按钮，避免过期的 sidebar-right store 吞掉点击或隐藏入口。
- 窗格标题栏刻意**不**挂载原生的每窗格 rightbar 座位（右侧栏由分屏工具栏统一控制）。该座位是会话级的，自带 store 句柄；在每个窗格里挂载会为同一会话创建第二个 sidebar-right store，导致共享面板的标签图标看起来失效。原生标题栏保留唯一的 store。

## 为什么不是每个窗格一个 iframe？

桌面端从 `dsh-app://app/` 提供客户端，并通过 Electron preload 注入启动图（`__DSH_BOOT__`、`__DSH_TRANSPORT__` 等）。preload 只在顶层框架运行，所以同源 iframe 会永远停在 “Loading plugins…”。因此窗格引擎在**顶层客户端**运行，按会话重新挂载原生对话组件——与上游插件相同的架构。

## 命令

- `window.__dshSplitWorkspace.health()`：版本、宿主、窗格、几何、持久化树、崩溃保护；`panelWarm` 表示画布正处在暖缓存隐藏中，`canvasRepairs` 记录画布显示后自检修复交互样式的次数（正常为 0）。
- `window.__dshSplitWorkspace.split(sessionId)`：把会话加为窗格。
- `window.__dshSplitWorkspace.addToSplit(sessionId)` / `removeFromSplit(sessionId)`：加入 / 退出分屏（未分屏时先进入待分屏）。
- `window.__dshSplitWorkspace.float(sessionId)`：把会话变成浮窗（自动从分屏/待分屏移出）。
- `window.__dshSplitWorkspace.dockFloat(sessionId)`：把浮窗放回分屏（没有分屏时进入待分屏）。
- `window.__dshSplitWorkspace.closeFloat(sessionId)`：关闭浮窗（不放回分屏）。
- `window.__dshSplitWorkspace.floats()`：当前浮窗的会话 id 列表（按创建顺序）。
- `window.__dshSplitWorkspace.openSystemWindow(sessionId)`：在应用内独立窗口打开该会话（`openIndependentWindow` 是同一功能的别名）。
- `window.__dshSplitWorkspace.openNativeWindow(sessionId)`：在原生系统窗口（macOS / Windows）打开该会话；Linux 或非桌面版会提示改用独立窗口。
- `window.__dshSplitWorkspace.closeNativeWindow(sessionId)`：关闭该会话的系统窗口。
- `window.__dshSplitWorkspace.nativeWindows()`：当前已打开系统窗口的会话 id 列表。
- `window.__dshSplitWorkspace.appWindow()`：当前独立窗口状态（`{ id, minimized, maximized }` 或 `null`）。
- `window.__dshSplitWorkspace.setPerformanceMode(true/false)`：开关性能模式（持久化）。
- `window.__dshSplitWorkspace.performanceMode()`：当前是否处于性能模式。
- `window.__dshSplitWorkspace.resizeFreeze()` / `setResizeFreeze(true|false)`：性能模式下窗口缩放时是否冻结画布内部布局、用 CSS 缩放跟随窗口边缘（默认开启）。
- `window.__dshSplitWorkspace.reloadClient()`：刷新页面。
- `window.__dshSplitWorkspace.restartApp()`：退出并重新打开 DSH 桌面版（需要完整重启时使用）。
- `window.__dshSplitWorkspace.pending()`：当前待分屏的会话 id。
- `window.__dshSplitWorkspace.openAddSplitDialog()`：打开多选添加分屏弹框。
- `window.__dshSplitWorkspace.arrange("auto")`：重新适配自动布局（旧模式名会被接受并忽略）。
- `window.__dshSplitWorkspace.focusChat()`、`closeFocused()`。
- `window.__dshSplitWorkspace.reflow()`：拖动预览状态（排查占位/闭合行为用）。
- `window.__dshSplitWorkspace.setEnabled(false)`：总开关。
- `window.__dshSplitWorkspace.reset()`：清除已保存布局。
- `window.__dshSplitWorkspace.resetAll()`：连同 localStorage / sessionStorage 与临时缓存一起彻底重置（等同菜单里的「重置分屏」）。

## 工程结构（源码拆分）

`lib/client.js` 是**构建产物**，不要直接编辑；源码在 `src/client/`，按模块拆成 18 个有序片段，由 `scripts/build-client.mjs` 拼回单文件：

| 片段 | 内容 |
| --- | --- |
| `00-preamble` / `01-constants` | module-loader 入口、React/P、常量、存储、性能/版本键、独立窗口检测 |
| `02-styles` | 全部 `dsv-*` CSS（含性能模式与浮窗样式） |
| `03-runtime` | runtime store、健康诊断、会话列表源 |
| `04-tree` | 分屏树 store、布局算法、持久化 |
| `05-pending-float-store` | 待分屏状态、浮窗 store 与模式切换 |
| `06-drag-reflow` | 窗格拖动预览/reflow、拖拽工具 |
| `07-faces` | root standard faces、session bindings |
| `08-pane-kit` | slot 捕获与原生组件 re-host |
| `09-pane-renderers` | 原生/降级对话与输入框渲染器 |
| `10-pane-frame` | 窗格标题栏、关闭/浮窗按钮、composer 测量 |
| `11-canvas-navigation` | 画布/分隔条、会话选择器、键盘导航、公共 API 前置 |
| `12-chrome` | 安全模式/帮助/提示、「分屏视图」主面板、窗口缩放冻结、更新通知、座位 |
| `13-drag-bridge` | 未激活时的拖入分屏桥 |
| `14-launcher` | 底部菜单、多选添加分屏弹框、会话菜单集成 |
| `15-float-window` | 浮窗组件与图层 |
| `16-standalone` | 应用内独立窗口组件、窗口层与恢复胶囊，以及系统窗口的模式切换与请求 |
| `17-api-apply` | `window.__dshSplitWorkspace` API、`apply()` 与导出 |
| `native/system-window.jxa` | macOS 系统窗口 Helper（AppKit `NSWindow` + `WKWebView`，由 Host 通过 `osascript` 启动） |
| `native/system-window.ps1` | Windows 系统窗口 Helper（PowerShell + WinForms 宿主 WebView2，由 Host 通过 `powershell.exe` 启动） |
| `native/webview2/` | 随包附带的 WebView2 SDK 二进制（BSD-3-Clause，约 1.1 MB，含 x64 / arm64 loader） |

- `npm run build`：重新生成 `lib/client.js`；`npm test` 会先跑 `build:check`，源码/产物不一致会失败。
- `npm run check:anchor`：在真实 WKWebView 里验证系统窗口的菜单锚点回落（macOS 专用；CI 在 Ubuntu 上不跑）。
- 为什么不用打包器：DSH 客户端只加载一个 `<plugin>/client.js`，片段共享同一个 module-loader 闭包，按顺序拼接即可；这样发布包保持零依赖、无构建依赖。
- 修改代码时改 `src/client/` 对应片段，然后 `npm run build`；`lib/client.js` 顶部有一行 GENERATED 标记。

## 快捷键

- `Alt+T`：切换聚焦窗格里的紧凑 TUI 输入框。
- `Alt+Shift+←/→/↑/↓`：在窗格间移动焦点。

## 界面截图

| 左右两列 · Side by side | 上下两列 · Stacked | 田字 · 2×2 grid |
| :-: | :-: | :-: |
| [![DeepSeek Harness split screen with two conversations side by side](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-side-by-side.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-side-by-side.png) | [![DeepSeek Harness split screen with two stacked conversations](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-stacked.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-stacked.png) | [![DeepSeek Harness 2×2 grid with four conversations](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-grid-2x2.png)](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/layout-grid-2x2.png) |
| 2 panes · automatic columns | 2 panes · dragged into rows | 4 panes · automatic 2×2 田字 |

Drag a pane by its header to re-arrange it — the dashed hole previews where it
will land:

![Dragging a DeepSeek Harness split pane by its header to create a stacked split](https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/docs/screenshots/drag-pane.gif)

## 限制

- 没有窗格数量上限；持久化树会校验（会话唯一、深度），损坏的树会被丢弃，而不是恢复一个坏掉的工作区。
- 「浮窗」是应用内窗口，不是 Electron 原生第二窗口：DSH Desktop 主窗口禁用了 `window.open`，Web 客户端也没有会话深链；浮窗复用真实会话组件、可拖动缩放，但仍在 DSH 主窗口内渲染（详见上面的「为什么浮窗不是系统级独立窗口？」）。
- 浮窗和分屏窗格互斥；同一会话不会同时以两种形态渲染，避免共享编辑器冲突。
- 「独立窗口」是应用内窗口：它不打开浏览器、没有地址栏，但不能移出 DSH 主窗口。桌面版（macOS / Windows）另提供「进入系统窗口」（系统 WebView / WebView2，真正的独立窗口）；DSH 本身仍未向插件开放 Electron `BrowserWindow`。独立窗口内的会话同样互斥于分屏和浮窗。
- 「系统窗口」是独立的 Web 客户端：需要 DSH 桌面版 + macOS，或 Windows + Microsoft Edge WebView2 运行时；它不共享主窗口的桌面专属能力（原生文件拖拽、系统目录选择器）。
- 持久化递归深度上限为 32 层，是为了手改数据时的栈安全，不是窗格上限。
- 隐藏的原生会话仍在遮罩下流式运行；窗格重新挂载原生输入框，所以每个窗格自己的输入框拥有该会话的编辑器。
- 窗格重命名拒绝空会话（原生重命名对话框同样如此）。
- 输入框增强插件兼容：分屏只让当前聚焦的窗格保留 `data-composer-card`，隐藏的原始输入框和非聚焦窗格不会抢走全局选择器；每个窗格仍挂载自己的输入浮层，切换窗格时非聚焦窗格的浮层隐藏但状态保留。`dsh-tweaks-prompt-history` 的历史角标、`dsh-prompt-history` 的候选提示、斜杠/模型菜单因此都定位在当前窗格。
- 拖动窗格时预览直接吸附，不再对宽度/高度做 180ms 过渡；拖动期间冻结窗格的尺寸观察和输入框测量，避免每个预览帧重排整段对话。
- 页面单例型输入增强插件（如 `dsh-prompt-history`）按活跃窗格隔离：预测上下文只读活跃窗格的对话行，隐藏的原始页不再抢输入焦点；非活跃窗格的草稿被外部写入时会回滚，Tab/→ 只把预测写入当前窗格。

MIT。见 `THIRD-PARTY-NOTICES.md`。

---

## English

**Split screen for DeepSeek Harness (DSH) Desktop — open as many conversations
as you need, side by side, stacked, or in a 2×2 / automatic grid.** Any
conversation can also become a movable, resizable **floating window**, switch
between the two modes at any time, move into an **in-app independent window**
(close / minimize / maximize / fullscreen), or — in DSH Desktop on macOS or
Windows — open a real **native OS window** (system WebView on macOS, WebView2 on
Windows; no browser, no left sidebar) for one
conversation. The session menu's **Split plugin** submenu holds the
`Join split / Leave split` toggle together with all three window surfaces,
each showing **Exit …** while that surface is open.
Both the sidebar menu and the system **Settings** page expose the controls.
Version history: [CHANGELOG.md](CHANGELOG.md).

`dsh-split-workspace` turns the DeepSeek Harness conversation area into a native
multi-pane workspace, including in the **Desktop app** (`dsh-app://` shell). Each
pane is a real session with its own composer, streaming, Stop, queue, todos,
attachments, `/` commands, `ask_user_question`, approvals and view tabs.

**中文简介**：把 DeepSeek Harness 的对话区拆成任意数量的原生窗格，支持左右分屏、
上下分屏、田字 2×2 和自动网格；每个窗格都是真实会话，拥有自己的输入框、流式输出、
停止、队列、待办、附件、斜杠命令、审批和视图页。适用于 DSH 桌面端；侧边栏菜单与
系统设置均可操作，版本历史见 CHANGELOG。

**Search terms / 搜索关键词**：split screen, split view, split pane, multi-pane,
multi-session, multi-window, tiled workspace, unlimited panes, DSH Desktop,
分屏, 分屏插件, 多窗格, 多窗口, 多会话, 左右分屏, 上下分屏, 并排, 田字布局,
系统窗口, 原生窗口, macOS system window, Windows system window, WebView2,
native window.

The pane engine is derived from
[dsh-split-screen](https://github.com/YEYEYEYESHIFU/dsh-split-screen) 1.7.0
(MIT). This package adapts it for the Desktop shell and adds the automatic
layout, the unlimited pane count, rename/copy/maximize and the compact toolbar.

### Quick start

**Pick where to run it**

| Mode | Best for | Plugin profile |
| --- | --- | --- |
| Web (`dsh web`, browser) | Trying it in a browser or on a remote machine | `web` |
| DSH Desktop (`dsh-app://`) | Daily use with full desktop features (recommended) | `desktop`, managed by the app |

- DSH 0.2.0 / 0.2.1 are supported; this build targets 0.2.1-rc.2.
- The package ships a prebuilt `lib/client.js` with no Node native modules and no install scripts; the client behaves the same on macOS / Windows / Linux. The Windows system window ships the WebView2 SDK (about 1.1 MB, BSD-3-Clause) and only needs the Microsoft Edge WebView2 Runtime (built into Windows 11, present on Windows 10 with a current Edge).
- The plugin itself makes no network requests at runtime.

**Web: online install**

```sh
dsh plugin --profile web add dsh-split-workspace
dsh --profile web
```

`dsh --profile web` prints the tokenized URL. If the server is already running, restart it after installing and hard-refresh the page.

**Web: offline install**

Pack on a connected machine (or download the `.tgz` from a GitHub Release), copy it to the target, then:

```sh
npm pack dsh-split-workspace                      # connected machine

dsh plugin --profile web add /absolute/path/dsh-split-workspace-<version>.tgz
# or, after extracting:
dsh plugin --profile web add /absolute/path/dsh-split-workspace
dsh --profile web
```

- For a source ZIP, extract it first; the package root must contain `package.json` (release tarballs already include `lib/client.js`).
- The target machine needs neither npm nor GitHub access.

**Desktop: online install**

1. Open DSH Desktop → **Plugin market** in the sidebar, search for `dsh-split-workspace`, and install it. Or use **Plugins → Add plugin → Install a third-party plugin** and enter the package name.
2. Open **Settings → Plugins** and enable `dsh-split-workspace`.
3. DSH's HMR normally loads a newly installed plugin immediately, so no restart is needed. If the split icon still does not appear in the sidebar footer after a few seconds, quit and reopen DSH Desktop completely (the plugin menu and update chip also offer **Restart DSH**).

> The `desktop` profile is owned by the Electron app. Do **not** run `dsh plugin --profile desktop add ...` in a terminal; it is rejected. Use the in-app plugin market / Add plugin UI instead.

**Desktop: offline install**

1. On a connected machine run `npm pack dsh-split-workspace`, or download the `.tgz` from a Release, and copy it to the target.
2. DSH Desktop → **Plugins → Add plugin → Install a third-party plugin**:
   - prefer the **absolute path to the `.tgz`** (the installer recognises it as a tarball);
   - if that build only accepts directories, extract the `.tgz` and enter the extracted directory (its root must contain `package.json`).
3. Enable it in **Settings → Plugins**; HMR usually loads it immediately. If the footer split icon does not appear, quit and reopen DSH Desktop, or use **Restart DSH** in the plugin menu.
4. The offline machine needs no network access; the plugin makes no runtime requests.

**Enable and verify**

- **Settings → Plugins** must show `dsh-split-workspace` enabled. DSH 0.2.x hot-loads newly installed plugins through HMR; if the UI still does not appear, see “Updates, reload and restart”.
- Entry points: the split icon in the sidebar footer (beside Settings), or drag a conversation from the sidebar onto the conversation column.
- Run `window.__dshSplitWorkspace.health()` in the browser/desktop console to see the version, pane count and geometry.
- If the split entry is missing: make sure the plugin is enabled and has no error. When the stock sidebar footer does not render this plugin's action, the plugin shows a fallback split button at the conversation area's bottom-left corner.
- Pane header buttons dead after restoring a minimized split: 0.13.1 and earlier left the covered conversation's native window-drag region above the canvas on Desktop, so Electron swallowed those clicks before the DOM (browsers ignore app-region, which is why the web build could not reproduce it). 0.13.2 declares `-webkit-app-region: no-drag` on the pane header.

**Start splitting**

- Click the split icon in the sidebar footer (beside Settings) to open the split menu: **Add split / Exit split / Minimize / Reset split**.
- **Add split** opens a multi-select dialog. Check two or more conversations and confirm. While already split, the dialog pre-selects the current panes: uncheck one to remove its pane, check more to extend, and the final selection becomes the split.
- You can also use the session list: right-click a conversation (or its row `⋯` button) and pick **Add to split** / **Leave split**. Outside split mode the first pick is parked as a *pending split*; adding a second conversation starts the split. Inside split mode the conversation joins the current split immediately. Leaving removes it, and dropping to one conversation exits split mode.
- Or drag a conversation from the sidebar onto the conversation column: the dropped conversation becomes the second pane.
- Once split, drag another conversation onto a pane to replace it, or use a pane header's split buttons to choose the session for a new pane.
- While a sidebar conversation is dragged over a pane edge, the panes lay themselves out as they will after the drop and a dashed placeholder names the incoming conversation — release to commit exactly that layout.
- **Reset split** clears the plugin's split-related localStorage / sessionStorage keys, the saved layout, the crash guard, the minimized flag and pane caches, so a split stuck by stale state can always start again (the performance-mode preference is kept).
- Closing a pane (header **✕**) or leaving the split via the context menu exits the split as soon as fewer than two conversations remain: the whole pane tree and every conversation's split membership are cleared, so nothing is left tagged “in split” while unselected.
- Right-click any conversation (or its row `⋯` button) → **Enter floating window** to detach it into a movable window. Drag its title bar to move it, drag any edge to resize, use **⇲ Dock to split** to put it back into a split, or **✕** to close the float. A conversation is never hosted in both modes: entering a float removes it from the split / pending split first.
- Right-click a conversation → **Open in independent window** to open it alone in an in-app window with close / minimize / maximize-restore / fullscreen controls — no browser is opened.

### Split view entry in the sidebar (0.12.0)

- The sidebar's global-panel navigation now has a **Split view** row next to
  **Plugins**, with the plugin's split glyph. The bottom-left split button and
  the session right-click **Split plugin** group use the same glyph.
- Clicking **Split view** switches the main column to the **Split view panel**:
  with two or more panes it shows the same canvas you get from “Restore split”
  (panes, dividers and the layout toolbar); with fewer panes it shows the
  **Add split** multi-select page, and confirming two or more conversations
  opens the split right there.
- **Minimize split** from the footer menu now returns to the conversation
  view, and **Exit split** clears the panes and returns as well. Switching to a
  conversation or another plugin panel in the sidebar keeps the layout; click
  **Split view** again to continue.
- **Switching no longer re-creates the panes (0.13.0)**: the canvas always stays
  mounted in the overlay layer and is only shown/hidden between the Split view
  panel, a plain conversation, the minimized state and plugin panels. While
  hidden it is kept mounted for **20 seconds** (warm hold), so Split view ⇄
  conversation and minimize ⇄ restore are near-instant instead of re-attaching
  every native conversation (session retain + editor guards) each time. After
  the warm window the pane tree is dropped to free resources; the hidden canvas
  also stays in layout, so showing it again is a visibility flip rather than a
  full re-layout of N conversations.
- **Minimize chip (0.13.0)**: the restore chip shown while the split is
  minimized can be dragged anywhere in the workspace and snaps to the **nearest
  edge** on release — the position along that edge is kept, so it is no longer
  limited to the four corners. The position persists across minimize cycles.
- The **Restart DSH** row now uses a drawn SVG instead of the U+23FB power
  symbol (missing from the default Windows CJK font stack, where it rendered as
  a mojibake box). Every new icon is inline SVG, so no system font is involved.

### Usage help (screenshots)

The in-app **Split help** card now carries three annotated screenshots — the
session right-click menu, the bottom-left split button menu, and Settings →
Split workspace — with click-to-enlarge thumbnails. The Host serves them
same-origin from `docs/screenshots/` under `/dsv/help/...`.

### Floating windows

Split panes and floating windows are two shapes of the same workspace, and a
conversation can switch between them without a reload:

- **Split → float**: right-click a conversation → **Enter floating window**. It
  leaves the split (or the pending pick) and becomes a floating window that
  hosts the session's real native UI — composer, streaming, Stop, queue, tool
  rows, attachments, approvals and view tabs all keep working.
- **Float → split**: right-click the conversation inside the float → **Add to
  split** (or use the header's **⇲ Dock to split**). With a split running, the
  session is appended as a pane; with none, it is parked in the pending split
  and the next pick starts the split. **Exit floating window** only closes the
  float without docking it.
- **Window behaviour**: drag the title bar to move, drag any edge/corner to
  resize, click to raise. Position, size and stacking order persist across DSH
  restarts, and every float is clamped back into the conversation column after
  a window resize or a right-sidebar open/close.
- **With a split**: floats sit above the split. Extracting one conversation
  from a 2-pane split ends the split and clears the other conversation's split
  membership (docking the float back parks it in the pending split, so the next
  pick restarts the split); with 3+ panes the split keeps showing the remaining
  panes.
- A session exists in exactly one mode at a time, so two composers can never
  edit the same conversation at once.

#### Why not a real OS-level window?

This is a host limitation, not a shortcut:

- The DSH Desktop Electron main process creates a single main window; its
  `setWindowOpenHandler` returns `{ action: "deny" }` for every `window.open`
  (http/https links are handed to the system browser), and there is no
  per-session window IPC or menu action.
- The DSH Web client is a single-page app with no per-session deep link such as
  `?session=`; session switches happen in-page through `uiWorkspace.openSession`,
  so there is no URL for "open one conversation in a new window".
- A renderer plugin cannot create an Electron `BrowserWindow`.

The float is therefore an **in-app window** rendered on the `shell.overlay`
layer: movable, resizable, persistent, and backed by the real `ChatPane`, but
inside the same DSH page. If DSH later exposes native multi-window support, the
float layer can be swapped for real windows while the split⇄float switching
logic stays unchanged.

### Independent window (in-app, no browser)

- Right-click a conversation → **Open in independent window**: it opens inside
  the DSH application as a window that shows only that conversation, with
  **close / minimize / maximize-restore / fullscreen**. Double-click the title
  bar toggles maximize; minimizing leaves a restore chip at the bottom-left.
- Opening it detaches the conversation from the split / float / pending pick, so
  one conversation is never edited through two composers. Closing the window
  keeps the conversation — it stays in the sidebar and can rejoin a split.
- **Why not a native OS window?** The DSH Desktop Electron main process keeps a
  single application window and its `setWindowOpenHandler` refuses `window.open`
  (http/https is handed to the system browser); the plugin Host runs in a Node
  child process with no Electron `BrowserWindow` API. Current DSH exposes no
  plugin-facing native multi-window API, so the 0.8.0 “system window” had to use
  the browser. 0.10.0 replaces it with an **in-app independent window**: no
  browser, no address bar, all window controls drawn by the plugin.
- Limitation: it stays inside the DSH main window (not an OS-level second
  window) and cannot be dragged outside it. If DSH later exposes native
  multi-window support, this layer can become a real system window without
  changing the conversation-switching logic.

### System window (native OS window, macOS + Windows)

- Right-click a conversation → **Split plugin** → **Enter system window** opens a
  **real OS window**: movable outside the DSH main window, resizable and closable
  on its own, with no browser and no address bar. While it is open the menu shows
  **Exit system window**, and closing the window itself flips the menu back.
- The window shows the real conversation client: **no left sidebar** (the
  conversation fills the window) while the **right sidebar**, header, composer and
  view tabs stay available.
- **macOS** uses an AppKit `NSWindow` + `WKWebView` helper
  (`native/system-window.jxa`, started with `osascript`); **Windows** uses a
  WinForms window hosting WebView2 (`native/system-window.ps1`, started with
  `powershell.exe`). Both load the Host's **locally authenticated web client**:
  the URL is minted inside the Host and never returned to the renderer, and a hash
  marker turns the same client into the single-conversation system-window mode.
- **Platforms**: macOS and Windows. Linux (or the Web client) is told to use the
  independent window instead, and a missing Microsoft Edge WebView2 Runtime is
  reported explicitly on Windows. The helper ships with the package (about 1.1 MB)
  and needs no local build; each window gets its own temporary WebView2 profile,
  and closing it ends the whole helper process tree.
- **Menu placement**: the stock DSH menus portal themselves next to their trigger
  with CSS Anchor Positioning (`position-anchor` + `anchor()`). Chromium supports
  it, WebKit/WKWebView does not, so dropdowns would otherwise fall back to the
  window's top-left corner. In the system window the plugin detects that gap and
  re-anchors those panels next to the trigger they opened from, using the
  `data-anchor-side` / `data-anchor-align` attributes and the model selector's
  anchor custom property; upward menus sit above the trigger, right-aligned and
  height-capped.
- Desktop-only capabilities (native file drag, system directory picker) follow the
  Web client inside the window; conversations share the same Host, so input,
  streaming and the right sidebar work normally.

### Settings entry

Besides the sidebar-footer split button, the plugin registers a **Settings → Split workspace** page (`settings.section`) so the controls remain reachable when the footer entry is hidden. The page shows:

- **Status**: plugin version, pane count, pending split, floating windows, and the current independent window.
- **Performance mode**: the persisted switch (on by default) for animations, background observers and the drag preview.
- **Actions**: open split view, add split, exit split, minimize split, reset split, refresh interface, restart DSH (Desktop), help.

“Add split” closes the Settings panel before opening the multi-select dialog so the dialog is never hidden behind it; the other actions run in place and refresh the status live.

### Performance mode and lag analysis

**Performance mode is ON by default** since 0.9.0 (an explicit off choice is
kept). Open the sidebar-footer split menu and pick **Performance mode**, or run
`window.__dshSplitWorkspace.setPerformanceMode(true/false)`; it persists. It
turns off:

- every pane / float / menu / chip animation, transition, card shadow, focus
  glow and running-row shimmer;
- the per-pane composer-geometry `MutationObserver`. This is the most suspicious
  cost: streaming mutates a pane's DOM on every token and the old path queued a
  measurement (`getBoundingClientRect` + style reads) for each change, multiplying
  with pane count. Performance mode keeps ResizeObserver plus a 1.5 s poll;
- TOC-grip sync (`dsh-prompt-history` ☰ placement), compaction-watch, float
  position polling and the 800 ms right-sidebar poll (resize listeners stay);
  geometry polling drops from 1 s to 3.5 s and sidebar session scraping from
  200 ms to 1 s;
- the floating drag-preview thumbnail for sessions and panes is not rendered at
  all — no DOM clone, no per-frame thumbnail positioning; drop targets and the
  layout reflow hole still work.

Real conversations, composers, approval flows, split/float/system-window
features all stay available.

- **0.12.0: window resizing no longer measures every frame.** While dragging
  the window edge, each pane's size observer used to commit a new pane box on
  every frame (re-rendering the pane and re-running the composer measurement and
  dock alignment); more panes meant more jank. Now the browser's own CSS reflow
  runs alone during the gesture, and all JS measurement and derived state (slim
  header / short-pane decision, composer-card geometry, dock row width, float
  clamping) runs once when the resize or divider drag settles. Pane transitions
  are also cut while resizing, so a 180 ms width transition cannot chase the live
  window edge. In performance mode, the canvas additionally keeps its gesture-start inner
  layout during a window resize and follows the live window edge through a CSS
  transform, so the stock conversation views inside the panes do not re-measure
  their scrollers on every frame; at settle it relayouts once at the real size
  (text is slightly scaled during the drag and crisps up immediately after).
  Performance mode benefits too.

Measured on a dev machine (headless Chromium, performance mode, 2 panes, one
continuous 40-step window drag): freeze ON vs OFF — median main-thread task time
across the gesture **2.1 s vs 3.2 s**, long tasks **1 vs 17**, total blocking time
**9 ms vs 461 ms**, average frame interval **25.7 ms vs 59.1 ms**; with 4 panes,
long tasks **6 vs 38** and blocking **85 ms vs 989 ms**. The panel entry has less
left to do because no covered stock conversation stays mounted.

**What can still lag**: every pane is a full native conversation view, so N panes
streaming at once means N independent React/DOM render and scroll pipelines —
the dominant upstream cost, which a renderer plugin cannot remove (that would
need upstream offscreen pausing/virtualization). On Windows machines with weak
single-core throughput, keep 2–3 active panes, close or minimize unused splits,
avoid stacking floats over a split, and use the compact TUI composer. Check
`window.__dshSplitWorkspace.health()` (`performance`, `panes`, `geometry`) and
compare DevTools Performance long tasks with the mode on/off.

### Updates, reload and restart

DSH 0.2.x (including Desktop 0.2.2-rc.3) ships HMR: a newly installed plugin is
hot-loaded, and a rebuilt client bundle is swapped into the open page. Most
installs/updates therefore need **no restart**. A restart is only needed when:

- the plugin manager reports `restart-required` (Host-half or linked-package
  host modules changed, or the package directory moved);
- the footer split icon still has not appeared a few seconds after install (some
  older DSH builds without HMR).

**The 0.12.0 / 0.13.0 panel, icons, warm-switch and resize work all live in the client bundle**, so a rebuilt `lib/client.js` is hot-swapped by HMR as well — no DSH restart.

**Fixed in 0.11.1: rebuilding the client bundle no longer needs a restart.** A
rebuild of `lib/client.js` used to make the footer button, the session menus and
**Settings → Split workspace** disappear until the page was reloaded, because the
plugin factory re-defined the read-only `__test` seam on the inherited
`window.__dshSplitWorkspace` object and threw `Cannot redefine property` — DSH
reported the entry as a failed page synchronization. Each bundle execution now
publishes a fresh public object, so **a rebuilt bundle hot-swaps, a disable →
enable cycle and the 0.11.0 → 0.11.1 hot upgrade all apply in place** without a
reload or restart.

Production DSH has **no built-in Restart menu item** (development builds do).
Since dsh-split-workspace 0.9.0:

- **Split menu → Restart DSH** confirms first (running tasks are interrupted),
  then the Host half closes and reopens the desktop app at the OS level (a
  normal AppleScript quit on macOS; close-then-terminate and relaunch on
  Windows).
- The update chip offers **Restart DSH** on Desktop and **Reload page** in the
  Web GUI.
- `window.__dshSplitWorkspace.restartApp()` does the same. Manually: Windows —
  quit from the tray/Start menu; macOS — ⌘Q; then open DSH again.
- **Refresh interface** only reloads the page (useful for a stuck overlay or a
  layout glitch); it does not apply changes that need a full restart.
- On a first install the plugin client is not running yet, so it cannot show
  its own restart button; follow the plugin manager's restart notice or quit
  and reopen DSH manually.
- **If the split entry is missing after a hot install, try a page reload before a
  restart**: production DSH has no Reload menu item, but it ships Developer
  Tools (macOS `⌘⌥I`, Windows `Ctrl+Shift+I`, or View → Toggle Developer Tools).
  Use the reload button in Developer Tools, press `⌘R` / `F5`, or run
  `location.reload()` in its Console to reload the page and fetch the current
  plugin graph — usually no DSH restart is needed. Quit and reopen only if that still fails.

### Features

- **No-rebuild switching + warm hold (0.13.0)** — the split canvas stays mounted, so Split view / plain conversation / minimized / plugin panels no longer tear down and re-create the native panes; the minimize chip drags anywhere and snaps to the nearest edge.
- **Split view sidebar entry (0.12.0)** — a global-panel row next to **Plugins** opens the split workspace in the main column: the pane canvas when a split exists, or the add-split multi-select page that opens the split as soon as two conversations are confirmed.
- **Sidebar split menu** — the footer button opens Add / Exit / Minimize / Reset; Exit and Minimize are the same actions as the split toolbar.
- **Multi-select add** — searchable dialog; pre-selects current panes, lets you uncheck or extend, and rebuilds the split from the final selection.
- **Session-menu integration** — the stock right-click menu gains Add to split / Leave split. Outside split mode the first pick waits in a pending split until a second conversation is added; removing down to one pane exits the split.
- **Floating windows** — right-click a conversation → Enter floating window turns it into a movable, resizable window; Dock to split / ✕ in its header switch it back or close it, and geometry persists.
- **Split ⇄ float switching** — one conversation lives in exactly one mode; entering a float detaches it from the split, docking it back closes the float.
- **Independent window (in-app)** — right-click → Open in independent window shows the conversation alone in an in-app window with close / minimize / maximize / fullscreen; no browser, and it is detached from split and float first.
- **Settings entry** — besides the sidebar-footer split menu, **Settings → Split workspace** offers the same actions (add / exit / minimize / reset split, performance mode, refresh, restart DSH, help and status).
- **Performance mode (on by default)** — one switch drops animations, shadows, shimmer and several background observers/polls for low-power or laggy Windows machines; the setting persists. In this mode the floating drag-preview thumbnail is not rendered at all (drop targets and placement feedback stay).
- **Update chip / Restart DSH / Refresh interface** — a newer on-disk version shows a corner chip with **Restart DSH** on Desktop or **Reload page** in the Web GUI; the split menu also offers Restart DSH and Refresh interface.
- **Fallback split entry** — when the host layout does not render the sidebar footer action (or hides it), the plugin shows a split button at the conversation area's bottom-left corner so the menu stays reachable.
- **One-click reset** — wipes plugin localStorage/sessionStorage, layout, crash guard and temporary caches.
- **Unlimited native panes** — no four-pane cap; add as many conversations as
  the window can show.
- **Automatic layout** — 2 panes as columns, 3 as an L, 4 as a 2×2 田字, and
  5+ as a balanced row-major grid.
- **Any arrangement by drag** — drag a pane header left, right, above or below
  another pane; stack a pair or build columns by hand.
- **Native sessions, not iframes** — each pane re-hosts the stock conversation
  primitives, so composer, streaming, Stop, queue, todos, approvals and view
  tabs all work.
- **Desktop-ready** — built for the DSH Desktop shell (`dsh-app://`), where the
  preload only runs in the top frame.
- **Shared sidebar** — the stock sidebar follows the focused pane; drag a
  conversation onto the split to add or replace a pane.
- **Right sidebar control** — open and close with distinct icon states; the
  split toolbar owns the toggle.
- **Minimize / restore** — hide the split without losing the pane tree.
- **Persistent tree** — the layout you left comes back after a restart.

### Layout

- The automatic policy: 2 panes side by side, 3 as an L, 4 as a 2×2 grid, and
  5+ as a balanced row-major grid that grows by about `sqrt(n)` columns. There
  is no mode menu — adding or closing a pane simply re-fits the grid. For a
  stacked pair, drag the second pane's header over the first, then move down
  to the bottom edge; a deliberate drag is kept, and the automatic grid is
  only the starting point.
- Drag the dividers to resize.
- Drag a pane by its header to move it: the pane's slot closes immediately (the
  other panes fill the space) and a dashed hole opens where it will land — left,
  right, above or below the pane under the cursor, following the direction of
  the gesture. Release to drop; release over the pane's own slot, or press Esc,
  to cancel. The preview is geometry-only, so the live conversations are not
  remounted while you drag.
- Double-click a pane header (or use the ⤢ button) to maximize / restore.
- No fixed pane cap: add as many conversations as the window can show (the
  per-pane header compacts itself as panes get narrower).
- While a split exists the shared stock sidebar follows the focused pane; click
  a conversation to load it into that pane, or drag a conversation onto the
  split area to add/replace a pane.
- The pane tree persists across reloads and reopens with the layout you left
  (including a hand-made stacked or L-shaped arrangement). Adding or closing a
  pane re-fits the automatic grid; restarting does not.
- **Minimize** (toolbar or footer menu) hides the split and shows the stock
  single-session view while keeping the pane tree. A "restore split" chip brings
  it back (drag it anywhere — it snaps to the nearest edge and remembers its
  position). Clicking another conversation tucks the split into the chip;
  opening a plugin/skills/settings panel only hides the canvas temporarily (the
  panes stay mounted) and it reappears when you return to a conversation or the
  Split view panel, so no restore chip is needed there.
- One title per pane: the pane header owns the title; the stock header keeps its
  view tabs and actions without repeating the breadcrumb. The close control is
  a drawn **✕** in a red-tinted button, not a low-contrast dot.
- If `dsh-prompt-history` is installed, its draggable **会话目录 (☰)** grip is
  shown **once per live pane, on the pane's left edge and vertically centered**.
  Every split adjustment (add, close, re-arrange, divider drag, maximize or a
  right-sidebar push) re-homes the affected grips to the left edge and the
  vertical center of their pane; a pane whose box did not change keeps a
  deliberate vertical drag. The copies mounted by the hidden stock conversation
  and by non-pane views are hidden, so the grips no longer stack on top of each
  other.
- The split toolbar's right-sidebar control has **two states**: a right chevron
  while the panel is closed (opens it) and an accent, left-chevron state while
  it is open (collapses it). A repair watcher catches the stock
  open/collapse buttons after a split is torn down, so a stale sidebar-right
  store can no longer swallow the click or hide the way back into the panel.
- Pane headers deliberately do **not** mount the stock per-pane rightbar seat
  (the split toolbar owns the toggle). That seat is session-scoped and carries
  its own store handle; mounting it inside every pane created a second
  sidebar-right store for the same session, which made the shared panel's tab
  icons look dead. The stock header keeps the single store.

### Why not one iframe per pane?

The Desktop app serves the client from `dsh-app://app/` and injects the boot
graph (`__DSH_BOOT__`, `__DSH_TRANSPORT__`, …) through the Electron preload.
That preload runs only in the top frame, so a same-origin iframe stays at
“Loading plugins…” forever. The pane engine therefore runs **in the top
client**, re-hosting the stock conversation primitives per session — the same
architecture the upstream plugin uses.

### Commands

- `window.__dshSplitWorkspace.health()` — version, host, panes, geometry, `panelWarm` (canvas hidden in the warm hold) and `canvasRepairs` (interactivity self-checks that had to repair a canvas after showing it; 0 in normal use),
  persisted tree, crash guard.
- `window.__dshSplitWorkspace.split(sessionId)` — add a session as a pane.
- `window.__dshSplitWorkspace.addToSplit(sessionId)` /
  `removeFromSplit(sessionId)` — add to / leave the split (the first pick
  outside split mode waits in the pending split).
- `window.__dshSplitWorkspace.float(sessionId)` — detach the conversation into
  a floating window (removed from the split / pending split first).
- `window.__dshSplitWorkspace.dockFloat(sessionId)` — put a floating window
  back into the split (or the pending split when no split is running).
- `window.__dshSplitWorkspace.closeFloat(sessionId)` — close a floating window
  without docking it.
- `window.__dshSplitWorkspace.floats()` — current floating-window session ids,
  in creation order.
- `window.__dshSplitWorkspace.openSystemWindow(sessionId)` — open the
  conversation in the app-internal independent window (`openIndependentWindow`
  is an alias).
- `window.__dshSplitWorkspace.appWindow()` — current independent-window state
  (`{ id, minimized, maximized }` or `null`).
- `window.__dshSplitWorkspace.setPerformanceMode(true/false)` /
  `performanceMode()` — toggle/inspect the persisted performance mode.
- `window.__dshSplitWorkspace.resizeFreeze()` / `setResizeFreeze(true/false)` —
  whether performance mode freezes the canvas layout during a live window
  resize and follows the window edge with a CSS transform (on by default).
- `window.__dshSplitWorkspace.reloadClient()` — reload the page.
- `window.__dshSplitWorkspace.restartApp()` — close and reopen DSH Desktop
  (for the rare changes that need a full restart).
- `window.__dshSplitWorkspace.pending()` — conversations waiting for a second
  pick before the split starts.
- `window.__dshSplitWorkspace.openAddSplitDialog()` — open the multi-select add
  dialog.
- `window.__dshSplitWorkspace.arrange("auto")` — re-fit the automatic layout
  (legacy mode names are accepted and ignored).
- `window.__dshSplitWorkspace.focusChat()`, `closeFocused()`.
- `window.__dshSplitWorkspace.reflow()` — live pane-drag preview state
  (diagnostics for the hole/collapse behaviour).
- `window.__dshSplitWorkspace.setEnabled(false)` — kill switch.
- `window.__dshSplitWorkspace.reset()` — clear the saved layout.
- `window.__dshSplitWorkspace.resetAll()` — also wipe the plugin's split
  localStorage / sessionStorage keys and temporary caches (same as the menu's
  Reset split; the performance-mode preference is preserved).

### Source layout and build

`lib/client.js` is a **generated artifact**; do not edit it. The source lives in
`src/client/` as 18 ordered sections, assembled by `scripts/build-client.mjs`:

| Section | Responsibility |
| --- | --- |
| `00-preamble` / `01-constants` | module-loader entry, React/P, constants, storage, perf/version keys, standalone detection |
| `02-styles` | all `dsv-*` CSS (including performance mode and floats) |
| `03-runtime` | runtime store, health diagnostics, session-list source |
| `04-tree` | split tree store, layouts, persistence |
| `05-pending-float-store` | pending split, float store, split⇄float helpers |
| `06-drag-reflow` | pane drag preview/reflow and drag utilities |
| `07-faces` | root standard faces and session bindings |
| `08-pane-kit` | slot capture and native component re-hosting |
| `09-pane-renderers` | native/fallback transcript + composer renderers |
| `10-pane-frame` | pane header, close/dock buttons, composer measurement |
| `11-canvas-navigation` | canvas/dividers, pickers, keyboard navigation, early API |
| `12-chrome` | safe mode/help/tips, the split-view main panel, live-resize canvas freeze, update notice, seat |
| `13-drag-bridge` | inactive drag-to-split bridge |
| `14-launcher` | footer menu, multi-select add dialog, session menu integration |
| `15-float-window` | floating window components/layer |
| `16-standalone` | system-window standalone page |
| `17-api-apply` | `window.__dshSplitWorkspace` API, `apply()` and exports |

- `npm run build` regenerates `lib/client.js`; `npm test` runs `build:check` first
  and fails when the source and artifact disagree.
- `npm run check:anchor` verifies the system window's menu anchoring fallback in a
  real WKWebView (macOS only; CI runs on Ubuntu).
- No bundler: the DSH client loads exactly one `<plugin>/client.js`, the sections
  share one module-loader closure, and ordered concatenation keeps the published
  package dependency-free.
- `native/` holds the platform helpers: `system-window.jxa` (macOS AppKit),
  `system-window.ps1` (Windows PowerShell + WinForms + WebView2) and the vendored
  `webview2/` SDK binaries (BSD-3-Clause; see `THIRD-PARTY-NOTICES.md`).
- Edit the matching `src/client/` section and run `npm run build`; the generated
  file starts with a GENERATED marker.

### Keyboard

- `Alt+T` — toggle the compact TUI composer in the focused pane.
- `Alt+Shift+←/→/↑/↓` — move focus between panes.

### Limits

- No pane-count cap; the persisted tree is validated (unique sessions, depth)
  and a corrupt tree is discarded instead of reactivating a broken workspace.
- A floating window is an **in-app** window, not a second Electron window: the
  Desktop main window denies `window.open` and the Web client has no
  per-session deep link, so the float re-hosts the real conversation inside the
  same DSH page (see “Why not a real OS-level window?” above).
- A conversation is either a split pane or a floating window — never both — so
  two composers can never share one session's editor.
- The **independent window** is an in-app surface, not an OS-level second
  window: DSH Desktop refuses plugin-created native windows and the Host process
  has no Electron `BrowserWindow` API. It opens no browser and has no address
  bar, but it cannot leave the DSH main window; a conversation in it is likewise
  detached from split and float.
- The **system window** is a second OS-level web client: it needs DSH Desktop on
  macOS, or Windows with the Microsoft Edge WebView2 Runtime, and it does not
  carry desktop-only integrations such as native file drag.
- The persisted recursion depth is capped at 32 levels as a stack-safety guard
  for hand-edited payloads, not as a pane limit.
- The hidden stock conversation still streams under the overlay; panes re-host
  the native composer, so a pane's own composer owns its session's editor.
- Pane rename refuses blank sessions (the stock rename dialog does the same).
- Composer-plugin compatibility: only the focused pane keeps
  `data-composer-card`; the hidden stock composer and inactive panes no longer
  win global selectors. Every pane still mounts its own composer overlays, and
  inactive panes hide (without unmounting) those overlays, so
  `dsh-tweaks-prompt-history` history pills, `dsh-prompt-history` suggestion
  ghosts, and slash/model menus stay anchored to the pane being typed in.
- Pane drags snap their preview instead of animating width/height over 180ms,
  and pane resize observers plus composer measurements are frozen during the
  drag, so each preview frame no longer re-lays-out a full transcript.
- Page-singleton composer plugins (such as `dsh-prompt-history`) are scoped to
  the active pane: prediction context reads only that pane's transcript, an
  external write into an inactive pane's draft is rolled back, and Tab/→
  inserts the prediction into the pane being typed in.

MIT. See `THIRD-PARTY-NOTICES.md`.

<!-- author-tools:start -->

<!-- generated by scripts/sync-readmes.mjs from projects.json -->

## 同作者的其他插件 · More plugins by the same author

- **[DSH 声音与提醒](https://github.com/mhlywxl/dsh-coding-sound)**（`dsh-coding-sound`）— 用声音盯住 Agent：按输出文字演奏生成式背景音乐，完成、等待审批与工具执行各有可配置的提示音。
  <br />*[DSH coding sound](https://github.com/mhlywxl/dsh-coding-sound)* (`dsh-coding-sound`) — Generative background music and notification chimes for DeepSeek Harness: hear whether the agent is thinking, still working, or waiting for you.

## 支持作者 · Support the author

如果这个项目帮你省下了盯屏幕的时间，欢迎请作者喝杯咖啡 ☕，或者给作者「充充电」⚡。金额随意，心意最重要。

*If this project saved you some screen time, you can buy the author a coffee ☕ or top up the author's battery ⚡. Any amount is welcome — the thought counts.*

<p align="center">
  <img src="https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/sponsor/alipay.jpg" alt="支付宝收款码 / Alipay QR code" width="180" />
  <img src="https://raw.githubusercontent.com/mhlywxl/dsh-split-workspace/main/sponsor/wechat.png" alt="微信收款码 / WeChat Pay QR code" width="180" />
</p>
<p align="center"><sub>支付宝 · 微信支付 / Alipay · WeChat Pay</sub></p>

<!-- author-tools:end -->
