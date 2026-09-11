# Harness integration guide

English | [中文](integration.zh.md)

## Supported base

The proven source-integration base is DeepSeek Harness commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`0.1.2-alpha.1`). The supplied [`deepseek-harness-v0.1.2-alpha.1.patch`](../integration/deepseek-harness-v0.1.2-alpha.1.patch) targets that exact commit. Run `git apply --check` before applying it. Another Harness revision requires a compatibility check because settings APIs, client slots, attachment references, package closure, project references, and the lockfile can change.

Upstream has since released [`0.1.2-alpha.5`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5). The adapter code follows its published Settings/Session direction, but alpha.5 compatibility remains unverified until the exact alpha.5 source passes compile, build, boot, and focused integration gates.

## Recommended mount-only profile

When the four packages are already installed or linked in a compatible Harness checkout, mount them without putting any agent choices in deployment YAML. From the Harness root:

```bash
plugin_root=/absolute/path/to/deepseek-harness-macos-use
export DSH_HOME="$(mktemp -d /private/tmp/dsh-macos-profile.XXXXXX)"
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml" --dump-config
node apps/cli/lib/bin.js --profile web --patch "$plugin_root/integration/macos-use.cordis.patch.yml"
```

The `--dump-config` preflight must show these four service IDs: `macos-use`, `browser-use`, `gui-model`, and `tool-macos-use`. [`macos-use.cordis.patch.yml`](../integration/macos-use.cordis.patch.yml) contains only those four mounts and **zero adjustable keys**. Make every agent configuration choice visually on **Settings → Plugins → Plugin configuration**, then keep the same `DSH_HOME` for subsequent launches.

The source-copy patch below remains the developer integration route when the compatible Harness checkout does not yet contain or resolve these packages.

## What the patch wires

The patch registers the four packages in the CLI/runtime closure and TypeScript project references, lets the tool package load its browser client, authorizes UI-only result images referenced from `tool/result.data.meta.content`, exports those images with the Session, updates the lockfile and third-party notice, and adds a synchronized Agent Note for the attachment decision. The client package registers the GUI Model and GUI Agent configuration cards in `settings.plugin.item` and the two task renderers in `tool.call.toolview`.

The package source itself is not duplicated in the patch. Copy `packages/macos-use` into the Harness checkout before or after applying it.

## GUI model settings

Open **Settings → Plugins → Plugin configuration → GUI model**. The page provides a secret field backed by Harness credentials plus visual fields for the credential reference, endpoint, model, and maximum response tokens. Configure these values only on this visual card; package composition merely mounts the capability and does not need to duplicate adjustable agent settings.

A fresh installation may leave `baseURL` and `model` empty so the card can render, but every model request fails closed until both are configured. `/chat/completions` is appended to the base URL. Endpoints reject embedded credentials, query strings, fragments, non-loopback HTTP, and redirects so screenshots and credentials are not sent over a cleartext remote connection or forwarded to an unconfigured host. Loopback HTTP remains available for a local model server. Use the visual secret field or a credential reference in `apiKeyEnv`; do not commit literal API keys. Invalid values are rejected before persistence, and valid changes apply live after Save.

## Desktop and browser settings

Open **Settings → Plugins → Plugin configuration → GUI agent** for all P0 agent controls. The visual card contains:

- reliability: maximum steps, task timeout, macOS command timeout, and semantic elements per window snapshot;
- browser: headed/headless mode, allowed domains, denied domains, and the separate private-network switch;
- safety: precise application read grants, control grants, precise deny rules, legacy name lists, destructive-action confirmation, default-on confirmation for every GUI mutation, and the single-active-task lock;
- screenshots and privacy: the default-on **Show step screenshots** switch and the applications whose windows must never be captured;
- a global **Abort all active GUI tasks** emergency stop that remains available while ordinary settings are saving.

The saved configuration is applied live to `macos-use`, `browser-use`, and `tool-macos-use`. Empty application and browser grants deny access. A precise application rule is one line such as `bundleId=com.apple.TextEdit`, `name=TextEdit | bundleId=com.apple.TextEdit`, or `pid=123`; malformed or duplicate fields reject the Save. Every control rule must be covered by an equal or broader read rule so a successful mutation can always produce its post-action receipt. The screenshot switch defaults to `true`; when enabled, each available task-step screenshot is saved and displayed with that step's output, including plugin-catchable stopped/error results. Turning it off omits the per-step images while preserving the GUI model's private grounding capture and the final screenshot reference.

Save is transactional from the user's perspective: ordinary settings and credential operations are validated as one plan, and a failed write remains visibly dirty instead of being presented as saved. Clearing an inherited text setting saves an explicit empty value; **Reset** is the only action that removes the override and allows inheritance again.

