# DeepSeek Harness macOS Use 插件

[English](README.md) | 中文

本仓库仅包含为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 开发的 macOS GUI／浏览器控制插件。它由四个能力包组成，不是 Harness 完整单体仓库的副本，也不是可独立运行的应用。

## 包含的包

| 包 | Harness 能力 | 用途 |
|---|---|---|
| [`@deepseek-ai/dsh-macos-use`](packages/macos-use/macos-use) | `ctx.macosUse` | 截图、System Events 自动化、启动应用和执行 AppleScript |
| [`@deepseek-ai/dsh-browser-use`](packages/macos-use/browser-use) | `ctx.browserUse` | 通过 Playwright Chromium 导航、选择器操作、坐标操作与截图 |
| [`@deepseek-ai/dsh-gui-model`](packages/macos-use/gui-model) | `ctx.guiModel` | 调用兼容 OpenAI 的视觉端点，把截图转换成经过校验的 GUI 动作 |
| [`@deepseek-ai/dsh-tool-macos-use`](packages/macos-use/tool-macos-use) | 面向模型的工具 | 桌面／浏览器基础工具，以及有步骤上限的 `computer_use_task`／`browser_use_task` 循环 |

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

在兼容基线上，聚焦测试、完整 Harness 构建、lint、文档、仓库卫生和类型检查均已通过。真实视觉提供方兼容性以及桌面／浏览器端到端测试，仍需要部署凭据和操作系统权限。
