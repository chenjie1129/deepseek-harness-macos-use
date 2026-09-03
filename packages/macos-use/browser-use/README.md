---
description: "Playwright-backed browser control for readers choosing, configuring, or debugging the browserUse seam and autonomous browser tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-use

English | [中文](README.zh.md)

## Summary

`dsh-browser-use` lets an agent navigate and operate a real Chromium page with DOM selectors or screenshot coordinates. Chromium starts lazily; each Harness Agent gets its own isolated browser context, page, cookies, and screenshot observations. Choose it for controlled web interaction that should not depend on the user's existing browser profile. It does not expose tools by itself; `dsh-tool-macos-use` owns the model-facing browser tools and autonomous loop.

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

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-browser-use'
```

Headed/headless mode, network grants, denials, and private-network access are managed visually by the **GUI Agent** card on Plugin Configuration; no adjustable browser-agent value needs to be duplicated in YAML. The integrated Harness documentation generator derives its exhaustive configuration catalog from the same live schema. The browser is fail-closed: an empty allowed-domain list disables network navigation; private, loopback, and link-local destinations also require the separate private-network switch. Tightening any live network setting immediately retires every loaded browser context.

### Operations

`ctx.browserUse` provides `navigate`, `clickSelector`, `fillSelector`, `extractText`, `clickAt`, `moveAt`, `dragAt`, `scroll`, `type`, `key`, `screenshot`, and `pageState`. The trusted tool adapter adds the current Agent identity to every request; model arguments never choose it. Extracted page text defaults to 20,000 characters and is hard-capped at 100,000 before it crosses the page/Host boundary; completion title and URL evidence are bounded as well. Coordinate and keyboard actions require the most recent owner-bound screenshot token, consume it before dispatch, reject it after 60 seconds, and compare a fresh viewport digest immediately before the action. Failures raise `BrowserUseError` with a stable code.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`BrowserUseService` owns one Playwright browser process and an owner-indexed set of isolated contexts/pages. The first operation for an Agent creates its context; later operations from that Agent reuse its page. A live headed/headless or network-policy change retires all contexts so subsequent operations start under the new policy. Plugin disposal closes every context and the browser.

Every HTTP(S) request and WebSocket handshake is checked against the domain/private-network policy and forced through a per-service authenticated loopback proxy. For each outbound connection the proxy validates the original hostname, resolves it once, rejects the whole answer set if any address is private unless private access is enabled, and connects to the selected numeric address while preserving the original Host and TLS SNI. Chromium's implicit loopback bypass and browser-side DNS fallback are disabled, as is QUIC. Service Workers, Dedicated Workers, and Shared Workers are disabled so page code cannot move a transport into an unguarded realm. WebRTC constructors are removed, while WebTransport is disabled both through a Blink launch flag and in every page realm. These guards close the known DNS-rebinding gap and reduce browser authority, but they are not an operating-system network sandbox; retain an OS/container firewall when an adversarial site must be contained.

An AbortSignal is subscribed before a Playwright action is dispatched. Cancellation retires and closes only that Agent's browser context, which interrupts in-flight navigation or input without disrupting another Agent; a later call receives a fresh context.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service lifecycle, configuration, and browser operations |
| [`src/pinned-proxy.ts`](src/pinned-proxy.ts) | Authenticated loopback egress, one-resolution address pinning, and socket bounds |
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
- One page per Agent is supported; multi-tab workflows are deferred.
- `key` uses Playwright key names rather than the macOS service's `cmd+shift+t`-style vocabulary.
- Dedicated and Shared Workers are unavailable by design because their independent networking realms cannot be completely mediated by Playwright routing.
- Exact viewport-digest binding deliberately rejects screenshot-derived actions on dynamic pages when any pixel changes; capture a fresh screenshot and decide again instead of retrying the old action.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The unit suite covers lazy launch, owner isolation, live policy reconfiguration, page reuse, URL/subresource/WebSocket filtering, worker/WebTransport lockdown, private-address resolution, one-shot/expiring observation tokens, concurrent replay, pointer movement and dragging, disposal, pre-dispatch and in-flight cancellation, and stable error codes.

</details>
