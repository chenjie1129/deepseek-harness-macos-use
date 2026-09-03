import { describe, expect, it, vi } from 'vitest'
import { MacosUseError, MacosUseService } from '../src/index.ts'
import { ScreenObservationStore, WindowObservationStore } from '../src/observations.ts'
import type { ScreenObservationTarget, ScreenTargetState } from '../src/observations.ts'
import type {
  FrontmostProcess,
  MacosUseRuntimeSettings,
  ResolvedMacosApplication,
} from '../src/types.ts'

const owner = 'agent-a'
const observed: ScreenObservationTarget = {
  process: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4 },
  window: {
    id: 41,
    app: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4,
    title: 'Draft',
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    onScreen: true,
  },
  display: { id: 1, bounds: { x: 0, y: 0, width: 400, height: 300 } },
  pixels: { width: 800, height: 600 },
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

interface ServiceHarness {
  click: MacosUseService['click']
  drag: MacosUseService['drag']
  focusWindow: MacosUseService['focusWindow']
  frontmostProcess: MacosUseService['frontmostProcess']
  key: MacosUseService['key']
  move: MacosUseService['move']
  openApp: MacosUseService['openApp']
  runAppleScript: MacosUseService['runAppleScript']
  scroll: MacosUseService['scroll']
  type: MacosUseService['type']
  runtime: MacosUseRuntimeSettings
  desktopMutationEpoch: number
  nativeMutationTail: Promise<void>
  nativeMutationDispatched: boolean
  screenObservations: ScreenObservationStore
  windowObservations: WindowObservationStore
  observeScreenTarget: () => Promise<ScreenTargetState>
  listAllWindows: () => Promise<readonly NonNullable<ScreenTargetState['window']>[]>
  readFrontmostProcess: () => Promise<FrontmostProcess>
  resolveApplication: () => Promise<ResolvedMacosApplication>
  waitForFrontmostApplication: () => Promise<FrontmostProcess>
  runAtomicAppleScript: (
    script: string,
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => Promise<string>
  runJxa: (script: string, signal?: AbortSignal) => Promise<string>
  runAtomicJxa: (
    script: string,
    signal: AbortSignal | undefined,
    minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => Promise<string>
  runCommand: (argv: readonly string[], signal?: AbortSignal) => Promise<string>
}

function harness(current: ScreenTargetState): {
  service: ServiceHarness
  appleScriptDispatch: ReturnType<typeof vi.fn>
  commandDispatch: ReturnType<typeof vi.fn>
  jxaDispatch: ReturnType<typeof vi.fn>
  observationId: string
  exactTarget: {
    observationId: string
    window: NonNullable<ScreenTargetState['window']>
  }
} {
  const service = Object.create(MacosUseService.prototype) as ServiceHarness
  const screenObservations = new ScreenObservationStore()
  const { observationId } = screenObservations.remember(observed, owner)
  const windowObservations = new WindowObservationStore()
  const exactObservation = windowObservations.remember(observed.window!, owner)
  const appleScriptDispatch = vi.fn((
    _script: string,
    _signal: AbortSignal | undefined,
    _minimumTimeoutMs: number,
    onDispatch?: () => void,
  ) => {
    onDispatch?.()
    return Promise.resolve('')
  })
  const commandDispatch = vi.fn(() => Promise.resolve(''))
  const jxaDispatch = vi.fn((
    _script: string,
    _signal?: AbortSignal,
    _minimumTimeoutMs?: number,
    onDispatch?: () => void,
  ) => {
    onDispatch?.()
    return Promise.resolve('')
  })
  service.runtime = runtime
  service.desktopMutationEpoch = 0
  service.nativeMutationTail = Promise.resolve()
  service.nativeMutationDispatched = false
  service.screenObservations = screenObservations
  service.windowObservations = windowObservations
  service.observeScreenTarget = () => Promise.resolve(current)
  service.listAllWindows = () => Promise.resolve(current.window === undefined ? [] : [current.window])
  service.readFrontmostProcess = () => Promise.resolve(current.process)
  service.resolveApplication = () => Promise.resolve({
    name: 'Notes',
    bundleId: 'com.apple.Notes',
    path: '/Applications/Notes.app',
  })
  service.waitForFrontmostApplication = () => Promise.resolve(observed.process)
  service.runAtomicAppleScript = appleScriptDispatch
  service.runJxa = jxaDispatch
  service.runAtomicJxa = jxaDispatch
  service.runCommand = commandDispatch
  return {
    service,
    appleScriptDispatch,
    commandDispatch,
    jxaDispatch,
    observationId,
    exactTarget: { ...exactObservation, window: observed.window! },
  }
}

describe('service observe-to-act contract', () => {
  it('uses one fenced native query and filters its completion snapshot through read grants', async () => {
    const runJson = vi.fn((_script: string, _signal?: AbortSignal) => Promise.resolve({
      frontmostProcess: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4 },
      windows: [
        observed.window!,
        {
          ...observed.window!,
          id: 99,
          app: 'Passwords',
          bundleId: 'com.apple.Passwords',
          pid: 99,
          title: 'Secrets',
        },
      ],
      observedAt: '2026-09-03T00:00:00.000Z',
    }))
    const service = Object.create(MacosUseService.prototype) as {
      runtime: MacosUseRuntimeSettings
      completionState: MacosUseService['completionState']
      runJson: typeof runJson
    }
    service.runtime = runtime
    service.runJson = runJson

    await expect(service.completionState()).resolves.toEqual({
      frontmostProcess: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4 },
      windows: [observed.window!],
      observedAt: '2026-09-03T00:00:00.000Z',
    })
    expect(runJson).toHaveBeenCalledOnce()
    expect(String(runJson.mock.calls[0]?.[0])).toContain('frontmost process changed during completion snapshot')
  })

  it('honors abort before an atomic input, then ignores mid-input abort until bounded completion', async () => {
    const dispatch = vi.fn(() => Promise.resolve('done'))
    const service = Object.create(MacosUseService.prototype) as {
      timeoutMs: number
      runAtomicCommand: (
        argv: readonly string[],
        signal: AbortSignal | undefined,
        minimumTimeoutMs: number,
        onDispatch?: () => void,
      ) => Promise<string>
      runCommandWithTimeout: typeof dispatch
    }
    service.timeoutMs = 1
    service.runCommandWithTimeout = dispatch

    const preAborted = new AbortController()
    preAborted.abort(new Error('stop before dispatch'))
    await expect(service.runAtomicCommand(['osascript'], preAborted.signal, 7000))
      .rejects.toThrow('stop before dispatch')
    expect(dispatch).not.toHaveBeenCalled()

    const midAction = new AbortController()
    const completion = service.runAtomicCommand(['osascript'], midAction.signal, 7000)
    midAction.abort(new Error('stop during dispatch'))
    await expect(completion).resolves.toBe('done')
    expect(dispatch).toHaveBeenCalledWith(['osascript'], undefined, 7000, undefined)
  })

  it('rejects control-not-covered-by-read configuration before changing live state', () => {
    const service = Object.create(MacosUseService.prototype) as {
      configure: MacosUseService['configure']
      timeoutMs: number
      runtime: MacosUseRuntimeSettings
      windowObservations: { clear: ReturnType<typeof vi.fn> }
      screenObservations: { clear: ReturnType<typeof vi.fn> }
    }
    service.timeoutMs = 15_000
    service.runtime = runtime
    service.windowObservations = { clear: vi.fn() }
    service.screenObservations = { clear: vi.fn() }
    expect(() => {
      service.configure({
        ...runtime,
        readAppGrants: [{ bundleId: 'com.apple.Notes' }],
        controlAppGrants: [{ bundleId: 'com.apple.Passwords' }],
      })
    }).toThrow(/Every Control app grant/)
    expect(service.runtime).toBe(runtime)
    expect(service.windowObservations.clear).not.toHaveBeenCalled()
    expect(service.screenObservations.clear).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'foreground process swap',
      current: {
        ...observed,
        process: { ...observed.process, pid: 5 },
        window: { ...observed.window!, pid: 5 },
      },
    },
    {
      name: 'selected window swap',
      current: {
        ...observed,
        window: { ...observed.window!, id: 42 },
      },
    },
    {
      name: 'display swap',
      current: {
        ...observed,
        display: { ...observed.display, id: 2 },
      },
    },
  ])('rejects a $name before native dispatch', async ({ current }) => {
    const appleScript = harness(current)
    await expect(appleScript.service.click(
      { x: 40, y: 60, observationId: appleScript.observationId },
      undefined,
      owner,
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(appleScript.jxaDispatch).not.toHaveBeenCalled()

    const jxa = harness(current)
    await expect(jxa.service.move(
      { x: 40, y: 60, observationId: jxa.observationId },
      undefined,
      owner,
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(jxa.jxaDispatch).not.toHaveBeenCalled()
  })

  it('maps Retina capture pixels to global points and embeds the final guard with the action', async () => {
    const { service, jxaDispatch, observationId } = harness(observed)
    await service.click({ x: 40, y: 60, observationId }, undefined, owner)
    const script = String(jxaDispatch.mock.calls[0]?.[0])
    expect(script).toContain('frontmostApplication')
    expect(script).toContain('firstProcessWindowId !== expectedTarget.id')
    expect(script).toContain('CGPointMake(20, 30)')
  })

  it('dispatches click, type, key, and scroll only inside exact CoreGraphics-window-id JXA guards', async () => {
    const actions: readonly {
      marker: string
      run: (service: ServiceHarness, observationId: string) => Promise<void>
    }[] = [
      {
        marker: 'CGEventCreateMouseEvent',
        run: (service, observationId) => service.click({ x: 40, y: 60, observationId }, undefined, owner),
      },
      {
        marker: 'systemEvents.keystroke("hello")',
        run: (service, observationId) => service.type({ text: 'hello', observationId }, undefined, owner),
      },
      {
        marker: 'systemEvents.keyCode(36)',
        run: (service, observationId) => service.key({ combo: 'return', observationId }, undefined, owner),
      },
      {
        marker: 'systemEvents.keyCode(125)',
        run: (service, observationId) => service.scroll({ direction: 'down', observationId }, undefined, owner),
      },
    ]
    for (const action of actions) {
      const { service, jxaDispatch, observationId } = harness(observed)
      await action.run(service, observationId)
      const script = String(jxaDispatch.mock.calls[0]?.[0])
      expect(script).toContain('exactMatches !== 1 || firstProcessWindowId !== expectedTarget.id')
      expect(script).toContain(action.marker)
      expect(jxaDispatch).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps exact-window target coordinates in global point space', async () => {
    const { service, jxaDispatch, exactTarget } = harness(observed)
    await service.click({ x: 20, y: 30, target: exactTarget }, undefined, owner)
    expect(String(jxaDispatch.mock.calls[0]?.[0])).toContain('CGPointMake(20, 30)')
  })

  it('rejects an exact-window geometry swap before native dispatch', async () => {
    const changed = {
      ...observed,
      window: { ...observed.window!, bounds: { ...observed.window!.bounds, x: 11 } },
    }
    const { service, jxaDispatch, exactTarget } = harness(changed)
    await expect(service.click({ x: 20, y: 30, target: exactTarget }, undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(jxaDispatch).not.toHaveBeenCalled()
  })

  it('rejects an outside-window capture pixel before native dispatch', async () => {
    const { service, jxaDispatch, observationId } = harness(observed)
    await expect(service.click({ x: 620, y: 60, observationId }, undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(jxaDispatch).not.toHaveBeenCalled()
  })

  it('atomically permits one concurrent dispatch and rejects replay', async () => {
    const { service, jxaDispatch, observationId } = harness(observed)
    const results = await Promise.allSettled([
      service.click({ x: 40, y: 60, observationId }, undefined, owner),
      service.click({ x: 40, y: 60, observationId }, undefined, owner),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(jxaDispatch).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent direct/autonomous-owner revalidation through dispatch and rejects the queued stale target', async () => {
    const { service, observationId } = harness(observed)
    const other = service.screenObservations.remember(observed, 'agent-b', Date.now(), 0)
    let releaseDispatch = (): void => {}
    let reportDispatch = (): void => {}
    const dispatched = new Promise<void>((resolve) => { reportDispatch = resolve })
    const blocked = new Promise<string>((resolve) => { releaseDispatch = () => { resolve('') } })
    const dispatch = vi.fn((
      _script: string,
      _signal: AbortSignal | undefined,
      _minimumTimeoutMs: number,
      onDispatch?: () => void,
    ) => {
      onDispatch?.()
      reportDispatch()
      return blocked
    })
    service.runAtomicJxa = dispatch

    const first = service.click({ x: 40, y: 60, observationId }, undefined, owner)
    const queued = service.click({ x: 40, y: 60, observationId: other.observationId }, undefined, 'agent-b')
    await dispatched
    await Promise.resolve()
    expect(dispatch).toHaveBeenCalledTimes(1)

    releaseDispatch()
    await first
    await expect(queued).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['click', (service: ServiceHarness, observationId: string) =>
      service.click({ x: 40, y: 60, observationId }, undefined, owner)],
    ['move', (service: ServiceHarness, observationId: string) =>
      service.move({ x: 40, y: 60, observationId }, undefined, owner)],
    ['drag', (service: ServiceHarness, observationId: string) =>
      service.drag({ x: 40, y: 60, toX: 60, toY: 80, observationId }, undefined, owner)],
    ['type', (service: ServiceHarness, observationId: string) =>
      service.type({ text: 'hello', observationId }, undefined, owner)],
    ['key', (service: ServiceHarness, observationId: string) =>
      service.key({ combo: 'return', observationId }, undefined, owner)],
    ['scroll', (service: ServiceHarness, observationId: string) =>
      service.scroll({ direction: 'down', observationId }, undefined, owner)],
    ['openApp', (service: ServiceHarness) => service.openApp({ bundleId: 'com.apple.Notes' })],
    ['focusWindow', (service: ServiceHarness) => service.focusWindow({ id: observed.window!.id })],
  ] as const)('%s invalidates every other owner\'s pending desktop observation at dispatch', async (_name, run) => {
    const { service, appleScriptDispatch, jxaDispatch, observationId } = harness(observed)
    const otherScreen = service.screenObservations.remember(observed, 'agent-b', Date.now(), 0)
    const otherWindow = service.windowObservations.remember(observed.window!, 'agent-b', Date.now(), 0)

    await run(service, observationId)
    expect(service.desktopMutationEpoch).toBe(1)

    await expect(service.click(
      { x: 40, y: 60, observationId: otherScreen.observationId },
      undefined,
      'agent-b',
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    await expect(service.click(
      { x: 20, y: 30, target: { ...otherWindow, window: observed.window! } },
      undefined,
      'agent-b',
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(appleScriptDispatch.mock.calls.length + jxaDispatch.mock.calls.length).toBe(1)
    expect(service.desktopMutationEpoch).toBe(1)
  })

  it('rejects open and focus if the desktop/configuration epoch changes during target resolution', async () => {
    const opening = harness(observed)
    opening.service.resolveApplication = async () => {
      opening.service.desktopMutationEpoch += 1
      return { name: 'Notes', bundleId: 'com.apple.Notes', path: '/Applications/Notes.app' }
    }
    await expect(opening.service.openApp({ bundleId: 'com.apple.Notes' }))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(opening.jxaDispatch).not.toHaveBeenCalled()

    const focusing = harness(observed)
    focusing.service.listAllWindows = async () => {
      focusing.service.desktopMutationEpoch += 1
      return [observed.window!]
    }
    await expect(focusing.service.focusWindow({ id: observed.window!.id }))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(focusing.appleScriptDispatch).not.toHaveBeenCalled()
  })

  it('rejects another owner and an absent owner before native dispatch', async () => {
    const mismatch = harness(observed)
    await expect(mismatch.service.click(
      { x: 40, y: 60, observationId: mismatch.observationId },
      undefined,
      'agent-b',
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(mismatch.jxaDispatch).not.toHaveBeenCalled()

    const absent = harness(observed)
    await expect(absent.service.click({ x: 40, y: 60, observationId: absent.observationId }))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(absent.jxaDispatch).not.toHaveBeenCalled()
  })

  it('does not canonicalize byte-distinct Agent owner identities', async () => {
    const spaced = harness(observed)
    await expect(spaced.service.click(
      { x: 40, y: 60, observationId: spaced.observationId },
      undefined,
      ' agent-a ',
    )).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(spaced.jxaDispatch).not.toHaveBeenCalled()
  })

  it('rejects every unbound focus-dependent mutation before either native dispatch path', async () => {
    const { service, appleScriptDispatch, commandDispatch, jxaDispatch } = harness(observed)
    const actions = [
      () => service.click({ x: 20, y: 30 }, undefined, owner),
      () => service.move({ x: 20, y: 30 }, undefined, owner),
      () => service.drag({ x: 20, y: 30, toX: 30, toY: 40 }, undefined, owner),
      () => service.type({ text: 'hello' }, undefined, owner),
      () => service.key({ combo: 'return' }, undefined, owner),
      () => service.scroll({ direction: 'down' }, undefined, owner),
    ]
    for (const action of actions) {
      await expect(action()).rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    }
    expect(appleScriptDispatch).not.toHaveBeenCalled()
    expect(commandDispatch).not.toHaveBeenCalled()
    expect(jxaDispatch).not.toHaveBeenCalled()
  })

  it('always blocks public arbitrary AppleScript', async () => {
    const { service, appleScriptDispatch } = harness(observed)
    await expect(service.runAppleScript('return "secret"'))
      .rejects.toMatchObject({ code: 'MACOS_USE_APP_BLOCKED' })
    expect(appleScriptDispatch).not.toHaveBeenCalled()
  })

  it('does not expose frontmost identity outside read scope', async () => {
    const { service } = harness(observed)
    service.runtime = { ...runtime, readAppGrants: [{ bundleId: 'com.apple.Notes' }] }
    service.readFrontmostProcess = () => Promise.resolve({
      name: 'Passwords',
      bundleId: 'com.apple.Passwords',
      pid: 9,
    })
    await expect(service.frontmostProcess()).rejects.toMatchObject({ code: 'MACOS_USE_APP_BLOCKED' })
  })

  it('fails closed with a visual-configuration hint when every grant is empty', async () => {
    const { service, appleScriptDispatch, commandDispatch, jxaDispatch } = harness(observed)
    service.runtime = {
      ...runtime,
      readAppGrants: [],
      controlAppGrants: [],
    }
    await expect(service.frontmostProcess()).rejects.toMatchObject({ code: 'MACOS_USE_APP_BLOCKED' })
    await expect(service.frontmostProcess()).rejects.toThrow(/Plugin Configuration/)
    await expect(service.openApp({ bundleId: 'com.apple.Notes' })).rejects.toMatchObject({ code: 'MACOS_USE_APP_BLOCKED' })
    await expect(service.openApp({ bundleId: 'com.apple.Notes' })).rejects.toThrow(/Plugin Configuration/)
    expect(appleScriptDispatch).not.toHaveBeenCalled()
    expect(commandDispatch).not.toHaveBeenCalled()
    expect(jxaDispatch).not.toHaveBeenCalled()
  })

  it('rejects control-only scope before a side effect that could lack its receipt', async () => {
    const { service, jxaDispatch, observationId } = harness(observed)
    service.runtime = { ...runtime, readAppGrants: [] }
    await expect(service.click({ x: 40, y: 60, observationId }, undefined, owner))
      .rejects.toMatchObject({ code: 'MACOS_USE_APP_BLOCKED' })
    expect(jxaDispatch).not.toHaveBeenCalled()
  })

  it('revalidates and launches the exact bundle in one native script, then returns verified identity', async () => {
    const { service, jxaDispatch } = harness(observed)
    await expect(service.openApp({ bundleId: 'com.apple.Notes' })).resolves.toEqual(observed.process)
    const script = String(jxaDispatch.mock.calls[0]?.[0])
    expect(script).toContain('/Applications/Notes.app')
    expect(script).toContain('com.apple.Notes')
    expect(script).toContain('NSWorkspace.sharedWorkspace.openURL(url)')
  })

  it('fails when the launched bundle is not the verified frontmost identity', async () => {
    const { service, jxaDispatch } = harness(observed)
    service.waitForFrontmostApplication = () => Promise.reject(new MacosUseError(
      'frontmost bundle mismatch',
      'MACOS_USE_TARGET_STALE',
    ))
    await expect(service.openApp({ bundleId: 'com.apple.Notes' }))
      .rejects.toMatchObject({ code: 'MACOS_USE_TARGET_STALE' })
    expect(jxaDispatch).toHaveBeenCalledTimes(1)
  })
})
