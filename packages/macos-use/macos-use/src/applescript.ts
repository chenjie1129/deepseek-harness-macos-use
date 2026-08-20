/**
 * AppleScript/System Events script builders backing {@link MacosUseService}. Isolated from `index.ts` so the
 * generated-script vocabulary (verified against real `osacompile` output while developing this package) stays
 * one small, independently readable unit.
 * @module @deepseek-ai/dsh-macos-use/applescript
 */

import { MacosUseError } from './types.ts'
import type { KeyModifier, MouseButton } from './types.ts'

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
  const verb = options.button === 'right' ? 'right click' : options.doubleClick === true ? 'double click' : 'click'
  const modifiers = options.modifiers ?? []
  const point = `{${x}, ${y}}`
  if (modifiers.length === 0) {
    return `tell application "System Events" to ${verb} at ${point}`
  }
  const names = modifiers.map(modifier => MODIFIER_KEYWORD[modifier])
  const downs = names.map(name => `key down ${name}`).join('\n')
  const ups = names.map(name => `key up ${name}`).join('\n')
  return `tell application "System Events"\n${downs}\n${verb} at ${point}\n${ups}\nend tell`
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
 * Build a `System Events` script for one key or modifier combo (e.g. `"return"`, `"cmd+shift+t"`, `"a"`).
 * @param combo - one named or printable key with optional modifiers.
 * @returns complete AppleScript source.
 * @throws {MacosUseError} `MACOS_USE_UNSUPPORTED_KEY` when the combo is empty, names an unknown modifier, or
 *   names a main key that is neither a single printable character nor a recognized named key.
 */
export function buildKeyScript(combo: string): string {
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
  const clause = usingClause(modifiers)
  const namedCode = NAMED_KEY_CODES[main]
  if (namedCode !== undefined) {
    return `tell application "System Events" to key code ${namedCode}${clause}`
  }
  if (main.length === 1) {
    return `tell application "System Events" to keystroke "${escapeAppleScriptString(main)}"${clause}`
  }
  throw new MacosUseError(`unsupported key: ${JSON.stringify(main)}`, 'MACOS_USE_UNSUPPORTED_KEY')
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
 * Build a script resolving the frontmost application's process name.
 * @returns complete AppleScript source.
 */
export function buildFrontmostAppScript(): string {
  return 'tell application "System Events" to get name of first process whose frontmost is true'
}
