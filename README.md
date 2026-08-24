# DeepSeek Harness macOS Use plugin

English | [中文](README.zh.md)

This repository contains only the macOS GUI/browser-control plugin developed for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is a four-package capability family, not a copy of the Harness monorepo and not a standalone application.

## Packages

| Package | Harness capability | Purpose |
|---|---|---|
| [`@deepseek-ai/dsh-macos-use`](packages/macos-use/macos-use) | `ctx.macosUse` | Redacted screen and exact-window capture, application/window discovery, Accessibility state, pointer actions, and AppleScript |
| [`@deepseek-ai/dsh-browser-use`](packages/macos-use/browser-use) | `ctx.browserUse` | Live-configurable Playwright Chromium navigation, selector/coordinate actions, dragging, and screenshots |
| [`@deepseek-ai/dsh-gui-model`](packages/macos-use/gui-model) | `ctx.guiModel` | OpenAI-compatible vision requests that turn screenshots into validated GUI actions |
| [`@deepseek-ai/dsh-tool-macos-use`](packages/macos-use/tool-macos-use) | model-facing tools | Desktop/browser primitives and bounded `computer_use_task` / `browser_use_task` loops |

## P0 reliability and safety

The plugin exposes 22 model-facing tools, including app/window discovery, exact-window screenshots, semantic Accessibility snapshots, expiring element tokens, pointer movement and drag, focus, scroll, abort, and bounded desktop/browser task loops. Autonomous work has a wall-clock deadline, a single-task lock, and an emergency stop.

Every adjustable agent setting is visible on Harness's **Plugin Configuration** page. The GUI Model card contains the API credential reference, endpoint, model, and response limit. The GUI Agent card contains step and timeout limits, semantic snapshot size, browser visibility, app allow/deny lists, confirmation controls, the single-task lock, screenshot privacy exclusions, and the emergency stop. **Show step screenshots** is on by default: when a step has a screenshot, the image is saved and shown alongside that step's user-facing output. Turning it off omits those per-step images without changing the GUI model's private grounding capture or the final screenshot reference.

Retina and other oversized captures are downscaled only for durable display storage, using the active attachment limits. The original screenshot still grounds GUI actions, so normalization does not change their coordinate system.

## Compatibility

The source and integration patch were validated against DeepSeek Harness release `0.1.0-rc.8`, base commit [`141eb6f`](https://github.com/deepseek-ai/deepseek-harness/commit/141eb6fef83422698aef7a981029e843e8161534). The package manifests intentionally retain Harness `workspace:^` dependencies because these packages are designed to be composed inside that workspace.

## Integrate with Harness

1. Check out the compatible Harness commit.
2. Copy this repository's `packages/macos-use` directory into Harness at the same path.
3. From the Harness root, check and apply [`integration/deepseek-harness-rc8.patch`](integration/deepseek-harness-rc8.patch).
4. Install dependencies, build, and run the focused tests:

```bash
git checkout 141eb6fef83422698aef7a981029e843e8161534
cp -R /path/to/deepseek-harness-macos-use/packages/macos-use ./packages/
git apply --check /path/to/deepseek-harness-macos-use/integration/deepseek-harness-rc8.patch
git apply /path/to/deepseek-harness-macos-use/integration/deepseek-harness-rc8.patch
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm exec vitest run packages/macos-use/*/tests/*.spec.ts
corepack pnpm exec playwright install chromium
```

See the [integration guide](docs/integration.md) and [architecture decision](docs/architecture.md) for configuration, security boundaries, and verification evidence.

## Runtime requirements

- macOS Accessibility permission for GUI actions.
- macOS Screen Recording permission for screenshots.
- A configured OpenAI-compatible vision endpoint for `gui-model`.
- Playwright Chromium for browser control.

## Current limits

Focused P0 suites passed 121 tests, the full GUI suite passed 3,968 tests with one skip, the production build passed, and all 28 documentation gates passed on the compatible base. A clean-profile UI smoke used the real macOS screenshot service and a deterministic local vision endpoint: the GUI model received a PNG and Harness displayed the resulting 2000×1125 image inline in Step 1. The same browser inspection confirmed all agent configuration on the visual Plugin Configuration page. The assembled web replay built successfully and passed 79 files with one skip; three pre-existing replay expectations remain unrelated to this plugin change. Live third-party provider compatibility and action-taking desktop/browser end-to-end tests still require deployment credentials and suitable operating-system permissions.
