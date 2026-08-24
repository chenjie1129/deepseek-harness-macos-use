/**
 * Service Definition and local implementation for the macOS desktop-control capability seam (`ctx.macosUse`):
 * full-screen capture via `screencapture`, GUI automation (clicks, keystrokes, scrolling) via AppleScript/System
 * Events, application launch via `open`, and direct AppleScript execution. One concrete implementation exists —
 * macOS System Events has no swappable alternative in this harness — so the definition and its provider are one
 * package, unlike the `dsh-shell`/`dsh-subprocess` seams that carry more than one backend.
 * @module @deepseek-ai/dsh-macos-use
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-subprocess'
import sharp from 'sharp'
import {
  buildClickScript,
  buildFrontmostAppScript,
  buildKeyScript,
  buildScrollScript,
  buildTypeScript,
} from './applescript.ts'
import {
  buildDragPointerScript,
  buildFocusWindowScript,
  buildListAppsScript,
  buildListWindowsScript,
  buildMainDisplayBoundsScript,
  buildMovePointerScript,
  buildWindowElementsScript,
} from './native.ts'
import { MacosUseError } from './types.ts'
import type {
  ClickRequest,
  DragRequest,
  KeyPressRequest,
  MacosApplication,
  MacosUseRuntimeSettings,
  MacosWindow,
  MoveRequest,
  OpenAppRequest,
  RunAppleScriptRequest,
  ScreenBounds,
  ScreenshotResult,
  ScrollRequest,
  TypeTextRequest,
  WindowStateRequest,
  WindowStateResult,
  WindowTarget,
} from './types.ts'

export { MacosUseError } from './types.ts'
export type {
  ClickRequest,
  DragRequest,
  AccessibilityElement,
  KeyModifier,
  KeyPressRequest,
  MacosApplication,
  MacosUseErrorCode,
  MacosUseRuntimeSettings,
  MacosWindow,
  MoveRequest,
  MouseButton,
  OpenAppRequest,
  RunAppleScriptRequest,
  ScreenBounds,
  ScreenshotResult,
  ScrollRequest,
  TypeTextRequest,
  WindowStateRequest,
  WindowStateResult,
  WindowTarget,
} from './types.ts'

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

function normalizedApp(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')
}

function sameBounds(left: ScreenBounds, right: ScreenBounds): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height
}

function intersects(left: ScreenBounds, right: ScreenBounds): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y
}

export const Config: z<Config> = z.object({
  commandTimeoutMs: z.number().step(1).min(1),
})

/**
 * macOS desktop-control service. Registered as `ctx.macosUse` (one instance per context). Every action shells
 * out through `ctx.subprocess` — never `node:child_process` directly — to `osascript`, `screencapture`, or
 * `open`. GUI automation and screen capture require the host process to hold Accessibility and Screen Recording
 * permission respectively in System Settings; macOS prompts for both on first use and denies silently (an empty
 * capture, a script that compiles but has no visible effect) until granted.
 */
export class MacosUseService extends Service {
  static inject = ['subprocess']
  static Config = Config

