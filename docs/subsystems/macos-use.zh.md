# macOS GUI 与浏览器使用

[English](macos-use.md) | 中文

macOS-use 子系统把桌面执行、浏览器执行、截图到动作推理和面向模型的工具注册拆分到四个包中。[已实现决策](../../.agents/notes/implemented/feature/2026-08-21-macos-gui-use.md)记录了拆分方式、安全边界与持久性取舍。

源码：[`packages/macos-use`](../../packages/macos-use)

## 能力拆分

`ctx.macosUse` 通过 subprocess seam 负责桌面操作，`ctx.browserUse` 负责一个 Playwright 页面，`ctx.guiModel` 负责独立的 OpenAI 兼容视觉请求。`@deepseek-ai/dsh-tool-macos-use` 将这些服务组合为基础工具与有边界的动作循环。

## 执行与持久性

GUI 模型在驱动 Session 日志之外接收截图像素。截图工具会保存持久附件记录，但只向驱动模型渲染文本引用。任务工具保留最终完成状态、摘要、动作与结果列表以及最终截图引用。

## 安全边界

macOS 控制“辅助功能”和“屏幕录制”授权。部署工具策略控制是否允许运行任意 AppleScript 以及桌面或浏览器操作；这组包自身不会添加持久权限授权。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowseruse--browseruseservice"></a>

### `ctx.browserUse` — `BrowserUseService`

Browser-use service. Registered as `ctx.browserUse` (one instance per context). Requires Playwright's Chromium browser to be installed (`pnpm exec playwright install chromium`) — a missing browser surfaces as `BROWSER_USE_LAUNCH_FAILED` on first use, not at plugin load.

```ts cordis-catalog
/**
 * Navigate the active tab, launching the browser first if needed.
 * @param request - absolute URL to load.
 * @param signal - rejects before dispatch when already aborted.
 */
async navigate(request: NavigateRequest, signal?: AbortSignal): Promise<void>

/**
 * Click the first element matching a CSS or Playwright text/role selector.
 * @param request - selector identifying the element.
 * @param signal - rejects before dispatch when already aborted.
 */
async clickSelector(request: ClickSelectorRequest, signal?: AbortSignal): Promise<void>

/**
 * Fill the first matching input, replacing its current value.
 * @param request - selector and literal replacement text.
 * @param signal - rejects before dispatch when already aborted.
 */
async fillSelector(request: FillSelectorRequest, signal?: AbortSignal): Promise<void>

/**
 * Read the first matching element, or the whole page body when the selector is omitted.
 * @param request - optional selector.
 * @param signal - rejects before dispatch when already aborted.
 * @returns the element's inner text.
 */
async extractText(request: ExtractTextRequest = {}, signal?: AbortSignal): Promise<string>

/**
 * Click at absolute pixel coordinates within the current viewport.
 * @param request - point and optional double-click flag.
 * @param signal - rejects before dispatch when already aborted.
 */
async clickAt(request: ClickAtRequest, signal?: AbortSignal): Promise<void>

/**
 * Type literal text into the currently focused element.
 * @param request - text to type.
 * @param signal - rejects before dispatch when already aborted.
 */
async type(request: TypeTextRequest, signal?: AbortSignal): Promise<void>

/**
 * Press a key or modifier combo using Playwright's vocabulary.
 * @param request - key or combo such as `"Enter"` or `"Control+A"`.
 * @param signal - rejects before dispatch when already aborted.
 */
async key(request: KeyPressRequest, signal?: AbortSignal): Promise<void>

/**
 * Capture the current viewport.
 * @param signal - rejects before dispatch when already aborted.
 * @returns base64-encoded PNG bytes.
 */
async screenshot(signal?: AbortSignal): Promise<BrowserScreenshotResult>
```

Source: [`packages/macos-use/browser-use/src/index.ts:62`](../../packages/macos-use/browser-use/src/index.ts)

<a id="ctxguimodel--guimodelservice"></a>

### `ctx.guiModel` — `GuiModelService`

GUI-grounding vision model service. Registered as `ctx.guiModel` (one instance per context). Sends the screenshot as a `data:image/png;base64,...` `image_url` content part alongside the task and prior-step history, and parses the single JSON action object the model is instructed to answer with.

```ts cordis-catalog
/**
 * Ask the model for the single next action toward `request.task`, given the current screenshot.
 * @param request - screenshot, task, and prior-step history.
 * @param signal - aborts the request.
 * @returns the parsed, validated next action.
 * @throws {GuiModelError} `GUI_MODEL_REQUEST_FAILED` on a non-2xx response or network failure, or
 *   `GUI_MODEL_MALFORMED_RESPONSE` when the model's answer cannot be parsed into a valid action.
 */
async nextAction(request: NextActionRequest, signal?: AbortSignal): Promise<GuiAction>
```

Source: [`packages/macos-use/gui-model/src/index.ts:104`](../../packages/macos-use/gui-model/src/index.ts)

<a id="ctxmacosuse--macosuseservice"></a>

### `ctx.macosUse` — `MacosUseService`

macOS desktop-control service. Registered as `ctx.macosUse` (one instance per context). Every action shells out through `ctx.subprocess` — never `node:child_process` directly — to `osascript`, `screencapture`, or `open`. GUI automation and screen capture require the host process to hold Accessibility and Screen Recording permission respectively in System Settings; macOS prompts for both on first use and denies silently (an empty capture, a script that compiles but has no visible effect) until granted.

```ts cordis-catalog
/**
 * Capture the full screen.
 * @param signal - aborts the capture.
 * @returns the capture as base64-encoded PNG bytes.
 */
async screenshot(signal?: AbortSignal): Promise<ScreenshotResult>

/**
 * Click, double-click, or right-click at absolute screen coordinates.
 * @param request - target point, button, and held modifiers.
 * @param signal - aborts the click.
 */
async click(request: ClickRequest, signal?: AbortSignal): Promise<void>

/**
 * Type literal text via keystroke events into the currently focused element.
 * @param request - the text to type.
 * @param signal - aborts the keystrokes.
 */
async type(request: TypeTextRequest, signal?: AbortSignal): Promise<void>

/**
 * Press a single key or modifier combo.
 * @param request - a combo like `"return"`, `"cmd+shift+t"`, or `"a"`.
 * @param signal - aborts the keystroke.
 */
async key(request: KeyPressRequest, signal?: AbortSignal): Promise<void>

/**
 * Scroll by repeating an arrow/page key a bounded number of times — System Events exposes no scroll-wheel
 * event, so this is an approximation, not a trackpad-accurate scroll delta.
 * @param request - direction and step count.
 * @param signal - aborts the scroll.
 */
async scroll(request: ScrollRequest, signal?: AbortSignal): Promise<void>

/**
 * Launch or activate an application by name.
 * @param request - the application name as `open -a` resolves it.
 * @param signal - aborts the launch.
 */
async openApp(request: OpenAppRequest, signal?: AbortSignal): Promise<void>

/**
 * Run caller-supplied AppleScript.
 * @param request - complete AppleScript source, or its shorthand string form.
 * @param signal - aborts the script.
 * @returns the script's stdout, trimmed.
 */
async runAppleScript(request: RunAppleScriptRequest | string, signal?: AbortSignal): Promise<string>

/**
 * Resolve the frontmost application.
 * @param signal - aborts the lookup.
 * @returns the frontmost process's name.
 */
async frontmostApp(signal?: AbortSignal): Promise<string>
```

Source: [`packages/macos-use/macos-use/src/index.ts:74`](../../packages/macos-use/macos-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
