# @deepseek-ai/dsh-macos-use

English | [中文](README.zh.md)

macOS desktop-control capability seam (`ctx.macosUse`) providing redacted full-screen and exact-window capture, application/window discovery, flattened Accessibility state, CoreGraphics pointer movement and dragging, System Events GUI automation, application launch, and direct AppleScript execution. The service and concrete provider share one package because this implementation has no swappable backend.

## API

`MacosUseService` is the default export and registers as `ctx.macosUse`:

- `screenshot(signal?)` -> `{ pngBase64 }`
- `listApps(signal?)` -> running application metadata
- `listWindows(signal?)` -> on-screen window metadata and bounds
- `screenshotWindow({ windowId?, app?, title? }, signal?)` -> exact-window PNG
- `windowState({ windowId?, app?, title?, maxElements? }, signal?)` -> window metadata plus flattened Accessibility elements
- `click({ x, y, button?, doubleClick?, modifiers? }, signal?)`
- `move({ x, y }, signal?)`
- `drag({ x, y, toX, toY }, signal?)`
- `type({ text }, signal?)`
- `key({ combo }, signal?)` using combos such as `return`, `escape`, `cmd+shift+t`, or `a`
- `scroll({ direction, amount? }, signal?)`
- `openApp({ name }, signal?)`
- `focusWindow({ windowId?, app?, title? }, signal?)`
- `runAppleScript({ script } | script, signal?)` -> stdout
- `frontmostApp(signal?)` -> frontmost process name

All commands run through `ctx.subprocess` under `commandTimeoutMs`. Failures raise `MacosUseError` with a stable `code`.

## Config

```yaml
config:
  commandTimeoutMs: 15000 # optional
  allowedApps: [] # optional; empty permits every app not denied
  deniedApps: [] # optional; evaluated before allowedApps
  excludedScreenshotApps: [] # optional; matching windows are masked
  maxElementsPerSnapshot: 250 # optional
```

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-macos-use`, which owns the desktop-control tool schemas and rendered results.

#### KV Cache effect

This service registers no prompt or schema directly, so loading it does not change the driving model's reusable request prefix.

## Known Limitations and Deferred Work

- The host process needs Accessibility permission for GUI automation and semantic state, and Screen Recording permission for screenshots; denial fails the corresponding call.
- System Events emits synthetic Accessibility actions, so applications that ignore those events may not respond.
- Accessibility elements without usable bounds remain observable but cannot produce a coordinate target.
