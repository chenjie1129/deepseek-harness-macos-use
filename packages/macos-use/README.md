---
description: "The macOS-use package group: local desktop, browser, GUI-model, and model-facing tool packages for computer-use agents."
kind: "package-group"
---

# macos-use/ — macOS and browser computer use

English | [中文](README.zh.md)

## Summary

This family lets an agent operate the local Mac and an isolated Chromium page, inspect macOS Accessibility state, and delegate screenshot grounding to an OpenAI-compatible vision model. `macos-use` owns native desktop control, `browser-use` owns per-Agent managed browser contexts, `gui-model` owns vision decisions, and `tool-macos-use` exposes those capabilities to an agent. All adjustable agent settings appear on the Plugin Configuration page, including default-deny application/network grants, default-on confirmation before every GUI mutation, the default-on per-step screenshot switch, and emergency stop. Every-mutation confirmation should be disabled only when an equivalent trusted safety or approval boundary exists. The package boundary does not bypass macOS permissions, application policy, or user confirmations.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the package that owns the behavior you need; the tool package composes all three capability seams.

| Package | `ctx` key | Role |
|---|---|---|
| [`macos-use`](macos-use/README.md) | `macosUse` | Captures exact authorized foreground/window pixels and controls permitted macOS applications and windows |
| [`gui-model`](gui-model/README.md) | `guiModel` | Selects one validated GUI action from a screenshot and task |
| [`browser-use`](browser-use/README.md) | `browserUse` | Drives an isolated Playwright Chromium context/page per Agent through a DNS-pinned policy proxy |
| [`tool-macos-use`](tool-macos-use/README.md) | — | Registers primitive tools, autonomous task loops, visual settings, and screenshot presentation |

<a id="related-documentation"></a>
## Related documentation

- [Repository architecture](../../docs/architecture.md) — integration boundaries and current Harness compatibility.
- [Tool runtime subsystem](../../docs/subsystems/tools.md) — generated service and tool-runtime contracts after integration.
- [Tool package](tool-macos-use/README.md) — visual configuration, safety policy, and model-facing tools.
- [GUI model package](gui-model/README.md) — the separate screenshot-grounding request boundary.

<a id="dev-note"></a>
## Dev Note

None.
