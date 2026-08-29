---
description: "OpenAI-compatible screenshot grounding for readers choosing, configuring, or debugging the independent GUI vision model."
kind: "package-reference"
---

# @deepseek-ai/dsh-gui-model

English | [中文](README.zh.md)

## Summary

`dsh-gui-model` sends a task, prior action history, and current screenshot to an OpenAI-compatible chat-completions endpoint and returns one validated GUI action. It lets a deployment use a vision-capable model independently from the driving agent model. Choose it for the autonomous computer and browser loops in `dsh-tool-macos-use`; primitive GUI tools do not require it. The package has no default provider or model and performs no retry.

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

Mount this capability with an explicit OpenAI-compatible endpoint and vision model before the task tool package.

### When to choose it

Choose this package when each GUI step may be decided by an OpenAI-compatible vision endpoint and that endpoint may be configured independently from the driving model. Avoid the autonomous task loops when no compatible vision endpoint is available; use the primitive desktop or browser tools instead.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-gui-model'
  config:
    apiKeyEnv: GUI_MODEL_API_KEY
    baseURL: https://api.example.com/v1
    model: some-vision-model
    maxOutputTokens: 512
```

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `GUI_MODEL_API_KEY` | Credential reference resolved for each request |
| `baseURL` | required | Endpoint base; the package appends `/chat/completions` |
| `model` | required | Vision-capable model name |
| `maxOutputTokens` | `512` | Response token cap for one action object |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-gui-model) is the exhaustive source for every accepted field. All four values are visually managed on the GUI Model card; the key is stored through the credential seam instead of being returned in settings responses.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each `nextAction` call resolves the current settings, sends one deterministic chat-completions request, extracts the first balanced JSON object from the answer, and validates the fields required by its selected action. The result is a `GuiAction` such as `click`, `drag`, `type`, `key`, `open_app`, `focus_window`, `wait`, or `done`.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, live settings, credential lookup, and HTTP request |
| [`src/parse.ts`](src/parse.ts) | System instruction, user prompt, JSON extraction, and action validation |
| [`src/types.ts`](src/types.ts) | Action contract and stable errors |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [macOS-use package map](../README.md) — the four-package capability family.
- [Tool package](../tool-macos-use/README.md) — autonomous loops that consume this service.
- [Desktop capability package](../macos-use/README.md) — native screenshots and desktop actions.

-----

<a id="model-experience"></a>
## Model Experience

### Independent GUI-model request

#### What the model sees

Each `nextAction` call sends the stable system instruction below, the task, prior action history, and current PNG screenshot to the configured vision provider. The request is outside the driving agent Session log.

##### GUI grounding system instruction

```markdown
You are a GUI grounding model. You are given a screenshot and a task. Respond with exactly one JSON object describing the single next action to take toward completing the task — no prose, no markdown fences, just the JSON object. Its shape is:
{"kind": "click"|"double_click"|"right_click"|"move"|"drag"|"type"|"key"|"scroll"|"open_app"|"focus_window"|"wait"|"done", "x"?: number, "y"?: number, "toX"?: number, "toY"?: number, "text"?: string, "combo"?: string, "app"?: string, "windowTitle"?: string, "direction"?: "up"|"down"|"left"|"right", "amount"?: number, "ms"?: number, "summary"?: string, "reason"?: string}
"x"/"y" are pixel coordinates in the screenshot for click/double_click/right_click/move and the drag start; "toX"/"toY" are the drag destination. "text" is literal text to type. "combo" is a key or modifier combo like "return" or "cmd+shift+t". "app" names an application for open_app/focus_window; "windowTitle" narrows focus_window. "direction"/"amount" are for scroll. "ms" is a pause duration for wait. Choose "done" with a "summary" only once the task is fully accomplished.
```

#### Token effect

Each step is an independent model request whose input grows with the task and history and includes a base64 screenshot; `maxOutputTokens` caps the response.

#### KV Cache effect

The request is independent from the driving model cache. A provider may reuse the stable system and task-history prefix only while provider, model, and prefix bytes remain unchanged; the current screenshot and growing history change the suffix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- There is no default `baseURL` or `model`; misconfiguration fails explicitly instead of guessing a provider.
- Transient request failures have no retry or backoff and abort the calling task tool immediately.
- The parser recovers the first balanced JSON object and validates required action fields, but it does not reject every unknown optional field or semantically unsuitable coordinate.
- Focused request and parser tests exist, but live third-party provider compatibility remains deployment verification work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The deterministic compatibility E2E uses a local OpenAI-compatible response server; it proves the request and loop integration but does not claim a third-party provider E2E.

</details>
