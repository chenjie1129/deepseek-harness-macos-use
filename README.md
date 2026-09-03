# DeepSeek Harness macOS Use plugin

English | [中文](README.zh.md)

This repository contains only the macOS GUI/browser-control plugin developed for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is a four-package capability family, not a copy of the Harness monorepo and not a standalone application.

## Packages

| Package | Harness capability | Purpose |
|---|---|---|
| [`@deepseek-ai/dsh-macos-use`](packages/macos-use/macos-use) | `ctx.macosUse` | Authorized foreground-window capture on a black display-coordinate canvas, exact-window capture, application/window discovery, Accessibility state, and target-guarded native actions |
| [`@deepseek-ai/dsh-browser-use`](packages/macos-use/browser-use) | `ctx.browserUse` | Live-configurable Playwright Chromium navigation, selector/coordinate actions, dragging, and screenshots |
| [`@deepseek-ai/dsh-gui-model`](packages/macos-use/gui-model) | `ctx.guiModel` | OpenAI-compatible vision requests that turn screenshots into validated GUI actions |
| [`@deepseek-ai/dsh-tool-macos-use`](packages/macos-use/tool-macos-use) | model-facing tools | Desktop/browser primitives and bounded `computer_use_task` / `browser_use_task` loops |

## P0 reliability and safety

The plugin exposes 21 model-facing tools, including app/window discovery, exact-window screenshots, semantic Accessibility snapshots, expiring element tokens, pointer movement and drag, focus, scroll, abort, and bounded desktop/browser task loops. Autonomous work has a wall-clock deadline, a single-task lock, and an emergency stop. Caller-supplied AppleScript is deliberately not exposed. An action that cannot be validated with confidence stops the task instead of being guessed or silently replaced.

Every adjustable agent setting is visible on Harness's **Plugin Configuration** page. The GUI Model card contains the API credential reference, endpoint, model, and response limit. The GUI Agent card contains step and timeout limits, semantic snapshot size, browser visibility and network grants, exact application read/control grants, deny rules, confirmation controls, the single-task lock, screenshot privacy exclusions, and the emergency stop. Empty network and application grants deny access. **Confirm every GUI mutation** is on by default and asks separately before each direct or model-selected GUI-changing action. Turn it off only when the deployment has an equivalent trusted safety or approval boundary; the remaining destructive-action confirmation is heuristic and does not guarantee the semantic effect of a coordinate action. **Show step screenshots** is also on by default: when a step has a screenshot, the image is saved and shown alongside that step's user-facing output, including structured stopped/error results when the plugin can still return one. Turning it off omits those per-step images without changing the GUI model's private grounding capture or the final screenshot reference.

Retina and other oversized captures are downscaled only for durable display storage, using the active attachment limits. A display-coordinate observation never captures the full display: the native service captures only the exact authorized foreground window and composites it onto an otherwise black main-display canvas. Its PNG pixels are converted to global macOS points only after a fresh, owner-bound observation is validated. A foreground window on, spanning, or partially outside another display is rejected rather than acted on from incomplete pixels. All native mutations share one service-wide queue and mutation epoch, so a dispatched action invalidates every stale desktop observation, including observations owned by another Agent.

Browser traffic is forced through an authenticated, per-service loopback proxy. Each outbound connection revalidates the original hostname, resolves it once, rejects the entire answer set when any address is non-public unless private access is explicitly enabled, and pins the socket to the selected numeric address while preserving the original Host header and TLS SNI. Chromium DNS fallbacks, the implicit loopback proxy bypass, QUIC, workers, WebRTC, and WebTransport are disabled. Screenshot-coordinate actions consume their token and compare a freshly captured viewport digest immediately before dispatch. These controls close the known in-browser DNS-rebinding route, but they do not replace an operating-system or container firewall.

User-facing progress and durable task output redact the payload of `type` actions as a character count; this prevents typed text from being echoed through action history, but it does not claim to redact text that is visibly present in a screenshot. A task is marked complete only after its requested host-side postcondition is checked against a fresh browser or macOS completion snapshot. The final result is assembled from that atomic completion snapshot rather than mixing observations from different moments.

## Compatibility

The proven source-integration base is DeepSeek Harness release `0.1.2-alpha.1`, commit [`cd5ef81`](https://github.com/deepseek-ai/deepseek-harness/commit/cd5ef8148158c3a752a658978873241fdf8e2bbc). The latest upstream release is [`0.1.2-alpha.5`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5), but this repository does not claim alpha.5 compatibility until the exact source has passed compile, build, boot, and focused integration gates. The package manifests intentionally retain Harness `workspace:^` dependencies because these packages are composed with Harness.

## Recommended mount-only integration

Use the mount patch from a compatible Harness checkout in which the four plugin packages are installed or linked. Run these commands from the Harness root:

```bash
plugin_root=/absolute/path/to/deepseek-harness-macos-use
export DSH_HOME="$(mktemp -d /private/tmp/dsh-macos-profile.XXXXXX)"
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml" --dump-config
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml"
```

The preflight dump must contain `macos-use`, `browser-use`, `gui-model`, and `tool-macos-use`. [`integration/macos-use.cordis.patch.yml`](integration/macos-use.cordis.patch.yml) only mounts those four services and contains **zero adjustable agent settings**. After launch, make every model, credential, network, application, safety, timeout, and screenshot choice visually on **Plugin Configuration**. Keep the same `DSH_HOME` when relaunching so Harness reuses those visual settings.

## Developer source integration

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
corepack pnpm exec vitest run packages/macos-use/*/tests/*.spec.ts packages/macos-use/*/tests/*.spec.tsx
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

## Current verification boundary

At the current source freeze, the plugin Vitest gate passes **330 tests across 22 files**, and the plugin Host and Client TypeScript projects plus the full integrated Harness build pass on the proven alpha.1 base. These checks cover configuration, policy, lifecycle, actions, progress, attachment metadata, the screenshot switch, and output redaction. The separate prompt-evaluator suite passes **19 tests across 8 files**, and its deterministic prompt-to-browser smoke passes against an independent HTTP oracle.

A dedicated Playwright Chromium render bundles the actual `SettingsCards` and `GuiTaskView` components. It verifies every configuration control, both default-on safety/screenshot switches, one inline step image when screenshots are on, zero when off, and clean console/request/overflow state.

This evidence does **not** claim an unlocked native-macOS application capture/action E2E, exact alpha.5 compile/build/boot compatibility, or a live third-party main-model/GUI-model run. Those gates require the corresponding host state, exact upstream source, or provider credentials and must be reported separately when performed.
