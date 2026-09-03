---
description: "Native macOS screenshot, Accessibility, pointer, keyboard, window, application, and target-guarded System Events/JXA control for computer-use agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-macos-use

English | [中文](README.zh.md)

## Summary

`dsh-macos-use` lets an agent observe and control permitted macOS applications through native screenshots, Accessibility metadata, CoreGraphics pointer actions, guarded System Events scripts, and exact application-bundle launch. It can capture one exact window or place the exact authorized foreground-window capture on an otherwise black main-display coordinate canvas, and it can issue opaque element tokens from the front window's Accessibility tree. Caller-supplied arbitrary AppleScript is intentionally unavailable. Choose it for local Mac control; it does not expose tools or make autonomous decisions by itself. macOS Accessibility and Screen Recording permissions remain mandatory.

## Table of Contents

- [Use this package](#use-this-package)
- [Reliability contract](#reliability-contract)
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

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-macos-use'
```

The native-command deadline, application grants and denials, screenshot exclusions, and Accessibility element budget are all managed visually by the **GUI Agent** card on Plugin Configuration; no adjustable macOS-agent value needs to be duplicated in YAML. The integrated Harness documentation generator derives its exhaustive configuration catalog from the same live schema.

### Operations

`ctx.macosUse` provides display-coordinate and exact-window screenshots; application, window, and Accessibility discovery; click, move, drag, type, key, and scroll actions; exact application-bundle launch; exact-window focus; and frontmost-application lookup. Failures raise `MacosUseError` with a stable code.

-----

<a id="reliability-contract"></a>
## Reliability contract

Every display-coordinate, exact-window, and Accessibility observation carries an opaque `observationId` and `observedAt`. A display-coordinate token is bound internally to the exact foreground process (`pid`, optional `bundleId`, and Unicode-safe name), its front-to-back selected on-screen window (`id`, title, bounds, and visibility), the trusted agent/session owner, the main-display geometry, and the service-wide desktop mutation epoch. Exact-window state carries the same complete window identity, owner, and epoch. A newer observation revokes that owner's older unconsumed observation. All native mutations share one service-wide queue from revalidation through dispatch; a dispatched click, move, drag, type, key, scroll, application launch, or window focus advances the epoch and revokes every other owner's pending observation. A failed attempt cannot replay its reserved token. Tokens expire after 60 seconds; cross-owner, superseded, pre-mutation, unknown, expired, moved, renamed, replaced, or replayed targets fail with `MACOS_USE_TARGET_STALE`. The owner comes from trusted execution context and is never a model parameter.

A display-coordinate result exposes `captureGeometry.displayId`, `captureGeometry.globalPointRect`, and `captureGeometry.capturePixels`. Coordinates paired with that observation are PNG pixels; the service uses its stored copy of the geometry to convert them to global macOS points only after owner, TTL, epoch, single-use, foreground, window, and display checks pass. Coordinates paired with an exact-window target remain global macOS points. Retina 1×/2× scaling and non-zero display origins therefore do not rely on the model guessing a scale.

Every click, pointer move, drag, type, key, or scroll call requires either a fresh display-coordinate `observationId` or an exact observed-window target. Unbound current-focus actions fail closed. Coordinate actions must remain inside the observed foreground window; clicks, pointer moves, and both drag endpoints outside its half-open bounds fail. Type, key, and scroll actions require the same foreground process and selected window. The global native-mutation queue keeps the last revalidation adjacent to dispatch, while the exact process/window/frontmost/CoreGraphics-window-id guard and input event are emitted by the same native JXA program. Native input uses a bounded best-effort critical section: cancellation is honored before dispatch and ordinary script errors run balanced mouse-up cleanup, while drag still caps at five seconds. A host termination, native-process crash, or hard timeout can still interrupt cleanup, so this is not an OS-level transaction or an unconditional input-state guarantee. Callers need only pass the opaque token back to bind an action. `openApp` and exact `focusWindow` carry their own explicit destination but use the same queue and invalidate pending observations when dispatched.

When a same-Mac approval panel displaces the foreground target after observation, the trusted tool adapter can request one post-approval reactivation. The service consumes the original owner-bound token first, restores only the exact observed process and window, and rechecks its identity, bounds, display geometry, and decoded-pixel digest before dispatch. Semantic element actions then take a fresh Accessibility snapshot as well. A replaced window or any pixel change—including dynamic content or foreground-style changes—fails closed and requires a new observation and decision; the old action is never replayed. Rejected or unavailable approval never triggers reactivation.

Window ids are authoritative and never fall back to an app name. App/title lookup must resolve exactly once; multiple matches fail with `MACOS_USE_WINDOW_AMBIGUOUS`. `actionReceipt()` captures a fresh post-action observation and reports whether the original exact window is present, missing, or the action was unscoped. A receipt proves that a fresh observation occurred; callers must still verify the requested application state.

Runtime policy has separate precise `readAppGrants` and `controlAppGrants`, whose rules can require an exact name, `bundleId`, `pid`, or combination. Names are normalized without discarding non-Latin letters. `deniedAppIdentities` overrides both. Configuration rejects a control rule unless an equal or broader read rule covers every identity it could admit. Precise grants fall back to the legacy `allowedApps` list only when absent or empty; if both are empty, read and control now fail closed. Upgrading users must add visible Read app grants and Control app grants in Plugin Configuration (or populate legacy `allowedApps`) before the agent can see or operate an app. This least-privilege default intentionally replaces the previous implicit allow-all behavior.

Discovery and exact capture enforce read scope, while input/open/focus require both read and control scope. Requiring read before every mutation prevents a control-only side effect whose mandatory post-action receipt would then be denied and potentially retried. The display-coordinate screenshot path never creates a full-display raster: it passes only the authorized foreground CoreGraphics window id to `screencapture -l -o`, then composites those exact-window pixels onto a synthesized black canvas whose pixel-to-point geometry covers the main display. A foreground window that is excluded, unreadable, unavailable, on a secondary display, spanning displays, or partly outside the main display is rejected before transferable pixels are returned. A foreground or display change during capture also rejects the result, and capture cannot begin while a dispatched native mutation remains in flight. Background windows, the desktop, menus, overlays, and other applications are black rather than captured and redacted after the fact. `excludedScreenshotApps` is a pixel-privacy list, not a general data-read denial.

`openApp` resolves installed bundle paths first. A bundle-id selector uses Launch Services and a bounded scan of standard application roots; a name-only selector combines Spotlight with that scan. More than one canonical match fails with `MACOS_USE_APP_AMBIGUOUS`. The resolved `name` plus `bundleId` are checked against read and control grants; one native NSWorkspace program then revalidates and launches that exact canonical bundle URL, and the service verifies that the same bundle becomes frontmost before returning. Supplying a bundle id is recommended and supports bundle-only or name-plus-bundle grants.

Public arbitrary AppleScript is always refused because its reads and effects cannot be confined reliably to application grants. Internal generated scripts still enforce exact targets. `excludedScreenshotApps` remains only a pixel-privacy list and is not a general data-read denial.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`MacosUseService` executes explicit native commands through `ctx.subprocess`. Screenshot capture uses exact-window `screencapture`; window and application inspection use CoreGraphics and System Events scripts; pointer movement and dragging use CoreGraphics; remaining GUI actions use System Events. The service applies the current application policy before returning observations or dispatching actions.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service lifecycle, policy, capture, and action methods |
| [`src/native.ts`](src/native.ts) | Native enumeration, Accessibility, focus, and pointer scripts |
| [`src/applescript.ts`](src/applescript.ts) | System Events action scripts |
| [`src/observations.ts`](src/observations.ts) | Expiring, bounded, one-action observation identities |
| [`src/policy.ts`](src/policy.ts) | Exact app-identity read/control policy |
| [`src/redaction.ts`](src/redaction.ts) | Display-to-pixel coordinate geometry helpers |
| [`src/target.ts`](src/target.ts) | Fail-closed window selection and freshness comparison |
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
- The synthesized display-coordinate canvas covers the main display only; other displays are intentionally omitted.
- Display-coordinate observation returns only the authorized foreground window on black pixels and refuses a secondary-display, spanning, or partially off-main-display foreground window; capture that window exactly instead.
- Post-action screenshots are evidence, not a semantic assertion that the user's requested outcome succeeded.
- Cancellation can be delayed by the currently dispatched bounded native input (at most the configured five-second drag plus cleanup). Cleanup is best effort: host termination, native-process crash, or a hard timeout can still interrupt it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The service and concrete provider share one package because this implementation has no swappable backend.

</details>
