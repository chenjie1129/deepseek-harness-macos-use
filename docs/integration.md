# Harness integration guide

English | [中文](integration.zh.md)

## Supported base

The supplied patch targets DeepSeek Harness commit `141eb6fef83422698aef7a981029e843e8161534` (`0.1.0-rc.8`). Run `git apply --check` before applying it. Newer Harness revisions may require a manual rebase because settings cards, package references, generated catalogs, and the lockfile can change.

## What the patch wires

The patch registers the four packages in the CLI/runtime closure and TypeScript project references, exposes the GUI-model and GUI-task presentation settings namespaces to the web client, adds the GUI Model and GUI Tasks settings cards, renders authorized UI-only step images in generic task results, exports those images with the Session, registers the model-facing tool and Cordis catalogs, updates the lockfile and third-party notice, and adds synchronized subsystem/tool/configuration documentation.

The package source itself is not duplicated in the patch. Copy `packages/macos-use` into the Harness checkout before or after applying it.

## GUI model settings

Configure the `gui-model` plugin section with:

```yaml
config:
  apiKeyEnv: GUI_MODEL_API_KEY
  baseURL: https://api.example.com/v1
  model: your-vision-model
  maxOutputTokens: 512
```

`baseURL` and `model` are required. `/chat/completions` is appended to the base URL. Prefer a credential reference in `apiKeyEnv`; do not commit literal API keys.

## Desktop and browser settings

`macos-use` accepts an optional `commandTimeoutMs` (default behavior is documented in its package README). `browser-use` accepts `headless`, and `tool-macos-use` accepts `defaultMaxSteps` plus the live `showStepScreenshots` switch. The switch defaults to `true`; when enabled, each available task-step screenshot is saved and displayed with that step's output. Turning it off omits the per-step images while preserving the final screenshot reference.

Install Chromium from the integrated Harness workspace:

```bash
corepack pnpm exec playwright install chromium
```

Grant Accessibility and Screen Recording permissions to the process that launches Harness. Coordinate conversion between screenshot pixels and macOS screen points is not normalized for Retina or multi-display layouts.

## Security boundary

The plugin can execute arbitrary AppleScript and control desktop/browser interfaces. Keep these tools behind the Harness deployment policy and approval surface. The plugin does not grant or persist operating-system permissions itself. GUI-model screenshots and intermediate decisions are not separate durable Session events. Enabled per-step images are authorized, UI-only presentation attachments in the final tool result and Session export; the driving model continues to receive text only.

## Verification performed

On the supported base, the feature-focused tests, 3,965-test GUI suite, production build, contract lint, 28 documentation gates, whitespace checks, and targeted TypeScript builds passed. The assembled web replay built successfully; its run reported 79 passed, one skipped, and three unrelated pre-existing failures (the official-logo snapshot, Node 22 development loader, and an existing plan-review golden). Live provider and real GUI end-to-end checks were not run because they require credentials and macOS permission grants.
