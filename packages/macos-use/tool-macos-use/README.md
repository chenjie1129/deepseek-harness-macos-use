---
description: "Model-facing macOS and browser tools, autonomous screenshot-grounded task loops, safety policy, visual configuration, and step-image presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-macos-use

English | [中文](README.zh.md)

## Summary

`dsh-tool-macos-use` gives an agent 21 desktop and browser tools, including primitive actions and autonomous screenshot-grounded task loops. It applies application policy, user confirmations, semantic element tokens, time and step budgets, single-task locking, and owner-scoped abort. Every adjustable agent setting is visible on the Plugin Configuration page. Confirmation before every direct or model-selected GUI mutation is on by default; disable it only behind an equivalent trusted safety or approval boundary. Fresh per-step visual evidence is stored and shown beside each step by default; switching that setting off prevents its storage and display without removing the private screenshot used by the GUI model.

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

Mount all three capability packages before this consumer, then configure the agent from Plugin Configuration. Browser network access and macOS app read/control access are default-deny: explicitly add domain and app grants before use. Existing installations upgrading from an allow-by-default build must migrate those fields visually.

### When to choose it

Choose this package when an agent should receive typed desktop or browser actions and the deployment accepts the configured application, confirmation, and screenshot policies. Exclude it when GUI control should not be model-visible. The autonomous task tools require `dsh-gui-model`; primitive desktop and browser tools do not invoke the vision endpoint.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-macos-use'
- name: '@deepseek-ai/dsh-gui-model'
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-tool-macos-use'
```

| Field | Default | Meaning |
|---|---|---|
| `defaultMaxSteps` | `20` | Default autonomous-loop step budget; visually constrained to 1–100 |
| `taskTimeoutMs` | `120,000` | Autonomous task deadline |
| `showStepScreenshots` | `true` | Save and show fresh visual evidence for each step |
| `confirmDestructiveActions` | `true` | Heuristically ask for some high-impact GUI actions |
| `confirmEveryMutation` | `true` | Ask once before every direct or autonomous GUI-changing action |
| `singleActiveTask` | `true` | Allow only one autonomous task at a time |

Every field in this table, plus command timeout, Accessibility element budget, Chromium mode, explicit browser-domain and app read/control grants, denials, screenshot exclusions, and the emergency stop, is managed visually on the GUI Agent card. No adjustable agent value needs to be duplicated in YAML. The integrated Harness documentation generator derives its exhaustive configuration catalog from the same live schema. An empty browser allowlist blocks network navigation (while `about:blank` remains available); empty legacy and precise app grants authorize no app.

### Tools

Desktop primitives are `computer_screenshot`, `computer_list_apps`, `computer_list_windows`, `computer_screenshot_window`, `computer_get_window_state`, `computer_click`, `computer_move`, `computer_drag`, `computer_type`, `computer_key`, `computer_scroll`, `computer_open_app`, `computer_focus_window`, and `computer_abort`. Browser primitives are `browser_navigate`, `browser_click`, `browser_fill`, `browser_extract_text`, and `browser_screenshot`. `computer_use_task` and `browser_use_task` capture, request one GUI-model action, execute it, and repeat until `done` or a bound stops the loop. Model-facing `computer_abort` can stop only the calling Agent's tasks; the Plugin Configuration Emergency Stop is explicitly global. Arbitrary model-authored AppleScript is intentionally not exposed because app grants cannot reliably constrain its reads and effects.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers every tool over `ctx.macosUse`, `ctx.browserUse`, `ctx.guiModel`, and `ctx.attachments`. `computer_get_window_state` issues owner-bound, single-use element tokens. A primitive reserves its token synchronously, takes a fresh window/Accessibility snapshot, and revalidates exact process, window, element identity, and bounds before dispatch. Element-token coordinates are global macOS points; display-coordinate observations contain only the authorized foreground window on black pixels and retain captured-image coordinates for native pixel-to-point conversion. `computer_screenshot` similarly issues a single-action foreground observation token required by raw coordinate/current-focus controls. Before storing an image, the package downscales a copy to the attachment byte, pixel, and side limits while preserving original pixels for GUI grounding.

Task results keep model-visible text separate from UI-only image presentation. The normal render contains status, summary, action log, and final screenshot reference. A `tool.call.toolview` projection reads durable image references from result metadata and shows them per step without sending those pixels to the driving model. The current output schema accepts the attachment service's optional `originalDimensions` metadata.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool schemas, execution, screenshot storage, result metadata, and UI projection |
| [`src/settings.ts`](src/settings.ts) | Live configuration schema and defaults |
| [`src/policy.ts`](src/policy.ts) | Confirmation and destructive-action policy |
| [`src/tokens.ts`](src/tokens.ts) | Snapshot-scoped Accessibility tokens |
| [`src/loop.ts`](src/loop.ts) | Bounded autonomous loop |
| [`src/client/index.ts`](src/client/index.ts) | Plugin Configuration cards and task-result renderer |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [macOS-use package map](../README.md) — the capability packages this consumer composes.
- [GUI model package](../gui-model/README.md) — the vision request made by autonomous loops.
- [Architecture](../../../docs/architecture.md) — result metadata, attachment authorization, and current Harness integration.
- The integrated Harness documentation generator emits the exact tool catalog from the running plugin.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The driving model sees the generated `computer_*`, `browser_*`, `computer_use_task`, and `browser_use_task` schemas. The GUI provider endpoint and credentials are deployment settings, not model arguments.

#### Token effect

Twenty-one fixed schemas are sent on each request while the package is visible; `defaultMaxSteps` changes only one task-argument description.

#### KV Cache effect

The prefix stays reusable while tool visibility, definitions, and the resolved default step count remain unchanged.

### Tool results

#### What the model sees

Primitive screenshots save PNG bytes as durable `ctx.attachments` records but render only dimensions, byte count, and attachment id as text because the primary DeepSeek driving adapter rejects image tool-result content. Task results render status, summary, every action and outcome, and the final screenshot reference. When `showStepScreenshots` is enabled, a UI-only projection pairs each action and outcome with its saved image; the driving model does not receive those pixels.

#### Token effect

Primitive acknowledgements are short. Extracted browser text and task action logs are data-dependent and remain in tool history until compaction; `max_steps` bounds loop-log growth.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- GUI-model requests and decisions occur outside the driving Session log. While a call is active (and briefly after it settles), an Agent-Context/call-bound, process-local RPC can show bounded inline JPEG previews; it appends no custom Session events. Ordinary model/action/approval failures return a structured stopped result whose enabled step screenshots are durable presentation metadata. A hard Harness-side cancellation can prevent that final result; the UI then falls back only to the short-lived bounded preview.
- The attachment seam has no transactional rollback/delete operation. If a hard outer cancellation lands after a step image was saved but before its final result was appended, that image can remain unreferenced in attachment storage; fully closing this requires upstream attachment lifecycle support.
- The context-only progress Remote prevents root API and accidental cross-scope use, but this local single-user Harness has no per-connection Session ACL. It does not claim isolation from a malicious same-origin RPC client that forges another live Agent's wire identity; that requires upstream Gateway authentication/capabilities.
- `confirmDestructiveActions` is an English/Chinese/Japanese wording and action-type heuristic, not a reliable semantic effect boundary. A raw coordinate click cannot reveal whether the target says Delete, Send, or Buy. Confirmation is scoped to the current action; the plugin does not create a persistent permission grant or replace macOS Accessibility and Screen Recording controls.
- `confirmEveryMutation` is the default-on safety boundary. It asks separately for every GUI-changing direct tool and every non-wait/non-done autonomous action; with no approval answerer, the action fails closed. Disable it only when an equivalent trusted safety or approval boundary exists. When disabled, `confirmDestructiveActions` still applies if configured, but that heuristic is not a semantic-effect guarantee.
- The plugin's own same-Mac action approval is requested only after the action has been grounded in its screenshot. If the approval UI steals focus, an allowed action reactivates only that exact observed window and proceeds only when its identity, geometry, and pixels still match; otherwise it stops for a new observation. If another policy asks before an outer `computer_use_task`, the approval wrapper privately binds the exact foreground target before showing the UI, restores and revalidates it after a one-shot grant, and only then takes a new screenshot and asks the GUI model to decide afresh. Rejected approvals do not reactivate anything. Managed-browser actions keep their existing approval behavior because Harness focus does not change the isolated page target. Approval answerers must delegate through the public `approval/request` waterfall: a later listener placed ahead of this wrapper that answers without calling `next()` cannot be observed or safely rebound, so deployment composition must keep the recovery wrapper outermost.
- There is no automatic retry or resume. Failures the plugin can catch return a structured stopped result with every already-saved step; only a hard outer Harness cancellation can prevent the durable final result.
- Accessibility element quality varies by application; controls without useful bounds cannot be targeted by token.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The current Harness compatibility patch adds authorization and export discovery for image references nested in tool-result metadata. Keep those core changes paired with the client renderer whenever the standalone package is integrated.

</details>
