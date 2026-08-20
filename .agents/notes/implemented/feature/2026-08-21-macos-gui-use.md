# Agent Note: macOS GUI and browser use

Status: implemented

English | [中文](2026-08-21-macos-gui-use.zh.md)

## Problem

The harness can edit files and run shell commands, but it has no explicit capability seam for applications that expose work only through a macOS GUI or a rendered browser page. Adding desktop control directly to one model-facing tool would mix operating-system execution, browser lifecycle, vision-provider configuration, loop policy, and result durability in one package.

## Decision

The implementation adds a four-package `macos-use` family. A dedicated GUI-model service sends screenshots to a configurable OpenAI-compatible vision endpoint, so GUI grounding does not require the driving model to accept image inputs. The endpoint, model, output cap, and credential reference are live plugin settings.

## Capability split

- `@deepseek-ai/dsh-macos-use` owns macOS screenshots, System Events actions, application launch, and AppleScript execution through `ctx.subprocess`.
- `@deepseek-ai/dsh-browser-use` owns one lazily launched Playwright Chromium page and exposes selector, text, keyboard, coordinate, and screenshot operations.
- `@deepseek-ai/dsh-gui-model` owns one independent screenshot-to-action request and validates the returned action union.
- `@deepseek-ai/dsh-tool-macos-use` owns the model-facing primitive schemas plus bounded desktop and browser action loops.

## Security and durability

macOS Accessibility and Screen Recording permissions remain host-controlled. Arbitrary AppleScript and GUI actions run through the ordinary tool execution and deployment policy surface; this package family does not create a persistent permission grant. Screenshot bytes are stored through `ctx.attachments`, while the driving model receives text references because its primary adapter rejects image tool-result content. GUI-model requests and intermediate decisions remain outside the driving Session log; the final task result retains the completion state, summary, action/outcome list, and final screenshot reference.

## Alternatives considered

- **Shell-only control.** Shell commands cannot reliably observe or operate applications whose meaningful state exists only in a rendered interface.
- **One monolithic plugin.** A single package would couple browser, desktop, provider, settings, tool schema, and loop changes, preventing independent replacement and focused tests.
- **Driving-model vision.** Requiring the main agent model to consume screenshots would make desktop capability depend on that model's modality support and would put large image results into ordinary conversation history.

## Verification

Focused suites cover AppleScript construction, macOS service behavior, GUI response parsing and requests, browser lifecycle and actions, settings-card registration, and bounded task-loop execution. The packages pass repository build, hygiene, generated-catalog, bilingual-documentation, and pre-push typecheck gates. Live provider credentials, macOS permission grants, and a real GUI end-to-end suite remain deployment checks.

## Consequences

Products can compose desktop execution, browser execution, GUI grounding, and model-facing tools independently while keeping the driving model text-only. The separation adds explicit configuration and installation requirements: Playwright Chromium must be present, the host must have operating-system permissions, and a compatible vision endpoint must be configured. Intermediate GUI steps are observable in the final result but are not independently durable Session events.