Before primitive, step, and final screenshots enter durable storage, `tool-macos-use` downscales a copy when required by the active attachment byte, pixel, or per-side limit. The GUI model still receives the original capture so action coordinates are unchanged.

Install Chromium from the integrated Harness workspace:

```bash
corepack pnpm exec playwright install chromium
```

Grant Accessibility and Screen Recording permissions to the process that launches Harness. A display-coordinate screenshot never captures the full display: the service passes only the exact authorized foreground-window id to the native capture command, then composites those pixels onto an otherwise black canvas with the main display's coordinate geometry. Its PNG pixel coordinates are converted to global macOS points after a fresh observation is validated, including Retina 1×/2× scaling and a nonzero main-display origin. An excluded, unreadable, secondary-display, spanning, partially outside, or changing foreground window is rejected before transferable pixels are returned.

### Ego Lite backend (experimental)

Set `browserBackend` to `ego` in the GUI Agent settings card to use the ego lite browser instead of Playwright. This requires the [ego lite app](https://github.com/citrolabs/ego-lite) to be installed and the `ego-browser` CLI to be available on PATH.

**This backend does not provide the pinned-proxy network isolation of the default Playwright backend.** Only enable it on trusted networks and with carefully scoped domain grants. See [architecture.md](architecture.md#experimental-ego-lite-backend) for the full risk statement.

When `ego` is active, only selector-based browser tools (`browser_navigate`, `browser_click`, `browser_fill`, `browser_extract_text`, `browser_screenshot`) are available. The `browser_use_task` autonomous loop and coordinate actions are not supported.

## Security boundary

The plugin does not expose caller-supplied arbitrary AppleScript; internal native scripts bind their final target check and input event together. Denied applications override grants. Background windows, the desktop, menus, overlays, and other applications are never included in a display-coordinate raster and therefore do not rely on after-the-fact masking; exact-window capture fails closed for excluded content. One-shot confirmation before every direct or model-selected GUI mutation is default-on. Turn it off only when the deployment supplies an equivalent trusted safety or approval boundary. When it is off, configured heuristic confirmation still covers some destructive drags, keys, and task wording, but it is not a semantic-effect guarantee.

Desktop and browser observations are owner-bound, one-shot, and expiring; they are reserved synchronously before asynchronous revalidation so concurrent replay cannot duplicate a mutation. Native mutations share a service-wide queue and epoch from the final revalidation through dispatch, so a dispatched mutation invalidates every other pending desktop observation. Browser contexts remain isolated per Agent, while each screenshot-coordinate token also binds a viewport digest that must match a fresh capture immediately before dispatch. Navigation, redirects, subresources, and WebSockets are forced through a random-credential loopback proxy. For each outbound connection it revalidates the original hostname, performs one DNS lookup, rejects the entire answer set if any address is non-public unless private access is enabled, and pins the socket to a numeric IP while preserving Host and TLS SNI. Chromium's DNS fallback, implicit loopback bypass, QUIC, Service/Dedicated/Shared Workers, WebRTC, and WebTransport are disabled. This closes the known in-browser DNS-rebinding path but remains defense in depth rather than an OS network sandbox. In-flight cancellation closes only the current Agent's context. The plugin does not grant or persist operating-system permissions itself.

An unsupported, malformed, oversized, stale, or otherwise uncertain model action stops rather than falling through to a guessed action. A task can report completion only after the requested host-side postcondition is verified against a fresh, atomic browser or macOS completion snapshot. User-facing progress and durable task history replace `type` payloads with a character-count placeholder; that output redaction does not conceal text already visible in screenshot pixels. GUI-model screenshots and intermediate decisions are not separate durable Session events. Enabled per-step images are authorized, UI-only presentation attachments in the final tool result and Session export; the driving model continues to receive text only.

## Verification performed

At the current source freeze, the plugin Vitest gate passes **346 tests across 23 files** and the Host and Client TypeScript projects plus the full integrated Harness build pass on the supported alpha.1 base. The logic gate covers settings persistence, visual card registration, fail-closed policy, provider bounds, observation ownership and cleanup, browser isolation, native action guards, atomic completion verification, typed-text output redaction, progress bounds, authorized attachment metadata, and the default-on/default-off screenshot paths.

The separate prompt evaluator passes **19 tests across 8 files**. Its deterministic prompt-to-browser smoke also passes through the real Harness SDK/tool loop and Playwright path, with the final state checked by an independent HTTP oracle.

A dedicated Playwright Chromium render bundles the actual `SettingsCards` and `GuiTaskView` components. It verifies every visual configuration control, both default-on switches, one inline step image in the on state, zero in the off state, and clean console/request/overflow state.

This release evidence does not claim an unlocked native-macOS application capture/action E2E, an exact alpha.5 compile/build/boot, or a live third-party provider run. Keep those gates separate from static, logic, TypeScript, and component-render evidence.
