# DeepSeek Harness macOS Use 插件

[English](README.md) | 中文

本仓库仅包含为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 开发的 macOS GUI／浏览器控制插件。它由四个能力包组成，不是 Harness 完整单体仓库的副本，也不是可独立运行的应用。

## 包含的包

| 包 | Harness 能力 | 用途 |
|---|---|---|
| [`@deepseek-ai/dsh-macos-use`](packages/macos-use/macos-use) | `ctx.macosUse` | 脱敏全屏与精确窗口截图、应用／窗口发现、辅助功能状态、指针操作和 AppleScript |
| [`@deepseek-ai/dsh-browser-use`](packages/macos-use/browser-use) | `ctx.browserUse` | 可实时配置的 Playwright Chromium 导航、选择器／坐标操作、拖动与截图 |
| [`@deepseek-ai/dsh-gui-model`](packages/macos-use/gui-model) | `ctx.guiModel` | 调用兼容 OpenAI 的视觉端点，把截图转换成经过校验的 GUI 动作 |
| [`@deepseek-ai/dsh-tool-macos-use`](packages/macos-use/tool-macos-use) | 面向模型的工具 | 桌面／浏览器基础工具，以及有步骤上限的 `computer_use_task`／`browser_use_task` 循环 |

## P0 可靠性与安全

插件提供 22 个面向模型的工具，包括应用／窗口发现、精确窗口截图、语义辅助功能快照、会过期的元素令牌、指针移动与拖动、聚焦、滚动、中止，以及有边界的桌面／浏览器任务循环。自主任务具有总超时、单任务锁和紧急停止能力。

所有可调整的智能体配置都能在 Harness 的**插件配置**页面中可视化完成。GUI 模型卡包含 API 凭据引用、端点、模型和响应上限；GUI 智能体卡包含步骤与超时限制、语义快照大小、浏览器可见性、应用允许／拒绝列表、确认控制、单任务锁、截图隐私排除项和紧急停止。**显示每步截图**默认开启：当某一步存在截图时，图片会被保存，并与该步的用户输出一起显示。关闭后不会保存或展示这些每步图片，但不会影响 GUI 模型私下用于定位的截图，也不会移除最终截图引用。

Retina 和其他超大截图只会在持久展示存储前按当前附件限制缩小。GUI 操作仍由原始截图定位，因此规范化不会改变动作坐标系。

## 兼容性

源码与集成补丁已在 DeepSeek Harness `0.1.0-rc.8` 发布基线提交 [`141eb6f`](https://github.com/deepseek-ai/deepseek-harness/commit/141eb6fef83422698aef7a981029e843e8161534) 上验证。各包清单有意保留 Harness 的 `workspace:^` 依赖，因为这些包需要组合进 Harness 工作区。

## 集成到 Harness

1. 检出兼容的 Harness 提交。
2. 把本仓库的 `packages/macos-use` 目录复制到 Harness 的同一路径。
3. 在 Harness 根目录检查并应用 [`integration/deepseek-harness-rc8.patch`](integration/deepseek-harness-rc8.patch)。
4. 安装依赖、构建并运行聚焦测试：

```bash
git checkout 141eb6fef83422698aef7a981029e843e8161534
cp -R /path/to/deepseek-harness-macos-use/packages/macos-use ./packages/
git apply --check /path/to/deepseek-harness-macos-use/integration/deepseek-harness-rc8.patch
git apply /path/to/deepseek-harness-macos-use/integration/deepseek-harness-rc8.patch
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm exec vitest run packages/macos-use/*/tests/*.spec.ts
corepack pnpm exec playwright install chromium
```

配置、安全边界和验证证据请参阅[集成指南](docs/integration.zh.md)与[架构决策](docs/architecture.zh.md)。

## 运行要求

- GUI 操作需要 macOS“辅助功能”权限。
- 截图需要 macOS“屏幕录制”权限。
- `gui-model` 需要配置兼容 OpenAI 的视觉端点。
- 浏览器控制需要安装 Playwright Chromium。

## 当前限制

在兼容基线上，P0 聚焦测试通过 121 项，完整 GUI 套件通过 3,968 项并跳过 1 项，生产构建通过，全部 28 项文档门禁也通过。干净 profile 的 UI 冒烟使用真实 macOS 截图服务和确定性的本地视觉端点：GUI 模型收到 PNG，Harness 在第 1 步内联显示了 2000×1125 图片。同一次浏览器检查也确认全部智能体配置都位于可视化插件配置页面。组装后的 Web 回放成功构建，通过 79 个文件并跳过 1 个；仍有 3 个与本插件变更无关的既有回放预期失败。真实第三方提供方兼容性以及会执行动作的桌面／浏览器端到端测试，仍需要部署凭据和合适的操作系统权限。
