/**
 * Vocabulary for the macOS desktop-control capability seam.
 * @module @deepseek-ai/dsh-macos-use/types
 */

/** Discriminates {@link MacosUseError} causes. */
export type MacosUseErrorCode =
  | 'MACOS_USE_COMMAND_FAILED'
  | 'MACOS_USE_APP_BLOCKED'
  | 'MACOS_USE_APP_NOT_FOUND'
  | 'MACOS_USE_APP_AMBIGUOUS'
  | 'MACOS_USE_SCREENSHOT_BLOCKED'
  | 'MACOS_USE_WINDOW_NOT_FOUND'
  | 'MACOS_USE_WINDOW_AMBIGUOUS'
  | 'MACOS_USE_TARGET_STALE'
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
  /** Base64-encoded PNG bytes of the observation. */
  pngBase64: string
  /** Opaque identity for this completed observation. */
  observationId: string
  /** Wall-clock time at which the observation finished. */
  observedAt: string
}

/** Main-display canvas containing only the exact authorized foreground-window capture. */
export interface ScreenObservationResult extends ScreenshotResult {
  /** Exact main-display point/pixel geometry used to interpret model coordinates. */
  captureGeometry: ScreenCaptureGeometry
  /** Present only when the foreground application is inside read scope. */
  frontmostProcess?: FrontmostProcess
  /** Selected foreground window, present only when it exists and is inside read scope. */
  targetWindow?: MacosWindow
}

/** One running foreground-capable macOS application. */
export interface MacosApplication {
  name: string
  bundleId?: string
  pid: number
  active: boolean
  hidden: boolean
}

/** Identity fields used by separate read/control grants. Every rule must set at least one field. */
export interface MacosAppIdentityRule {
  name?: string
  bundleId?: string
  pid?: number
}

/** Process identity used to bind a control action to the observed frontmost app. */
export interface FrontmostProcess {
  name: string
  bundleId?: string
  pid: number
}

/** Screen-space bounds in macOS points. */
export interface ScreenBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Stable CoreGraphics display identity and its global point-space bounds. */
export interface MacosDisplay {
  id: number
  bounds: ScreenBounds
}

/** Pixel dimensions of one captured PNG. */
export interface ScreenPixelSize {
  width: number
  height: number
}

/** Mapping from captured PNG pixels to one display's global point space. */
export interface ScreenCaptureGeometry {
  /** Stable CoreGraphics display identity. */
  displayId: number
  /** Captured display rectangle in global macOS point space. */
  globalPointRect: ScreenBounds
  /** PNG dimensions in capture-pixel space. */
  capturePixels: ScreenPixelSize
}

/** One CoreGraphics window suitable for exact capture and focus targeting. */
export interface MacosWindow {
  id: number
  app: string
  bundleId?: string
  /** CoreGraphics layer, present on internal privacy/window-list observations. */
  layer?: number
  pid: number
  title: string
  bounds: ScreenBounds
  onScreen: boolean
}

/** One policy-filtered, stability-fenced native snapshot used for task completion checks. */
export interface MacosCompletionState {
  /** Present only when the stable foreground application is inside read scope. */
  frontmostProcess?: FrontmostProcess
  /** Ordinary on-screen windows inside read scope from the same native query. */
  windows: readonly MacosWindow[]
  /** Wall-clock time serialized by the native query after its stability fence passed. */
  observedAt: string
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
  /** Opaque identity that can bind one subsequent control action. */
  observationId: string
  observedAt: string
}

/** Exact window identity captured by a prior observation and revalidated before control. */
export interface ObservedWindowTarget {
  observationId: string
  window: MacosWindow
}

/** Fresh evidence captured immediately after a control action. */
export interface MacosActionReceipt extends ScreenshotResult {
  /** Whether the originally observed exact window still exists after the action. */
  targetState: 'present' | 'missing' | 'unscoped'
  /** Fresh post-action window metadata when the target still exists. */
  window?: MacosWindow
}

/** Live safety and runtime settings enforced by {@link MacosUseService}. */
export interface MacosUseRuntimeSettings {
  commandTimeoutMs: number
  allowedApps: readonly string[]
  deniedApps: readonly string[]
  excludedScreenshotApps: readonly string[]
  maxElementsPerSnapshot: number
  /** Precise read grants. Empty/omitted falls back to legacy allowedApps; both empty deny. */
  readAppGrants?: readonly MacosAppIdentityRule[]
  /** Precise control grants. Empty/omitted falls back to legacy allowedApps; both empty deny. */
  controlAppGrants?: readonly MacosAppIdentityRule[]
  /** Optional precise global denials applied to both read and control. */
  deniedAppIdentities?: readonly MacosAppIdentityRule[]
}

