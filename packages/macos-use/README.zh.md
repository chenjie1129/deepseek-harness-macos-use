---
description: "macOS-use 包组：面向计算机操作智能体的本地桌面、浏览器、GUI 模型与模型工具包。"
kind: "package-group"
---

# macos-use/ — macOS 与浏览器计算机操作

[English](README.md) | 中文

## 概述

该包组让智能体操作本地 Mac 和隔离的 Chromium 页面、检查 macOS 辅助功能状态，并把截图定位委托给 OpenAI 兼容视觉模型。`macos-use` 负责原生桌面控制，`browser-use` 负责每个 Agent 的托管浏览器上下文，`gui-model` 负责视觉决策，`tool-macos-use` 则把这些能力提供给智能体。所有可调整的智能体设置都显示在插件配置页面中，包括默认拒绝的应用／网络授权、默认开启的每次 GUI 变更确认、默认开启的每步截图开关与紧急停止。只有当部署具备等效、可信的安全或审批边界时，才应关闭每次变更确认。包边界不会绕过 macOS 权限、应用策略或用户确认。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

请根据所需行为选择对应的包；工具包会组合全部三种能力 seam。

| 包 | `ctx` 键 | 作用 |
|---|---|---|
| [`macos-use`](macos-use/README.zh.md) | `macosUse` | 只捕获精确授权的前台／窗口像素，并控制策略允许的 macOS 应用与窗口 |
| [`gui-model`](gui-model/README.zh.md) | `guiModel` | 根据截图与任务选择一个经过校验的 GUI 动作 |
| [`browser-use`](browser-use/README.zh.md) | `browserUse` | 通过 DNS 固定的策略代理，为每个 Agent 驱动隔离的 Playwright Chromium 上下文／页面 |
| [`tool-macos-use`](tool-macos-use/README.zh.md) | — | 注册基础工具、自主任务循环、可视化设置与截图展示 |

<a id="related-documentation"></a>
## 相关文档

- [仓库架构](../../docs/architecture.zh.md) — 集成边界与当前 Harness 兼容性。
- [工具运行时子系统](../../docs/subsystems/tools.zh.md) — 集成后生成的服务与工具运行时约定。
- [工具包](tool-macos-use/README.zh.md) — 可视化配置、安全策略与面向模型的工具。
- [GUI 模型包](gui-model/README.zh.md) — 独立的截图定位请求边界。

<a id="dev-note"></a>
## 开发备注

无。
