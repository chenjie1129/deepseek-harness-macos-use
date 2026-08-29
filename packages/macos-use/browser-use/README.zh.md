---
description: "基于 Playwright 的浏览器控制，供读者选择、配置或调试 browserUse seam 与自主浏览器任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-use

[English](README.md) | 中文

## 概述

`dsh-browser-use` 让智能体通过 DOM 选择器或截图坐标导航并操作一个真实 Chromium 页面。浏览器会延迟启动、跨调用复用，并随插件关闭。需要不依赖用户现有浏览器配置的受控网页交互时，请选择此包。它不会自行暴露工具；`dsh-tool-macos-use` 负责面向模型的浏览器工具与自主循环。

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

当智能体需要托管浏览器页面时，请在 `dsh-tool-macos-use` 之前挂载此能力。

### 何时选择

需要一个支持确定性选择器操作和截图坐标操作的隔离 Playwright 页面时，请选择此包。如果任务依赖用户的标签页、Cookie、扩展或已登录的 Chrome 状态，请使用连接到现有用户配置的浏览器集成。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-browser-use'
  config:
    headless: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `headless` | `true` | 启动不显示浏览器窗口的 Chromium |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-browser-use)是所有可接受字段的完整来源。

### 操作

`ctx.browserUse` 提供 `navigate`、`clickSelector`、`fillSelector`、`extractText`、`clickAt`、`moveAt`、`dragAt`、`type`、`key` 与 `screenshot`。失败会抛出带稳定代码的 `BrowserUseError`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`BrowserUseService` 拥有一个 Playwright 浏览器、上下文与页面。首次操作启动 Chromium，后续操作复用该页面。实时修改有头或无头模式会停用当前浏览器，使下一次操作按所选模式启动。释放插件会关闭页面上下文和浏览器。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务生命周期、配置与浏览器操作 |
| [`src/types.ts`](src/types.ts) | 请求、结果与稳定错误代码 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [macOS-use 包映射](../README.zh.md) — 包含四个包的能力系列。
- [工具包](../tool-macos-use/README.zh.md) — 面向模型的浏览器工具与任务循环。
- [GUI 模型包](../gui-model/README.zh.md) — 浏览器任务的截图定位动作决策。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@deepseek-ai/dsh-tool-macos-use`；浏览器工具 schema 与渲染结果由该包负责。

#### KV 缓存影响

该服务不直接注册提示词或 schema，因此加载它不会改变驱动模型可复用的请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 必须另行安装 Playwright Chromium：`pnpm exec playwright install chromium`；缺少浏览器时会在首次使用时抛出 `BROWSER_USE_LAUNCH_FAILED`。
- 仅支持一个浏览器上下文与一个页面；多标签页和多上下文工作流留待后续实现。
- `key` 使用 Playwright 键名，而不是 macOS 服务的 `cmd+shift+t` 风格词汇。
- 取消信号会在分派前检查，但无法通过该信号中断已经运行的 Playwright 操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

单元测试覆盖延迟启动、实时有头/无头切换、页面复用、指针移动和拖拽、释放、分派前取消与稳定错误代码。

</details>
