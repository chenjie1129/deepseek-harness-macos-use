# @deepseek-ai/dsh-macos-use

[English](README.md) | 中文

macOS 桌面控制能力接缝（`ctx.macosUse`），通过 `screencapture` 提供全屏截图，通过 AppleScript 和 System Events 提供 GUI 自动化，通过 `open` 启动应用，并支持直接执行 AppleScript。由于此实现没有可替换后端，服务与具体提供方位于同一个包中。

## API

`MacosUseService` 是默认导出，并注册为 `ctx.macosUse`：

- `screenshot(signal?)` -> `{ pngBase64 }`
- `click({ x, y, button?, doubleClick?, modifiers? }, signal?)`
- `type({ text }, signal?)`
- `key({ combo }, signal?)` 使用 `return`、`escape`、`cmd+shift+t` 或 `a` 等组合键
- `scroll({ direction, amount? }, signal?)`
- `openApp({ name }, signal?)`
- `runAppleScript({ script } | script, signal?)` -> stdout
- `frontmostApp(signal?)` -> 前台进程名称

所有命令都通过 `ctx.subprocess` 运行，并受 `commandTimeoutMs` 限制。失败会抛出带稳定 `code` 的 `MacosUseError`。

## 配置

```yaml
config:
  commandTimeoutMs: 15000 # optional
```

## 模型体验

间接地，通过 `@deepseek-ai/dsh-tool-macos-use`；桌面控制工具 schema 与渲染结果由该包负责。

#### KV 缓存影响

该服务不直接注册提示词或 schema，因此加载它不会改变驱动模型可复用的请求前缀。

## 已知限制与后续工作

- 宿主进程需要“辅助功能”权限才能进行 GUI 自动化，需要“屏幕录制”权限才能截图；拒绝授权会使对应调用失败。
- System Events 发送合成的辅助功能操作，因此忽略这些事件的应用可能不会响应。
- GUI 模型坐标指向截图像素，而 System Events 点击使用屏幕点；Retina 缩放与多显示器布局不会自动归一化。
- AppleScript 构造器和服务行为已有聚焦测试，但真实 macOS GUI 端到端套件留待后续实现。
