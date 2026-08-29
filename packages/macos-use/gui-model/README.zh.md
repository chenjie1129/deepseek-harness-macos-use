---
description: "OpenAI 兼容截图定位，供读者选择、配置或调试独立 GUI 视觉模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gui-model

[English](README.md) | 中文

## 概述

`dsh-gui-model` 把任务、历史动作与当前截图发送到 OpenAI 兼容 chat-completions 端点，并返回一个经过校验的 GUI 动作。部署可以借此使用独立于驱动智能体模型的视觉模型。需要 `dsh-tool-macos-use` 中的自主计算机和浏览器循环时，请选择此包；基础 GUI 工具不需要它。该包没有默认提供方或模型，也不会重试。

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

请先使用明确的 OpenAI 兼容端点与视觉模型挂载此能力，再挂载任务工具包。

### 何时选择

当每个 GUI 步骤可以由 OpenAI 兼容视觉端点决定，并且该端点可独立于驱动模型配置时，请选择此包。如果没有兼容视觉端点，请勿使用自主任务循环，而应使用基础桌面或浏览器工具。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-gui-model'
  config:
    apiKeyEnv: GUI_MODEL_API_KEY
    baseURL: https://api.example.com/v1
    model: some-vision-model
    maxOutputTokens: 512
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `GUI_MODEL_API_KEY` | 每次请求都会解析的凭据引用 |
| `baseURL` | 必填 | 端点基址；该包会追加 `/chat/completions` |
| `model` | 必填 | 支持视觉的模型名称 |
| `maxOutputTokens` | `512` | 一个动作对象的响应 token 上限 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-gui-model)是所有可接受字段的完整来源。全部四项配置都可在 GUI 模型卡片中可视化管理；密钥通过凭据 seam 保存，不会在设置响应中返回。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

每次 `nextAction` 调用都会解析当前设置、发送一个确定性的 chat-completions 请求、从回答中提取第一个括号配对完整的 JSON 对象，并校验所选动作的必填字段。结果是 `click`、`drag`、`type`、`key`、`open_app`、`focus_window`、`wait` 或 `done` 等 `GuiAction`。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、实时设置、凭据查找与 HTTP 请求 |
| [`src/parse.ts`](src/parse.ts) | 系统指令、用户提示词、JSON 提取与动作校验 |
| [`src/types.ts`](src/types.ts) | 动作约定与稳定错误 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [macOS-use 包映射](../README.zh.md) — 包含四个包的能力系列。
- [工具包](../tool-macos-use/README.zh.md) — 使用此服务的自主循环。
- [桌面能力包](../macos-use/README.zh.md) — 原生截图与桌面操作。

-----

<a id="model-experience"></a>
## 模型体验

### 独立 GUI 模型请求

#### 模型看到的内容

每次 `nextAction` 调用都会把下方稳定系统指令、任务、历史动作与当前 PNG 截图发送给已配置的视觉提供方。该请求位于驱动智能体会话日志之外。

##### GUI 定位系统指令

```markdown
You are a GUI grounding model. You are given a screenshot and a task. Respond with exactly one JSON object describing the single next action to take toward completing the task — no prose, no markdown fences, just the JSON object. Its shape is:
{"kind": "click"|"double_click"|"right_click"|"move"|"drag"|"type"|"key"|"scroll"|"open_app"|"focus_window"|"wait"|"done", "x"?: number, "y"?: number, "toX"?: number, "toY"?: number, "text"?: string, "combo"?: string, "app"?: string, "windowTitle"?: string, "direction"?: "up"|"down"|"left"|"right", "amount"?: number, "ms"?: number, "summary"?: string, "reason"?: string}
"x"/"y" are pixel coordinates in the screenshot for click/double_click/right_click/move and the drag start; "toX"/"toY" are the drag destination. "text" is literal text to type. "combo" is a key or modifier combo like "return" or "cmd+shift+t". "app" names an application for open_app/focus_window; "windowTitle" narrows focus_window. "direction"/"amount" are for scroll. "ms" is a pause duration for wait. Choose "done" with a "summary" only once the task is fully accomplished.
```

#### Token 影响

每个步骤都是独立模型请求，输入会随任务与历史增长并包含 base64 截图；`maxOutputTokens` 限制响应长度。

#### KV 缓存影响

该请求独立于驱动模型缓存。仅当提供方、模型和前缀字节保持不变时，提供方才可能复用稳定的系统指令与任务历史前缀；当前截图和不断增长的历史会改变后缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- `baseURL` 和 `model` 没有默认值；配置错误会明确失败，而不会猜测提供方。
- 瞬态请求失败没有重试或退避，会立即中止调用它的任务工具。
- 解析器会恢复第一个括号配对完整的 JSON 对象并校验动作必填字段，但不会拒绝所有未知可选字段，也无法判断坐标在语义上是否合适。
- 已有聚焦的请求和解析器测试，但实时第三方提供方兼容性仍需由部署验证。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

确定性兼容性端到端测试使用本地 OpenAI 兼容响应服务器；它证明请求与循环集成，但不声称完成了第三方提供方端到端测试。

</details>
