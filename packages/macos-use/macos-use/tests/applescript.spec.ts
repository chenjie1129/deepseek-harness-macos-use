import { describe, expect, it } from 'vitest'
import {
  buildClickScript,
  buildFrontmostAppScript,
  buildKeyScript,
  buildScrollScript,
  buildTypeScript,
  escapeAppleScriptString,
} from '../src/applescript.ts'
import { MacosUseError } from '../src/types.ts'
import {
  buildDragPointerScript,
  buildListAppsScript,
  buildListWindowsScript,
  buildMovePointerScript,
  buildWindowElementsScript,
} from '../src/native.ts'

describe('escapeAppleScriptString', () => {
  it('escapes backslashes before quotes', () => {
    expect(escapeAppleScriptString('say "hi"')).toBe('say \\"hi\\"')
    expect(escapeAppleScriptString('a\\b')).toBe('a\\\\b')
  })
})

describe('buildClickScript', () => {
  it('builds a plain click at coordinates with no modifiers', () => {
    expect(buildClickScript(100, 200, {})).toBe('tell application "System Events" to click at {100, 200}')
  })

  it('builds a double click', () => {
    expect(buildClickScript(1, 2, { doubleClick: true })).toBe('tell application "System Events" to double click at {1, 2}')
  })

  it('builds a right click, taking priority over doubleClick', () => {
    expect(buildClickScript(1, 2, { button: 'right', doubleClick: true })).toBe('tell application "System Events" to right click at {1, 2}')
  })

  it('wraps a modified click in key down/up statements', () => {
    expect(buildClickScript(5, 6, { modifiers: ['command', 'shift'] })).toBe(
      'tell application "System Events"\nkey down command\nkey down shift\nclick at {5, 6}\nkey up command\nkey up shift\nend tell',
    )
  })
})

describe('buildTypeScript', () => {
  it('embeds and escapes literal text', () => {
    expect(buildTypeScript('hello "world"')).toBe('tell application "System Events" to keystroke "hello \\"world\\""')
  })
})

describe('buildKeyScript', () => {
  it('builds a named key code for special keys', () => {
    expect(buildKeyScript('return')).toBe('tell application "System Events" to key code 36')
    expect(buildKeyScript('Escape')).toBe('tell application "System Events" to key code 53')
  })

  it('builds a keystroke for a single printable character', () => {
    expect(buildKeyScript('a')).toBe('tell application "System Events" to keystroke "a"')
  })

  it('normalizes cmd/ctrl/alt aliases and applies a using clause', () => {
    expect(buildKeyScript('cmd+shift+t')).toBe('tell application "System Events" to keystroke "t" using {command down, shift down}')
    expect(buildKeyScript('ctrl+alt+return')).toBe('tell application "System Events" to key code 36 using {control down, option down}')
  })

  it('rejects an empty combo', () => {
    expect(() => buildKeyScript('')).toThrow(MacosUseError)
    expect(() => buildKeyScript('  ')).toThrow(MacosUseError)
  })

  it('rejects an unknown modifier', () => {
    expect(() => buildKeyScript('meta+a')).toThrow(MacosUseError)
  })

  it('rejects a main key that is neither named nor a single character', () => {
    expect(() => buildKeyScript('cmd+notakey')).toThrow(MacosUseError)
  })
})

describe('buildScrollScript', () => {
  it('repeats the direction key code, clamped to [1, 50]', () => {
    expect(buildScrollScript('down', 3)).toBe('tell application "System Events"\nrepeat 3 times\nkey code 125\nend repeat\nend tell')
    expect(buildScrollScript('up', 0)).toContain('repeat 1 times')
    expect(buildScrollScript('left', 1000)).toContain('repeat 50 times')
  })
})

describe('buildFrontmostAppScript', () => {
  it('builds the frontmost-process query', () => {
    expect(buildFrontmostAppScript()).toBe('tell application "System Events" to get name of first process whose frontmost is true')
  })
})

describe('P0 native scripts', () => {
  it('uses AppKit/CoreGraphics discovery instead of screen-coordinate guesses', () => {
    expect(buildListAppsScript()).toContain('NSWorkspace.sharedWorkspace.runningApplications')
    expect(buildListWindowsScript()).toContain('CGWindowListCopyWindowInfo')
  })

  it('builds pointer motion and bounded drag events', () => {
    expect(buildMovePointerScript(10, 20)).toContain('CGWarpMouseCursorPosition')
    const drag = buildDragPointerScript(1, 2, 30, 40, 300)
    expect(drag).toContain('kCGEventLeftMouseDown')
    expect(drag).toContain('kCGEventLeftMouseDragged')
    expect(drag).toContain('kCGEventLeftMouseUp')
  })

  it('bounds Accessibility traversal and redacts secure text values', () => {
    const script = buildWindowElementsScript({
      id: 1,
      app: 'Notes',
      pid: 2,
      title: 'Draft',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      onScreen: true,
    }, 250)
    expect(script).toContain('output.length >= 250')
    expect(script).toContain("'[redacted]'")
    expect(script).toContain('expectedTitle = "Draft"')
  })
})
