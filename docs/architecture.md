# Agent Note: macOS GUI and browser use

Status: implemented

English | [中文](architecture.zh.md)

## Problem

The harness can edit files and run shell commands, but it has no explicit capability seam for applications that expose work only through a macOS GUI or a rendered browser page. Adding desktop control directly to one model-facing tool would mix operating-system execution, browser lifecycle, vision-provider configuration, loop policy, and result durability in one package.

## Decision

The implementation adds a four-package `macos-use` family. A dedicated GUI-model service sends screenshots to a configurable OpenAI-compatible vision endpoint, so GUI grounding does not require the driving model to accept image inputs. The endpoint, model, output cap, and credential reference are live visual plugin settings. P0 adds a semantic window-observation path alongside pixels: application and window discovery, exact-window capture, flattened Accessibility elements, and opaque element tokens that expire after a new snapshot or window-geometry change.

## Capability split

- `@deepseek-ai/dsh-macos-use` owns redacted full-screen and exact-window capture, application/window discovery, Accessibility state, System Events actions, CoreGraphics pointer movement/dragging, application launch, and AppleScript execution through `ctx.subprocess`.
- `@deepseek-ai/dsh-browser-use` owns one lazily launched Playwright Chromium page and exposes selector, text, keyboard, coordinate, drag, and screenshot operations; a live headed/headless change safely restarts that browser on its next action.
- `@deepseek-ai/dsh-gui-model` owns one independent screenshot-to-action request and validates the returned action union.
- `@deepseek-ai/dsh-tool-macos-use` owns the model-facing primitive schemas plus bounded desktop and browser action loops.

## Security and durability

macOS Accessibility and Screen Recording permissions remain host-controlled. Denied applications override the allow list. Full-screen capture masks excluded-app windows, while an exact-window request for excluded content fails closed. Arbitrary AppleScript, drag, destructive keys, and destructive task intent can require one-shot confirmation. A single-task lock, task deadline, command deadline, explicit abort tool, and visual emergency stop bound autonomous control; this package family does not create a persistent permission grant.

Screenshot bytes are stored through `ctx.attachments`, while the driving model receives text references because its primary adapter rejects image tool-result content. GUI-model requests and intermediate decisions remain outside the driving Session log. A default-on presentation setting can retain each step's grounding screenshot as authorized UI-only result content, while the final task result still retains the completion state, summary, action/outcome list, and final screenshot reference. Stored copies are normalized to the active attachment limits without changing the original grounding pixels or action coordinates.

The tool package has Host and Client faces. The Host projects retained step images into `tool/result.data.meta.content`; the Session Controller authorizes those references and Session export includes their objects. The Client validates that metadata, loads images through the Session attachment route, and renders the task card through the keyed `tool.call.toolview` slot. The task output schema accepts the attachment service's optional `originalDimensions` metadata when normalization downscales a capture.

## Alternatives considered

- **Shell-only control.** Shell commands cannot reliably observe or operate applications whose meaningful state exists only in a rendered interface.
- **One monolithic plugin.** A single package would couple browser, desktop, provider, settings, tool schema, and loop changes, preventing independent replacement and focused tests.
- **Driving-model vision.** Requiring the main agent model to consume screenshots would make desktop capability depend on that model's modality support and would put large image results into ordinary conversation history.

## Verification

Focused suites cover AppleScript and native-script construction, macOS service behavior, semantic-token expiry, task coordination and abort, GUI response parsing and requests, browser lifecycle/actions, policy confirmations, output-schema validation, visual settings-card registration, authorized attachment loading, and bounded task-loop execution. The packages pass the production web build and full GUI gate. A clean-profile live UI test also exercised a real screenshot through the local vision boundary and displayed its attachment inline in Step 1. Live third-party provider credentials remain a deployment check.

## Consequences

Products can compose desktop execution, browser execution, GUI grounding, and model-facing tools independently while keeping the driving model text-only. Every adjustable P0 agent option is presented visually in the GUI Model or GUI Agent card on the Plugin Configuration page; the deployment file remains an auditable representation, not the only way to configure the agent. The separation adds explicit installation requirements: Playwright Chromium must be present and the host must have operating-system permissions. Intermediate GUI steps are observable in the final result, optionally with their screenshots, but are not independently durable Session events.
