# @deepseek-ai/dsh-macos-use

English | [中文](README.zh.md)

macOS desktop-control capability seam (`ctx.macosUse`) providing full-screen capture through `screencapture`, GUI automation through AppleScript and System Events, application launch through `open`, and direct AppleScript execution. The service and concrete provider share one package because this implementation has no swappable backend.

## API

`MacosUseService` is the default export and registers as `ctx.macosUse`:

- `screenshot(signal?)` -> `{ pngBase64 }`
- `click({ x, y, button?, doubleClick?, modifiers? }, signal?)`
- `type({ text }, signal?)`
- `key({ combo }, signal?)` using combos such as `return`, `escape`, `cmd+shift+t`, or `a`
- `scroll({ direction, amount? }, signal?)`
- `openApp({ name }, signal?)`
- `runAppleScript({ script } | script, signal?)` -> stdout
- `frontmostApp(signal?)` -> frontmost process name

All commands run through `ctx.subprocess` under `commandTimeoutMs`. Failures raise `MacosUseError` with a stable `code`.

## Config

```yaml
config:
  commandTimeoutMs: 15000 # optional
```

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-macos-use`, which owns the desktop-control tool schemas and rendered results.

#### KV Cache effect

This service registers no prompt or schema directly, so loading it does not change the driving model's reusable request prefix.

## Known Limitations and Deferred Work

- The host process needs Accessibility permission for GUI automation and Screen Recording permission for screenshots; denial fails the corresponding call.
- System Events emits synthetic Accessibility actions, so applications that ignore those events may not respond.
- GUI-model coordinates refer to screenshot pixels while System Events clicks use screen points; Retina scaling and multi-display layouts are not normalized automatically.
- AppleScript builders and service behavior have focused tests, but a real macOS GUI end-to-end suite is deferred.
