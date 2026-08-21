/**
 * Service Definition and local implementation for the macOS desktop-control capability seam (`ctx.macosUse`):
 * full-screen capture via `screencapture`, GUI automation (clicks, keystrokes, scrolling) via AppleScript/System
 * Events, application launch via `open`, and direct AppleScript execution. One concrete implementation exists —
 * macOS System Events has no swappable alternative in this harness — so the definition and its provider are one
 * package, unlike the `dsh-shell`/`dsh-subprocess` seams that carry more than one backend.
 * @module @deepseek-ai/dsh-macos-use
 */

import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-subprocess'
import {
  buildClickScript,
  buildFrontmostAppScript,
  buildKeyScript,
  buildScrollScript,
  buildTypeScript,
} from './applescript.ts'
import { MacosUseError } from './types.ts'
import type {
  ClickRequest,
  KeyPressRequest,
  OpenAppRequest,
  RunAppleScriptRequest,
  ScreenshotResult,
  ScrollRequest,
  TypeTextRequest,
} from './types.ts'

export { MacosUseError } from './types.ts'
export type {
  ClickRequest,
  KeyModifier,
  KeyPressRequest,
  MacosUseErrorCode,
  MouseButton,
  OpenAppRequest,
  RunAppleScriptRequest,
  ScreenshotResult,
  ScrollRequest,
  TypeTextRequest,
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

  private readonly timeoutMs: number

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'macosUse')
    this.timeoutMs = config.commandTimeoutMs ?? MACOS_USE_DEFAULT_COMMAND_TIMEOUT_MS
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
      return { pngBase64: bytes.toString('base64') }
    } finally {
      await unlink(path).catch(() => {})
    }
  }

  /**
   * Click, double-click, or right-click at absolute screen coordinates.
   * @param request - target point, button, and held modifiers.
   * @param signal - aborts the click.
   */
  async click(request: ClickRequest, signal?: AbortSignal): Promise<void> {
    await this.runAppleScript(buildClickScript(request.x, request.y, request), signal)
  }

  /**
   * Type literal text via keystroke events into the currently focused element.
   * @param request - the text to type.
   * @param signal - aborts the keystrokes.
   */
  async type(request: TypeTextRequest, signal?: AbortSignal): Promise<void> {
    await this.runAppleScript(buildTypeScript(request.text), signal)
  }

  /**
   * Press a single key or modifier combo.
   * @param request - a combo like `"return"`, `"cmd+shift+t"`, or `"a"`.
   * @param signal - aborts the keystroke.
   */
  async key(request: KeyPressRequest, signal?: AbortSignal): Promise<void> {
    await this.runAppleScript(buildKeyScript(request.combo), signal)
  }

  /**
   * Scroll by repeating an arrow/page key a bounded number of times — System Events exposes no scroll-wheel
   * event, so this is an approximation, not a trackpad-accurate scroll delta.
   * @param request - direction and step count.
   * @param signal - aborts the scroll.
   */
  async scroll(request: ScrollRequest, signal?: AbortSignal): Promise<void> {
    await this.runAppleScript(buildScrollScript(request.direction, request.amount ?? 5), signal)
  }

  /**
   * Launch or activate an application by name.
   * @param request - the application name as `open -a` resolves it.
   * @param signal - aborts the launch.
   */
  async openApp(request: OpenAppRequest, signal?: AbortSignal): Promise<void> {
    await this.runCommand(['open', '-a', request.name], signal)
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
