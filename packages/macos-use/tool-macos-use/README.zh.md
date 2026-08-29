---
description: "面向模型的 macOS 与浏览器工具、自主截图定位任务循环、安全策略、可视化配置与步骤图片展示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-macos-use

[English](README.md) | 中文

## 概述

`dsh-tool-macos-use` 为智能体提供 22 个桌面与浏览器工具，包括基础操作和基于截图定位的自主任务循环。它会执行应用策略、用户确认、语义元素令牌、时间与步骤预算、单任务锁和立即中止。所有可调整的智能体设置都显示在插件配置页面中。默认情况下，每步截图都会存储并显示在对应步骤旁；关闭该设置后，不会存储或显示每步截图，但 GUI 模型私下使用的截图仍会保留。

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

请先挂载全部三个能力包，再挂载此消费方，然后在插件配置中设置智能体。

### 何时选择

当智能体应获得类型化桌面或浏览器操作，并且部署接受已配置的应用、确认和截图策略时，请选择此包。如果 GUI 控制不应对模型可见，请排除此包。自主任务工具需要 `dsh-gui-model`；基础桌面与浏览器工具不会调用视觉端点。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-macos-use'
- name: '@deepseek-ai/dsh-gui-model'
  config:
    baseURL: https://api.example.com/v1
    model: some-vision-model
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-tool-macos-use'
  config:
    showStepScreenshots: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defaultMaxSteps` | `20` | 自主循环默认步骤预算 |
| `taskTimeoutMs` | `120,000` | 自主任务截止时间 |
| `showStepScreenshots` | `true` | 保存并显示每个步骤定位时使用的截图 |
| `confirmAppleScript` | `true` | 执行任意 AppleScript 前询问 |
| `confirmDestructiveActions` | `true` | 执行破坏性 GUI 操作前询问 |
| `singleActiveTask` | `true` | 同一时间只允许一个自主任务 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-macos-use)是所有可接受字段的完整来源。GUI 智能体卡片还管理命令超时、辅助功能元素预算、Chromium 模式、应用允许与拒绝列表、截图排除项和紧急停止。

### 工具

桌面基础工具包括 `computer_screenshot`、`computer_list_apps`、`computer_list_windows`、`computer_screenshot_window`、`computer_get_window_state`、`computer_click`、`computer_move`、`computer_drag`、`computer_type`、`computer_key`、`computer_scroll`、`computer_open_app`、`computer_focus_window`、`computer_run_applescript` 和 `computer_abort`。浏览器基础工具包括 `browser_navigate`、`browser_click`、`browser_fill`、`browser_extract_text` 和 `browser_screenshot`。`computer_use_task` 与 `browser_use_task` 会捕获截图、请求一个 GUI 模型动作、执行该动作并重复此过程，直到返回 `done` 或循环因边界停止。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

该包基于 `ctx.macosUse`、`ctx.browserUse`、`ctx.guiModel` 和 `ctx.attachments` 注册所有工具。`computer_get_window_state` 会签发不透明元素令牌；指针工具会重新解析令牌的当前中心点，并在更新快照或窗口几何变化后拒绝该令牌。存储图片前，该包会缩小副本，以满足附件字节、像素与边长限制，同时保留 GUI 定位所需的原始像素。

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
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-macos-use) — 从运行中插件收集的精确 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

驱动模型会看到生成的 [`computer_*`、`browser_*`、`computer_use_task` 与 `browser_use_task` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-macos-use)。GUI 提供方端点与凭据属于部署设置，不是模型参数。

#### Token 影响

包可见时，每个请求都会发送 22 个固定 schema；`defaultMaxSteps` 只会改变一个任务参数的说明。

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

- GUI 模型请求与决策发生在驱动会话日志之外。启用的每步截图是最终工具结果中的持久 UI 展示元数据，不是独立流式会话事件。
- 确认只对当前操作有效。该插件不会创建持久权限，也不会替代 macOS 的辅助功能与屏幕录制控制。
- GUI 模型请求失败会中止任务工具；没有重试、恢复或局部持久子步骤记录。
- 辅助功能元素质量因应用而异；没有有效边界的控件不能通过令牌定位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

当前 Harness 兼容性补丁会为嵌套在工具结果元数据中的图片引用增加授权与导出发现逻辑。把独立包集成进 Harness 时，请始终将这些核心更改与客户端渲染器配套使用。

</details>
