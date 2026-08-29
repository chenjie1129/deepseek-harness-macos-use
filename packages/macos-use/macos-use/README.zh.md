---
description: "面向计算机操作智能体的原生 macOS 截图、辅助功能、指针、键盘、窗口、应用与 AppleScript 控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-macos-use

[English](README.md) | 中文

## 概述

`dsh-macos-use` 让智能体通过原生截图、辅助功能元数据、CoreGraphics 指针操作、System Events、应用启动与 AppleScript 观察并控制策略允许的 macOS 应用。它可以捕获脱敏全屏或一个精确窗口，也可以根据前台窗口的辅助功能树签发不透明元素令牌。需要本地 Mac 控制时，请选择此包；它本身不会暴露工具或作出自主决策。macOS 辅助功能与屏幕录制权限仍是强制要求。

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

请在本地子进程提供方之后、`dsh-tool-macos-use` 之前挂载此能力。

### 何时选择

当部署运行于 macOS，并且宿主进程可以获得辅助功能与屏幕录制权限时，请选择此包。对于非 macOS 宿主，或原生 GUI 控制不在部署信任边界内的场景，请勿使用。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-macos-use'
  config:
    commandTimeoutMs: 15000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `commandTimeoutMs` | `15,000` | 单条原生命令的截止时间 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-macos-use)是所有可接受字段的完整来源。应用允许与拒绝列表、截图排除项和辅助功能元素预算，是插件配置页面中的实时工具包设置。

### 操作

`ctx.macosUse` 提供全屏与精确窗口截图；应用、窗口和辅助功能发现；点击、移动、拖拽、输入、按键与滚动操作；应用启动；精确窗口聚焦；AppleScript；以及前台应用查询。失败会抛出带稳定代码的 `MacosUseError`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`MacosUseService` 通过 `ctx.subprocess` 执行明确的原生命令。截图使用 `screencapture`；窗口与应用检查使用 CoreGraphics 和 System Events 脚本；指针移动与拖拽使用 CoreGraphics；其余 GUI 操作使用 System Events。该服务会先应用当前应用策略与截图脱敏策略，再返回观察结果或分派操作。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务生命周期、策略、截图与操作方法 |
| [`src/native.ts`](src/native.ts) | 原生枚举、辅助功能、聚焦与指针脚本 |
| [`src/applescript.ts`](src/applescript.ts) | System Events 操作脚本 |
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

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

该服务与具体提供方位于同一个包中，因为此实现没有可替换后端。

</details>
