# macOS GUI and Browser Use

English | [中文](macos-use.zh.md)

The macOS-use subsystem separates desktop execution, browser execution, screenshot-to-action inference, and model-facing tool registration across four packages. The [implemented decision](../../.agents/notes/implemented/feature/2026-08-21-macos-gui-use.md) records the split, security boundary, and durability tradeoffs.

Source: [`packages/macos-use`](../../packages/macos-use)

## Capability split

`ctx.macosUse` owns desktop operations through the subprocess seam, `ctx.browserUse` owns one Playwright page, and `ctx.guiModel` owns independent OpenAI-compatible vision requests. `@deepseek-ai/dsh-tool-macos-use` composes those services into primitive tools and bounded action loops.

## Execution and durability

The GUI model receives screenshot pixels outside the driving Session log. Screenshot tools save durable attachment records but render text references to the driving model. Task tools retain their final completion state, summary, action/outcome list, and final screenshot reference.

## Security boundary

macOS controls Accessibility and Screen Recording grants. Deployment tool policy controls whether arbitrary AppleScript and desktop or browser actions may run; the package family adds no persistent permission grant of its own.

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
