import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { MacosUseService } from '../src/index.ts'
import { ScreenObservationStore, WindowObservationStore } from '../src/observations.ts'
import type { ScreenTargetState } from '../src/observations.ts'
import type { MacosUseRuntimeSettings, MacosWindow } from '../src/types.ts'

const owner = 'agent-a'
const window: MacosWindow = {
  id: 41,
  app: 'Notes',
  bundleId: 'com.apple.Notes',
  pid: 4,
  title: 'Draft',
  bounds: { x: 10, y: 20, width: 100, height: 80 },
  onScreen: true,
}
const target: ScreenTargetState = {
  process: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4 },
  window,
  display: { id: 1, bounds: { x: 0, y: 0, width: 200, height: 120 } },
}
const approvalUi: ScreenTargetState = {
  process: { name: 'DeepSeek Harness', bundleId: 'ai.deepseek.harness', pid: 99 },
  window: {
    id: 99,
    app: 'DeepSeek Harness',
    bundleId: 'ai.deepseek.harness',
    pid: 99,
    title: 'Approval required',
    bounds: { x: 0, y: 0, width: 180, height: 100 },
    onScreen: true,
  },
  display: target.display,
}
const runtime: MacosUseRuntimeSettings = {
  commandTimeoutMs: 15_000,
  allowedApps: [],
  deniedApps: [],
  excludedScreenshotApps: [],
  maxElementsPerSnapshot: 250,
  readAppGrants: [{ bundleId: 'com.apple.Notes' }],
  controlAppGrants: [{ bundleId: 'com.apple.Notes' }],
  deniedAppIdentities: [],
}

