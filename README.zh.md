# DeepSeek Harness macOS Use 插件

[English](README.md) | 中文

本仓库仅包含为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 开发的 macOS GUI／浏览器控制插件。它由四个能力包组成，不是 Harness 完整单体仓库的副本，也不是可独立运行的应用。

## 包含的包

| 包 | Harness 能力 | 用途 |
|---|---|---|
| [`@deepseek-ai/dsh-macos-use`](packages/macos-use/macos-use) | `ctx.macosUse` | 在全黑显示器坐标画布上呈现已授权前台窗口、精确窗口截图、应用／窗口发现、辅助功能状态和目标受约束的原生操作 |
| [`@deepseek-ai/dsh-browser-use`](packages/macos-use/browser-use) | `ctx.browserUse` | 可实时配置的 Playwright Chromium 导航、选择器／坐标操作、拖动与截图 |
| [`@deepseek-ai/dsh-gui-model`](packages/macos-use/gui-model) | `ctx.guiModel` | 调用兼容 OpenAI 的视觉端点，把截图转换成经过校验的 GUI 动作 |
| [`@deepseek-ai/dsh-tool-macos-use`](packages/macos-use/tool-macos-use) | 面向模型的工具 | 桌面／浏览器基础工具，以及有步骤上限的 `computer_use_task`／`browser_use_task` 循环 |

## P0 可靠性与安全

插件提供 21 个面向模型的工具，包括应用／窗口发现、精确窗口截图、语义辅助功能快照、会过期的元素令牌、指针移动与拖动、聚焦、滚动、中止，以及有边界的桌面／浏览器任务循环。自主任务具有总超时、单任务锁和紧急停止能力。插件有意不向模型暴露调用方自定义的任意 AppleScript。无法可靠校验的动作会停止任务，而不是猜测或静默替换。

所有可调整的智能体配置都能在 Harness 的**插件配置**页面中可视化完成。GUI 模型卡包含 API 凭据引用、端点、模型和响应上限；GUI 智能体卡包含步骤与超时限制、语义快照大小、浏览器可见性和网络授权、精确的应用读取／控制授权、拒绝规则、确认控制、单任务锁、截图隐私排除项和紧急停止。网络和应用授权为空时默认拒绝。**每个 GUI 变更动作都确认**默认开启，每次直接或模型选择的 GUI 变更动作都会单独询问。只有当部署具备等效、可信的安全或审批边界时，才应有意关闭它；关闭后仍会进行启发式破坏性动作确认，但这种启发式规则不能保证坐标动作的语义效果。**显示每步截图**也默认开启：当某一步存在截图时，图片会被保存，并与该步的用户输出一起显示；插件能够结构化返回的停止／错误结果也保留已有步骤截图。关闭后不会保存或展示这些每步图片，但不会影响 GUI 模型私下用于定位的截图，也不会移除最终截图引用。

Retina 和其他超大截图只会在持久展示存储前按当前附件限制缩小。显示器坐标观察绝不会捕获完整显示器：原生服务只截取经过精确授权的前台窗口，再把它合成到其余像素全黑的主显示器画布上。只有新鲜且绑定 owner 的观察通过验证后，PNG 像素才会依据捕获几何转换成全局 macOS point。前台窗口位于副屏、跨屏或部分超出主屏时会被拒绝，不会依据不完整像素执行操作。所有原生变更共用一个服务级队列与 mutation epoch；任一动作一旦分派，就会使包括其他 Agent 所有观察在内的陈旧桌面观察失效。

浏览器流量会被强制送入每个服务实例独有、带随机认证的环回代理。每条出站连接都会重新校验原始主机名，只解析一次；除非明确开启私有网络访问，只要解析答案中存在任一非公网地址，就拒绝整个结果集；随后把 socket 固定到选中的数字 IP，同时保留原始 Host 头和 TLS SNI。Chromium 的 DNS 退路、隐式环回代理绕过、QUIC、Worker、WebRTC 与 WebTransport 都会被禁用。基于截图坐标的动作会先消费令牌，并在分派前立即比较新鲜视口摘要。这些控制关闭了已知的浏览器内 DNS rebinding 路径，但不能替代操作系统或容器防火墙。

面向用户的实时进度与持久任务输出会把 `type` 动作的文本载荷脱敏为字符数，避免在动作历史中回显键入内容；这不表示截图里本来可见的文字也会被遮盖。只有当宿主侧请求的后置条件在新鲜的浏览器或 macOS 完成快照上通过校验，任务才会标记为完成。最终结果从这份原子的完成快照组装，不会混用不同时刻的观察。

