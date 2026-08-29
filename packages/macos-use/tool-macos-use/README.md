---
description: "Model-facing macOS and browser tools, autonomous screenshot-grounded task loops, safety policy, visual configuration, and step-image presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-macos-use

English | [中文](README.zh.md)

## Summary

`dsh-tool-macos-use` gives an agent 22 desktop and browser tools, including primitive actions and autonomous screenshot-grounded task loops. It applies application policy, user confirmations, semantic element tokens, time and step budgets, single-task locking, and an immediate abort path. Every adjustable agent setting is visible on the Plugin Configuration page. Per-step screenshots are stored and shown beside each step by default; switching that setting off prevents their storage and display without removing the private screenshot used by the GUI model.

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

Mount all three capability packages before this consumer, then configure the agent from Plugin Configuration.

### When to choose it

Choose this package when an agent should receive typed desktop or browser actions and the deployment accepts the configured application, confirmation, and screenshot policies. Exclude it when GUI control should not be model-visible. The autonomous task tools require `dsh-gui-model`; primitive desktop and browser tools do not invoke the vision endpoint.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-macos-use'
- name: '@deepseek-ai/dsh-gui-model'
  config:
    baseURL: https://api.example.com/v1
    model: some-vision-model
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-tool-macos-use'
  config:
    showStepScreenshots: true
```

| Field | Default | Meaning |
|---|---|---|
| `defaultMaxSteps` | `20` | Default autonomous-loop step budget |
| `taskTimeoutMs` | `120,000` | Autonomous task deadline |
| `showStepScreenshots` | `true` | Save and show the screenshot that grounded each step |
| `confirmAppleScript` | `true` | Ask before arbitrary AppleScript |
| `confirmDestructiveActions` | `true` | Ask before destructive GUI actions |
| `singleActiveTask` | `true` | Allow only one autonomous task at a time |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-macos-use) is the exhaustive source for every accepted field. The GUI Agent card also manages command timeout, Accessibility element budget, Chromium mode, allowed and denied applications, screenshot exclusions, and the emergency stop.

### Tools

Desktop primitives are `computer_screenshot`, `computer_list_apps`, `computer_list_windows`, `computer_screenshot_window`, `computer_get_window_state`, `computer_click`, `computer_move`, `computer_drag`, `computer_type`, `computer_key`, `computer_scroll`, `computer_open_app`, `computer_focus_window`, `computer_run_applescript`, and `computer_abort`. Browser primitives are `browser_navigate`, `browser_click`, `browser_fill`, `browser_extract_text`, and `browser_screenshot`. `computer_use_task` and `browser_use_task` capture, request one GUI-model action, execute it, and repeat until `done` or a bound stops the loop.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers every tool over `ctx.macosUse`, `ctx.browserUse`, `ctx.guiModel`, and `ctx.attachments`. `computer_get_window_state` issues opaque element tokens; pointer tools re-resolve the token's current center and reject it after a newer snapshot or window geometry change. Before storing an image, the package downscales a copy to the attachment byte, pixel, and side limits while preserving original pixels for GUI grounding.

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
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-macos-use) — exact schemas harvested from the running plugin.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The driving model sees the generated [`computer_*`, `browser_*`, `computer_use_task`, and `browser_use_task` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-macos-use). The GUI provider endpoint and credentials are deployment settings, not model arguments.

#### Token effect

Twenty-two fixed schemas are sent on each request while the package is visible; `defaultMaxSteps` changes only one task-argument description.

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

- GUI-model requests and decisions occur outside the driving Session log. Enabled per-step screenshots are durable UI presentation metadata inside the final tool result, not independently streamed Session events.
- Confirmation is scoped to the current action. The plugin does not create a persistent permission grant or replace macOS Accessibility and Screen Recording controls.
- A GUI-model request failure aborts the task tool; there is no retry, resume, or partial durable substep record.
- Accessibility element quality varies by application; controls without useful bounds cannot be targeted by token.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The current Harness compatibility patch adds authorization and export discovery for image references nested in tool-result metadata. Keep those core changes paired with the client renderer whenever the standalone package is integrated.

</details>
