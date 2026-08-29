# Harness integration guide

English | [中文](integration.zh.md)

## Supported base

The supplied [`deepseek-harness-v0.1.2-alpha.1.patch`](../integration/deepseek-harness-v0.1.2-alpha.1.patch) targets DeepSeek Harness commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`0.1.2-alpha.1`). Run `git apply --check` before applying it. Another Harness revision requires a compatibility check because client slots, attachment references, package closure, project references, and the lockfile can change.

## What the patch wires

The patch registers the four packages in the CLI/runtime closure and TypeScript project references, lets the tool package load its browser client, authorizes UI-only result images referenced from `tool/result.data.meta.content`, exports those images with the Session, updates the lockfile and third-party notice, and adds a synchronized Agent Note for the attachment decision. The client package registers the GUI Model and GUI Agent configuration cards in `settings.plugin.item` and the two task renderers in `tool.call.toolview`.

The package source itself is not duplicated in the patch. Copy `packages/macos-use` into the Harness checkout before or after applying it.

## GUI model settings

Open **Settings → Plugins → Plugin configuration → GUI model**. The page provides visual fields for the API-key environment variable, endpoint, model, and maximum response tokens. The equivalent deployment representation is:

```yaml
config:
  apiKeyEnv: GUI_MODEL_API_KEY
  baseURL: https://api.example.com/v1
  model: your-vision-model
  maxOutputTokens: 512
```

`baseURL` and `model` are required. `/chat/completions` is appended to the base URL. Prefer a credential reference in `apiKeyEnv`; do not commit literal API keys. Changes are applied live after Save.

## Desktop and browser settings

Open **Settings → Plugins → Plugin configuration → GUI agent** for all P0 agent controls. The visual card contains:

- reliability: maximum steps, task timeout, macOS command timeout, semantic elements per window snapshot, and browser headed/headless mode;
- safety: allowed applications, denied applications, one-shot AppleScript confirmation, destructive-action confirmation, and the single-active-task lock;
- screenshots and privacy: the default-on **Show step screenshots** switch and the applications whose windows must never be captured;
- an immediate **Abort active task** emergency stop.

The saved configuration is applied live to `macos-use`, `browser-use`, and `tool-macos-use`. The screenshot switch defaults to `true`; when enabled, each available task-step screenshot is saved and displayed with that step's output. Turning it off omits the per-step images while preserving the GUI model's private grounding capture and the final screenshot reference.

Before primitive, step, and final screenshots enter durable storage, `tool-macos-use` downscales a copy when required by the active attachment byte, pixel, or per-side limit. The GUI model still receives the original capture so action coordinates are unchanged.

Install Chromium from the integrated Harness workspace:

```bash
corepack pnpm exec playwright install chromium
```

Grant Accessibility and Screen Recording permissions to the process that launches Harness. Coordinate conversion between screenshot pixels and macOS screen points is not normalized for Retina or multi-display layouts.

## Security boundary

The plugin can execute arbitrary AppleScript and control desktop/browser interfaces. Denied applications override allowed ones. Excluded-application windows are masked in full-screen captures, and exact-window capture fails closed for them. Default-on one-shot confirmations cover arbitrary AppleScript, drag, destructive keys, and destructive task intent. An expiring element token may be used only until another semantic snapshot or a source-window geometry change. The plugin does not grant or persist operating-system permissions itself. GUI-model screenshots and intermediate decisions are not separate durable Session events. Enabled per-step images are authorized, UI-only presentation attachments in the final tool result and Session export; the driving model continues to receive text only.

## Verification performed

On the supported base, 59 plugin tests and 98 focused plugin-plus-Harness attachment tests pass. The GUI suite passes 3,822 tests with one skip, and the production web build passes. Native JXA/AppKit/CoreGraphics/System Events scripts compile successfully. A clean-profile browser inspection ran `computer_use_task` through deterministic local driving and vision endpoints and the real macOS screenshot service. The task completed, its saved `computer-use-task-step-1.png` loaded through the session attachment route, and Harness rendered it inline in Step 1 with no browser warning or error. The same inspection verified the default-on switch and every P0 control in the visual GUI Model and GUI Agent cards. A live third-party provider run was not performed.
