/**
 * Vocabulary for the macOS desktop-control capability seam.
 * @module @deepseek-ai/dsh-macos-use/types
 */

/** Discriminates {@link MacosUseError} causes. */
export type MacosUseErrorCode =
  | 'MACOS_USE_COMMAND_FAILED'
  | 'MACOS_USE_APP_BLOCKED'
  | 'MACOS_USE_SCREENSHOT_BLOCKED'
  | 'MACOS_USE_WINDOW_NOT_FOUND'
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

/** One running foreground-capable macOS application. */
export interface MacosApplication {
  name: string
  bundleId?: string
  pid: number
  active: boolean
  hidden: boolean
}

/** Screen-space bounds in macOS points. */
export interface ScreenBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One CoreGraphics window suitable for exact capture and focus targeting. */
export interface MacosWindow {
  id: number
  app: string
  pid: number
  title: string
  bounds: ScreenBounds
  onScreen: boolean
}

/** One visible Accessibility element inside a window snapshot. */
export interface AccessibilityElement {
  role: string
  subrole?: string
  name?: string
  value?: string
  description?: string
  enabled: boolean
  bounds?: ScreenBounds
}

/** Exact window screenshot plus the semantic controls discovered in it. */
export interface WindowStateResult {
  window: MacosWindow
  pngBase64: string
  elements: readonly AccessibilityElement[]
  truncated: boolean
}

/** Live safety and runtime settings enforced by {@link MacosUseService}. */
export interface MacosUseRuntimeSettings {
  commandTimeoutMs: number
  allowedApps: readonly string[]
  deniedApps: readonly string[]
  excludedScreenshotApps: readonly string[]
  maxElementsPerSnapshot: number
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

/** Arguments to move the pointer without clicking. */
export interface MoveRequest {
  x: number
  y: number
}

/** Arguments to drag from one absolute screen point to another. */
export interface DragRequest {
  x: number
  y: number
  toX: number
  toY: number
  /** Duration in milliseconds. Defaults to 300; clamped to [50, 5000]. */
  durationMs?: number
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

/** Select one exact window. `id` takes priority over app/title matching. */
export interface WindowTarget {
  id?: number
  app?: string
  title?: string
}

/** Arguments for an Accessibility snapshot. */
export interface WindowStateRequest extends WindowTarget {
  /** Maximum flattened elements. The live plugin setting supplies the default. */
  maxElements?: number
}

/** Arguments to {@link MacosUseService.runAppleScript}. */
export interface RunAppleScriptRequest {
  /** Complete AppleScript source passed to `osascript -e`. */
  script: string
}
