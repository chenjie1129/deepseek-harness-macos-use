# @deepseek-ai/dsh-macos-use

[English](README.md) | 中文

macOS 桌面控制能力接缝（`ctx.macosUse`），支持脱敏全屏与精确窗口截图、应用和窗口发现、扁平无障碍状态、CoreGraphics 指针移动和拖拽、System Events GUI 自动化、应用启动以及直接执行 AppleScript。由于此实现没有可替换后端，服务与具体提供方位于同一个包中。

## API

`MacosUseService` 是默认导出，并注册为 `ctx.macosUse`：

- `screenshot(signal?)` -> `{ pngBase64 }`
- `listApps(signal?)` -> 运行中应用元数据
- `listWindows(signal?)` -> 屏幕上窗口元数据与边界
- `screenshotWindow({ windowId?, app?, title? }, signal?)` -> 精确窗口 PNG
- `windowState({ windowId?, app?, title?, maxElements? }, signal?)` -> 窗口元数据与扁平无障碍元素
- `click({ x, y, button?, doubleClick?, modifiers? }, signal?)`
- `move({ x, y }, signal?)`
- `drag({ x, y, toX, toY }, signal?)`
- `type({ text }, signal?)`
- `key({ combo }, signal?)` 使用 `return`、`escape`、`cmd+shift+t` 或 `a` 等组合键
- `scroll({ direction, amount? }, signal?)`
- `openApp({ name }, signal?)`
- `focusWindow({ windowId?, app?, title? }, signal?)`
- `runAppleScript({ script } | script, signal?)` -> stdout
- `frontmostApp(signal?)` -> 前台进程名称

所有命令都通过 `ctx.subprocess` 运行，并受 `commandTimeoutMs` 限制。失败会抛出带稳定 `code` 的 `MacosUseError`。

## 配置

```yaml
config:
  commandTimeoutMs: 15000 # optional
  allowedApps: [] # optional; empty permits every app not denied
  deniedApps: [] # optional; evaluated before allowedApps
  excludedScreenshotApps: [] # optional; matching windows are masked
  maxElementsPerSnapshot: 250 # optional
```

## 模型体验

间接地，通过 `@deepseek-ai/dsh-tool-macos-use`；桌面控制工具 schema 与渲染结果由该包负责。

#### KV 缓存影响

该服务不直接注册提示词或 schema，因此加载它不会改变驱动模型可复用的请求前缀。

## 已知限制与后续工作

- 宿主进程需要“辅助功能”权限才能进行 GUI 自动化和语义状态读取，需要“屏幕录制”权限才能截图；拒绝授权会使对应调用失败。
- System Events 发送合成的辅助功能操作，因此忽略这些事件的应用可能不会响应。
- 没有可用边界的无障碍元素仍可观察，但不能生成坐标目标。
