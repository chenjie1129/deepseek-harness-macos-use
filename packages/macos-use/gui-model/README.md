# @deepseek-ai/dsh-gui-model

English | [中文](README.zh.md)

GUI-grounding vision-model seam (`ctx.guiModel`) that sends a screenshot, task, and prior-step history to an OpenAI-compatible chat-completions endpoint and returns one validated next action. Live plugin settings provide the model key or access point without coupling the driving agent model to GUI vision.

## API

`GuiModelService` is the default export and registers as `ctx.guiModel`:

- `nextAction({ screenshotPngBase64, task, history? }, signal?)` -> `GuiAction`

A `GuiAction` is `{ kind: 'click'|'double_click'|'right_click'|'type'|'key'|'scroll'|'wait'|'done', x?, y?, text?, combo?, direction?, amount?, ms?, summary?, reason? }`. The service validates the required fields for the selected action before returning it.

## Config

```yaml
config:
  apiKeyEnv: GUI_MODEL_API_KEY # optional credential reference
  baseURL: https://api.example.com/v1 # required; /chat/completions is appended
  model: some-vision-model # required
  maxOutputTokens: 512 # optional
```

## Model Experience

### Independent GUI-model request

#### What the model sees

Each `nextAction` call sends the stable system instruction below, the task, prior action history, and the current PNG screenshot to the configured vision provider. The request is outside the driving agent Session log.

##### GUI grounding system instruction

```markdown
You are a GUI grounding model. You are given a screenshot and a task. Respond with exactly one JSON object describing the single next action to take toward completing the task — no prose, no markdown fences, just the JSON object. Its shape is:
{"kind": "click"|"double_click"|"right_click"|"type"|"key"|"scroll"|"wait"|"done", "x"?: number, "y"?: number, "text"?: string, "combo"?: string, "direction"?: "up"|"down"|"left"|"right", "amount"?: number, "ms"?: number, "summary"?: string, "reason"?: string}
"x"/"y" are pixel coordinates in the screenshot for click/double_click/right_click. "text" is literal text to type. "combo" is a key or modifier combo like "return" or "cmd+shift+t". "direction"/"amount" are for scroll. "ms" is a pause duration for wait. Choose "done" with a "summary" only once the task is fully accomplished.
```

#### Token effect

Each step is an independent model request whose input grows with task and history and includes a base64 screenshot; `maxOutputTokens` caps the response.

#### KV Cache effect

The request is independent from the driving model cache. A provider may reuse the stable system/task-history prefix only while provider, model, and prefix bytes remain unchanged; the current screenshot and growing history change the suffix.

## Known Limitations and Deferred Work

- There is no default `baseURL` or `model`; misconfiguration fails explicitly instead of guessing a provider.
- Transient request failures have no retry or backoff and abort the calling task tool immediately.
- The parser recovers the first balanced JSON object and validates required action fields, but it does not reject every unknown optional field or semantically unsuitable coordinate.
- Focused request and parser tests exist, but live provider compatibility and a real GUI end-to-end suite remain deployment verification work.
