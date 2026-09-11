/**
 * Vocabulary for the browser-use capability seam.
 * @module @deepseek-ai/dsh-browser-use/types
 */

/** Discriminates {@link BrowserUseError} causes. */
export type BrowserUseErrorCode =
  | 'BROWSER_USE_LAUNCH_FAILED'
  | 'BROWSER_USE_ACTION_FAILED'
  | 'BROWSER_USE_URL_BLOCKED'
  | 'BROWSER_USE_STALE_OBSERVATION'
  | 'BROWSER_USE_BACKEND_UNAVAILABLE'
  | 'BROWSER_USE_UNSUPPORTED_ACTION'

/** Selects the browser automation backend. 'playwright' is the secure default; 'ego' is experimental. */
export type BrowserBackendType = 'playwright' | 'ego'

/** Raised by every {@link BrowserUseService} method on a launch or action failure. */
export class BrowserUseError extends Error {
  constructor(message: string, readonly code: BrowserUseErrorCode) {
    super(message)
    this.name = 'BrowserUseError'
  }
}

/** Internal caller scope supplied by the tool adapter, never by model arguments. */
export interface BrowserOwnerScope {
  /** Stable Harness Agent identity used to isolate pages and observation tokens. */
  ownerId: string
}

/** Result of {@link BrowserUseService.screenshot}. */
export interface BrowserScreenshotResult {
  /** Base64-encoded PNG bytes of the current page viewport. */
  pngBase64: string
  /** Opaque, single-page observation identity. Coordinate actions can bind to it. */
  observationId: string
  /** Page URL at capture time. */
  url: string
}

/** Live browser policy supplied by the visually managed GUI-agent settings. */
export interface BrowserUseRuntimeSettings {
  headless: boolean
  /** Exact host or parent-domain grants. Empty disables browser networking. */
  allowedDomains: readonly string[]
  /** Exact host or parent-domain denials. Denials take priority over grants. */
  deniedDomains: readonly string[]
  /** Permit loopback, link-local, and private IP destinations. Defaults to false. */
  allowPrivateNetwork: boolean
  /** Active browser backend. Defaults to 'playwright'; 'ego' requires the ego lite app and is experimental. */
  backend?: BrowserBackendType
}

/** Arguments to {@link BrowserUseService.navigate}. */
export interface NavigateRequest extends BrowserOwnerScope {
  url: string
}

/** Arguments to {@link BrowserUseService.clickSelector}. Locates the first match. */
export interface ClickSelectorRequest extends BrowserOwnerScope {
  /** CSS or Playwright text/role selector, e.g. `"text=Sign in"` or `"#submit"`. */
  selector: string
}

/** Arguments to {@link BrowserUseService.fillSelector}. */
export interface FillSelectorRequest extends BrowserOwnerScope {
  /** CSS or Playwright text/role selector for the first matching input. */
  selector: string
  text: string
}

/** Arguments to {@link BrowserUseService.extractText}. */
export interface ExtractTextRequest extends BrowserOwnerScope {
  /** CSS or Playwright selector; omitted = the whole page body. */
  selector?: string
  /** Maximum UTF-16 code units returned. Defaults to 20,000; hard-capped at 100,000. */
  maxTextChars?: number
}

/** Arguments to {@link BrowserUseService.clickAt}, coordinate-grounded within the current viewport. */
export interface ClickAtRequest extends BrowserOwnerScope {
  x: number
  y: number
  doubleClick?: boolean
  /** Bind this coordinate to the screenshot that produced it. */
  observationId: string
}

/** Arguments to move the browser pointer without clicking. */
export interface MoveAtRequest extends BrowserOwnerScope {
  x: number
  y: number
  observationId: string
}

/** Arguments to drag between two viewport coordinates. */
export interface DragAtRequest extends BrowserOwnerScope {
  x: number
  y: number
  toX: number
  toY: number
  observationId: string
}

/** Arguments to one observation-bound browser scroll dispatch. */
export interface BrowserScrollRequest extends BrowserOwnerScope {
  direction: 'up' | 'down' | 'left' | 'right'
  /** Multiplier from 1 through 10. Defaults to 1. */
  amount?: number
  observationId: string
}

/** Arguments to {@link BrowserUseService.type}. */
export interface TypeTextRequest extends BrowserOwnerScope {
  text: string
  observationId: string
}

/** Arguments to {@link BrowserUseService.key}. Uses Playwright's own key vocabulary, e.g. `"Enter"`, `"Control+A"`. */
export interface KeyPressRequest extends BrowserOwnerScope {
  key: string
  observationId: string
}

/** Bounded semantic state used for independent completion checks. */
export interface BrowserPageState {
  url: string
  title: string
  text: string
}

/** Arguments to {@link BrowserUseService.pageState}. */
export interface BrowserPageStateRequest extends BrowserOwnerScope {
  selector?: string
  /** Maximum UTF-16 code units returned from page text. Defaults to 20,000. */
  maxTextChars?: number
}

/** Arguments to one owner-isolated screenshot capture. */
export type BrowserScreenshotRequest = BrowserOwnerScope
