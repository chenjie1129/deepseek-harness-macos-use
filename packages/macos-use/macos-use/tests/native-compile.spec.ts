import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  buildClickScript,
  buildGuardedClickScript,
  buildGuardedKeyScript,
  buildGuardedScrollScript,
  buildGuardedTypeScript,
  buildKeyScript,
  buildScrollScript,
  buildTypeScript,
} from '../src/applescript.ts'
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
  buildMainDisplayBoundsScript,
  buildMovePointerScript,
  buildWindowElementsScript,
} from '../src/native.ts'

const execFileAsync = promisify(execFile)
const observedWindow = {
  id: 41,
  app: 'Notes',
  bundleId: 'com.apple.Notes',
  pid: 4,
  title: 'Draft',
  bounds: { x: 10, y: 20, width: 300, height: 200 },
  onScreen: true,
}

async function compileScripts(
  root: string,
  language: 'AppleScript' | 'JavaScript',
  scripts: readonly string[],
): Promise<void> {
  for (const [index, script] of scripts.entries()) {
    await execFileAsync('/usr/bin/osacompile', [
      '-l',
      language,
      '-o',
      join(root, `${language}-${String(index)}.scpt`),
      '-e',
      script,
    ])
  }
}

describe('generated native script syntax', () => {
  it('compiles every generated JXA and AppleScript program without executing it', async () => {
    if (process.platform !== 'darwin') return
    const root = await mkdtemp(join(tmpdir(), 'dsh-macos-native-compile-'))
    try {
      await compileScripts(root, 'JavaScript', [
        buildListAppsScript(),
        buildCompletionStateScript(),
        buildListWindowsScript(),
        buildMaskingWindowsScript(),
        buildMainDisplayBoundsScript(),
        buildFrontmostProcessScript(),
        buildGuardedClickJxaScript(observedWindow, 20, 30, { modifiers: ['command'] }),
        buildGuardedTypeJxaScript(observedWindow, 'hello'),
        buildGuardedKeyJxaScript(observedWindow, 'cmd+return'),
        buildGuardedScrollJxaScript(observedWindow, 'down', 3),
        buildMovePointerScript(10, 20),
        buildMovePointerScript(10, 20, observedWindow),
        buildDragPointerScript(1, 2, 30, 40, 300),
        buildDragPointerScript(1, 2, 30, 40, 300, observedWindow),
        buildApplicationUrlsForBundleScript('com.apple.Notes'),
        buildApplicationBundleInspectionScript(['/Applications/Notes.app']),
        buildLaunchExactApplicationScript({
          name: 'Notes',
          bundleId: 'com.apple.Notes',
          path: '/Applications/Notes.app',
        }),
        buildWindowElementsScript(observedWindow, 250),
      ])
      await compileScripts(root, 'AppleScript', [
        buildClickScript(10, 20, {}),
        buildTypeScript('hello'),
        buildKeyScript('cmd+shift+t'),
        buildScrollScript('down', 3),
        buildFocusWindowScript(observedWindow),
        buildGuardedClickScript(observedWindow, 10, 20, {}),
        buildGuardedTypeScript(observedWindow, 'hello'),
        buildGuardedKeyScript(observedWindow, 'return'),
        buildGuardedScrollScript(observedWindow, 'down', 3),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('executes read-only NSBundle inspection without GUI permissions', async () => {
    if (process.platform !== 'darwin') return
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      buildApplicationBundleInspectionScript(['/System/Library/CoreServices/Finder.app']),
    ])
    expect(JSON.parse(stdout)).toEqual([{
      name: 'Finder',
      bundleId: 'com.apple.finder',
      path: '/System/Library/CoreServices/Finder.app',
    }])
  })
})
