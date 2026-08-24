# Harness 集成指南

[English](integration.md) | 中文

## 支持的基线

随附补丁面向 DeepSeek Harness 提交 `141eb6fef83422698aef7a981029e843e8161534`（`0.1.0-rc.8`）。应用前请先运行 `git apply --check`。较新的 Harness 版本可能需要手工变基，因为设置卡片、包引用、生成目录和锁文件都可能变化。

## 补丁接入的内容

补丁会把四个包注册到 CLI／运行时闭包和 TypeScript 项目引用中，把 GUI 模型与 GUI 任务展示设置命名空间暴露给 Web 客户端，加入 GUI Model 与 GUI Tasks 设置卡片，在通用任务结果中渲染经过授权的仅 UI 每步图片，并将这些图片随 Session 导出；同时注册面向模型的工具与 Cordis 目录，更新锁文件和第三方声明，并加入同步的子系统、工具及配置文档。

补丁不会重复包含包源码。请在应用补丁前或之后，把 `packages/macos-use` 复制到 Harness 工作区。

## GUI 模型设置

在 `gui-model` 插件配置中设置：

```yaml
config:
  apiKeyEnv: GUI_MODEL_API_KEY
  baseURL: https://api.example.com/v1
  model: your-vision-model
  maxOutputTokens: 512
```

`baseURL` 和 `model` 必填，服务会在基础 URL 后追加 `/chat/completions`。请优先通过 `apiKeyEnv` 引用凭据，不要提交明文 API Key。

## 桌面与浏览器设置

`macos-use` 可设置 `commandTimeoutMs`，`browser-use` 可设置 `headless`，`tool-macos-use` 可设置 `defaultMaxSteps`，并提供实时 `showStepScreenshots` 开关。该开关默认为 `true`；开启时，每个存在的任务步骤截图都会被保存并随该步输出显示。关闭后会省略每步图片，但保留最终截图引用。具体默认行为见各包 README。

请在集成后的 Harness 工作区安装 Chromium：

```bash
corepack pnpm exec playwright install chromium
```

需要给启动 Harness 的进程授予“辅助功能”和“屏幕录制”权限。截图像素坐标与 macOS 屏幕点之间尚未针对 Retina 或多显示器布局自动换算。

## 安全边界

插件可以执行任意 AppleScript，并控制桌面和浏览器界面。应继续通过 Harness 的部署策略和审批界面限制这些工具。插件本身不会授予或持久化操作系统权限。GUI 模型截图与中间决策不会成为独立持久化 Session 事件。启用的每步图片会作为最终工具结果中的、经过授权的仅 UI 展示附件保存，并随 Session 导出；驱动模型仍然只接收文本。

## 已完成的验证

在支持的基线上，聚焦功能测试、包含 3,965 个通过用例的 GUI 套件、生产构建、契约 lint、28 项文档检查、空白检查和定向 TypeScript 构建均通过。组装后的 Web 回放成功构建；运行结果为 79 个通过、1 个跳过和 3 个无关的既有失败（官方 Logo 快照、Node 22 开发加载器以及现有 plan-review golden）。真实视觉提供方和真实 GUI 端到端测试未执行，因为它们需要凭据和 macOS 权限。
