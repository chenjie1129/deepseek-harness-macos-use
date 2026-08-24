# Harness integration guide

English | [中文](integration.zh.md)

## Supported base

The supplied patch targets DeepSeek Harness commit `141eb6fef83422698aef7a981029e843e8161534` (`0.1.0-rc.8`). Run `git apply --check` before applying it. Newer Harness revisions may require a manual rebase because settings cards, package references, generated catalogs, and the lockfile can change.

## What the patch wires

The patch registers the four packages in the CLI/runtime closure and TypeScript project references, exposes the GUI-model and GUI-agent settings namespaces to the web client, adds the GUI Model and GUI Agent configuration cards, renders authorized UI-only step images in generic task results, exports those images with the Session, registers the model-facing tool and Cordis catalogs, updates the lockfile and third-party notice, and adds synchronized subsystem/tool/configuration documentation.

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

On the supported base, 121 focused P0 tests, the GUI suite with 3,968 passing tests and one skip, the production build, 28 documentation gates, whitespace checks, and targeted TypeScript builds passed. Native JXA/AppKit/CoreGraphics/System Events scripts also compiled successfully. A clean-profile browser inspection ran `computer_use_task` against a deterministic local vision response and a real macOS screenshot. The local GUI endpoint verified that it received PNG image input; with the default-on switch, Harness rendered the image inline in Step 1 at a 2000×1125 natural size and then completed the task. The same inspection verified every P0 control in the visual GUI Model and GUI Agent cards. The assembled web replay built successfully; its run reported 79 passed files, one skipped, and three unrelated pre-existing failures (the official-logo snapshot, Node 22 development loader, and an existing plan-review golden). A live third-party provider and action-taking desktop/browser end-to-end run were not performed.
