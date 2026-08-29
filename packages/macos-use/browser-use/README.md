---
description: "Playwright-backed browser control for readers choosing, configuring, or debugging the browserUse seam and autonomous browser tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-use

English | [中文](README.zh.md)

## Summary

`dsh-browser-use` lets an agent navigate and operate one real Chromium page with DOM selectors or screenshot coordinates. The browser starts lazily, is reused across calls, and closes with the plugin. Choose it for controlled web interaction that should not depend on the user's existing browser profile. It does not expose tools by itself; `dsh-tool-macos-use` owns the model-facing browser tools and autonomous loop.

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

Mount this capability before `dsh-tool-macos-use` when an agent needs a managed browser page.

### When to choose it

Choose this package for an isolated Playwright page that supports deterministic selector actions and screenshot-grounded coordinate actions. Use a browser integration attached to an existing user profile when the task requires the user's tabs, cookies, extensions, or signed-in Chrome state.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-browser-use'
  config:
    headless: true
```

| Field | Default | Meaning |
|---|---|---|
| `headless` | `true` | Launch Chromium without visible browser chrome |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-browser-use) is the exhaustive source for every accepted field.

### Operations

`ctx.browserUse` provides `navigate`, `clickSelector`, `fillSelector`, `extractText`, `clickAt`, `moveAt`, `dragAt`, `type`, `key`, and `screenshot`. Failures raise `BrowserUseError` with a stable code.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`BrowserUseService` owns one Playwright browser, context, and page. The first operation launches Chromium; later operations reuse the page. A live headed/headless change retires the current browser so the next operation launches in the selected mode. Plugin disposal closes the page context and browser.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service lifecycle, configuration, and browser operations |
| [`src/types.ts`](src/types.ts) | Requests, results, and stable error codes |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [macOS-use package map](../README.md) — the four-package capability family.
- [Tool package](../tool-macos-use/README.md) — model-facing browser tools and task loop.
- [GUI model package](../gui-model/README.md) — screenshot-grounded action decisions for browser tasks.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-macos-use`, which owns the browser tool schemas and rendered results.

#### KV Cache effect

This service registers no prompt or schema directly, so loading it does not change the driving model's reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Playwright's Chromium browser must be installed separately with `pnpm exec playwright install chromium`; a missing browser raises `BROWSER_USE_LAUNCH_FAILED` on first use.
- One browser context and one page are supported; multi-tab and multi-context workflows are deferred.
- `key` uses Playwright key names rather than the macOS service's `cmd+shift+t`-style vocabulary.
- Cancellation is checked before dispatch, but an already-running Playwright operation is not interrupted through the signal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The unit suite covers lazy launch, live headed/headless reconfiguration, page reuse, pointer movement and dragging, disposal, pre-dispatch cancellation, and stable error codes.

</details>
