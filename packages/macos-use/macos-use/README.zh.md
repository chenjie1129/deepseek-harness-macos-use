---
description: "面向计算机操作智能体的原生 macOS 截图、辅助功能、指针、键盘、窗口、应用与目标受约束的 System Events/JXA 控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-macos-use

[English](README.md) | 中文

## 概述

`dsh-macos-use` 让智能体通过原生截图、辅助功能元数据、CoreGraphics 指针操作、带防护的 System Events 脚本与精确应用 bundle 启动，观察并控制策略允许的 macOS 应用。它可以捕获一个精确窗口，或把经过精确授权的前台窗口截图放到其余像素全黑的主显示器坐标画布上，也可以根据前台窗口的辅助功能树签发不透明元素令牌。调用方提供的任意 AppleScript 被有意禁用。需要本地 Mac 控制时，请选择此包；它本身不会暴露工具或作出自主决策。macOS 辅助功能与屏幕录制权限仍是强制要求。

## 目录

- [使用此包](#use-this-package)
- [可靠性契约](#reliability-contract)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

请在本地子进程提供方之后、`dsh-tool-macos-use` 之前挂载此能力。

### 何时选择

当部署运行于 macOS，并且宿主进程可以获得辅助功能与屏幕录制权限时，请选择此包。对于非 macOS 宿主，或原生 GUI 控制不在部署信任边界内的场景，请勿使用。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-macos-use'
```

原生命令截止时间、应用授权与拒绝、截图排除项和辅助功能元素预算，全部由插件配置页面的 **GUI 智能体**卡片可视化管理，无需在 YAML 中重复任何可调 macOS 智能体参数。集成后的 Harness 文档生成器会从同一份实时 schema 生成完整配置目录。

### 操作

`ctx.macosUse` 提供显示器坐标截图与精确窗口截图；应用、窗口和辅助功能发现；点击、移动、拖拽、输入、按键与滚动操作；精确应用 bundle 启动；精确窗口聚焦；以及前台应用查询。失败会抛出带稳定代码的 `MacosUseError`。

-----

<a id="reliability-contract"></a>
## 可靠性契约

每次显示器坐标、精确窗口和辅助功能观察都携带不透明的 `observationId` 与 `observedAt`。显示器坐标令牌在服务内部绑定精确前台进程（`pid`、可选 `bundleId` 与 Unicode 安全的名称）、该进程按前后层级选出的屏幕内窗口（`id`、标题、边界与可见性）、可信智能体/会话 owner、主显示器几何信息与服务级桌面变更 epoch；精确窗口状态也携带同一套完整窗口身份、owner 与 epoch。同一 owner 获得新观察时，其较旧且未消费的观察会被撤销。全部原生变更从复查到分派共用一个服务级队列；点击、移动、拖拽、输入、按键、滚动、启动应用或聚焦窗口一旦分派，就会推进 epoch 并撤销其他所有 owner 的待用观察。失败的尝试也不能重放已经占用的令牌。令牌 60 秒后过期；跨 owner、已被更新观察取代、变更前、未知、过期、移动、改名、替换或重放的目标会以 `MACOS_USE_TARGET_STALE` 失败。owner 来自可信执行上下文，绝不是模型参数。

显示器坐标结果明确返回 `captureGeometry.displayId`、`captureGeometry.globalPointRect` 与 `captureGeometry.capturePixels`。与该观察配对的坐标采用 PNG 像素；只有在 owner、TTL、epoch、一次性、前台进程、窗口和显示器检查全部通过后，服务才使用内部保存的几何信息把它们转换成全局 macOS point。与精确窗口目标配对的坐标仍使用全局 macOS point。因此 Retina 1×/2× 缩放和非零显示器原点都不依赖模型猜测比例。

每次点击、指针移动、拖拽、输入、按键或滚动都必须携带新鲜的显示器坐标 `observationId`，或精确的已观察窗口目标；未绑定的当前焦点操作会失败关闭。坐标操作必须留在已观察的前台窗口内；点击、指针移动或拖拽任一端点超出其半开边界时都会失败。输入、按键与滚动要求前台进程和所选窗口保持一致。全局原生变更队列让最后一次复查与分派保持相邻，而精确进程、窗口、前台状态与 CoreGraphics 窗口 ID 防护和输入事件由同一个原生 JXA 程序发出。原生输入使用有界、尽力而为的关键区：分派前会响应取消，普通脚本错误会执行配对的 mouse-up 清理，拖拽仍最多五秒；但宿主终止、原生进程崩溃或硬超时仍可能中断清理，因此这不是操作系统级事务，也不构成无条件输入状态保证。调用方绑定动作时只需回传不透明令牌。`openApp` 与精确 `focusWindow` 自身携带明确目的地，但仍使用同一个队列，并在分派后撤销待用观察。

当同一台 Mac 上的审批面板在观察后抢走前台焦点时，受信任的工具适配器可以请求一次审批后重激活。服务会先消费原先绑定 owner 的令牌，只恢复已观察到的精确进程与窗口，并在分派前重新核对身份、边界、显示器几何和解码后像素摘要。语义元素操作还会重新获取一份辅助功能快照。窗口被替换或任何像素变化（包括动态内容或前后台样式变化）都会失败关闭，必须重新观察和决策；旧动作绝不会重放。审批被拒绝或不可用时不会触发重激活。

窗口 id 是权威目标，绝不会退回应用名匹配。应用名/标题查询必须唯一命中；多个匹配会以 `MACOS_USE_WINDOW_AMBIGUOUS` 失败。`actionReceipt()` 会捕获新鲜的操作后观察，并报告原精确窗口仍存在、已消失或该操作未绑定目标。回执只能证明发生了新鲜观察；调用方仍必须验证用户要求的应用状态。

运行时策略提供彼此独立的精确 `readAppGrants` 与 `controlAppGrants`，每条规则可以要求名称、`bundleId`、`pid` 或其组合；名称归一化不会丢弃非拉丁文字。`deniedAppIdentities` 对两者都优先。若一条控制规则未被相同或更宽的读取规则覆盖，配置会直接拒绝。只有精确授权缺失或为空时才回退到旧 `allowedApps`；两者都为空时，读取与控制现在都会失败关闭。升级用户必须先在 Plugin Configuration 中可视化添加 Read app grants 与 Control app grants（或填写旧 `allowedApps`），代理才能看到或操作应用。这个最小权限默认值有意取代以前隐式的全开放行为。

发现与精确截图执行读取范围；输入、打开与聚焦则同时要求读取和控制范围。每次变更前都要求读取权限，可以避免先产生 control-only 副作用、随后强制操作后回执又因无读取权限而失败并诱发重试。显示器坐标截图路径绝不会生成完整显示器 raster：它只把已授权前台窗口的 CoreGraphics window id 传给 `screencapture -l -o`，再把这份精确窗口像素合成到一个覆盖主显示器坐标、其余像素全黑的画布上。前台窗口被排除、不可读、不可用、位于副显示器、跨屏或有一部分超出主显示器时，服务都会在返回可转移像素前拒绝；截图过程中前台或显示器发生变化也会拒绝结果，已经分派的原生变更仍在执行时也不能开始截图。背景窗口、桌面、菜单、覆盖层与其他应用不会先被捕获再遮盖，而是始终保持黑色。`excludedScreenshotApps` 只是像素隐私名单，不是通用数据读取拒绝策略。

`openApp` 会先解析已安装应用的 bundle 路径。bundle-id 选择器结合 Launch Services 与标准应用目录的有界扫描；只有名称的选择器结合 Spotlight 与该扫描。多个规范化匹配会以 `MACOS_USE_APP_AMBIGUOUS` 失败。解析后的 `name` 与 `bundleId` 会同时接受读取和控制授权检查；随后由同一个原生 NSWorkspace 程序再次核对并启动该精确规范 bundle URL，服务还会在返回前验证同一个 bundle 已成为前台应用。建议提供 bundle id；它支持只含 bundleId 或 name+bundleId 的授权。

公开的任意 AppleScript 始终被拒绝，因为无法可靠地把它的读取与影响限制在应用授权内；内部生成脚本仍会执行精确目标约束。`excludedScreenshotApps` 仍然只是像素隐私名单，并非通用数据读取拒绝策略。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`MacosUseService` 通过 `ctx.subprocess` 执行明确的原生命令。截图使用精确窗口 `screencapture`；窗口与应用检查使用 CoreGraphics 和 System Events 脚本；指针移动与拖拽使用 CoreGraphics；其余 GUI 操作使用 System Events。该服务会先应用当前应用策略，再返回观察结果或分派操作。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务生命周期、策略、截图与操作方法 |
| [`src/native.ts`](src/native.ts) | 原生枚举、辅助功能、聚焦与指针脚本 |
| [`src/applescript.ts`](src/applescript.ts) | System Events 操作脚本 |
| [`src/observations.ts`](src/observations.ts) | 有时限、有容量上限且仅供一次操作的观察身份 |
| [`src/policy.ts`](src/policy.ts) | 精确应用身份的读取与控制策略 |
| [`src/redaction.ts`](src/redaction.ts) | 显示器到像素的坐标几何辅助函数 |
| [`src/target.ts`](src/target.ts) | 失败关闭的窗口选择与新鲜度比较 |
| [`src/types.ts`](src/types.ts) | 请求、结果与稳定错误代码 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [macOS-use 包映射](../README.zh.md) — 包含四个包的能力系列。
- [工具包](../tool-macos-use/README.zh.md) — 面向模型的安全策略、令牌与任务循环。
- [浏览器能力包](../browser-use/README.zh.md) — 面向浏览器任务的隔离 Chromium 控制。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@deepseek-ai/dsh-tool-macos-use`；桌面控制工具 schema 与渲染结果由该包负责。

#### KV 缓存影响

该服务不直接注册提示词或 schema，因此加载它不会改变驱动模型可复用的请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 宿主进程需要辅助功能权限才能进行 GUI 自动化和语义状态读取，需要屏幕录制权限才能截图；拒绝授权会使对应调用失败。
- System Events 发送合成的辅助功能操作，因此忽略这些事件的应用可能不会响应。
- 没有可用边界的辅助功能元素仍可观察，但不能生成坐标目标。
- 合成的显示器坐标画布只覆盖主显示器；其他显示器会被有意省略。
- 显示器坐标观察只在黑色像素上返回已授权前台窗口；前台窗口位于副显示器、跨屏或有一部分超出主屏时会拒绝，请改用精确窗口截图。
- 操作后截图是证据，并不等同于对用户要求结果的语义断言。
- 取消可能会延迟到当前有界原生输入结束（最多为已配置的五秒拖拽加清理时间）。清理是尽力而为：宿主终止、原生进程崩溃或硬超时仍可能中断清理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

该服务与具体提供方位于同一个包中，因为此实现没有可替换后端。

</details>
