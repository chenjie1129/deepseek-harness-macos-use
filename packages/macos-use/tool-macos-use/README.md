# @deepseek-ai/dsh-tool-macos-use

English | [中文](README.zh.md)

Model-facing consumer of the `ctx.macosUse`, `ctx.guiModel`, and `ctx.browserUse` capability seams.

## Tools

Primitive macOS tools are `computer_screenshot`, `computer_list_apps`, `computer_list_windows`, `computer_screenshot_window`, `computer_get_window_state`, `computer_click`, `computer_move`, `computer_drag`, `computer_type`, `computer_key`, `computer_scroll`, `computer_open_app`, `computer_focus_window`, `computer_run_applescript`, and `computer_abort`.

Primitive browser tools are `browser_navigate`, `browser_click`, `browser_fill`, `browser_extract_text`, and `browser_screenshot`.

`computer_use_task` and `browser_use_task` repeatedly capture a screenshot, ask `ctx.guiModel` for one action, and execute it through `ctx.macosUse` or `ctx.browserUse` until the GUI model answers `done` or the step budget is exhausted. Each task result includes `completed`, `summary`, the action/outcome log, and a durable final-screenshot reference. By default, the user-facing result also shows the screenshot that grounded each step beside that step's output.

## Config

```yaml
config:
  defaultMaxSteps: 20
  taskTimeoutMs: 120000
  commandTimeoutMs: 15000
  maxElementsPerSnapshot: 250
  showStepScreenshots: true
  browserHeadless: true
  allowedApps: '' # comma/newline list
  deniedApps: '' # comma/newline list
  excludedScreenshotApps: | # comma/newline list
    Passwords
    1Password
    Keychain Access
  confirmAppleScript: true
  confirmDestructiveActions: true
  singleActiveTask: true
```

Every value is live on the Plugin Configuration page. The same card includes an emergency-stop button that immediately aborts the active autonomous GUI task. `showStepScreenshots` defaults to `true`; turning it off prevents per-step screenshots from being saved or shown while the GUI loop still captures each screen privately for the vision model.

`computer_get_window_state` returns opaque element tokens for actionable Accessibility elements. `computer_click`, `computer_move`, and `computer_drag` accept those tokens and re-resolve their current center point. A token becomes stale after the agent takes another semantic snapshot or the source window moves or resizes.

Denied applications always win over the allow list. Arbitrary AppleScript, drag, destructive key combinations, and destructive task intent request confirmation when their corresponding switches are on. The single-task lock and timeout bound autonomous loops; `computer_abort` and the visual emergency stop cancel one immediately.

Before any primitive, step, or final screenshot is stored, the tool downscales a copy when necessary to satisfy the active attachment byte, pixel, and per-side limits. GUI grounding keeps the original capture, so storage normalization does not change the coordinate system used for desktop or browser actions.

## Model Experience

### Tool schemas

#### What the model sees

The driving model sees the generated [`computer_*`, `browser_*`, `computer_use_task`, and `browser_use_task` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-macos-use). The GUI provider endpoint and credentials are deployment settings, not model arguments.

#### Token effect

Twenty-two fixed schemas are sent on each request while the package is visible; `defaultMaxSteps` changes only one task-argument description.

#### KV Cache effect

Prefix-stable while tool visibility, definitions, and the resolved default step count are unchanged.

### Tool results

#### What the model sees

Primitive screenshots save PNG bytes as durable `ctx.attachments` records but render only dimensions, byte count, and attachment id as text because the primary DeepSeek driving adapter rejects image tool-result content. Task results render `Completed` or `Stopped`, the summary, every action/outcome line, and the final screenshot reference. When `showStepScreenshots` is enabled, a separate UI-only result projection pairs each action/outcome with its saved image; the driving model does not receive those pixels.

#### Token effect

Primitive acknowledgements are short. Extracted browser text and task action logs are data-dependent and remain in tool history until compaction; `max_steps` bounds loop-log growth.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- GUI-model requests and decisions occur outside the driving Session log. Enabled per-step screenshots are durable UI presentation metadata inside the final tool result, not independently streamed Session events.
- Confirmation is scoped to the current action. The plugin does not create a persistent permission grant or replace macOS Accessibility and Screen Recording controls.
- A GUI-model request failure aborts the task tool; there is no retry, resume, or partial durable substep record.
- Accessibility element quality varies by application; controls without useful bounds cannot be targeted by token.
