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

The source and current integration patch are validated against DeepSeek Harness release `0.1.2-alpha.1`, base commit [`cd5ef81`](https://github.com/deepseek-ai/deepseek-harness/commit/cd5ef8148158c3a752a658978873241fdf8e2bbc). The package manifests intentionally retain Harness `workspace:^` dependencies because these packages are designed to be composed inside that workspace.

## Integrate with Harness

1. Check out the compatible Harness commit.
2. Copy this repository's `packages/macos-use` directory into Harness at the same path.
3. From the Harness root, check and apply [`integration/deepseek-harness-v0.1.2-alpha.1.patch`](integration/deepseek-harness-v0.1.2-alpha.1.patch).
4. Install dependencies, build, and run the focused tests:

```bash
git checkout cd5ef8148158c3a752a658978873241fdf8e2bbc
cp -R /path/to/deepseek-harness-macos-use/packages/macos-use ./packages/
git apply --check /path/to/deepseek-harness-macos-use/integration/deepseek-harness-v0.1.2-alpha.1.patch
git apply /path/to/deepseek-harness-macos-use/integration/deepseek-harness-v0.1.2-alpha.1.patch
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm exec vitest run packages/macos-use/*/tests/*.spec.ts
corepack pnpm exec playwright install chromium
```

See the [integration guide](docs/integration.md) and [architecture decision](docs/architecture.md) for configuration, security boundaries, and verification evidence.

## Evaluate from a user prompt

The repository includes a [prompt-level evaluation runner](evaluations/README.md). It sends an exact natural-language prompt through a fresh Harness SDK session, records tool and per-step screenshot presentation evidence, and scores the outcome with an independent HTTP or workspace-file oracle. A deterministic smoke exercises the real Playwright and screenshot path without third-party credentials; a live mode reuses GUI Model and GUI Agent settings made visually on the Plugin Configuration page.

## Runtime requirements

- macOS Accessibility permission for GUI actions.
- macOS Screen Recording permission for screenshots.
- A configured OpenAI-compatible vision endpoint for `gui-model`.
- Playwright Chromium for browser control.

## Current limits

The plugin suites pass 59 tests, and the focused plugin-plus-Harness attachment suites pass 98 tests. The prompt evaluator passes 18 focused tests. Its deterministic prompt smoke passed on Harness commit `cd5ef81`: the exact prompt selected `browser_use_task`, changed the independent order-state oracle to `Reviewed`, and produced two 1280×720 per-step screenshot attachments. The complete GUI suite passes 3,822 tests with one skip, and the production web build passes on the compatible base. Deterministic web replay passes 310 tests across 91 files with 15 skips; its sole failing core HMR test reproduces unchanged on the pristine compatible base under Node 22.22.0. A clean-profile UI test used the real macOS screenshot service and deterministic local driving and vision endpoints: `computer_use_task` completed, and Harness displayed `computer-use-task-step-1.png` inline in Step 1 from its authorized attachment. The same browser inspection confirmed the default-on switch and every adjustable agent setting on the visual Plugin Configuration page. Live third-party provider compatibility still requires deployment credentials; deterministic runs do not claim provider compatibility.
