import { describe, expect, it } from 'vitest'
import {
  buildClickScript,
  buildFrontmostAppScript,
  buildGuardedClickScript,
  buildGuardedKeyScript,
  buildGuardedScrollScript,
  buildGuardedTypeScript,
  buildKeyScript,
  buildScrollScript,
  buildTypeScript,
  escapeAppleScriptString,
} from '../src/applescript.ts'
import { MacosUseError } from '../src/types.ts'
import {
  buildApplicationBundleInspectionScript,
  buildApplicationUrlsForBundleScript,
  buildCompletionStateScript,
  buildDragPointerScript,
  buildFocusWindowScript,
  buildFrontmostProcessScript,
  buildGuardedClickJxaScript,
  buildGuardedKeyJxaScript,
  buildGuardedScrollJxaScript,
  buildGuardedTypeJxaScript,
  buildListAppsScript,
  buildListWindowsScript,
  buildLaunchExactApplicationScript,
  buildMaskingWindowsScript,
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
      'tell application "System Events"\ntry\nkey down command\nkey down shift\nclick at {5, 6}\non error errorMessage number errorNumber\nkey up shift\nkey up command\nerror errorMessage number errorNumber\nend try\nkey up shift\nkey up command\nend tell',
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
  it('fences a completion snapshot around one CoreGraphics window-list query', () => {
    const script = buildCompletionStateScript()
    expect(script).toContain('CGWindowListCopyWindowInfo')
    expect(script.match(/const (?:before|after) = readFrontmost\(\)/g)).toHaveLength(2)
    expect(script).toContain('frontmost process changed during completion snapshot')
    expect(script).toContain('JSON.stringify({ frontmostProcess: after, windows, observedAt:')
  })

  it('uses AppKit/CoreGraphics discovery instead of screen-coordinate guesses', () => {
    expect(buildListAppsScript()).toContain('NSWorkspace.sharedWorkspace.runningApplications')
    expect(buildListWindowsScript()).toContain('CGWindowListCopyWindowInfo')
    expect(buildListWindowsScript()).toContain('bundleIdentifier')
    expect(buildListWindowsScript()).toContain('includeAllLayers = false')
    expect(buildMaskingWindowsScript()).toContain('includeAllLayers = true')
    expect(buildListWindowsScript()).toContain('includeAllLayers ? 1 : 17')
    expect(buildMaskingWindowsScript()).toContain('includeAllLayers ? 1 : 17')
  })

  it('binds frontmost control to both application name and process id', () => {
    const script = buildFrontmostProcessScript()
    expect(script).toContain('frontmostApplication')
    expect(script).toContain('processIdentifier')
    expect(script).toContain('bundleIdentifier')
  })

  it('builds pointer motion and bounded drag events', () => {
    expect(buildMovePointerScript(10, 20)).toContain('CGWarpMouseCursorPosition')
    const drag = buildDragPointerScript(1, 2, 30, 40, 300)
    expect(drag).toContain('kCGEventLeftMouseDown')
    expect(drag).toContain('kCGEventLeftMouseDragged')
    expect(drag).toContain('kCGEventLeftMouseUp')
    expect(drag).toContain('finally')
    expect(drag).toContain('if (mouseDown) post($.kCGEventLeftMouseUp')
    const guardedMove = buildMovePointerScript(10, 20, {
      id: 1,
      app: 'Notes',
      bundleId: 'com.apple.Notes',
      pid: 2,
      title: 'Draft',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      onScreen: true,
    })
    expect(guardedMove).toContain('frontmostApplication')
    expect(guardedMove).toContain('firstProcessWindowId !== expectedTarget.id')
    expect(guardedMove).toContain('CGWarpMouseCursorPosition')
  })

  it('resolves and inspects exact installed application bundles', () => {
    expect(buildApplicationUrlsForBundleScript('com.apple.Notes'))
      .toContain('LSCopyApplicationURLsForBundleIdentifier')
    const inspection = buildApplicationBundleInspectionScript(['/Applications/Notes.app'])
    expect(inspection).toContain('NSBundle.bundleWithURL')
    expect(inspection).toContain('bundleIdentifier')
    const launch = buildLaunchExactApplicationScript({
      name: 'Notes',
      bundleId: 'com.apple.Notes',
      path: '/Applications/Notes.app',
    })
    expect(launch).toContain('application bundle identity changed before launch')
    expect(launch).toContain('NSWorkspace.sharedWorkspace.openURL(url)')
  })

  it('keeps exact final target guards in the same script as every System Events input', () => {
    const target = {
      id: 1,
      app: 'Notes',
      bundleId: 'com.apple.Notes',
      pid: 2,
      title: 'Draft',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      onScreen: true,
    }
    const scripts = [
      buildGuardedClickScript(target, 20, 30, {}),
      buildGuardedTypeScript(target, 'hello'),
      buildGuardedKeyScript(target, 'return'),
      buildGuardedScrollScript(target, 'down', 3),
    ]
    for (const script of scripts) {
      expect(script).toContain('whose unix id is 2')
      expect(script).toContain('bundle identifier of targetProcess')
      expect(script).toContain('target process is no longer frontmost')
      expect(script).toContain('target window is stale or ambiguous')
    }
    expect(scripts[0]).toContain('click at {20, 30}')
    expect(scripts[1]).toContain('keystroke "hello"')
    expect(scripts[2]).toContain('key code 36')
    expect(scripts[3]).toContain('repeat 3 times')
  })

  it('keeps exact CoreGraphics window id guard and each actual input in one JXA program', () => {
    const target = {
      id: 41,
      app: 'Notes',
      bundleId: 'com.apple.Notes',
      pid: 4,
      title: 'Draft',
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      onScreen: true,
    }
    const scripts = [
      buildGuardedClickJxaScript(target, 20, 30, { modifiers: ['command'] }),
      buildGuardedTypeJxaScript(target, 'hello "world"'),
      buildGuardedKeyJxaScript(target, 'cmd+return'),
      buildGuardedScrollJxaScript(target, 'down', 3),
    ]
    for (const script of scripts) {
      expect(script).toContain('expectedTarget.id')
      expect(script).toContain('firstProcessWindowId !== expectedTarget.id')
      expect(script).toContain('frontmostApplication')
    }
    expect(scripts[0]).toContain('kCGEventFlagMaskCommand')
    expect(scripts[0]).not.toContain('keyDown')
    expect(scripts[1]).toContain('systemEvents.keystroke("hello \\"world\\"")')
    expect(scripts[2]).toContain('systemEvents.keyCode(36, { using: ["command down"] })')
    expect(scripts[3]).toContain('systemEvents.keyCode(125)')
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
    expect(script).toContain('expectedPid = 2')
    expect(script).toContain('expectedBundle = null')
    expect(script).toContain('matchingProcesses.length !== 1')
    expect(script).toContain('matchingWindows.length !== 1')
  })

  it('focuses only the exact pid, title, and bounds and rejects duplicate matches', () => {
    const script = buildFocusWindowScript({
      id: 1,
      app: 'Notes',
      bundleId: 'com.apple.Notes',
      pid: 2,
      title: 'Draft',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      onScreen: true,
    })
    expect(script).toContain('whose unix id is 2')
    expect(script).toContain('bundle identifier of targetProcess')
    expect(script).toContain('candidateTitle is "Draft"')
    expect(script).toContain('nearValue(item 1 of candidatePosition, 10)')
    expect(script).toContain('if (count matchingWindows) is not 1')
  })
})
