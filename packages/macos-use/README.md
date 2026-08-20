# macos-use

English | [中文](README.zh.md)

"Mac OS Use Agent Tools" is a capability-seam family that lets the agent operate the local computer through macOS APIs, GUI automation, and a real driven browser instead of relying only on the filesystem and shell.

| Package | `ctx` key | Role |
|---|---|---|
| [`macos-use`](macos-use/README.md) | `macosUse` | Screenshots, System Events GUI automation, app launch, and AppleScript |
| [`gui-model`](gui-model/README.md) | `guiModel` | Calls a configured OpenAI-compatible vision endpoint to choose the next GUI action from a screenshot |
| [`browser-use`](browser-use/README.md) | `browserUse` | Runs a Playwright-driven Chromium tab with selector and coordinate actions |
| [`tool-macos-use`](tool-macos-use/README.md) | — | Registers model-facing primitive tools and the `computer_use_task` / `browser_use_task` loops |

## Configuring the GUI model

`gui-model` exposes live `apiKeyEnv`, `baseURL`, `model`, and `maxOutputTokens` settings on the ordinary plugin-configuration surface. Point `baseURL` at an OpenAI-compatible vision chat-completions endpoint and prefer a credential reference through `apiKeyEnv` over a literal key.

## Known Limitations and Deferred Work

- This package group has focused unit coverage and participates in the repository build and documentation gates, but it does not yet have a keyless assembled GUI snapshot or a real desktop/browser end-to-end suite.
- Desktop automation requires Accessibility permission, and screenshots require Screen Recording permission, granted to the host process in System Settings.
- Browser automation requires Playwright's Chromium browser to be installed separately with `pnpm exec playwright install chromium`.
