---
description: "Native macOS screenshot, Accessibility, pointer, keyboard, window, application, and AppleScript control for computer-use agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-macos-use

English | [中文](README.zh.md)

## Summary

`dsh-macos-use` lets an agent observe and control permitted macOS applications through native screenshots, Accessibility metadata, CoreGraphics pointer actions, System Events, application launch, and AppleScript. It can capture a redacted full screen or one exact window and can issue opaque element tokens from the front window's Accessibility tree. Choose it for local Mac control; it does not expose tools or make autonomous decisions by itself. macOS Accessibility and Screen Recording permissions remain mandatory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this capability after the local subprocess provider and before `dsh-tool-macos-use`.

### When to choose it

Choose this package when the deployment runs on macOS and the host process may receive Accessibility and Screen Recording permission. Avoid it on non-macOS hosts or when native GUI control is outside the deployment's trust boundary.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-macos-use'
  config:
    commandTimeoutMs: 15000
```

| Field | Default | Meaning |
|---|---|---|
| `commandTimeoutMs` | `15,000` | Deadline for one native command |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-macos-use) is the exhaustive source for every accepted field. Application allow/deny lists, screenshot exclusions, and Accessibility element budgets are live tool-package settings on the Plugin Configuration page.

### Operations

`ctx.macosUse` provides full-screen and exact-window screenshots; application, window, and Accessibility discovery; click, move, drag, type, key, and scroll actions; application launch; exact-window focus; AppleScript; and frontmost-application lookup. Failures raise `MacosUseError` with a stable code.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`MacosUseService` executes explicit native commands through `ctx.subprocess`. Screenshot capture uses `screencapture`; window and application inspection use CoreGraphics and System Events scripts; pointer movement and dragging use CoreGraphics; remaining GUI actions use System Events. The service applies the current application and screenshot-redaction policy before returning observations or dispatching actions.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service lifecycle, policy, capture, and action methods |
| [`src/native.ts`](src/native.ts) | Native enumeration, Accessibility, focus, and pointer scripts |
| [`src/applescript.ts`](src/applescript.ts) | System Events action scripts |
| [`src/types.ts`](src/types.ts) | Requests, results, and stable error codes |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [macOS-use package map](../README.md) — the four-package capability family.
- [Tool package](../tool-macos-use/README.md) — model-facing safety policy, tokens, and task loops.
- [Browser capability package](../browser-use/README.md) — isolated Chromium control for browser tasks.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-macos-use`, which owns the desktop-control tool schemas and rendered results.

#### KV Cache effect

This service registers no prompt or schema directly, so loading it does not change the driving model's reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The host process needs Accessibility permission for GUI automation and semantic state, and Screen Recording permission for screenshots; denial fails the corresponding call.
- System Events emits synthetic Accessibility actions, so applications that ignore those events may not respond.
- Accessibility elements without usable bounds remain observable but cannot produce a coordinate target.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The service and concrete provider share one package because this implementation has no swappable backend.

</details>
