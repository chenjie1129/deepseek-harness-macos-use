/**
 * Service Definition and Playwright-backed implementation for the browser-use capability seam (`ctx.browserUse`):
 * a real, single-tab Chromium browser reused across calls, offering both DOM-selector actions (navigate, click,
 * fill, extract text — reliable and fast) and coordinate-grounded actions (click at a pixel, type, press a key —
 * for the vision-model-driven `browser_use_task` loop in `@deepseek-ai/dsh-tool-macos-use`). The browser launches
 * lazily on first use and is closed on plugin disposal.
 * @module @deepseek-ai/dsh-browser-use
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { BrowserUseError } from './types.ts'
import type {
  BrowserScreenshotResult,
  ClickAtRequest,
  ClickSelectorRequest,
  ExtractTextRequest,
  FillSelectorRequest,
  KeyPressRequest,
  NavigateRequest,
  TypeTextRequest,
} from './types.ts'

export { BrowserUseError } from './types.ts'
export type {
  BrowserScreenshotResult,
  BrowserUseErrorCode,
  ClickAtRequest,
  ClickSelectorRequest,
  ExtractTextRequest,
  FillSelectorRequest,
  KeyPressRequest,
  NavigateRequest,
  TypeTextRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    browserUse: BrowserUseService
  }
}

/** Config for the browser-use seam. */
export interface Config {
  /** Run Chromium headless. Defaults to true; set false to watch the browser drive itself. */
  headless?: boolean
}

const BROWSER_USE_DEFAULT_HEADLESS = true

export const Config: z<Config> = z.object({
  headless: z.boolean(),
})

/**
 * Browser-use service. Registered as `ctx.browserUse` (one instance per context). Requires Playwright's Chromium
 * browser to be installed (`pnpm exec playwright install chromium`) — a missing browser surfaces as
 * `BROWSER_USE_LAUNCH_FAILED` on first use, not at plugin load.
 */
export class BrowserUseService extends Service {
  static Config = Config

  private readonly headless: boolean
  private browser: Browser | undefined
  private page: Page | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserUse')
    this.headless = config.headless ?? BROWSER_USE_DEFAULT_HEADLESS
    ctx.effect(() => async () => {
      await this.page?.context().close().catch(() => {})
      await this.browser?.close().catch(() => {})
      this.page = undefined
      this.browser = undefined
    }, 'browser-use teardown')
  }

  /**
   * Navigate the active tab, launching the browser first if needed.
   * @param request - absolute URL to load.
   * @param signal - rejects before dispatch when already aborted.
   */
  async navigate(request: NavigateRequest, signal?: AbortSignal): Promise<void> {
    const page = await this.ensurePage()
    await this.runAction(() => page.goto(request.url, { waitUntil: 'domcontentloaded' }), signal)
  }

  /**
   * Click the first element matching a CSS or Playwright text/role selector.
   * @param request - selector identifying the element.
   * @param signal - rejects before dispatch when already aborted.
   */
  async clickSelector(request: ClickSelectorRequest, signal?: AbortSignal): Promise<void> {
    const page = await this.ensurePage()
    await this.runAction(() => page.locator(request.selector).first().click(), signal)
  }

  /**
   * Fill the first matching input, replacing its current value.
   * @param request - selector and literal replacement text.
   * @param signal - rejects before dispatch when already aborted.
   */
  async fillSelector(request: FillSelectorRequest, signal?: AbortSignal): Promise<void> {
    const page = await this.ensurePage()
    await this.runAction(() => page.locator(request.selector).first().fill(request.text), signal)
  }

  /**
   * Read the first matching element, or the whole page body when the selector is omitted.
   * @param request - optional selector.
   * @param signal - rejects before dispatch when already aborted.
   * @returns the element's inner text.
   */
  async extractText(request: ExtractTextRequest = {}, signal?: AbortSignal): Promise<string> {
    const page = await this.ensurePage()
    const selector = request.selector ?? 'body'
    return this.runAction(() => page.locator(selector).first().innerText(), signal)
  }

  /**
   * Click at absolute pixel coordinates within the current viewport.
   * @param request - point and optional double-click flag.
   * @param signal - rejects before dispatch when already aborted.
   */
  async clickAt(request: ClickAtRequest, signal?: AbortSignal): Promise<void> {
    const page = await this.ensurePage()
    await this.runAction(
      () => request.doubleClick === true
        ? page.mouse.dblclick(request.x, request.y)
        : page.mouse.click(request.x, request.y),
      signal,
    )
  }

  /**
   * Type literal text into the currently focused element.
   * @param request - text to type.
   * @param signal - rejects before dispatch when already aborted.
   */
  async type(request: TypeTextRequest, signal?: AbortSignal): Promise<void> {
    const page = await this.ensurePage()
    await this.runAction(() => page.keyboard.type(request.text), signal)
  }

  /**
   * Press a key or modifier combo using Playwright's vocabulary.
   * @param request - key or combo such as `"Enter"` or `"Control+A"`.
   * @param signal - rejects before dispatch when already aborted.
   */
  async key(request: KeyPressRequest, signal?: AbortSignal): Promise<void> {
    const page = await this.ensurePage()
    await this.runAction(() => page.keyboard.press(request.key), signal)
  }

  /**
   * Capture the current viewport.
   * @param signal - rejects before dispatch when already aborted.
   * @returns base64-encoded PNG bytes.
   */
  async screenshot(signal?: AbortSignal): Promise<BrowserScreenshotResult> {
    const page = await this.ensurePage()
    const buffer = await this.runAction(() => page.screenshot({ type: 'png' }), signal)
    return { pngBase64: buffer.toString('base64') }
  }

  private async ensurePage(): Promise<Page> {
    if (this.page !== undefined && !this.page.isClosed()) return this.page
    if (this.browser === undefined) {
      try {
        this.browser = await chromium.launch({ headless: this.headless })
      } catch (error) {
        throw new BrowserUseError(`failed to launch Chromium: ${String(error)}`, 'BROWSER_USE_LAUNCH_FAILED')
      }
    }
    const context = await this.browser.newContext()
    this.page = await context.newPage()
    return this.page
  }

  private async runAction<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    try {
      return await action()
    } catch (error) {
      if (error instanceof BrowserUseError) throw error
      throw new BrowserUseError(`browser action failed: ${String(error)}`, 'BROWSER_USE_ACTION_FAILED')
    }
  }
}

export default BrowserUseService
