/**
 * AppleScript/System Events script builders backing {@link MacosUseService}. Isolated from `index.ts` so the
 * generated-script vocabulary (verified against real `osacompile` output while developing this package) stays
 * one small, independently readable unit.
 * @module @deepseek-ai/dsh-macos-use/applescript
 */

import { MacosUseError } from './types.ts'
import type { KeyModifier, MacosWindow, MouseButton } from './types.ts'

const MODIFIER_KEYWORD: Record<KeyModifier, string> = {
  command: 'command',
  control: 'control',
  option: 'option',
  shift: 'shift',
}

/** `System Events` key codes for keys with no printable character. */
const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  forwarddelete: 117,
  escape: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
}

/** Arrow key codes for {@link buildScrollScript}, typed by direction so lookup needs no assertion. */
const DIRECTION_KEY_CODES: Readonly<Record<'up' | 'down' | 'left' | 'right', number>> = {
  up: 126,
  down: 125,
  left: 123,
  right: 124,
}

/**
 * Escape a literal for an AppleScript double-quoted string.
 * @param value - untrusted literal text.
 * @returns escaped AppleScript string content without surrounding quotes.
 */
export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function usingClause(modifiers: readonly KeyModifier[]): string {
  if (modifiers.length === 0) return ''
  return ` using {${modifiers.map(modifier => `${MODIFIER_KEYWORD[modifier]} down`).join(', ')}}`
}

/** Validated key-combination parts shared by the AppleScript and JXA emitters. */
export interface ParsedKeyCombo {
  keyCode?: number
  character?: string
  modifiers: readonly KeyModifier[]
}

/**
 * Parse and validate a key combo once for both AppleScript and JXA backends.
 * @param combo - one named or printable key with optional modifiers.
 * @returns the supported key code or character plus normalized modifiers.
 */
export function parseKeyCombo(combo: string): ParsedKeyCombo {
  const parts = combo.split('+').map(part => part.trim().toLowerCase()).filter(part => part.length > 0)
  if (parts.length === 0) {
    throw new MacosUseError(`invalid key combo: ${JSON.stringify(combo)}`, 'MACOS_USE_UNSUPPORTED_KEY')
  }
  const main = parts[parts.length - 1]
  if (main === undefined) {
    throw new MacosUseError(`invalid key combo: ${JSON.stringify(combo)}`, 'MACOS_USE_UNSUPPORTED_KEY')
  }
  const modifiers = parts.slice(0, -1).map((name): KeyModifier => {
    const normalized = name === 'cmd' ? 'command' : name === 'ctrl' ? 'control' : name === 'alt' ? 'option' : name
    if (normalized !== 'command' && normalized !== 'control' && normalized !== 'option' && normalized !== 'shift') {
      throw new MacosUseError(`unsupported modifier: ${JSON.stringify(name)}`, 'MACOS_USE_UNSUPPORTED_KEY')
    }
    return normalized
  })
  const keyCode = NAMED_KEY_CODES[main]
  if (keyCode !== undefined) return { keyCode, modifiers }
  if (main.length === 1) return { character: main, modifiers }
  throw new MacosUseError(`unsupported key: ${JSON.stringify(main)}`, 'MACOS_USE_UNSUPPORTED_KEY')
}

function exactWindowGuard(window: MacosWindow): string {
  const app = escapeAppleScriptString(window.app)
  const title = escapeAppleScriptString(window.title)
  const bundleCheck = window.bundleId === undefined
    ? ''
    : `if (bundle identifier of targetProcess) is not "${escapeAppleScriptString(window.bundleId)}" then error "target process bundle changed"\n`
  const { x, y, width, height } = window.bounds
  return 'on nearValue(leftValue, rightValue)\n'
    + 'return ((leftValue - rightValue) is less than or equal to 2) and ((rightValue - leftValue) is less than or equal to 2)\n'
    + 'end nearValue\n'
    + 'tell application "System Events"\n'
    + `set matchingProcesses to every application process whose unix id is ${String(window.pid)}\n`
    + 'if (count matchingProcesses) is not 1 then error "target process is stale or ambiguous"\n'
    + 'set targetProcess to item 1 of matchingProcesses\n'
    + `if (name of targetProcess) is not "${app}" then error "target process identity changed"\n`
    + bundleCheck
    + 'if (frontmost of targetProcess) is not true then error "target process is no longer frontmost"\n'
    + 'set matchingWindows to {}\n'
    + 'repeat with candidateWindow in windows of targetProcess\n'
    + 'try\n'
    + 'set candidateTitle to name of candidateWindow\n'
    + 'set candidatePosition to position of candidateWindow\n'
    + 'set candidateSize to size of candidateWindow\n'
    + `if candidateTitle is "${title}" and my nearValue(item 1 of candidatePosition, ${String(x)}) and my nearValue(item 2 of candidatePosition, ${String(y)}) and my nearValue(item 1 of candidateSize, ${String(width)}) and my nearValue(item 2 of candidateSize, ${String(height)}) then set end of matchingWindows to candidateWindow\n`
    + 'end try\n'
    + 'end repeat\n'
    + 'if (count matchingWindows) is not 1 then error "target window is stale or ambiguous"\n'
}

function buildGuardedSystemEventsScript(window: MacosWindow, body: string): string {
  return `${exactWindowGuard(window)}${body}\nend tell`
}

