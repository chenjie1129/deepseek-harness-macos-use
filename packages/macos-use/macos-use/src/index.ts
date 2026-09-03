/**
 * Service Definition and local implementation for the macOS desktop-control capability seam (`ctx.macosUse`):
 * include-only foreground-window capture via `screencapture`, guarded GUI automation through generated JXA/System
 * Events programs, and exact application-bundle launch through Launch Services. Caller-provided AppleScript is
 * always rejected.
 * One concrete implementation exists —
 * macOS System Events has no swappable alternative in this harness — so the definition and its provider are one
 * package, unlike the `dsh-shell`/`dsh-subprocess` seams that carry more than one backend.
 * @module @deepseek-ai/dsh-macos-use
 */

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { access, readFile, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-subprocess'
import sharp from 'sharp'
import { sameExactApplicationName, selectResolvedApplication } from './application.ts'
import {
  buildApplicationBundleInspectionScript,
  buildApplicationUrlsForBundleScript,
  buildDragPointerScript,
  buildCompletionStateScript,
  buildFocusWindowScript,
  buildFrontmostProcessScript,
  buildGuardedClickJxaScript,
  buildGuardedKeyJxaScript,
  buildGuardedScrollJxaScript,
  buildGuardedTypeJxaScript,
  buildListAppsScript,
  buildListWindowsScript,
  buildLaunchExactApplicationScript,
  buildMainDisplayBoundsScript,
  buildMovePointerScript,
  buildWindowElementsScript,
} from './native.ts'
import {
  sameScreenObservationTarget,
  ScreenObservationStore,
  WindowObservationStore,
} from './observations.ts'
import type {
  ScreenObservationTarget,
  ScreenTargetState,
  WindowObservationProof,
} from './observations.ts'
import { appScopeAllows, normalizedAppName, validateReadControlGrantPolicy } from './policy.ts'
import type { MacosAppIdentity } from './policy.ts'
import {
  capturePixelToGlobalPoint,
  screenBoundsContain,
} from './redaction.ts'
import {
  assertPointsInsideWindow,
  sameObservedWindow,
  sameProcessIdentity,
  selectWindowTarget,
} from './target.ts'
import { MacosUseError } from './types.ts'
import type {
  ClickRequest,
  DragRequest,
  FrontmostProcess,
  KeyPressRequest,
  MacosActionReceipt,
  MacosApplication,
  MacosCompletionState,
  MacosDisplay,
  MacosUseRuntimeSettings,
  MacosWindow,
  MoveRequest,
  ObservedWindowTarget,
  OpenAppRequest,
  RunAppleScriptRequest,
  ResolvedMacosApplication,
  ScreenBounds,
  ScreenCaptureGeometry,
  ScreenObservationResult,
  ScreenPixelSize,
  ScreenshotResult,
  ScrollRequest,
  TypeTextRequest,
  WindowStateRequest,
  WindowStateResult,
  WindowTarget,
} from './types.ts'

export { MacosUseError } from './types.ts'
export { sameExactApplicationName, selectResolvedApplication } from './application.ts'
export type {
  ClickRequest,
  DragRequest,
  FrontmostProcess,
  AccessibilityElement,
  KeyModifier,
  KeyPressRequest,
  MacosActionReceipt,
  MacosAppIdentityRule,
  MacosApplication,
  MacosCompletionState,
  MacosDisplay,
  MacosUseErrorCode,
  MacosUseRuntimeSettings,
  MacosWindow,
  MoveRequest,
  MouseButton,
  ObservedWindowTarget,
  OpenAppRequest,
  RunAppleScriptRequest,
  ResolvedMacosApplication,
  ScreenBounds,
  ScreenCaptureGeometry,
  ScreenObservationResult,
  ScreenPixelSize,
  ScreenshotResult,
  ScrollRequest,
  TypeTextRequest,
  WindowStateRequest,
  WindowStateResult,
  WindowTarget,
} from './types.ts'
export {
  assertPointsInsideWindow,
  boundsContainPoint,
  sameObservedWindow,
  sameProcessIdentity,
  selectWindowTarget,
} from './target.ts'
export {
  appIdentityMatches,
  appScopeAllows,
  normalizedAppName,
  readRuleCoversControlRule,
  validateReadControlGrantPolicy,
} from './policy.ts'
export type { MacosAppIdentity } from './policy.ts'
export {
  capturePixelToGlobalPoint,
  collectRedactionRectangles,
  sameScreenBounds,
  screenBoundsContain,
  screenBoundsIntersect,
} from './redaction.ts'
export type { PixelRectangle } from './redaction.ts'
export {
  sameScreenObservationTarget,
  ScreenObservationStore,
  WindowObservationStore,
} from './observations.ts'
export type { ScreenObservationTarget, ScreenTargetState } from './observations.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    macosUse: MacosUseService
  }
}

/** Config for the macOS desktop-control seam. */
export interface Config {
  /** Deadline in milliseconds for one `osascript`/`screencapture`/`open` invocation. Defaults to 15000. */
  commandTimeoutMs?: number
}

const MACOS_USE_DEFAULT_COMMAND_TIMEOUT_MS = 15_000
const MACOS_USE_DEFAULT_MAX_ELEMENTS = 250

interface ControlPoint {
  x: number
  y: number
}

interface PreparedControlTarget {
  points: readonly ControlPoint[]
  window: MacosWindow
}

type MutationDispatch = () => void

export const Config: z<Config> = z.object({
  commandTimeoutMs: z.number().step(1).min(1),
})

/**
 * macOS desktop-control service. Registered as `ctx.macosUse` (one instance per context). Every action shells
 * out through `ctx.subprocess` — never `node:child_process` directly — to bounded native inspection, capture, and
 * input commands. GUI automation and screen capture require the host process to hold Accessibility and Screen Recording
 * permission respectively in System Settings; macOS prompts for both on first use and denies silently (an empty
 * capture, a script that compiles but has no visible effect) until granted.
 */
export class MacosUseService extends Service {
  static inject = ['subprocess']
  static Config = Config

