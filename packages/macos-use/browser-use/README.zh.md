---
description: "基于 Playwright 的浏览器控制，供读者选择、配置或调试 browserUse seam 与自主浏览器任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-use

[English](README.md) | 中文

## 概述

`dsh-browser-use` 让智能体通过 DOM 选择器或截图坐标导航并操作真实 Chromium 页面。Chromium 会延迟启动；每个 Harness Agent 都有隔离的浏览器上下文、页面、Cookie 与截图 observation。需要不依赖用户现有浏览器配置的受控网页交互时，请选择此包。它不会自行暴露工具；`dsh-tool-macos-use` 负责面向模型的浏览器工具与自主循环。

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

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-browser-use'
```

有头／无头模式、网络授权、拒绝项和私有网络访问全部由插件配置页面的 **GUI 智能体**卡片可视化管理，无需在 YAML 中重复任何可调浏览器智能体参数。集成后的 Harness 文档生成器会从同一份实时 schema 生成完整配置目录。浏览器默认拒绝：允许域名留空会禁用网络导航；访问私网、环回与链路本地地址还必须单独开启私网开关。实时收紧任何网络设置都会立即停用所有已加载的浏览器上下文。

### 操作

`ctx.browserUse` 提供 `navigate`、`clickSelector`、`fillSelector`、`extractText`、`clickAt`、`moveAt`、`dragAt`、`scroll`、`type`、`key`、`screenshot` 与 `pageState`。可信工具适配层会在每次请求中加入当前 Agent 身份，模型参数不能选择它。页面文本默认最多返回 20,000 个字符，并在跨越页面／宿主边界前强制限制在 100,000 个字符以内；完成校验使用的标题和 URL 也有上限。坐标与键盘动作必须使用该 Agent 最新截图的 token；token 会在分派前消耗、在 60 秒后失效，并在动作前立即与新鲜视口摘要比较。失败会抛出带稳定代码的 `BrowserUseError`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`BrowserUseService` 拥有一个 Playwright 浏览器进程，以及按 owner 索引的隔离上下文／页面。某 Agent 首次操作时创建上下文，后续操作复用自己的页面。实时修改有头／无头或网络策略会停用全部上下文，使后续操作按新策略启动。释放插件会关闭全部上下文与浏览器。

每个 HTTP(S) 请求和 WebSocket 握手都会经过域名／私网策略，并强制通过每个服务实例独享且带随机认证的环回代理。每次建立外连时，代理先校验原始主机名，只解析一次；若未开启私网访问，只要解析结果中出现任一私有地址就拒绝；随后直接连接所选数字 IP，同时保留原始 Host 与 TLS SNI。Chromium 的隐式环回绕过、浏览器侧 DNS 回退和 QUIC 均被禁用。Service Worker、Dedicated Worker 与 Shared Worker 均被禁用，页面代码无法把传输移入不受路由保护的 realm；WebRTC 构造器会被移除，WebTransport 同时通过 Blink 启动参数和每个页面 realm 禁用。这些防护关闭了已知 DNS rebinding 缺口并缩小浏览器权限，但不等同于操作系统级网络沙箱；隔离对抗性网站时仍应保留操作系统或容器防火墙。

服务会在分派 Playwright 动作前订阅 AbortSignal。取消会停用并关闭该 Agent 自己的浏览器上下文，从而中断进行中的导航或输入，不影响其他 Agent；该 Agent 下一次调用会得到新上下文。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务生命周期、配置与浏览器操作 |
| [`src/pinned-proxy.ts`](src/pinned-proxy.ts) | 带认证的环回出口、单次解析地址固定与 socket 边界 |
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
- 每个 Agent 只支持一个页面；多标签页工作流留待后续实现。
- `key` 使用 Playwright 键名，而不是 macOS 服务的 `cmd+shift+t` 风格词汇。
- Dedicated Worker 与 Shared Worker 有意不可用，因为 Playwright 路由无法完整约束它们独立的联网 realm。
- 精确视口摘要绑定会有意拒绝任何像素发生变化后的截图派生动作；动态页面需要重新截图并重新决策，不能重试旧动作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

单元测试覆盖延迟启动、owner 隔离、实时策略切换、页面复用、URL／子资源／WebSocket 过滤、Worker／WebTransport 禁用、私网解析、一次性／过期 observation token、并发重放、指针移动与拖拽、释放、分派前与进行中取消，以及稳定错误代码。

</details>
