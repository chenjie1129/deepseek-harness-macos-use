/**
 * Vocabulary for the browser-use capability seam.
 * @module @deepseek-ai/dsh-browser-use/types
 */

/** Discriminates {@link BrowserUseError} causes. */
export type BrowserUseErrorCode = 'BROWSER_USE_LAUNCH_FAILED' | 'BROWSER_USE_ACTION_FAILED'

/** Raised by every {@link BrowserUseService} method on a launch or action failure. */
export class BrowserUseError extends Error {
  constructor(message: string, readonly code: BrowserUseErrorCode) {
    super(message)
    this.name = 'BrowserUseError'
  }
}

/** Result of {@link BrowserUseService.screenshot}. */
export interface BrowserScreenshotResult {
  /** Base64-encoded PNG bytes of the current page viewport. */
  pngBase64: string
}

/** Arguments to {@link BrowserUseService.navigate}. */
export interface NavigateRequest {
  url: string
}

/** Arguments to {@link BrowserUseService.clickSelector}. Locates the first match. */
export interface ClickSelectorRequest {
  /** CSS or Playwright text/role selector, e.g. `"text=Sign in"` or `"#submit"`. */
  selector: string
}

/** Arguments to {@link BrowserUseService.fillSelector}. */
export interface FillSelectorRequest {
  /** CSS or Playwright text/role selector for the first matching input. */
  selector: string
  text: string
}

/** Arguments to {@link BrowserUseService.extractText}. */
export interface ExtractTextRequest {
  /** CSS or Playwright selector; omitted = the whole page body. */
  selector?: string
}

/** Arguments to {@link BrowserUseService.clickAt}, coordinate-grounded within the current viewport. */
export interface ClickAtRequest {
  x: number
  y: number
  doubleClick?: boolean
}

/** Arguments to {@link BrowserUseService.type}. */
export interface TypeTextRequest {
  text: string
}

/** Arguments to {@link BrowserUseService.key}. Uses Playwright's own key vocabulary, e.g. `"Enter"`, `"Control+A"`. */
export interface KeyPressRequest {
  key: string
}