  private timeoutMs: number
  private runtime: MacosUseRuntimeSettings
  private readonly windowObservations = new WindowObservationStore()
  private readonly screenObservations = new ScreenObservationStore()
  private desktopMutationEpoch = 0
  private nativeMutationTail: Promise<void> = Promise.resolve()
  private nativeMutationDispatched = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'macosUse')
    this.timeoutMs = config.commandTimeoutMs ?? MACOS_USE_DEFAULT_COMMAND_TIMEOUT_MS
    this.runtime = {
      commandTimeoutMs: this.timeoutMs,
      allowedApps: [],
      deniedApps: [],
      excludedScreenshotApps: [],
      maxElementsPerSnapshot: MACOS_USE_DEFAULT_MAX_ELEMENTS,
      readAppGrants: [],
      controlAppGrants: [],
      deniedAppIdentities: [],
    }
    ctx.on('agent/disposed', ({ agent }) => {
      this.windowObservations.clearOwner(agent.id)
      this.screenObservations.clearOwner(agent.id)
    })
  }

  /**
   * Apply the live, visually managed runtime policy used by every subsequent action.
   * @param settings - complete policy projection from the tool plugin's visual section.
   */
  configure(settings: MacosUseRuntimeSettings): void {
    const policyError = validateReadControlGrantPolicy(settings)
    if (policyError !== undefined) {
      throw new MacosUseError(
        `${policyError} Fix the grants in Plugin Configuration.`,
        'MACOS_USE_APP_BLOCKED',
      )
    }
    this.timeoutMs = settings.commandTimeoutMs
    this.runtime = {
      commandTimeoutMs: settings.commandTimeoutMs,
      allowedApps: [...settings.allowedApps],
      deniedApps: [...settings.deniedApps],
      excludedScreenshotApps: [...settings.excludedScreenshotApps],
      maxElementsPerSnapshot: settings.maxElementsPerSnapshot,
      readAppGrants: [...settings.readAppGrants ?? []],
      controlAppGrants: [...settings.controlAppGrants ?? []],
      deniedAppIdentities: [...settings.deniedAppIdentities ?? []],
    }
    this.desktopMutationEpoch = this.currentDesktopMutationEpoch() + 1
    this.windowObservations.clear()
    this.screenObservations.clear()
  }

  /**
   * Capture an authorized foreground window on a black main-display canvas.
   * No full-display raster is created: `screencapture` receives only the exact
   * authorized CoreGraphics window id, and every other display pixel is synthesized black.
   * @param signal - aborts the capture.
   * @param ownerId - trusted agent/session identity that owns the resulting observation token.
   * @returns include-only PNG bytes, exact display geometry, and a fresh owner-bound observation token.
   */
  async screenshot(signal?: AbortSignal, ownerId?: string): Promise<ScreenObservationResult> {
    const owner = this.requireObservationOwner(ownerId)
    this.assertNoNativeMutationInFlight()
    const epoch = this.currentDesktopMutationEpoch()
    const before = await this.observeScreenTarget(signal)
    if (before.window === undefined
        || !screenBoundsContain(before.display.bounds, before.window.bounds)) {
      throw new MacosUseError(
        'foreground target is unavailable or outside the captured main display',
        'MACOS_USE_TARGET_STALE',
      )
    }
    this.assertScreenshotAllowed(before.window)
    const windowBytes = await this.captureExactWindow(before.window, signal)
    const after = await this.observeScreenTarget(signal)
    this.assertDesktopEpoch(epoch)
    if (!sameScreenObservationTarget(before, after)
        || after.window === undefined
        || !screenBoundsContain(after.display.bounds, after.window.bounds)) {
      throw new MacosUseError(
        'foreground target changed or is outside the captured main display',
        'MACOS_USE_TARGET_STALE',
      )
    }
    this.assertScreenshotAllowed(after.window)
    const capture = await this.composeAuthorizedDisplay(windowBytes, after.window, after.display.bounds)
    this.assertDesktopEpoch(epoch)
    this.assertNoNativeMutationInFlight()
    const observed: ScreenObservationTarget = {
      ...after,
      pixels: capture.pixels,
      rasterDigest: await this.rasterDigest(windowBytes),
    }
    const captureGeometry: ScreenCaptureGeometry = {
      displayId: after.display.id,
      globalPointRect: after.display.bounds,
      capturePixels: capture.pixels,
    }
    return {
      pngBase64: capture.png.toString('base64'),
      captureGeometry,
      ...this.screenObservations.remember(observed, owner, Date.now(), epoch),
      frontmostProcess: after.process,
      targetWindow: after.window,
    }
  }

  /**
   * List running foreground-capable apps after applying the allow/deny policy.
   * @param signal - aborts the native discovery request.
   * @returns permitted applications with bundle and process metadata.
   */
  async listApps(signal?: AbortSignal): Promise<readonly MacosApplication[]> {
    const apps = await this.runJson<MacosApplication[]>(buildListAppsScript(), signal)
    return apps.filter(app => this.appReadAllowed(app))
  }

  /**
   * List ordinary on-screen windows after applying the allow/deny policy.
   * @param signal - aborts the native discovery request.
   * @returns permitted layer-zero windows and their point-space bounds.
   */
  async listWindows(signal?: AbortSignal): Promise<readonly MacosWindow[]> {
    const windows = await this.listAllWindows(signal)
    return windows.filter(window => this.appReadAllowed(this.identityOfWindow(window)))
  }

  /**
   * Read a fresh completion snapshot through one foreground-stability-fenced
   * native query, then apply the visual read policy to every returned identity.
   * @param signal - aborts the native completion-state query.
   * @returns the stable readable foreground identity and readable window list.
   */
  async completionState(signal?: AbortSignal): Promise<MacosCompletionState> {
    const state = await this.runJson<{
      frontmostProcess: FrontmostProcess
      windows: MacosWindow[]
      observedAt: string
    }>(buildCompletionStateScript(), signal)
    return {
      ...this.appReadAllowed(state.frontmostProcess) ? { frontmostProcess: state.frontmostProcess } : {},
      windows: state.windows.filter(window => this.appReadAllowed(this.identityOfWindow(window))),
      observedAt: state.observedAt,
    }
  }

  /**
   * Capture one exact window by CoreGraphics window id or application/title selector.
   * @param target - selector resolving one permitted, non-sensitive window.
   * @param signal - aborts discovery or capture.
   * @param ownerId - trusted agent/session identity that owns the resulting observation token.
   * @returns PNG bytes paired with the exact resolved window metadata.
   */
  async screenshotWindow(
    target: WindowTarget,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<ScreenshotResult & { window: MacosWindow }> {
    const owner = this.requireObservationOwner(ownerId)
    this.assertNoNativeMutationInFlight()
    const epoch = this.currentDesktopMutationEpoch()
    const window = await this.resolveWindow(target, 'read', signal)
    this.assertScreenshotAllowed(window)
    const bytes = await this.captureExactWindow(window, signal)
    const current = await this.resolveWindow({ id: window.id }, 'read', signal)
    this.assertDesktopEpoch(epoch)
    this.assertNoNativeMutationInFlight()
    if (!sameObservedWindow(window, current)) {
      throw new MacosUseError(
        'window identity or geometry changed while its screenshot was captured',
        'MACOS_USE_TARGET_STALE',
      )
    }
    return {
      window: current,
      pngBase64: bytes.toString('base64'),
      ...this.rememberWindowObservation(current, owner, epoch, await this.rasterDigest(bytes)),
    }
  }

  /**
   * Capture one exact window and flatten its Accessibility controls.
   * @param request - window selector and optional element budget.
   * @param signal - aborts capture or Accessibility enumeration.
   * @param ownerId - trusted agent/session identity that owns the resulting observation token.
   * @returns exact window pixels, metadata, and bounded semantic elements.
   */
  async windowState(
    request: WindowStateRequest,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<WindowStateResult> {
    const owner = this.requireObservationOwner(ownerId)
    const epoch = this.currentDesktopMutationEpoch()
    const window = await this.resolveWindow(request, 'read', signal)
    this.assertScreenshotAllowed(window)
    const maxElements = Math.max(1, Math.min(
      2000,
      Math.trunc(request.maxElements ?? this.runtime.maxElementsPerSnapshot),
    ))
    const [capture, semantic] = await Promise.all([
      this.screenshotWindow({ id: window.id }, signal, owner),
      this.runJson<{ elements: WindowStateResult['elements']; truncated: boolean }>(
        buildWindowElementsScript(window, maxElements),
        signal,
      ),
    ])
    const current = await this.resolveWindow({ id: window.id }, 'read', signal)
    this.assertDesktopEpoch(epoch)
    if (!sameObservedWindow(window, current)) {
      throw new MacosUseError('window identity or geometry changed while its state was captured', 'MACOS_USE_TARGET_STALE')
    }
    return {
      window: current,
      pngBase64: capture.pngBase64,
      elements: semantic.elements,
      truncated: semantic.truncated,
      observationId: capture.observationId,
      observedAt: capture.observedAt,
    }
  }

  /**
   * Click, double-click, or right-click using coordinates from the bound observation.
   * @param request - PNG pixels for a display-coordinate observation, or global macOS points for an exact-window observation.
   * @param signal - aborts the click.
   * @param ownerId - trusted agent/session identity that must own the fresh observation in `request`.
   */
  async click(request: ClickRequest, signal?: AbortSignal, ownerId?: string): Promise<void> {
    await this.withNativeMutation(signal, request.target?.observationId, async (markDispatched) => {
      const prepared = await this.prepareControlTarget(
        request.target,
        request.observationId,
        [{ x: request.x, y: request.y }],
        signal,
        ownerId,
        request.restoreObservedFocus,
        markDispatched,
      )
      const [point] = prepared.points
      if (point === undefined) throw new MacosUseError('click point is unavailable', 'MACOS_USE_TARGET_STALE')
      await this.runAtomicJxa(
        buildGuardedClickJxaScript(prepared.window, point.x, point.y, request),
        signal,
        2000,
        markDispatched,
      )
    })
  }

  /**
   * Move the pointer without clicking using coordinates from the bound observation.
   * @param request - PNG pixels for a display-coordinate observation, or global macOS points for an exact-window observation.
   * @param signal - aborts the pointer action.
   * @param ownerId - trusted agent/session identity that must own the fresh observation in `request`.
   */
  async move(request: MoveRequest, signal?: AbortSignal, ownerId?: string): Promise<void> {
    await this.withNativeMutation(signal, request.target?.observationId, async (markDispatched) => {
      const prepared = await this.prepareControlTarget(
        request.target,
        request.observationId,
        [{ x: request.x, y: request.y }],
        signal,
        ownerId,
        request.restoreObservedFocus,
        markDispatched,
      )
      const [point] = prepared.points
      if (point === undefined) throw new MacosUseError('move point is unavailable', 'MACOS_USE_TARGET_STALE')
      await this.runAtomicJxa(buildMovePointerScript(point.x, point.y, prepared.window), signal, 2000, markDispatched)
    })
  }

  /**
   * Drag between two coordinates from the bound observation.
   * @param request - PNG pixels for a display-coordinate observation, or global macOS points for an exact-window
   * observation, plus an optional bounded duration.
   * @param signal - aborts the pointer action.
   * @param ownerId - trusted agent/session identity that must own the fresh observation in `request`.
   */
  async drag(request: DragRequest, signal?: AbortSignal, ownerId?: string): Promise<void> {
    await this.withNativeMutation(signal, request.target?.observationId, async (markDispatched) => {
      const prepared = await this.prepareControlTarget(
        request.target,
        request.observationId,
        [{ x: request.x, y: request.y }, { x: request.toX, y: request.toY }],
        signal,
        ownerId,
        request.restoreObservedFocus,
        markDispatched,
      )
      const [from, to] = prepared.points
      if (from === undefined || to === undefined) {
        throw new MacosUseError('drag points are unavailable', 'MACOS_USE_TARGET_STALE')
      }
      const durationMs = Math.max(50, Math.min(5000, Math.trunc(request.durationMs ?? 300)))
      await this.runAtomicJxa(
        buildDragPointerScript(from.x, from.y, to.x, to.y, durationMs, prepared.window),
        signal,
        durationMs + 2000,
        markDispatched,
      )
    })
  }

  /**
   * Type literal text via keystroke events into the currently focused element.
   * @param request - the text to type.
   * @param signal - aborts the keystrokes.
   * @param ownerId - trusted agent/session identity that must own the fresh observation in `request`.
   */
  async type(request: TypeTextRequest, signal?: AbortSignal, ownerId?: string): Promise<void> {
    await this.withNativeMutation(signal, request.target?.observationId, async (markDispatched) => {
      const prepared = await this.prepareControlTarget(
        request.target,
        request.observationId,
        [],
        signal,
        ownerId,
        request.restoreObservedFocus,
        markDispatched,
      )
      await this.runAtomicJxa(buildGuardedTypeJxaScript(prepared.window, request.text), signal, 5000, markDispatched)
    })
  }

  /**
   * Press a single key or modifier combo.
   * @param request - a combo like `"return"`, `"cmd+shift+t"`, or `"a"`.
   * @param signal - aborts the keystroke.
   * @param ownerId - trusted agent/session identity that must own the fresh observation in `request`.
   */
  async key(request: KeyPressRequest, signal?: AbortSignal, ownerId?: string): Promise<void> {
    await this.withNativeMutation(signal, request.target?.observationId, async (markDispatched) => {
      const prepared = await this.prepareControlTarget(
        request.target,
        request.observationId,
        [],
        signal,
        ownerId,
        request.restoreObservedFocus,
        markDispatched,
      )
      await this.runAtomicJxa(buildGuardedKeyJxaScript(prepared.window, request.combo), signal, 5000, markDispatched)
    })
  }

  /**
   * Scroll by repeating an arrow/page key a bounded number of times — System Events exposes no scroll-wheel
   * event, so this is an approximation, not a trackpad-accurate scroll delta.
   * @param request - direction and step count.
   * @param signal - aborts the scroll.
   * @param ownerId - trusted agent/session identity that must own the fresh observation in `request`.
   */
  async scroll(request: ScrollRequest, signal?: AbortSignal, ownerId?: string): Promise<void> {
    await this.withNativeMutation(signal, request.target?.observationId, async (markDispatched) => {
      const prepared = await this.prepareControlTarget(
        request.target,
        request.observationId,
        [],
        signal,
        ownerId,
        request.restoreObservedFocus,
        markDispatched,
      )
      await this.runAtomicJxa(buildGuardedScrollJxaScript(
        prepared.window,
        request.direction,
        request.amount ?? 5,
      ), signal, 5000, markDispatched)
    })
  }

  /**
   * Launch or activate one uniquely resolved application bundle.
   * @param request - exact application name, bundle identifier, or both.
   * @param signal - aborts the launch.
   * @returns the exact frontmost process observed after launch.
   */
  async openApp(request: OpenAppRequest, signal?: AbortSignal): Promise<FrontmostProcess> {
    return this.withNativeMutation(signal, undefined, async (markDispatched) => {
      const epoch = this.currentDesktopMutationEpoch()
      const application = await this.resolveApplication(request, signal)
      this.assertReadAllowed(application)
      this.assertControlAllowed(application)
      this.assertDesktopEpoch(epoch)
      await this.runAtomicJxa(buildLaunchExactApplicationScript(application), signal, 5000, markDispatched)
      return this.waitForFrontmostApplication(application, signal)
    })
  }

  /**
   * Bring one exact window to the foreground.
   * @param target - selector resolving one permitted window.
   * @param signal - aborts discovery or focus.
   * @returns metadata for the window the action targeted.
   */
  async focusWindow(target: WindowTarget, signal?: AbortSignal): Promise<MacosWindow> {
    return this.withNativeMutation(signal, undefined, async (markDispatched) => {
      const epoch = this.currentDesktopMutationEpoch()
      const window = await this.resolveWindow(target, 'control', signal)
      this.assertDesktopEpoch(epoch)
      await this.runAtomicAppleScript(buildFocusWindowScript(window), signal, 5000, markDispatched)
      return window
    })
  }

  /**
   * Reject caller-supplied AppleScript because arbitrary source cannot be constrained to app grants.
   * @param _request - untrusted source that is intentionally never dispatched.
   * @param _signal - unused signal retained for API compatibility.
   * @returns a rejected promise with `MACOS_USE_APP_BLOCKED`.
   */
  runAppleScript(_request: RunAppleScriptRequest | string, _signal?: AbortSignal): Promise<string> {
    return Promise.reject(new MacosUseError(
      'arbitrary AppleScript cannot be constrained to configured app read/control grants',
      'MACOS_USE_APP_BLOCKED',
    ))
  }

  /**
   * Resolve the frontmost application.
   * @param signal - aborts the lookup.
   * @returns the frontmost process's name.
   */
  async frontmostApp(signal?: AbortSignal): Promise<string> {
    return (await this.frontmostProcess(signal)).name
  }

  /**
   * Resolve the current frontmost application with a stable process identity.
   * @param signal - aborts the lookup.
   * @returns the permitted frontmost process name, bundle identifier, and process id.
   */
  async frontmostProcess(signal?: AbortSignal): Promise<FrontmostProcess> {
    const process = await this.readFrontmostProcess(signal)
    this.assertReadAllowed(process)
    return process
  }

  /**
   * Revalidate an exact observed window immediately before an action. Window
   * disappearance, id reuse, process replacement, title change, or geometry
   * change is reported as a stale target rather than silently retargeting.
   * @param target - owner-bound observation token and exact original window identity.
   * @param signal - aborts native window discovery.
   * @param ownerId - trusted agent/session identity that must own the observation.
   * @returns the freshly revalidated exact window.
   */
  async revalidateWindow(
    target: ObservedWindowTarget,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<MacosWindow> {
    const owner = this.requireObservationOwner(ownerId)
    const epoch = this.currentDesktopMutationEpoch()
    return (await this.revalidateWindowAtEpoch(target, signal, owner, epoch)).window
  }

  /**
   * Consume an exact-window observation after a same-Mac approval prompt,
   * restore only that previously observed window, verify its decoded pixels
   * are unchanged, and mint a fresh owner-bound observation for the caller's
   * normal semantic revalidation. A changed/replaced window fails closed.
   * @param target - owner-bound exact window observation captured before approval.
   * @param signal - aborts restoration before native dispatch.
   * @param ownerId - trusted agent/session identity that owns the observation.
   * @returns a fresh one-action target for the same exact window.
   */
  async reactivateWindowObservation(
    target: ObservedWindowTarget,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<ObservedWindowTarget> {
    const owner = this.requireObservationOwner(ownerId)
    return this.withNativeMutation(signal, undefined, async (markDispatched) => {
      const epoch = this.currentDesktopMutationEpoch()
      const proof = this.windowObservations.takeForReactivation(target, owner, Date.now(), epoch)
      const restored = await this.restorePostApprovalTarget(
        proof,
        undefined,
        signal,
        epoch,
        markDispatched,
      )
      if (restored.window === undefined) {
        throw new MacosUseError('approved target window is unavailable after restoration', 'MACOS_USE_TARGET_STALE')
      }
      const fresh = this.rememberWindowObservation(
        restored.window,
        owner,
        this.currentDesktopMutationEpoch(),
        proof.rasterDigest,
      )
      return { observationId: fresh.observationId, window: restored.window }
    })
  }

  /**
   * Consume a display-coordinate observation captured immediately before an
   * outer same-Mac task approval and restore that exact unchanged target before
   * the autonomous loop takes its first model-facing screenshot. This grants
   * no action or receipt authority; the loop must observe and decide afresh.
   * @param observationId - owner-bound screen observation captured before approval.
   * @param signal - aborts restoration before native dispatch.
   * @param ownerId - trusted agent/session identity that owns the observation.
   */
  async reactivateScreenObservation(
    observationId: string,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<void> {
    const owner = this.requireObservationOwner(ownerId)
    await this.withNativeMutation(signal, undefined, async (markDispatched) => {
      const epoch = this.currentDesktopMutationEpoch()
      const observed = this.screenObservations.reserve(observationId, owner, Date.now(), epoch)
      if (observed.window === undefined) {
        throw new MacosUseError(
          'post-approval task restoration requires an exact observed window',
          'MACOS_USE_TARGET_STALE',
        )
      }
      await this.restorePostApprovalTarget({
        window: observed.window,
        ...observed.rasterDigest === undefined ? {} : { rasterDigest: observed.rasterDigest },
      }, observed, signal, epoch, markDispatched)
    })
  }

  private async revalidateWindowAtEpoch(
    target: ObservedWindowTarget,
    signal: AbortSignal | undefined,
    owner: string,
    epoch: number,
  ): Promise<WindowObservationProof> {
    const proof = this.windowObservations.reserveProof(target, owner, Date.now(), epoch)
    let current: MacosWindow
    try {
      current = selectWindowTarget(await this.listAllWindows(signal), { id: target.window.id })
    } catch (error) {
      if (error instanceof MacosUseError && error.code === 'MACOS_USE_WINDOW_NOT_FOUND') {
        throw new MacosUseError(`observed window ${String(target.window.id)} is stale`, 'MACOS_USE_TARGET_STALE')
      }
      throw error
    }
    this.assertControlAllowed(this.identityOfWindow(current))
    if (!sameObservedWindow(target.window, current)) {
      throw new MacosUseError(
        `observed window ${String(target.window.id)} changed before control`,
        'MACOS_USE_TARGET_STALE',
      )
    }
    this.assertDesktopEpoch(epoch)
    return { ...proof, window: current }
  }

  /**
   * Capture fresh evidence immediately after a control action.
   * @param target - optional exact consumed target whose post-action state should be captured.
   * @param signal - aborts evidence capture.
   * @param ownerId - trusted agent/session identity that performed the action.
   * @returns fresh screenshot evidence labelled as present, missing, or intentionally unscoped.
   */
  async actionReceipt(
    target?: ObservedWindowTarget,
    signal?: AbortSignal,
    ownerId?: string,
  ): Promise<MacosActionReceipt> {
    const owner = this.requireObservationOwner(ownerId)
    if (target === undefined) return { ...await this.screenshot(signal, owner), targetState: 'unscoped' }
    this.windowObservations.reserveReceipt(target, owner)
    const current = (await this.listAllWindows(signal)).find(window => window.id === target.window.id)
    if (current === undefined) return { ...await this.screenshot(signal, owner), targetState: 'missing' }
    this.assertReadAllowed(this.identityOfWindow(current))
    if (current.pid !== target.window.pid
        || normalizedAppName(current.app) !== normalizedAppName(target.window.app)
        || (current.bundleId ?? '').toLocaleLowerCase('en-US')
          !== (target.window.bundleId ?? '').toLocaleLowerCase('en-US')) {
      throw new MacosUseError(
        `window id ${String(target.window.id)} was reused after the action`,
        'MACOS_USE_TARGET_STALE',
      )
    }
    const capture = await this.screenshotWindow({ id: current.id }, signal, owner)
    return { ...capture, targetState: 'present' }
  }

  private identityOfWindow(window: MacosWindow): MacosAppIdentity {
    return {
      name: window.app,
      pid: window.pid,
      ...window.bundleId === undefined ? {} : { bundleId: window.bundleId },
    }
  }

  private appReadAllowed(identity: MacosAppIdentity): boolean {
    return appScopeAllows(identity, {
      ...this.runtime.readAppGrants === undefined ? {} : { grants: this.runtime.readAppGrants },
      legacyAllowedApps: this.runtime.allowedApps,
      legacyDeniedApps: this.runtime.deniedApps,
      ...this.runtime.deniedAppIdentities === undefined
        ? {}
        : { deniedIdentities: this.runtime.deniedAppIdentities },
    })
  }

  private appControlAllowed(identity: MacosAppIdentity): boolean {
    return appScopeAllows(identity, {
      ...this.runtime.controlAppGrants === undefined ? {} : { grants: this.runtime.controlAppGrants },
      legacyAllowedApps: this.runtime.allowedApps,
      legacyDeniedApps: this.runtime.deniedApps,
      ...this.runtime.deniedAppIdentities === undefined
        ? {}
        : { deniedIdentities: this.runtime.deniedAppIdentities },
    })
  }

  private assertReadAllowed(identity: MacosAppIdentity): void {
    if (!this.appReadAllowed(identity)) {
      throw new MacosUseError(
        `application is outside the GUI agent read scope: ${identity.name}; configure Read app grants in Plugin Configuration`,
        'MACOS_USE_APP_BLOCKED',
      )
    }
  }

  private assertControlAllowed(identity: MacosAppIdentity): void {
    if (!this.appControlAllowed(identity)) {
      throw new MacosUseError(
        `application is outside the GUI agent control scope: ${identity.name}; configure Control app grants in Plugin Configuration`,
        'MACOS_USE_APP_BLOCKED',
      )
    }
  }

  private assertScreenshotAllowed(window: MacosWindow): void {
    this.assertReadAllowed(this.identityOfWindow(window))
    const candidate = normalizedAppName(window.app)
    if (this.runtime.excludedScreenshotApps.some(value => normalizedAppName(value) === candidate)) {
      throw new MacosUseError(
        `screenshots are blocked for sensitive application: ${window.app}`,
        'MACOS_USE_SCREENSHOT_BLOCKED',
      )
    }
  }

  /**
   * Restore the exact target displaced by a same-Mac approval UI and prove the
   * model- or semantic-grounding pixels still match before the caller reaches
   * native input dispatch. The caller already owns the surrounding native
   * mutation queue, so no plugin action can interleave restoration and input.
   */
  private async restorePostApprovalTarget(
    proof: WindowObservationProof,
    observedScreen: ScreenObservationTarget | undefined,
    signal: AbortSignal | undefined,
    epoch: number,
    markDispatched: MutationDispatch,
  ): Promise<ScreenTargetState> {
    if (proof.rasterDigest === undefined) {
      throw new MacosUseError(
        'post-approval focus restoration lacks the original raster proof',
        'MACOS_USE_TARGET_STALE',
      )
    }
    let currentWindow: MacosWindow
    try {
      currentWindow = selectWindowTarget(await this.listAllWindows(signal), { id: proof.window.id })
    } catch (error) {
      if (error instanceof MacosUseError && error.code === 'MACOS_USE_WINDOW_NOT_FOUND') {
        throw new MacosUseError(
          `observed window ${String(proof.window.id)} disappeared during approval`,
          'MACOS_USE_TARGET_STALE',
        )
      }
      throw error
    }
    this.assertReadAllowed(this.identityOfWindow(currentWindow))
    this.assertControlAllowed(this.identityOfWindow(currentWindow))
    this.assertScreenshotAllowed(currentWindow)
    if (!sameObservedWindow(proof.window, currentWindow)) {
      throw new MacosUseError(
        `observed window ${String(proof.window.id)} changed or was replaced during approval`,
        'MACOS_USE_TARGET_STALE',
      )
    }
    this.assertDesktopEpoch(epoch)

    let currentScreen = await this.observeScreenTarget(signal)
    this.assertDesktopEpoch(epoch)
    if (observedScreen !== undefined && !this.sameDisplay(observedScreen.display, currentScreen.display)) {
      throw new MacosUseError('main display identity or bounds changed during approval', 'MACOS_USE_TARGET_STALE')
    }
    if (!this.screenTargetsWindow(currentScreen, currentWindow)) {
      await this.runAtomicAppleScript(
        buildFocusWindowScript(currentWindow),
        signal,
        5000,
        markDispatched,
      )
      const restoredEpoch = epoch + 1
      this.assertDesktopEpoch(restoredEpoch)
      currentScreen = await this.waitForExactForegroundWindow(
        currentWindow,
        observedScreen?.display,
        signal,
        restoredEpoch,
      )
    }

    const activeEpoch = this.currentDesktopMutationEpoch()
    if (!this.screenTargetsWindow(currentScreen, currentWindow)
        || (observedScreen !== undefined && !sameScreenObservationTarget(observedScreen, currentScreen))) {
      throw new MacosUseError('approved target could not be restored exactly', 'MACOS_USE_TARGET_STALE')
    }
    const windowBytes = await this.captureExactWindow(currentWindow, signal)
    const after = await this.observeScreenTarget(signal)
    this.assertDesktopEpoch(activeEpoch)
    if (!this.screenTargetsWindow(after, currentWindow)
        || !sameScreenObservationTarget(currentScreen, after)) {
      throw new MacosUseError('approved target changed while its pixels were rebound', 'MACOS_USE_TARGET_STALE')
    }
    if (observedScreen !== undefined) {
      const capture = await this.composeAuthorizedDisplay(windowBytes, currentWindow, after.display.bounds)
      if (capture.pixels.width !== observedScreen.pixels.width
          || capture.pixels.height !== observedScreen.pixels.height) {
        throw new MacosUseError('approved target capture geometry changed', 'MACOS_USE_TARGET_STALE')
      }
    }
    if (await this.rasterDigest(windowBytes) !== proof.rasterDigest) {
      throw new MacosUseError(
        'approved target pixels changed; refusing to replay an action grounded before approval',
        'MACOS_USE_TARGET_STALE',
      )
    }
    return after
  }

  private screenTargetsWindow(screen: ScreenTargetState, window: MacosWindow): boolean {
    return sameProcessIdentity(screen.process, {
      name: window.app,
      pid: window.pid,
      ...window.bundleId === undefined ? {} : { bundleId: window.bundleId },
    }) && screen.window !== undefined && sameObservedWindow(window, screen.window)
  }

  private sameDisplay(left: MacosDisplay, right: MacosDisplay): boolean {
    return left.id === right.id
      && left.bounds.x === right.bounds.x
      && left.bounds.y === right.bounds.y
      && left.bounds.width === right.bounds.width
      && left.bounds.height === right.bounds.height
  }

  private async waitForExactForegroundWindow(
    window: MacosWindow,
    display: MacosDisplay | undefined,
    signal: AbortSignal | undefined,
    epoch: number,
  ): Promise<ScreenTargetState> {
    const deadline = Date.now() + Math.min(this.timeoutMs, 5000)
    for (;;) {
      const current = await this.observeScreenTarget(signal)
      this.assertDesktopEpoch(epoch)
      if (display !== undefined && !this.sameDisplay(display, current.display)) {
        throw new MacosUseError('main display identity or bounds changed during approval', 'MACOS_USE_TARGET_STALE')
      }
      if (this.screenTargetsWindow(current, window)) return current
      if (Date.now() >= deadline) {
        throw new MacosUseError(
          `approved window ${String(window.id)} did not become the exact foreground target`,
          'MACOS_USE_TARGET_STALE',
        )
      }
      await this.waitForRetry(signal)
    }
  }

  private async prepareControlTarget(
    target: ObservedWindowTarget | undefined,
    observationId: string | undefined,
    points: readonly ControlPoint[],
    signal?: AbortSignal,
    ownerId?: string,
    restoreObservedFocus?: boolean,
    markDispatched?: MutationDispatch,
  ): Promise<PreparedControlTarget> {
    const owner = this.requireObservationOwner(ownerId)
    const epoch = this.currentDesktopMutationEpoch()
    if (target === undefined && observationId === undefined) {
      throw new MacosUseError(
        'a fresh screen observation or exact window target is required before control',
        'MACOS_USE_TARGET_STALE',
      )
    }
    if (target !== undefined && observationId !== undefined && target.observationId !== observationId) {
      throw new MacosUseError('conflicting observation identities', 'MACOS_USE_TARGET_STALE')
    }
    const observedScreen = observationId === undefined || target !== undefined
      ? undefined
      : this.screenObservations.reserve(observationId, owner, Date.now(), epoch)
    const observedWindow = target === undefined
      ? undefined
      : await this.revalidateWindowAtEpoch(target, signal, owner, epoch)
    let currentScreen: ScreenTargetState
    if (restoreObservedFocus === true) {
      const restorationProof: WindowObservationProof | undefined = observedWindow ?? (
        observedScreen?.window === undefined
          ? undefined
          : {
            window: observedScreen.window,
            ...observedScreen.rasterDigest === undefined
              ? {}
              : { rasterDigest: observedScreen.rasterDigest },
          }
      )
      if (restorationProof === undefined || markDispatched === undefined) {
        throw new MacosUseError(
          'post-approval focus restoration requires an exact observed window',
          'MACOS_USE_TARGET_STALE',
        )
      }
      currentScreen = await this.restorePostApprovalTarget(
        restorationProof,
        observedScreen,
        signal,
        epoch,
        markDispatched,
      )
    } else {
      currentScreen = await this.observeScreenTarget(signal)
      this.assertDesktopEpoch(epoch)
    }
    let constrainedWindow = observedWindow?.window
    if (observedWindow !== undefined && (!sameProcessIdentity(currentScreen.process, {
      name: observedWindow.window.app,
      pid: observedWindow.window.pid,
      ...observedWindow.window.bundleId === undefined ? {} : { bundleId: observedWindow.window.bundleId },
    }) || currentScreen.window === undefined || !sameObservedWindow(observedWindow.window, currentScreen.window))) {
      throw new MacosUseError(
        `observed target ${observedWindow.window.app} (${String(observedWindow.window.pid)}) is not the frontmost window`,
        'MACOS_USE_TARGET_STALE',
      )
    }
    if (observedScreen !== undefined) {
      if (!sameScreenObservationTarget(observedScreen, currentScreen)) {
        throw new MacosUseError('screen observation target changed before control', 'MACOS_USE_TARGET_STALE')
      }
      constrainedWindow = observedScreen.window
    }
    this.assertControlAllowed(currentScreen.process)
    this.assertReadAllowed(currentScreen.process)
    const mappedPoints = observedScreen === undefined
      ? points
      : points.map((point) => {
        const mapped = capturePixelToGlobalPoint({
          displayId: observedScreen.display.id,
          globalPointRect: observedScreen.display.bounds,
          capturePixels: observedScreen.pixels,
        }, point)
        if (mapped === undefined) {
          throw new MacosUseError('coordinate is outside the observed capture', 'MACOS_USE_TARGET_STALE')
        }
        return mapped
      })
    if (mappedPoints.length > 0) {
      if (constrainedWindow === undefined) {
        throw new MacosUseError(
          'coordinate action requires an observed foreground window',
          'MACOS_USE_TARGET_STALE',
        )
      }
      assertPointsInsideWindow(constrainedWindow, mappedPoints)
      this.assertControlAllowed(this.identityOfWindow(constrainedWindow))
      this.assertReadAllowed(this.identityOfWindow(constrainedWindow))
    }
    if (constrainedWindow === undefined) {
      throw new MacosUseError('control requires an observed foreground window', 'MACOS_USE_TARGET_STALE')
    }
    return { points: mappedPoints, window: constrainedWindow }
  }

  private rememberWindowObservation(
    window: MacosWindow,
    ownerId: string,
    epoch = this.currentDesktopMutationEpoch(),
    rasterDigest?: string,
  ): Pick<ScreenshotResult, 'observationId' | 'observedAt'> {
    return this.windowObservations.remember(window, ownerId, Date.now(), epoch, rasterDigest)
  }

  private async listAllWindows(signal?: AbortSignal): Promise<readonly MacosWindow[]> {
    return this.runJson<MacosWindow[]>(buildListWindowsScript(), signal)
  }

  private async observeScreenTarget(signal?: AbortSignal): Promise<ScreenTargetState> {
    const [process, windows, display] = await Promise.all([
      this.readFrontmostProcess(signal),
      this.listAllWindows(signal),
      this.runJson<MacosDisplay>(buildMainDisplayBoundsScript(), signal),
    ])
    this.assertValidDisplay(display)
    return this.selectScreenTarget(process, windows, display)
  }

  private async captureExactWindow(window: MacosWindow, signal?: AbortSignal): Promise<Buffer> {
    const path = join(tmpdir(), `dsh-macos-window-${randomUUID()}.png`)
    try {
      await this.runCommand(['screencapture', '-x', '-o', '-l', String(window.id), path], signal)
      return await readFile(path)
    } finally {
      await unlink(path).catch(() => {})
    }
  }

  private async composeAuthorizedDisplay(
    windowPng: Buffer,
    window: MacosWindow,
    display: ScreenBounds,
  ): Promise<{ png: Buffer; pixels: ScreenPixelSize }> {
    if (!screenBoundsContain(display, window.bounds)) {
      throw new MacosUseError(
        'authorized foreground window is outside the main display',
        'MACOS_USE_TARGET_STALE',
      )
    }
    const metadata = await sharp(windowPng).metadata()
    const windowPixels = this.requirePixelSize(metadata.width, metadata.height)
    const scaleX = windowPixels.width / window.bounds.width
    const scaleY = windowPixels.height / window.bounds.height
    const pixels = this.requirePixelSize(
      Math.round(display.width * scaleX),
      Math.round(display.height * scaleY),
    )
    const left = Math.round((window.bounds.x - display.x) * scaleX)
    const top = Math.round((window.bounds.y - display.y) * scaleY)
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(top)
        || left < 0 || top < 0
        || left + windowPixels.width > pixels.width
        || top + windowPixels.height > pixels.height) {
      throw new MacosUseError(
        'authorized window capture cannot be placed inside the main-display canvas',
        'MACOS_USE_SCREENSHOT_BLOCKED',
      )
    }
    const png = await sharp({
      create: {
        width: pixels.width,
        height: pixels.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).composite([{ input: windowPng, left, top }]).png().toBuffer()
    return { png, pixels }
  }

  /** Hash decoded RGBA pixels so PNG metadata/compression cannot cause a false mismatch. */
  private async rasterDigest(png: Buffer): Promise<string> {
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const geometry = `${String(decoded.info.width)}x${String(decoded.info.height)}x${String(decoded.info.channels)}\0`
    return createHash('sha256').update(geometry).update(decoded.data).digest('hex')
  }

  private selectScreenTarget(
    process: FrontmostProcess,
    windows: readonly MacosWindow[],
    display: MacosDisplay,
  ): ScreenTargetState {
    const window = windows.find(candidate => candidate.onScreen
      && candidate.pid === process.pid
      && normalizedAppName(candidate.app) === normalizedAppName(process.name)
      && (candidate.bundleId ?? '').toLocaleLowerCase('en-US')
        === (process.bundleId ?? '').toLocaleLowerCase('en-US'))
    return {
      process,
      display,
      ...window === undefined ? {} : { window },
    }
  }

  private assertValidDisplay(display: MacosDisplay): void {
    if (!Number.isInteger(display.id)
        || !Number.isFinite(display.bounds.x) || !Number.isFinite(display.bounds.y)
        || !Number.isFinite(display.bounds.width) || !Number.isFinite(display.bounds.height)
        || display.bounds.width <= 0 || display.bounds.height <= 0) {
      throw new MacosUseError('native query returned invalid main-display identity/bounds', 'MACOS_USE_COMMAND_FAILED')
    }
  }

  private requirePixelSize(width: number | undefined, height: number | undefined): ScreenPixelSize {
    if (width === undefined || height === undefined
        || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width <= 0 || height <= 0) {
      throw new MacosUseError('screen capture returned invalid pixel dimensions', 'MACOS_USE_COMMAND_FAILED')
    }
    return { width, height }
  }

  private requireObservationOwner(ownerId: string | undefined): string {
    if (ownerId === undefined || ownerId.trim().length === 0) {
      throw new MacosUseError('trusted observation owner is required', 'MACOS_USE_TARGET_STALE')
    }
    // SessionId is an opaque identity; trim only validates non-whitespace and
    // must not merge two distinct registered owner strings.
    return ownerId
  }

  private async readFrontmostProcess(signal?: AbortSignal): Promise<FrontmostProcess> {
    return this.runJson<FrontmostProcess>(buildFrontmostProcessScript(), signal)
  }

  private async resolveWindow(
    target: WindowTarget,
    scope: 'read' | 'control',
    signal?: AbortSignal,
  ): Promise<MacosWindow> {
    const window = selectWindowTarget(await this.listAllWindows(signal), target)
    const identity = this.identityOfWindow(window)
    if (scope === 'read') this.assertReadAllowed(identity)
    else {
      this.assertReadAllowed(identity)
      this.assertControlAllowed(identity)
    }
    return window
  }

  private async resolveApplication(
    request: OpenAppRequest,
    signal?: AbortSignal,
  ): Promise<ResolvedMacosApplication> {
    const requestedName = request.name?.trim()
    const requestedBundle = request.bundleId?.trim()
    if ((requestedName === undefined || requestedName.length === 0)
        && (requestedBundle === undefined || requestedBundle.length === 0)) {
      throw new MacosUseError('openApp requires an exact application name or bundleId', 'MACOS_USE_APP_NOT_FOUND')
    }
    let discovered: readonly string[]
    if (requestedBundle !== undefined && requestedBundle.length > 0) {
      discovered = await this.runJson<string[]>(buildApplicationUrlsForBundleScript(requestedBundle), signal)
    } else if (requestedName !== undefined && requestedName.length > 0) {
      discovered = this.parseNullSeparatedPaths(await this.runCommand([
        'mdfind',
        '-0',
        '-name',
        `${requestedName}.app`,
      ], signal))
    } else {
      throw new MacosUseError('openApp requires an exact application name or bundleId', 'MACOS_USE_APP_NOT_FOUND')
    }
    const paths = [...new Set([...discovered, ...await this.scanStandardApplicationRoots(signal)])]
    const inspected = paths.length === 0
      ? []
      : await this.runJson<ResolvedMacosApplication[]>(buildApplicationBundleInspectionScript(paths), signal)
    return selectResolvedApplication(inspected, request)
  }

  private parseNullSeparatedPaths(output: string): readonly string[] {
    return output.split('\0').map(value => value.trim()).filter(value => value.length > 0)
  }

  private async scanStandardApplicationRoots(signal?: AbortSignal): Promise<readonly string[]> {
    const candidates = [
      '/Applications',
      '/System/Applications',
      '/System/Library/CoreServices',
      join(homedir(), 'Applications'),
    ]
    const existing = (await Promise.all(candidates.map(async (path) => {
      try {
        await access(path)
        return path
      } catch {
        return undefined
      }
    }))).filter((path): path is string => path !== undefined)
    if (existing.length === 0) return []
    return this.parseNullSeparatedPaths(await this.runCommand([
      '/usr/bin/find',
      ...existing,
      '-type',
      'd',
      '-name',
      '*.app',
      '-prune',
      '-print0',
    ], signal))
  }

  private async waitForFrontmostApplication(
    application: ResolvedMacosApplication,
    signal?: AbortSignal,
  ): Promise<FrontmostProcess> {
    const deadline = Date.now() + Math.min(this.timeoutMs, 5000)
    let current: FrontmostProcess | undefined
    for (;;) {
      current = await this.readFrontmostProcess(signal)
      if (sameExactApplicationName(current.name, application.name)
          && (current.bundleId ?? '').toLocaleLowerCase('en-US')
            === application.bundleId.toLocaleLowerCase('en-US')) return current
      if (Date.now() >= deadline) break
      await this.waitForRetry(signal)
    }
    throw new MacosUseError(
      `launched application did not become the exact frontmost target: ${application.bundleId}; current=${current.bundleId ?? current.name}`,
      'MACOS_USE_TARGET_STALE',
    )
  }

  private async waitForRetry(signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(this.abortError(signal))
        return
      }
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(this.abortError(signal))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, 50)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private currentDesktopMutationEpoch(): number {
    return this.desktopMutationEpoch
  }

  private assertDesktopEpoch(expected: number): void {
    if (this.currentDesktopMutationEpoch() !== expected) {
      throw new MacosUseError(
        'desktop changed during observation or target revalidation',
        'MACOS_USE_TARGET_STALE',
      )
    }
  }

  private assertNoNativeMutationInFlight(): void {
    if (this.nativeMutationDispatched) {
      throw new MacosUseError(
        'a native desktop mutation is still in flight',
        'MACOS_USE_TARGET_STALE',
      )
    }
  }

  private advanceDesktopMutationEpoch(preserveReceiptObservationId?: string): void {
    this.desktopMutationEpoch = this.currentDesktopMutationEpoch() + 1
    this.windowObservations.invalidateForMutation(preserveReceiptObservationId)
    this.screenObservations.clear()
  }

  private async withNativeMutation<T>(
    signal: AbortSignal | undefined,
    preserveReceiptObservationId: string | undefined,
    operation: (markDispatched: MutationDispatch) => Promise<T>,
  ): Promise<T> {
    const previous = this.nativeMutationTail
    let release = (): void => {}
    const current = new Promise<void>((resolve) => { release = resolve })
    this.nativeMutationTail = previous.then(() => current, () => current)
    await previous.catch(() => {})
    let dispatched = false
    try {
      if (signal?.aborted === true) throw this.abortError(signal)
      return await operation(() => {
        if (dispatched) return
        dispatched = true
        this.nativeMutationDispatched = true
        this.advanceDesktopMutationEpoch(preserveReceiptObservationId)
      })
    } finally {
      this.nativeMutationDispatched = false
      release()
    }
  }

  private async runJxa(script: string, signal?: AbortSignal): Promise<string> {
    return this.runCommand(['osascript', '-l', 'JavaScript', '-e', script], signal)
  }

  private async runAtomicJxa(
    script: string,
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: MutationDispatch,
  ): Promise<string> {
    return this.runAtomicCommand(
      ['osascript', '-l', 'JavaScript', '-e', script],
      signal,
      minimumTimeoutMs,
      onDispatch,
    )
  }

  private async runAtomicAppleScript(
    script: string,
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: MutationDispatch,
  ): Promise<string> {
    return this.runAtomicCommand(['osascript', '-e', script], signal, minimumTimeoutMs, onDispatch)
  }

  private async runJson<T>(script: string, signal?: AbortSignal): Promise<T> {
    const output = await this.runJxa(script, signal)
    try {
      return JSON.parse(output) as T
    } catch (error) {
      throw new MacosUseError(`native macOS query returned invalid JSON: ${String(error)}`, 'MACOS_USE_COMMAND_FAILED')
    }
  }

  private async runCommand(argv: readonly string[], signal?: AbortSignal): Promise<string> {
    return this.runCommandWithTimeout(argv, signal, this.timeoutMs)
  }

  private async runAtomicCommand(
    argv: readonly string[],
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: MutationDispatch,
  ): Promise<string> {
    if (signal?.aborted === true) throw this.abortError(signal)
    return this.runCommandWithTimeout(argv, undefined, Math.max(this.timeoutMs, minimumTimeoutMs), onDispatch)
  }

  private abortError(signal: AbortSignal | undefined): Error {
    return signal?.reason instanceof Error ? signal.reason : new Error('macOS action was aborted')
  }

  private async runCommandWithTimeout(
    argv: readonly string[],
    signal: AbortSignal | undefined,
    timeoutMs: number,
    onDispatch?: MutationDispatch,
  ): Promise<string> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combinedSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd: tmpdir(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 65_536 },
        stderr: { maxBytes: 65_536 },
      },
      graceMs: 2000,
      signal: combinedSignal,
    })
    onDispatch?.()
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (timeoutSignal.aborted && outcome.exitCode === null) {
      throw new MacosUseError(`${argv[0]} timed out after ${String(timeoutMs)}ms`, 'MACOS_USE_TIMED_OUT')
    }
    if (outcome.exitCode !== 0) {
      throw new MacosUseError(
        `${argv[0]} exited with code ${String(outcome.exitCode)}: ${stderr.trim() || stdout.trim()}`,
        'MACOS_USE_COMMAND_FAILED',
      )
    }
    return stdout.trim()
  }
}

export default MacosUseService
