# Harness integration guide

English | [中文](integration.zh.md)

## Supported base

The supplied patch targets DeepSeek Harness commit `141eb6fef83422698aef7a981029e843e8161534` (`0.1.0-rc.8`). Run `git apply --check` before applying it. Newer Harness revisions may require a manual rebase because settings cards, package references, generated catalogs, and the lockfile can change.

## What the patch wires

The patch registers the four packages in the CLI/runtime closure and TypeScript project references, exposes the GUI-model settings namespace to the web client, adds the GUI Model settings card, registers the model-facing tool and Cordis catalogs, updates the lockfile and third-party notice, and adds synchronized subsystem/tool/configuration documentation.

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

`macos-use` accepts an optional `commandTimeoutMs` (default behavior is documented in its package README). `browser-use` accepts `headless`, and `tool-macos-use` accepts `defaultMaxSteps`.

Install Chromium from the integrated Harness workspace:

```bash
corepack pnpm exec playwright install chromium
```

Grant Accessibility and Screen Recording permissions to the process that launches Harness. Coordinate conversion between screenshot pixels and macOS screen points is not normalized for Retina or multi-display layouts.

## Security boundary

The plugin can execute arbitrary AppleScript and control desktop/browser interfaces. Keep these tools behind the Harness deployment policy and approval surface. The plugin does not grant or persist operating-system permissions itself. GUI-model screenshots and intermediate decisions are not separate durable Session events; the final task result retains the action/outcome summary and attachment reference.

## Verification performed

On the supported base, 50 focused tests passed along with the complete Harness lint, production build, hygiene suite, 28 documentation gates, whitespace checks, and pre-push TypeScript checks. Live provider and real GUI end-to-end checks were not run because they require credentials and macOS permission grants.
