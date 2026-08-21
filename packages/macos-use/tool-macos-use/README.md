# @deepseek-ai/dsh-tool-macos-use

English | [中文](README.zh.md)

Model-facing consumer of the `ctx.macosUse`, `ctx.guiModel`, and `ctx.browserUse` capability seams.

## Tools

Primitive macOS tools are `computer_screenshot`, `computer_click`, `computer_type`, `computer_key`, `computer_open_app`, and `computer_run_applescript`.

Primitive browser tools are `browser_navigate`, `browser_click`, `browser_fill`, `browser_extract_text`, and `browser_screenshot`.

`computer_use_task` and `browser_use_task` repeatedly capture a screenshot, ask `ctx.guiModel` for one action, and execute it through `ctx.macosUse` or `ctx.browserUse` until the GUI model answers `done` or the step budget is exhausted. Each task result includes `completed`, `summary`, the action/outcome log, and a durable final-screenshot reference.

## Config

```yaml
config:
  defaultMaxSteps: 20 # optional
```

## Model Experience

### Tool schemas

#### What the model sees

The driving model sees the `computer_*`, `browser_*`, `computer_use_task`, and `browser_use_task` schemas defined in [`src/index.ts`](src/index.ts). The GUI provider endpoint and credentials are deployment settings, not model arguments.

#### Token effect

Thirteen fixed schemas are sent on each request while the package is visible; `defaultMaxSteps` changes only one task-argument description.

#### KV Cache effect

Prefix-stable while tool visibility, definitions, and the resolved default step count are unchanged.

### Tool results

#### What the model sees

Primitive screenshots save PNG bytes as durable `ctx.attachments` records but render only dimensions, byte count, and attachment id as text because the primary DeepSeek driving adapter rejects image tool-result content. Task results render `Completed` or `Stopped`, the summary, every action/outcome line, and the final screenshot reference; the driving model does not receive screenshot pixels.

#### Token effect

Primitive acknowledgements are short. Extracted browser text and task action logs are data-dependent and remain in tool history until compaction; `max_steps` bounds loop-log growth.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- GUI-model screenshot requests and decisions occur outside the driving Session log; only the final tool result retains the action/outcome summary and attachment reference.
- `computer_run_applescript` accepts arbitrary script source, and all desktop/browser actions depend on deployment tool policy plus host operating-system permissions rather than a package-specific approval layer.
- A GUI-model request failure aborts the task tool; there is no retry, resume, or partial durable substep record.
- Focused tool-loop tests exist, but an assembled model snapshot and real desktop/browser end-to-end suite are deferred.