  private timeoutMs: number
  private runtime: MacosUseRuntimeSettings

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'macosUse')
    this.timeoutMs = config.commandTimeoutMs ?? MACOS_USE_DEFAULT_COMMAND_TIMEOUT_MS
    this.runtime = {
      commandTimeoutMs: this.timeoutMs,
      allowedApps: [],
      deniedApps: [],
      excludedScreenshotApps: [],
      maxElementsPerSnapshot: MACOS_USE_DEFAULT_MAX_ELEMENTS,
    }
  }

  /**
   * Apply the live, visually managed runtime policy used by every subsequent action.
   * @param settings - complete policy projection from the tool plugin's visual section.
   */
  configure(settings: MacosUseRuntimeSettings): void {
    this.timeoutMs = settings.commandTimeoutMs
    this.runtime = {
      commandTimeoutMs: settings.commandTimeoutMs,
      allowedApps: [...settings.allowedApps],
      deniedApps: [...settings.deniedApps],
      excludedScreenshotApps: [...settings.excludedScreenshotApps],
      maxElementsPerSnapshot: settings.maxElementsPerSnapshot,
    }
  }

  /**
   * Capture the full screen.
   * @param signal - aborts the capture.
   * @returns the capture as base64-encoded PNG bytes.
   */
  async screenshot(signal?: AbortSignal): Promise<ScreenshotResult> {
    const path = join(tmpdir(), `dsh-macos-use-${randomUUID()}.png`)
    try {
      await this.runCommand(['screencapture', '-x', path], signal)
      const bytes = await readFile(path)
      const redacted = await this.redactExcludedWindows(bytes, signal)
      return { pngBase64: redacted.toString('base64') }
    } finally {
      await unlink(path).catch(() => {})
    }
  }

  /**
   * List running foreground-capable apps after applying the allow/deny policy.
   * @param signal - aborts the native discovery request.
   * @returns permitted applications with bundle and process metadata.
   */
  async listApps(signal?: AbortSignal): Promise<readonly MacosApplication[]> {
    const apps = await this.runJson<MacosApplication[]>(buildListAppsScript(), signal)
    return apps.filter(app => this.appAllowed(app.name))
  }

  /**
   * List ordinary on-screen windows after applying the allow/deny policy.
   * @param signal - aborts the native discovery request.
   * @returns permitted layer-zero windows and their point-space bounds.
   */
  async listWindows(signal?: AbortSignal): Promise<readonly MacosWindow[]> {
    const windows = await this.listAllWindows(signal)
    return windows.filter(window => this.appAllowed(window.app))
  }

  /**
   * Capture one exact window by CoreGraphics window id or application/title selector.
   * @param target - selector resolving one permitted, non-sensitive window.
   * @param signal - aborts discovery or capture.
   * @returns PNG bytes paired with the exact resolved window metadata.
   */
  async screenshotWindow(target: WindowTarget, signal?: AbortSignal): Promise<ScreenshotResult & { window: MacosWindow }> {
    const window = await this.resolveWindow(target, signal)
    this.assertScreenshotAllowed(window.app)
    const path = join(tmpdir(), `dsh-macos-window-${randomUUID()}.png`)
    try {
      await this.runCommand(['screencapture', '-x', '-l', String(window.id), path], signal)
      const bytes = await readFile(path)
      return { window, pngBase64: bytes.toString('base64') }
    } finally {
      await unlink(path).catch(() => {})
    }
  }

  /**
   * Capture one exact window and flatten its Accessibility controls.
   * @param request - window selector and optional element budget.
   * @param signal - aborts capture or Accessibility enumeration.
   * @returns exact window pixels, metadata, and bounded semantic elements.
   */
  async windowState(request: WindowStateRequest, signal?: AbortSignal): Promise<WindowStateResult> {
    const window = await this.resolveWindow(request, signal)
    this.assertScreenshotAllowed(window.app)
    const maxElements = Math.max(1, Math.min(
      2000,
      Math.trunc(request.maxElements ?? this.runtime.maxElementsPerSnapshot),
    ))
    const [{ pngBase64 }, semantic] = await Promise.all([
      this.screenshotWindow({ id: window.id }, signal),
      this.runJson<{ elements: WindowStateResult['elements']; truncated: boolean }>(
        buildWindowElementsScript(window, maxElements),
        signal,
      ),
    ])
    const current = await this.resolveWindow({ id: window.id }, signal)
    if (!sameBounds(window.bounds, current.bounds)) {
      throw new MacosUseError('window geometry changed while its state was captured', 'MACOS_USE_WINDOW_NOT_FOUND')
    }
    return { window: current, pngBase64, elements: semantic.elements, truncated: semantic.truncated }
  }

  /**
   * Click, double-click, or right-click at absolute screen coordinates.
   * @param request - target point, button, and held modifiers.
   * @param signal - aborts the click.
   */
  async click(request: ClickRequest, signal?: AbortSignal): Promise<void> {
    await this.assertFrontmostAllowed(signal)
    await this.runAppleScript(buildClickScript(request.x, request.y, request), signal)
  }

  /**
   * Move the pointer without clicking.
   * @param request - absolute destination in macOS point space.
   * @param signal - aborts the pointer action.
   */
  async move(request: MoveRequest, signal?: AbortSignal): Promise<void> {
    await this.assertFrontmostAllowed(signal)
    await this.runJxa(buildMovePointerScript(request.x, request.y), signal)
  }

  /**
   * Drag from one absolute screen coordinate to another.
   * @param request - start, destination, and optional bounded duration.
   * @param signal - aborts the pointer action.
   */
  async drag(request: DragRequest, signal?: AbortSignal): Promise<void> {
    await this.assertFrontmostAllowed(signal)
    const durationMs = Math.max(50, Math.min(5000, Math.trunc(request.durationMs ?? 300)))
    await this.runJxa(buildDragPointerScript(request.x, request.y, request.toX, request.toY, durationMs), signal)
  }

  /**
   * Type literal text via keystroke events into the currently focused element.
   * @param request - the text to type.
   * @param signal - aborts the keystrokes.
   */
  async type(request: TypeTextRequest, signal?: AbortSignal): Promise<void> {
    await this.assertFrontmostAllowed(signal)
    await this.runAppleScript(buildTypeScript(request.text), signal)
  }

  /**
   * Press a single key or modifier combo.
   * @param request - a combo like `"return"`, `"cmd+shift+t"`, or `"a"`.
   * @param signal - aborts the keystroke.
   */
  async key(request: KeyPressRequest, signal?: AbortSignal): Promise<void> {
    await this.assertFrontmostAllowed(signal)
    await this.runAppleScript(buildKeyScript(request.combo), signal)
  }

  /**
   * Scroll by repeating an arrow/page key a bounded number of times — System Events exposes no scroll-wheel
   * event, so this is an approximation, not a trackpad-accurate scroll delta.
   * @param request - direction and step count.
   * @param signal - aborts the scroll.
   */
  async scroll(request: ScrollRequest, signal?: AbortSignal): Promise<void> {
    await this.assertFrontmostAllowed(signal)
    await this.runAppleScript(buildScrollScript(request.direction, request.amount ?? 5), signal)
  }

  /**
   * Launch or activate an application by name.
   * @param request - the application name as `open -a` resolves it.
   * @param signal - aborts the launch.
   */
  async openApp(request: OpenAppRequest, signal?: AbortSignal): Promise<void> {
    this.assertAppAllowed(request.name)
    await this.runCommand(['open', '-a', request.name], signal)
  }

  /**
   * Bring one exact window to the foreground.
   * @param target - selector resolving one permitted window.
   * @param signal - aborts discovery or focus.
   * @returns metadata for the window the action targeted.
   */
  async focusWindow(target: WindowTarget, signal?: AbortSignal): Promise<MacosWindow> {
    const window = await this.resolveWindow(target, signal)
    await this.runAppleScript(buildFocusWindowScript(window), signal)
    return window
  }

  /**
   * Run caller-supplied AppleScript.
   * @param request - complete AppleScript source, or its shorthand string form.
   * @param signal - aborts the script.
   * @returns the script's stdout, trimmed.
   */
  async runAppleScript(request: RunAppleScriptRequest | string, signal?: AbortSignal): Promise<string> {
    const script = typeof request === 'string' ? request : request.script
    return this.runCommand(['osascript', '-e', script], signal)
  }

  /**
   * Resolve the frontmost application.
   * @param signal - aborts the lookup.
   * @returns the frontmost process's name.
   */
  async frontmostApp(signal?: AbortSignal): Promise<string> {
    return this.runAppleScript(buildFrontmostAppScript(), signal)
  }

  private appAllowed(app: string): boolean {
    const candidate = normalizedApp(app)
    const denied = this.runtime.deniedApps.some(value => normalizedApp(value) === candidate)
    if (denied) return false
    return this.runtime.allowedApps.length === 0
      || this.runtime.allowedApps.some(value => normalizedApp(value) === candidate)
  }

  private assertAppAllowed(app: string): void {
    if (!this.appAllowed(app)) {
      throw new MacosUseError(`application is blocked by the GUI agent policy: ${app}`, 'MACOS_USE_APP_BLOCKED')
    }
  }

  private assertScreenshotAllowed(app: string): void {
    this.assertAppAllowed(app)
    const candidate = normalizedApp(app)
    if (this.runtime.excludedScreenshotApps.some(value => normalizedApp(value) === candidate)) {
      throw new MacosUseError(
        `screenshots are blocked for sensitive application: ${app}`,
        'MACOS_USE_SCREENSHOT_BLOCKED',
      )
    }
  }

  private async assertFrontmostAllowed(signal?: AbortSignal): Promise<void> {
    const app = await this.frontmostApp(signal)
    this.assertAppAllowed(app)
  }

  private async listAllWindows(signal?: AbortSignal): Promise<readonly MacosWindow[]> {
    return this.runJson<MacosWindow[]>(buildListWindowsScript(), signal)
  }

  private async resolveWindow(target: WindowTarget, signal?: AbortSignal): Promise<MacosWindow> {
    const windows = await this.listAllWindows(signal)
    let window: MacosWindow | undefined
    if (target.id !== undefined) window = windows.find(candidate => candidate.id === target.id)
    if (window === undefined && target.app !== undefined) {
      const app = normalizedApp(target.app)
      window = windows.find(candidate => normalizedApp(candidate.app) === app
        && (target.title === undefined || candidate.title === target.title))
    }
    if (window === undefined) {
      throw new MacosUseError('requested window is not currently available', 'MACOS_USE_WINDOW_NOT_FOUND')
    }
    this.assertAppAllowed(window.app)
    return window
  }

  private async redactExcludedWindows(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
    if (this.runtime.excludedScreenshotApps.length === 0) return bytes
    const [windows, display, metadata] = await Promise.all([
      this.listAllWindows(signal),
      this.runJson<ScreenBounds>(buildMainDisplayBoundsScript(), signal),
      sharp(bytes).metadata(),
    ])
    const width = metadata.width
    const height = metadata.height
    if (width <= 0 || height <= 0 || display.width <= 0 || display.height <= 0) return bytes
    const excluded = windows.filter(window => window.onScreen && intersects(window.bounds, display)
      && this.runtime.excludedScreenshotApps.some(value => normalizedApp(value) === normalizedApp(window.app)))
    if (excluded.length === 0) return bytes
    const scaleX = width / display.width
    const scaleY = height / display.height
    const rectangles = excluded.map((window) => {
      const x = Math.max(0, Math.floor((window.bounds.x - display.x) * scaleX))
      const y = Math.max(0, Math.floor((window.bounds.y - display.y) * scaleY))
      const rectangleWidth = Math.min(width - x, Math.ceil(window.bounds.width * scaleX))
      const rectangleHeight = Math.min(height - y, Math.ceil(window.bounds.height * scaleY))
      return `<rect x="${String(x)}" y="${String(y)}" width="${String(rectangleWidth)}" height="${String(rectangleHeight)}" fill="#111"/>`
    }).join('')
    const overlay = Buffer.from(`<svg width="${String(width)}" height="${String(height)}" xmlns="http://www.w3.org/2000/svg">${rectangles}</svg>`)
    return sharp(bytes).composite([{ input: overlay, blend: 'over' }]).png().toBuffer()
  }

  private async runJxa(script: string, signal?: AbortSignal): Promise<string> {
    return this.runCommand(['osascript', '-l', 'JavaScript', '-e', script], signal)
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
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
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
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (timeoutSignal.aborted && outcome.exitCode === null) {
      throw new MacosUseError(`${argv[0]} timed out after ${this.timeoutMs}ms`, 'MACOS_USE_TIMED_OUT')
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