/** Arguments to {@link MacosUseService.click}. */
export interface ClickRequest {
  /** Capture-pixel x with `observationId`; global macOS point x with an exact window `target`. */
  x: number
  /** Capture-pixel y with `observationId`; global macOS point y with an exact window `target`. */
  y: number
  /** Defaults to `'left'`. */
  button?: MouseButton
  /** Double-click instead of a single click. Ignored when `button` is `'right'`. */
  doubleClick?: boolean
  /** Modifier keys held for the duration of the click. */
  modifiers?: readonly KeyModifier[]
  /** Optional exact observed target; stale or non-frontmost targets fail closed. */
  target?: ObservedWindowTarget
  /** Opaque token returned by {@link MacosUseService.screenshot}; valid for one action. */
  observationId?: string
  /** Trusted adapter marker: approval may have focused Harness, so restore and pixel-rebind the observation once. */
  restoreObservedFocus?: boolean
}

/** Arguments to move the pointer without clicking. */
export interface MoveRequest {
  /** Capture-pixel x with `observationId`; global macOS point x with an exact window `target`. */
  x: number
  /** Capture-pixel y with `observationId`; global macOS point y with an exact window `target`. */
  y: number
  target?: ObservedWindowTarget
  observationId?: string
  /** Trusted adapter marker for one fail-closed post-approval focus restoration. */
  restoreObservedFocus?: boolean
}

/** Arguments to drag between coordinates expressed in the bound observation's coordinate space. */
export interface DragRequest {
  /** Capture-pixel start x with `observationId`; global point x with an exact window `target`. */
  x: number
  /** Capture-pixel start y with `observationId`; global point y with an exact window `target`. */
  y: number
  /** Capture-pixel destination x with `observationId`; global point x with an exact window `target`. */
  toX: number
  /** Capture-pixel destination y with `observationId`; global point y with an exact window `target`. */
  toY: number
  /** Duration in milliseconds. Defaults to 300; clamped to [50, 5000]. */
  durationMs?: number
  target?: ObservedWindowTarget
  observationId?: string
  /** Trusted adapter marker for one fail-closed post-approval focus restoration. */
  restoreObservedFocus?: boolean
}

/** Arguments to {@link MacosUseService.type}. */
export interface TypeTextRequest {
  /** Literal text delivered as keystroke events. */
  text: string
  target?: ObservedWindowTarget
  observationId?: string
  /** Trusted adapter marker for one fail-closed post-approval focus restoration. */
  restoreObservedFocus?: boolean
}

/** Arguments to {@link MacosUseService.key}. */
export interface KeyPressRequest {
  /** A key or `+`-joined modifier combo, e.g. `"return"`, `"cmd+shift+t"`, `"escape"`, `"a"`. */
  combo: string
  target?: ObservedWindowTarget
  observationId?: string
  /** Trusted adapter marker for one fail-closed post-approval focus restoration. */
  restoreObservedFocus?: boolean
}

/** Arguments to {@link MacosUseService.scroll}. */
export interface ScrollRequest {
  direction: 'up' | 'down' | 'left' | 'right'
  /** Scroll steps, each one arrow/page keystroke. Defaults to 5; clamped to [1, 50]. */
  amount?: number
  target?: ObservedWindowTarget
  observationId?: string
  /** Trusted adapter marker for one fail-closed post-approval focus restoration. */
  restoreObservedFocus?: boolean
}

/** Arguments to {@link MacosUseService.openApp}. */
export interface OpenAppRequest {
  /** Exact installed application display name, e.g. `"Safari"`. */
  name?: string
  /** Exact bundle identifier. Supplying it avoids display-name ambiguity. */
  bundleId?: string
}

/** One uniquely resolved installed application bundle. */
export interface ResolvedMacosApplication {
  name: string
  bundleId: string
  /** Canonical application-bundle path passed to Launch Services. */
  path: string
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

/** Legacy compatibility input for {@link MacosUseService.runAppleScript}; the service always rejects it. */
export interface RunAppleScriptRequest {
  /** Untrusted AppleScript source retained only so older callers receive an explicit fail-closed error. */
  script: string
}