## 兼容性

已经证明的源码集成基线是 DeepSeek Harness `0.1.2-alpha.1` 发布版提交 [`cd5ef81`](https://github.com/deepseek-ai/deepseek-harness/commit/cd5ef8148158c3a752a658978873241fdf8e2bbc)。上游最新发布版是 [`0.1.2-alpha.5`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5)，但在精确源码通过编译、构建、启动与聚焦集成门禁前，本仓库不宣称兼容 alpha.5。各包清单有意保留 Harness 的 `workspace:^` 依赖，因为这些包需要与 Harness 组合。

## 推荐的仅挂载集成

请在能够解析这四个插件包的兼容 Harness 工作区中使用挂载补丁，并从 Harness 根目录运行：

```bash
plugin_root=/absolute/path/to/deepseek-harness-macos-use
export DSH_HOME="$(mktemp -d /private/tmp/dsh-macos-profile.XXXXXX)"
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml" --dump-config
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml"
```

预检输出必须包含 `macos-use`、`browser-use`、`gui-model` 与 `tool-macos-use`。[`integration/macos-use.cordis.patch.yml`](integration/macos-use.cordis.patch.yml) 只挂载这四项服务，包含的**可调智能体配置为零**。启动后，请在**插件配置**页面中可视化完成模型、凭据、网络、应用、安全、超时与截图的全部选择。重新启动时继续使用同一个 `DSH_HOME`，以便 Harness 复用这些可视化设置。

## 开发者源码集成

1. 检出兼容的 Harness 提交。
2. 把本仓库的 `packages/macos-use` 目录复制到 Harness 的同一路径。
3. 在 Harness 根目录检查并应用 [`integration/deepseek-harness-v0.1.2-alpha.1.patch`](integration/deepseek-harness-v0.1.2-alpha.1.patch)。
4. 安装依赖、构建并运行聚焦测试：

```bash
git checkout cd5ef8148158c3a752a658978873241fdf8e2bbc
cp -R /path/to/deepseek-harness-macos-use/packages/macos-use ./packages/
git apply --check /path/to/deepseek-harness-macos-use/integration/deepseek-harness-v0.1.2-alpha.1.patch
git apply /path/to/deepseek-harness-macos-use/integration/deepseek-harness-v0.1.2-alpha.1.patch
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm exec vitest run packages/macos-use/*/tests/*.spec.ts packages/macos-use/*/tests/*.spec.tsx
corepack pnpm exec playwright install chromium
```

配置、安全边界和验证证据请参阅[集成指南](docs/integration.zh.md)与[架构决策](docs/architecture.zh.md)。

## 从用户提示词开始评测

本仓库包含一个[提示词级评测运行器](evaluations/README.zh.md)。它把原样自然语言提示词送入全新的 Harness SDK 会话，记录工具与每步截图展示证据，再通过独立 HTTP 或工作区文件判定器评分。确定性冒烟测试无需第三方凭据即可走通真实 Playwright 与截图路径；真实模式则复用在插件配置页面中可视化完成的 GUI 模型与 GUI 智能体设置。

## 运行要求

- GUI 操作需要 macOS“辅助功能”权限。
- 截图需要 macOS“屏幕录制”权限。
- `gui-model` 需要配置兼容 OpenAI 的视觉端点。
- 浏览器控制需要安装 Playwright Chromium。

## 当前验证边界

在当前源码冻结点，插件 Vitest 门禁在 **23 个文件中通过 346 项测试**，插件 Host 与 Client TypeScript 项目以及完整集成 Harness 构建也在已证明的 alpha.1 基线上通过。这些检查覆盖配置、策略、生命周期、动作、进度、附件元数据、截图开关与输出脱敏。独立的提示词评测器在 **8 个文件中通过 19 项测试**，其确定性“提示词到浏览器”冒烟测试也通过了独立 HTTP 判定器。

专用 Playwright Chromium 渲染夹具会打包实际的 `SettingsCards` 与 `GuiTaskView` 组件。它已验证所有配置控件、默认开启的安全／截图开关、开启截图时有 1 张步骤图片、关闭时为 0 张，以及无控制台、请求或水平溢出问题。

这些证据**不宣称**已完成解锁原生 macOS 应用后的截图／动作 E2E、alpha.5 精确源码的编译／构建／启动兼容性，或真实第三方主模型／GUI 模型运行。这些门禁分别需要相应的宿主状态、精确上游源码或提供方凭据，执行后应单独报告。
