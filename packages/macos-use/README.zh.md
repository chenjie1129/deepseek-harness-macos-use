# macos-use

[English](README.md) | 中文

“Mac OS Use Agent Tools”是一组能力接缝包，让智能体通过 macOS API、GUI 自动化和真实受控浏览器直接操作本地计算机，而不再只依赖文件系统和 shell。

| 包 | `ctx` 键 | 角色 |
|---|---|---|
| [`macos-use`](macos-use/README.md) | `macosUse` | 截图、System Events GUI 自动化、应用启动与 AppleScript |
| [`gui-model`](gui-model/README.md) | `guiModel` | 调用已配置的 OpenAI 兼容视觉端点，根据截图选择下一步 GUI 动作 |
| [`browser-use`](browser-use/README.md) | `browserUse` | 运行 Playwright 驱动的 Chromium 标签页，支持选择器与坐标操作 |
| [`tool-macos-use`](tool-macos-use/README.md) | — | 注册面向模型的基础工具以及 `computer_use_task` / `browser_use_task` 循环 |

## 配置 GUI 模型

`gui-model` 在常规插件配置界面提供可实时更新的 `apiKeyEnv`、`baseURL`、`model` 与 `maxOutputTokens` 设置。请将 `baseURL` 指向 OpenAI 兼容的视觉 chat-completions 端点，并优先通过 `apiKeyEnv` 使用凭据引用，而不是写入明文密钥。

## 已知限制与后续工作

- 这组包已有聚焦的单元测试，并参与仓库构建与文档门禁，但尚无无需密钥的组装 GUI 快照，也没有真实桌面或浏览器端到端测试套件。
- 桌面自动化需要为宿主进程授予“辅助功能”权限，截图需要在“系统设置”中授予“屏幕录制”权限。
- 浏览器自动化要求另行安装 Playwright Chromium：`pnpm exec playwright install chromium`。
