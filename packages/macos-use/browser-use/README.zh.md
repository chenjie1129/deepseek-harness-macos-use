# @deepseek-ai/dsh-browser-use

[English](README.md) | 中文

由单个 Playwright Chromium 页面支持的浏览器控制能力接缝（`ctx.browserUse`）。浏览器在首次使用时延迟启动，跨调用复用，并在插件释放时关闭。该服务同时支持 DOM 选择器操作和坐标定位操作，供 `@deepseek-ai/dsh-tool-macos-use` 中的 `browser_use_task` 使用。

## API

`BrowserUseService` 是默认导出，并注册为 `ctx.browserUse`：

- `navigate({ url }, signal?)`
- `clickSelector({ selector }, signal?)`
- `fillSelector({ selector, text }, signal?)`
- `extractText({ selector? }, signal?)` -> text
- `clickAt({ x, y, doubleClick? }, signal?)`
- `type({ text }, signal?)`
- `key({ key }, signal?)` 使用 Playwright 键名，例如 `Enter` 和 `Control+A`
- `screenshot(signal?)` -> `{ pngBase64 }`

失败会抛出带稳定 `code` 的 `BrowserUseError`。

## 配置

```yaml
config:
  headless: true # optional, default true
```

## 模型体验

间接地，通过 `@deepseek-ai/dsh-tool-macos-use`；浏览器工具 schema 与渲染结果由该包负责。

#### KV 缓存影响

该服务不直接注册提示词或 schema，因此加载它不会改变驱动模型可复用的请求前缀。

## 已知限制与后续工作

- 必须另行安装 Playwright Chromium：`pnpm exec playwright install chromium`；缺少浏览器时会在首次使用时返回 `BROWSER_USE_LAUNCH_FAILED`。
- 仅支持一个浏览器上下文与一个页面；多标签页和多上下文工作流留待后续实现。
- `key` 使用 Playwright 键名，而不是 macOS 服务的 `cmd+shift+t` 风格词汇。
- 取消信号会在分派前检查，但无法通过该信号中断已经运行的 Playwright 操作。
- 单元测试覆盖延迟启动、页面复用、操作、释放、分派前取消和稳定错误码；真实浏览器端到端套件留待后续实现。
