---
description: "面向模型的 macOS 与浏览器工具、自主截图定位任务循环、安全策略、可视化配置与步骤图片展示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-macos-use

[English](README.md) | 中文

## 概述

`dsh-tool-macos-use` 为智能体提供 21 个桌面与浏览器工具，包括基础操作和基于截图定位的自主任务循环。它会执行应用策略、用户确认、语义元素令牌、时间与步骤预算、单任务锁和按所有者隔离的中止。所有可调整的智能体设置都显示在插件配置页面中。每次直接或模型选择的 GUI 变更动作前的确认默认开启；只有存在等效、可信的安全或审批边界时才应关闭。默认情况下，每步的新鲜视觉证据也会存储并显示在对应步骤旁；关闭该设置后，不会存储或显示每步截图，但 GUI 模型私下使用的截图仍会保留。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

请先挂载全部三个能力包，再挂载此消费方，然后在插件配置中设置智能体。浏览器网络访问及 macOS 应用读取/控制均默认拒绝；使用前必须在页面中显式加入域名和应用授权。从旧版允许式默认值升级时，需要迁移这些配置。

### 何时选择

当智能体应获得类型化桌面或浏览器操作，并且部署接受已配置的应用、确认和截图策略时，请选择此包。如果 GUI 控制不应对模型可见，请排除此包。自主任务工具需要 `dsh-gui-model`；基础桌面与浏览器工具不会调用视觉端点。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-macos-use'
- name: '@deepseek-ai/dsh-gui-model'
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-tool-macos-use'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defaultMaxSteps` | `20` | 自主循环默认步骤预算；可视化配置限制为 1–100 |
| `taskTimeoutMs` | `120,000` | 自主任务截止时间 |
| `showStepScreenshots` | `true` | 保存并显示每一步的新鲜视觉证据 |
| `confirmDestructiveActions` | `true` | 对部分高影响 GUI 操作启发式询问 |
| `confirmEveryMutation` | `true` | 每次直接或自主 GUI 变更动作前单独询问 |
| `singleActiveTask` | `true` | 同一时间只允许一个自主任务 |

表内全部字段，以及命令超时、辅助功能元素预算、Chromium 模式、显式浏览器域名授权、应用读取／控制授权、拒绝项、截图排除项和紧急停止，都由 GUI 智能体卡片可视化管理，无需在 YAML 中重复任何可调智能体参数。集成后的 Harness 文档生成器会从同一份实时 schema 生成完整配置目录。浏览器允许列表为空时会阻止网络导航（仍可用 `about:blank`）；旧版与精确应用授权都为空时不授权任何应用。

### 工具

桌面基础工具包括 `computer_screenshot`、`computer_list_apps`、`computer_list_windows`、`computer_screenshot_window`、`computer_get_window_state`、`computer_click`、`computer_move`、`computer_drag`、`computer_type`、`computer_key`、`computer_scroll`、`computer_open_app`、`computer_focus_window` 和 `computer_abort`。浏览器基础工具包括 `browser_navigate`、`browser_click`、`browser_fill`、`browser_extract_text` 和 `browser_screenshot`。`computer_use_task` 与 `browser_use_task` 会捕获截图、请求一个 GUI 模型动作、执行该动作并重复此过程，直到返回 `done` 或循环因边界停止。模型可见的 `computer_abort` 只能停止调用它的 Agent 所拥有的任务；插件配置中的紧急停止明确作用于全局。任意模型生成的 AppleScript 不会暴露，因为应用授权无法可靠限制它的读取和副作用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

该包基于 `ctx.macosUse`、`ctx.browserUse`、`ctx.guiModel` 和 `ctx.attachments` 注册所有工具。`computer_get_window_state` 会签发绑定所有者的一次性元素令牌。基础操作会先同步预留令牌，再重新获取窗口/辅助功能快照，并在派发前复验精确进程、窗口、元素身份与边界。元素令牌使用 macOS 全局点坐标；显示器坐标观察只在黑色像素上包含已授权前台窗口，并保留截图像素坐标，供原生服务转换为全局 point。`computer_screenshot` 同样签发一次性的前台观察令牌，原始坐标/当前焦点操作必须携带它。存储图片前，该包会缩小副本，以满足附件字节、像素与边长限制，同时保留 GUI 定位所需的原始像素。

任务结果会分离模型可见文本与仅 UI 可见的图片展示。常规渲染包含状态、摘要、动作日志和最终截图引用。`tool.call.toolview` 投影从结果元数据读取持久图片引用，并逐步显示它们，而不会把这些像素发送给驱动模型。当前输出 schema 接受附件服务可选的 `originalDimensions` 元数据。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具 schema、执行、截图存储、结果元数据与 UI 投影 |
| [`src/settings.ts`](src/settings.ts) | 实时配置 schema 与默认值 |
| [`src/policy.ts`](src/policy.ts) | 确认与破坏性操作策略 |
| [`src/tokens.ts`](src/tokens.ts) | 快照范围的辅助功能令牌 |
| [`src/loop.ts`](src/loop.ts) | 有边界的自主循环 |
| [`src/client/index.ts`](src/client/index.ts) | 插件配置卡片与任务结果渲染器 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [macOS-use 包映射](../README.zh.md) — 此消费方组合的能力包。
- [GUI 模型包](../gui-model/README.zh.md) — 自主循环发起的视觉请求。
- [架构](../../../docs/architecture.zh.md) — 结果元数据、附件授权与当前 Harness 集成。
- 集成后的 Harness 文档生成器会从运行中的插件输出精确工具目录。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

