# DeepSeek Harness macOS Use plugin

English | [中文](README.zh.md)

This repository contains only the macOS GUI/browser-control plugin developed for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is a four-package capability family, not a copy of the Harness monorepo and not a standalone application.

## Packages

| Package | Harness capability | Purpose |
|---|---|---|
| [`@deepseek-ai/dsh-macos-use`](packages/macos-use/macos-use) | `ctx.macosUse` | Screenshots, System Events automation, application launch, and AppleScript |
| [`@deepseek-ai/dsh-browser-use`](packages/macos-use/browser-use) | `ctx.browserUse` | Playwright Chromium navigation, selector actions, coordinate actions, and screenshots |
| [`@deepseek-ai/dsh-gui-model`](packages/macos-use/gui-model) | `ctx.guiModel` | OpenAI-compatible vision requests that turn screenshots into validated GUI actions |
| [`@deepseek-ai/dsh-tool-macos-use`](packages/macos-use/tool-macos-use) | model-facing tools | Desktop/browser primitives and bounded `computer_use_task` / `browser_use_task` loops |

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

Focused tests, the full Harness build, lint, documentation, hygiene, and type-check gates passed on the compatible base. Live provider compatibility and a real desktop/browser end-to-end suite still require deployment credentials and operating-system permissions.
