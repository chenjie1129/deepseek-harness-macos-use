# macos-use

English | [中文](README.zh.md)

"Mac OS Use Agent Tools" is a capability-seam family that lets the agent operate the local computer through macOS APIs, GUI automation, and a real driven browser instead of relying only on the filesystem and shell.

| Package | `ctx` key | Role |
|---|---|---|
| [`macos-use`](macos-use/README.md) | `macosUse` | Screenshots, System Events GUI automation, app launch, and AppleScript |
| [`gui-model`](gui-model/README.md) | `guiModel` | Calls a configured OpenAI-compatible vision endpoint to choose the next GUI action from a screenshot |
| [`browser-use`](browser-use/README.md) | `browserUse` | Runs a Playwright-driven Chromium tab with selector and coordinate actions |
| [`tool-macos-use`](tool-macos-use/README.md) | — | Registers model-facing primitive tools and the `computer_use_task` / `browser_use_task` loops |

## Visual configuration

Every adjustable GUI-agent setting is available on the ordinary **Plugin Configuration** page. The GUI-model card owns the credential, OpenAI-compatible endpoint, model name, and response budget. The macOS-use card owns task and command timeouts, step and accessibility-element budgets, Chromium headless mode, application allow/deny lists, approval switches, single-task locking, screenshot presentation and exclusion lists, and the immediate abort control. Changes apply live; no YAML edit or restart is required.

The per-step screenshot switch defaults on and shows the screenshot used for each `computer_use_task` or `browser_use_task` step beside that step's result. Turn it off to avoid saving and displaying those per-step captures. Full-screen captures mask windows belonging to the configured exclusion list before storage or vision use.

Stored screenshots are automatically downscaled when a Retina or large browser capture exceeds the active attachment limits. The original pixels still ground GUI actions; only the durable display copy is normalized.

## P0 reliability and safety

The desktop seam can enumerate applications and windows, capture one exact window, flatten the front window's Accessibility tree, focus a named window, and move, click, drag, type, press keys, or scroll. Accessibility snapshots issue opaque element tokens. Coordinate tools may target a token instead of raw coordinates, and tokens fail closed after a newer snapshot or a window-geometry change.

Desktop actions enforce the live application policy. Denied applications always win; a non-empty allow list restricts control to its members. Arbitrary AppleScript, drag operations, destructive key combinations, and destructive autonomous tasks can require an explicit user confirmation. Only one autonomous GUI task runs at a time by default, every task has a wall-clock timeout, and the visual emergency stop aborts the active task immediately.

## Known Limitations and Deferred Work

- A configured vision provider is still required for autonomous task loops; primitive and semantic tools do not require one.
- Desktop automation requires Accessibility permission, and screenshots require Screen Recording permission, granted to the host process in System Settings.
- Browser automation requires Playwright's Chromium browser to be installed separately with `pnpm exec playwright install chromium`.