interface ScreenshotHarness {
  click: MacosUseService['click']
  reactivateScreenObservation: MacosUseService['reactivateScreenObservation']
  reactivateWindowObservation: MacosUseService['reactivateWindowObservation']
  screenshot: MacosUseService['screenshot']
  screenshotWindow: MacosUseService['screenshotWindow']
  runtime: MacosUseRuntimeSettings
  screenObservations: ScreenObservationStore
  windowObservations: WindowObservationStore
  desktopMutationEpoch: number
  nativeMutationTail: Promise<void>
  nativeMutationDispatched: boolean
  observeScreenTarget: () => Promise<ScreenTargetState>
  listAllWindows: () => Promise<readonly MacosWindow[]>
  runAtomicAppleScript: (
    script: string,
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => Promise<string>
  runAtomicJxa: (
    script: string,
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => Promise<string>
  runCommand: (argv: readonly string[]) => Promise<string>
}

async function harness(
  observations: readonly ScreenTargetState[],
  options: {
    windows?: readonly MacosWindow[]
    captureColors?: readonly { r: number; g: number; b: number }[]
  } = {},
) {
  const service = Object.create(MacosUseService.prototype) as ScreenshotHarness
  const windowPngs = await Promise.all((options.captureColors ?? [{ r: 12, g: 34, b: 56 }]).map(
    background => sharp({
      create: {
        width: 200,
        height: 160,
        channels: 4,
        background: { ...background, alpha: 1 },
      },
    }).png().toBuffer(),
  ))
  const rawDisplayThatMustNeverBeCaptured = await sharp({
    create: {
      width: 400,
      height: 240,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  }).png().toBuffer()
  let index = 0
  let windowCapture = 0
  const dispatch = vi.fn(async (argv: readonly string[]) => {
    const path = argv.at(-1)
    if (path !== undefined) {
      const png = windowPngs[Math.min(windowCapture, windowPngs.length - 1)]
      if (!argv.includes('-m')) windowCapture += 1
      await writeFile(path, argv.includes('-m') ? rawDisplayThatMustNeverBeCaptured : png!)
    }
    return ''
  })
  const focusDispatch = vi.fn((
    _script: string,
    _signal: AbortSignal | undefined,
    _minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => {
    onDispatch?.()
    return Promise.resolve('')
  })
  const actionDispatch = vi.fn((
    _script: string,
    _signal: AbortSignal | undefined,
    _minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => {
    onDispatch?.()
    return Promise.resolve('')
  })
  service.runtime = runtime
  service.screenObservations = new ScreenObservationStore()
  service.windowObservations = new WindowObservationStore()
  service.desktopMutationEpoch = 0
  service.nativeMutationTail = Promise.resolve()
  service.nativeMutationDispatched = false
  service.observeScreenTarget = () => Promise.resolve(observations[Math.min(index++, observations.length - 1)]!)
  service.listAllWindows = () => Promise.resolve(options.windows ?? [window])
  service.runAtomicAppleScript = focusDispatch
  service.runAtomicJxa = actionDispatch
  service.runCommand = dispatch
  return { service, dispatch, focusDispatch, actionDispatch }
}

describe('include-only display observation contract', () => {
  it('returns an authorized exact window on black display pixels without creating a raw display capture', async () => {
    const { service, dispatch } = await harness([target, target])
    const result = await service.screenshot(undefined, owner)
    expect(result.captureGeometry).toEqual({
      displayId: 1,
      globalPointRect: target.display.bounds,
      capturePixels: { width: 400, height: 240 },
    })
    expect(result.frontmostProcess).toEqual(target.process)
    expect(result.targetWindow).toEqual(window)
    expect(result.observationId).toEqual(expect.any(String))
    expect(dispatch).toHaveBeenCalledWith([
      'screencapture', '-x', '-o', '-l', String(window.id), expect.any(String),
    ], undefined)
    expect(dispatch.mock.calls.some(([argv]) => argv.includes('-m'))).toBe(false)

    const pixels = await sharp(Buffer.from(result.pngBase64, 'base64')).raw().toBuffer()
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255])
    const authorizedOffset = (50 * 400 + 30) * 4
    expect([...pixels.subarray(authorizedOffset, authorizedOffset + 4)]).toEqual([12, 34, 56, 255])
    expect(pixels.indexOf(Buffer.from([255, 0, 0, 255]))).toBe(-1)
  })

  it('restores approval-stolen focus and dispatches once only after exact pixels match', async () => {
    const { service, focusDispatch, actionDispatch } = await harness([
      target,
      target,
      approvalUi,
      target,
      target,
    ])
    const observation = await service.screenshot(undefined, owner)

    await service.click({
      x: 40,
      y: 60,
      observationId: observation.observationId,
      restoreObservedFocus: true,
    }, undefined, owner)

    expect(focusDispatch).toHaveBeenCalledOnce()
    expect(actionDispatch).toHaveBeenCalledOnce()
    expect(service.desktopMutationEpoch).toBe(1)
    await expect(service.click({
      x: 40,
      y: 60,
      observationId: observation.observationId,
      restoreObservedFocus: true,
    }, undefined, owner)).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(actionDispatch).toHaveBeenCalledOnce()
  })

  it('treats approval focus restoration as one mutation epoch and invalidates every other owner token', async () => {
    const { service, actionDispatch } = await harness([
      target,
      target,
      approvalUi,
      target,
      target,
    ])
    const approved = await service.screenshot(undefined, owner)
    const other = service.screenObservations.remember({
      ...target,
      pixels: approved.captureGeometry.capturePixels,
    }, 'agent-b', Date.now(), 0)

    await service.click({
      x: 40,
      y: 60,
      observationId: approved.observationId,
      restoreObservedFocus: true,
    }, undefined, owner)

    expect(service.desktopMutationEpoch).toBe(1)
    await expect(service.click({
      x: 40,
      y: 60,
      observationId: other.observationId,
    }, undefined, 'agent-b')).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(actionDispatch).toHaveBeenCalledOnce()
  })

  it('reactivates an outer-task screen proof once and invalidates other-owner epochs', async () => {
    const { service, focusDispatch, actionDispatch } = await harness([
      target,
      target,
      approvalUi,
      target,
      target,
    ])
    const approved = await service.screenshot(undefined, owner)
    const other = service.screenObservations.remember({
      ...target,
      pixels: approved.captureGeometry.capturePixels,
    }, 'agent-b', Date.now(), 0)

    await service.reactivateScreenObservation(approved.observationId, undefined, owner)

    expect(focusDispatch).toHaveBeenCalledOnce()
    expect(actionDispatch).not.toHaveBeenCalled()
    expect(service.desktopMutationEpoch).toBe(1)
    await expect(service.reactivateScreenObservation(
      approved.observationId,
      undefined,
      owner,
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    await expect(service.reactivateScreenObservation(
      other.observationId,
      undefined,
      'agent-b',
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(focusDispatch).toHaveBeenCalledOnce()
  })

  it('keeps outer-task screen reactivation owner-bound and consumes a mismatched attempt', async () => {
    const { service, focusDispatch } = await harness([target, target])
    const approved = await service.screenshot(undefined, owner)

    await expect(service.reactivateScreenObservation(
      approved.observationId,
      undefined,
      'agent-b',
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    await expect(service.reactivateScreenObservation(
      approved.observationId,
      undefined,
      owner,
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(focusDispatch).not.toHaveBeenCalled()
  })

  it('rejects outer-task reactivation when pixels change or the exact window is replaced', async () => {
    const changed = await harness([
      target,
      target,
      approvalUi,
      target,
      target,
    ], {
      captureColors: [
        { r: 12, g: 34, b: 56 },
        { r: 13, g: 34, b: 56 },
      ],
    })
    const changedObservation = await changed.service.screenshot(undefined, owner)
    await expect(changed.service.reactivateScreenObservation(
      changedObservation.observationId,
      undefined,
      owner,
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(changed.focusDispatch).toHaveBeenCalledOnce()
    expect(changed.actionDispatch).not.toHaveBeenCalled()

    const replaced = await harness([target, target])
    const replacedObservation = await replaced.service.screenshot(undefined, owner)
    replaced.service.listAllWindows = () => Promise.resolve([{ ...window, pid: 5 }])
    await expect(replaced.service.reactivateScreenObservation(
      replacedObservation.observationId,
      undefined,
      owner,
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(replaced.focusDispatch).not.toHaveBeenCalled()
    expect(replaced.actionDispatch).not.toHaveBeenCalled()
  })

  it('refuses an approval-delayed action when the exact target pixels changed', async () => {
    const { service, actionDispatch } = await harness([
      target,
      target,
      approvalUi,
      target,
      target,
    ], {
      captureColors: [
        { r: 12, g: 34, b: 56 },
        { r: 13, g: 34, b: 56 },
      ],
    })
    const observation = await service.screenshot(undefined, owner)

    await expect(service.click({
      x: 40,
      y: 60,
      observationId: observation.observationId,
      restoreObservedFocus: true,
    }, undefined, owner)).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    await expect(service.click({
      x: 40,
      y: 60,
      observationId: observation.observationId,
      restoreObservedFocus: true,
    }, undefined, owner)).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(actionDispatch).not.toHaveBeenCalled()
  })

  it('reactivates a semantic window observation, returns a fresh token, and rejects replacement', async () => {
    const valid = await harness([approvalUi, target, target, target, target, target])
    const capture = await valid.service.screenshotWindow({ id: window.id }, undefined, owner)
    const original = { observationId: capture.observationId, window: capture.window }
    const fresh = await valid.service.reactivateWindowObservation(original, undefined, owner)

    expect(fresh.observationId).not.toBe(original.observationId)
    expect(fresh.window).toEqual(window)
    expect(valid.focusDispatch).toHaveBeenCalledOnce()
    await valid.service.click({
      x: 20,
      y: 30,
      target: fresh,
      restoreObservedFocus: true,
    }, undefined, owner)
    expect(valid.actionDispatch).toHaveBeenCalledOnce()

    const replaced = await harness([approvalUi])
    const replacedCapture = await replaced.service.screenshotWindow({ id: window.id }, undefined, owner)
    replaced.service.listAllWindows = () => Promise.resolve([{ ...window, pid: 5 }])
    await expect(replaced.service.reactivateWindowObservation({
      observationId: replacedCapture.observationId,
      window: replacedCapture.window,
    }, undefined, owner)).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(replaced.focusDispatch).not.toHaveBeenCalled()
  })

  it('rejects a secondary-display or spanning target without issuing an observation', async () => {
    const secondary = {
      ...target,
      window: { ...window, bounds: { x: 220, y: 20, width: 100, height: 80 } },
    }
    const { service, dispatch } = await harness([secondary, secondary])
    await expect(service.screenshot(undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('rejects capture when foreground identity changes between metadata snapshots', async () => {
    const changed = {
      ...target,
      process: { ...target.process, pid: 9 },
      window: { ...window, pid: 9 },
    }
    const { service } = await harness([target, changed])
    await expect(service.screenshot(undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
  })

  it('requires a trusted owner before any screen-capture dispatch', async () => {
    const { service, dispatch } = await harness([target, target])
    await expect(service.screenshot()).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('rejects a screenshot whose capture overlaps a dispatched mutation', async () => {
    const { service } = await harness([target, target, target])
    const mutationToken = service.screenObservations.remember({
      ...target,
      pixels: { width: 400, height: 240 },
    }, 'agent-b', Date.now(), 0)
    const captureCommand = service.runCommand
    let reportCapture = (): void => {}
    let releaseCapture = (): void => {}
    const captureStarted = new Promise<void>((resolve) => { reportCapture = resolve })
    const captureReleased = new Promise<void>((resolve) => { releaseCapture = resolve })
    service.runCommand = async (argv) => {
      reportCapture()
      await captureReleased
      return captureCommand(argv)
    }

    const capture = service.screenshot(undefined, owner)
    await captureStarted
    await service.click({ x: 40, y: 60, observationId: mutationToken.observationId }, undefined, 'agent-b')
    releaseCapture()

    await expect(capture).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
  })

  it('rejects before capture when a native mutation has already dispatched and is still in flight', async () => {
    const { service, dispatch } = await harness([target, target, target])
    const mutationToken = service.screenObservations.remember({
      ...target,
      pixels: { width: 400, height: 240 },
    }, 'agent-b', Date.now(), 0)
    let reportMutation = (): void => {}
    let releaseMutation = (): void => {}
    const mutationDispatched = new Promise<void>((resolve) => { reportMutation = resolve })
    const mutationReleased = new Promise<string>((resolve) => { releaseMutation = () => { resolve('') } })
    service.runAtomicJxa = (_script, _signal, _minimumTimeoutMs, onDispatch) => {
      onDispatch?.()
      reportMutation()
      return mutationReleased
    }

    const mutation = service.click(
      { x: 40, y: 60, observationId: mutationToken.observationId },
      undefined,
      'agent-b',
    )
    await mutationDispatched

    await expect(service.screenshot(undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(dispatch).not.toHaveBeenCalled()

    releaseMutation()
    await mutation
  })

  it('rejects an unreadable foreground window before capture instead of transferring and masking its pixels', async () => {
    const { service, dispatch } = await harness([target, target])
    service.runtime = { ...runtime, readAppGrants: [], allowedApps: [] }
    await expect(service.screenshot(undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_APP_BLOCKED' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
