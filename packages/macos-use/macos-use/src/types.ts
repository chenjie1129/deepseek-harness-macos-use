/**
 * Vocabulary for the macOS desktop-control capability seam.
 * @module @deepseek-ai/dsh-macos-use/types
 */

/** Discriminates {@link MacosUseError} causes. */
export type MacosUseErrorCode =
  | 'MACOS_USE_COMMAND_FAILED'
  | 'MACOS_USE_UNSUPPORTED_KEY'
  | 'MACOS_USE_TIMED_OUT'

/** Raised by every {@link MacosUseService} method on a failed or timed-out command. */
export class MacosUseError extends Error {
  constructor(message: string, readonly code: MacosUseErrorCode) {
    super(message)
    this.name = 'MacosUseError'
  }
}

/** Mouse button a {@link ClickRequest} targets. */
export type MouseButton = 'left' | 'right'

/** A held modifier key for a click or keystroke. */
export type KeyModifier = 'command' | 'control' | 'option' | 'shift'

/** Result of {@link MacosUseService.screenshot}. */
export interface ScreenshotResult {
  /** Base64-encoded PNG bytes of the full-screen capture. */
  pngBase64: string
}

/** Arguments to {@link MacosUseService.click}. */
export interface ClickRequest {
  /** Absolute screen x coordinate in points. */
  x: number
  /** Absolute screen y coordinate in points. */
  y: number
  /** Defaults to `'left'`. */
  button?: MouseButton
  /** Double-click instead of a single click. Ignored when `button` is `'right'`. */
  doubleClick?: boolean
  /** Modifier keys held for the duration of the click. */
  modifiers?: readonly KeyModifier[]
}

/** Arguments to {@link MacosUseService.type}. */
export interface TypeTextRequest {
  /** Literal text delivered as keystroke events. */
  text: string
}

/** Arguments to {@link MacosUseService.key}. */
export interface KeyPressRequest {
  /** A key or `+`-joined modifier combo, e.g. `"return"`, `"cmd+shift+t"`, `"escape"`, `"a"`. */
  combo: string
}

/** Arguments to {@link MacosUseService.scroll}. */
export interface ScrollRequest {
  direction: 'up' | 'down' | 'left' | 'right'
  /** Scroll steps, each one arrow/page keystroke. Defaults to 5; clamped to [1, 50]. */
  amount?: number
}

/** Arguments to {@link MacosUseService.openApp}. */
export interface OpenAppRequest {
  /** Application name as `open -a` resolves it, e.g. `"Safari"`. */
  name: string
}

/** Arguments to {@link MacosUseService.runAppleScript}. */
export interface RunAppleScriptRequest {
  /** Complete AppleScript source passed to `osascript -e`. */
  script: string
}