function clickBody(
  x: number,
  y: number,
  options: { button?: MouseButton; doubleClick?: boolean; modifiers?: readonly KeyModifier[] },
): string {
  const verb = options.button === 'right' ? 'right click' : options.doubleClick === true ? 'double click' : 'click'
  const modifiers = options.modifiers ?? []
  const point = `{${x}, ${y}}`
  if (modifiers.length === 0) return `${verb} at ${point}`
  const names = modifiers.map(modifier => MODIFIER_KEYWORD[modifier])
  const downs = names.map(name => `key down ${name}`).join('\n')
  const ups = [...names].reverse().map(name => `key up ${name}`).join('\n')
  return `try\n${downs}\n${verb} at ${point}\non error errorMessage number errorNumber\n${ups}\nerror errorMessage number errorNumber\nend try\n${ups}`
}

/**
 * Build a `System Events` click script. Modifier-held clicks compile only as
 * separate `key down`/`key up` statements around the click — `click at {x, y}
 * using {...}` does not compile under System Events' AppleScript dictionary.
 * @param x - absolute horizontal screen coordinate.
 * @param y - absolute vertical screen coordinate.
 * @param options - button, click count, and held modifiers.
 * @returns complete AppleScript source.
 */
export function buildClickScript(
  x: number,
  y: number,
  options: { button?: MouseButton; doubleClick?: boolean; modifiers?: readonly KeyModifier[] },
): string {
  const body = clickBody(x, y, options)
  return body.includes('\n')
    ? `tell application "System Events"\n${body}\nend tell`
    : `tell application "System Events" to ${body}`
}

/**
 * Build a click whose exact process/window guard and input share one native script.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param x - absolute horizontal screen coordinate.
 * @param y - absolute vertical screen coordinate.
 * @param options - button, click count, and held modifiers.
 * @returns guarded AppleScript source that fails before input when the window changed.
 */
export function buildGuardedClickScript(
  window: MacosWindow,
  x: number,
  y: number,
  options: { button?: MouseButton; doubleClick?: boolean; modifiers?: readonly KeyModifier[] },
): string {
  return buildGuardedSystemEventsScript(window, clickBody(x, y, options))
}

/**
 * Build a `System Events` keystroke script delivering literal text.
 * @param text - text to type.
 * @returns complete AppleScript source.
 */
export function buildTypeScript(text: string): string {
  return `tell application "System Events" to keystroke "${escapeAppleScriptString(text)}"`
}

/**
 * Build literal typing whose exact process/window guard and input share one native script.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param text - literal text delivered after the target guard succeeds.
 * @returns guarded AppleScript source that fails before input when the window changed.
 */
export function buildGuardedTypeScript(window: MacosWindow, text: string): string {
  return buildGuardedSystemEventsScript(window, `keystroke "${escapeAppleScriptString(text)}"`)
}

function keyBody(combo: string): string {
  const parsed = parseKeyCombo(combo)
  const clause = usingClause(parsed.modifiers)
  if (parsed.keyCode !== undefined) return `key code ${String(parsed.keyCode)}${clause}`
  if (parsed.character === undefined) {
    throw new MacosUseError(`unsupported key: ${JSON.stringify(combo)}`, 'MACOS_USE_UNSUPPORTED_KEY')
  }
  return `keystroke "${escapeAppleScriptString(parsed.character)}"${clause}`
}

/**
 * Build a `System Events` script for one key or modifier combo (e.g. `"return"`, `"cmd+shift+t"`, `"a"`).
 * @param combo - one named or printable key with optional modifiers.
 * @returns complete AppleScript source.
 * @throws {MacosUseError} `MACOS_USE_UNSUPPORTED_KEY` when the combo is empty, names an unknown modifier, or
 *   names a main key that is neither a single printable character nor a recognized named key.
 */
export function buildKeyScript(combo: string): string {
  return `tell application "System Events" to ${keyBody(combo)}`
}

/**
 * Build a key press whose exact process/window guard and input share one native script.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param combo - one validated named or printable key with optional modifiers.
 * @returns guarded AppleScript source that fails before input when the window changed.
 */
export function buildGuardedKeyScript(window: MacosWindow, combo: string): string {
  return buildGuardedSystemEventsScript(window, keyBody(combo))
}

/**
 * Build a `System Events` script approximating scroll via repeated arrow keystrokes.
 * @param direction - arrow-key direction.
 * @param amount - requested repetition count, clamped to 1 through 50.
 * @returns complete AppleScript source.
 */
export function buildScrollScript(direction: 'up' | 'down' | 'left' | 'right', amount: number): string {
  const code = DIRECTION_KEY_CODES[direction]
  const steps = Math.max(1, Math.min(50, Math.trunc(amount)))
  return `tell application "System Events"\nrepeat ${steps} times\nkey code ${code}\nend repeat\nend tell`
}

/**
 * Build scroll keystrokes whose exact process/window guard and input share one native script.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param direction - arrow-key direction.
 * @param amount - requested repetition count, clamped to 1 through 50.
 * @returns guarded AppleScript source that fails before input when the window changed.
 */
export function buildGuardedScrollScript(
  window: MacosWindow,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
): string {
  const code = DIRECTION_KEY_CODES[direction]
  const steps = Math.max(1, Math.min(50, Math.trunc(amount)))
  return buildGuardedSystemEventsScript(window, `repeat ${steps} times\nkey code ${code}\nend repeat`)
}

/**
 * Build a script resolving the frontmost application's process name.
 * @returns complete AppleScript source.
 */
export function buildFrontmostAppScript(): string {
  return 'tell application "System Events" to get name of first process whose frontmost is true'
}
