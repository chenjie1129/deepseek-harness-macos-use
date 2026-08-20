# @deepseek-ai/dsh-gui-model

[English](README.md) | 中文

GUI 定位视觉模型接缝（`ctx.guiModel`），它把截图、任务和历史步骤发送到 OpenAI 兼容的 chat-completions 端点，并返回一个经过校验的下一步动作。实时插件设置提供模型密钥或访问点，无需把驱动智能体模型与 GUI 视觉能力绑定。

## API

`GuiModelService` 是默认导出，并注册为 `ctx.guiModel`：

- `nextAction({ screenshotPngBase64, task, history? }, signal?)` -> `GuiAction`

`GuiAction` 的结构为 `{ kind: 'click'|'double_click'|'right_click'|'type'|'key'|'scroll'|'wait'|'done', x?, y?, text?, combo?, direction?, amount?, ms?, summary?, reason? }`。服务会在返回前校验所选动作的必填字段。

## 配置

```yaml
config:
  apiKeyEnv: GUI_MODEL_API_KEY # optional credential reference
  baseURL: https://api.example.com/v1 # required; /chat/completions is appended
  model: some-vision-model # required
  maxOutputTokens: 512 # optional
```

## 模型体验

### 独立 GUI 模型请求

#### 模型看到的内容

每次 `nextAction` 调用都会把下方稳定系统指令、任务、历史动作和当前 PNG 截图发送给已配置的视觉提供方。该请求位于驱动智能体 Session 日志之外。

##### GUI 定位系统指令

```markdown
You are a GUI grounding model. You are given a screenshot and a task. Respond with exactly one JSON object describing the single next action to take toward completing the task — no prose, no markdown fences, just the JSON object. Its shape is:
{"kind": "click"|"double_click"|"right_click"|"type"|"key"|"scroll"|"wait"|"done", "x"?: number, "y"?: number, "text"?: string, "combo"?: string, "direction"?: "up"|"down"|"left"|"right", "amount"?: number, "ms"?: number, "summary"?: string, "reason"?: string}
"x"/"y" are pixel coordinates in the screenshot for click/double_click/right_click. "text" is literal text to type. "combo" is a key or modifier combo like "return" or "cmd+shift+t". "direction"/"amount" are for scroll. "ms" is a pause duration for wait. Choose "done" with a "summary" only once the task is fully accomplished.
```

#### Token 影响

每一步都是独立模型请求，输入会随任务与历史增长并包含 base64 截图；`maxOutputTokens` 限制响应长度。

#### KV 缓存影响

该请求独立于驱动模型缓存。仅当提供方、模型和前缀字节保持不变时，提供方才可能复用稳定的系统指令与任务历史前缀；当前截图和不断增长的历史会改变后缀。

## 已知限制与后续工作

- `baseURL` 和 `model` 没有默认值；配置错误会明确失败，而不会猜测提供方。
- 瞬态请求失败没有重试或退避，会立即中止调用它的任务工具。
- 解析器会恢复第一个配对完整的 JSON 对象并校验动作必填字段，但不会拒绝所有未知可选字段，也无法判断坐标在语义上是否合适。
- 已有聚焦的请求和解析器测试，但实时提供方兼容性与真实 GUI 端到端套件仍需由部署验证。
