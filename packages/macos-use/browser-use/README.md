# @deepseek-ai/dsh-browser-use

English | [中文](README.zh.md)

Browser-control capability seam (`ctx.browserUse`) backed by one Playwright Chromium page. The browser launches lazily on first use, is reused across calls, and closes on plugin disposal. The service supports both DOM-selector actions and coordinate-grounded actions for `browser_use_task` in `@deepseek-ai/dsh-tool-macos-use`.

## API

`BrowserUseService` is the default export and registers as `ctx.browserUse`:

- `navigate({ url }, signal?)`
- `clickSelector({ selector }, signal?)`
- `fillSelector({ selector, text }, signal?)`
- `extractText({ selector? }, signal?)` -> text
- `clickAt({ x, y, doubleClick? }, signal?)`
- `type({ text }, signal?)`
- `key({ key }, signal?)` using Playwright key names such as `Enter` and `Control+A`
- `screenshot(signal?)` -> `{ pngBase64 }`

Failures raise `BrowserUseError` with a stable `code`.

## Config

```yaml
config:
  headless: true # optional, default true
```

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-macos-use`, which owns the browser tool schemas and rendered results.

#### KV Cache effect

This service registers no prompt or schema directly, so loading it does not change the driving model's reusable request prefix.

## Known Limitations and Deferred Work

- Playwright's Chromium browser must be installed separately with `pnpm exec playwright install chromium`; a missing browser surfaces as `BROWSER_USE_LAUNCH_FAILED` on first use.
- One browser context and one page are supported; multi-tab and multi-context workflows are deferred.
- `key` uses Playwright key names rather than the macOS service's `cmd+shift+t`-style vocabulary.
- Cancellation is checked before dispatch, but an already-running Playwright operation is not interrupted through the signal.
- The unit suite covers lazy launch, page reuse, actions, disposal, pre-dispatch cancellation, and stable error codes; a real-browser end-to-end suite is deferred.