驱动模型会看到生成的 `computer_*`、`browser_*`、`computer_use_task` 与 `browser_use_task` schema。GUI 提供方端点与凭据属于部署设置，不是模型参数。

#### Token 影响

包可见时，每个请求都会发送 21 个固定 schema；`defaultMaxSteps` 只会改变一个任务参数的说明。

#### KV 缓存影响

只要工具可见性、定义与解析后的默认步骤数保持不变，前缀就可继续复用。

### 工具结果

#### 模型看到的内容

基础截图会把 PNG 字节保存为持久 `ctx.attachments` 记录，但只把尺寸、字节数和附件 id 渲染为文本，因为主要的 DeepSeek 驱动适配器拒绝图片工具结果内容。任务结果会渲染状态、摘要、每个动作与结果以及最终截图引用。启用 `showStepScreenshots` 时，仅 UI 投影会把每个动作和结果与已保存图片配对；驱动模型不会收到这些像素。

#### Token 影响

基础确认文本很短。提取的浏览器文本与任务动作日志取决于数据，并保留在工具历史中直至压缩；`max_steps` 限制循环日志增长。

#### KV 缓存影响

追加式结果文本位于可复用请求前缀之后，不会使之前的缓存项失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- GUI 模型请求与决策发生在驱动会话日志之外。调用活动期间及结束后的短暂时间内，绑定 Agent Context 与调用的进程内 RPC 可显示有严格上限的 JPEG 预览，且不会追加自定义会话事件。普通模型/动作/审批失败会返回结构化停止结果，开启后的步骤截图会成为可回放的持久展示元数据。若 Harness 在外层硬中断、来不及写入最终结果，UI 只能退化到短时保留的受限预览。
- 附件接口没有事务回滚或删除操作。如果 Harness 外层硬中断恰好发生在步骤图片已保存、最终结果尚未写入之间，该图片可能成为附件存储中的无引用对象；彻底解决需要上游附件生命周期能力。
- context-only 进度 Remote 可防止根 API 与意外跨 scope 调用，但本地单用户 Harness 没有按连接隔离的 Session ACL；它不声称能抵御伪造其他活动 Agent wire identity 的恶意同源 RPC 客户端，完整隔离依赖上游 Gateway 认证/能力令牌。
- `confirmDestructiveActions` 是基于中英日措辞和动作类型的启发式规则，不是可靠的语义副作用边界；原始坐标点击无法判断目标究竟是“删除”“发送”还是“购买”。确认只对当前操作有效，不会创建持久权限，也不会替代 macOS 的辅助功能与屏幕录制控制。
- `confirmEveryMutation` 是默认开启的安全边界，会为每个 GUI 变更类直接工具及每个非 wait/done 自主动作单独询问；没有审批响应方时会默认拒绝。只有存在等效、可信的安全或审批边界时才应关闭。关闭后，若已配置，`confirmDestructiveActions` 仍会生效，但该启发式规则不是语义效果保证。
- 插件自身的同机桌面动作审批只会在动作已经由截图定位后发起。若审批 UI 抢走焦点，只有获准的动作才会重激活该精确已观察窗口，并且仅在身份、几何与像素仍一致时继续；否则停止并要求重新观察。若其他策略在外层 `computer_use_task` 执行前询问，审批包装器会在显示 UI 前私下绑定精确前台目标；获得一次性允许后先恢复并复验，再拍摄新截图并让 GUI 模型重新决策。被拒绝的审批不会重激活任何目标。托管浏览器动作维持原有审批行为，因为 Harness 焦点不会改变隔离页面目标。审批应答器必须通过公开的 `approval/request` 瀑布继续委托：若后来注册的监听器排在该包装器之前，并在不调用 `next()` 的情况下直接作答，插件无法观察或安全重绑定该审批，因此部署组合必须让恢复包装器保持在最外层。
- 当前没有自动重试或恢复。插件可捕获的失败会返回结构化停止结果并保留已保存步骤；只有 Harness 外层强制取消可能阻止最终持久结果写入。
- 辅助功能元素质量因应用而异；没有有效边界的控件不能通过令牌定位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

当前 Harness 兼容性补丁会为嵌套在工具结果元数据中的图片引用增加授权与导出发现逻辑。把独立包集成进 Harness 时，请始终将这些核心更改与客户端渲染器配套使用。

</details>
