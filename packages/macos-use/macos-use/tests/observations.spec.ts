import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { MacosUseService } from '../src/index.ts'
import { ScreenObservationStore, WindowObservationStore } from '../src/observations.ts'

const owner = 'agent-a'
const window = {
  id: 41,
  app: 'Notes',
  bundleId: 'com.apple.Notes',
  pid: 4,
  title: 'Draft',
  bounds: { x: 10, y: 20, width: 300, height: 200 },
  onScreen: true,
}

describe('window observation freshness', () => {
  it('accepts an exact fresh observation and rejects tampering', () => {
    const store = new WindowObservationStore()
    const observation = store.remember(window, owner, 1_000)
    expect(store.validate({ ...observation, window }, owner, 1_001)).toEqual(window)
    expect(() => store.validate({ ...observation, window: { ...window, pid: 9 } }, owner, 1_001))
      .toThrow(/stale or unknown/)
  })

  it('expires observations and atomically reserves them for one action', () => {
    const store = new WindowObservationStore(100)
    const expired = store.remember(window, owner, 1_000)
    expect(() => store.validate({ ...expired, window }, owner, 1_101)).toThrow(/stale or unknown/)

    const oneShot = store.remember(window, owner, 2_000)
    expect(store.reserve({ ...oneShot, window }, owner, 2_001)).toEqual(window)
    expect(() => store.reserve({ ...oneShot, window }, owner, 2_002)).toThrow(/stale or unknown/)
  })

  it('keeps post-approval raster proof owner-bound and one-shot', () => {
    const ownerMismatch = new WindowObservationStore()
    const mismatch = ownerMismatch.remember(window, owner, 1_000, 0, 'digest-a')
    expect(() => ownerMismatch.takeForReactivation(
      { ...mismatch, window },
      'agent-b',
      1_001,
    )).toThrow(/stale or unknown/)

    const store = new WindowObservationStore()
    const observation = store.remember(window, owner, 2_000, 0, 'digest-b')
    expect(store.takeForReactivation({ ...observation, window }, owner, 2_001)).toEqual({
      window,
      rasterDigest: 'digest-b',
    })
    expect(() => store.takeForReactivation({ ...observation, window }, owner, 2_002))
      .toThrow(/stale or unknown/)
    expect(() => store.reserveReceipt({ ...observation, window }, owner, 2_002))
      .toThrow(/stale/)
  })

  it('binds action and receipt use to one owner', () => {
    const store = new WindowObservationStore()
    const observation = store.remember(window, owner, 1_000)
    expect(() => store.reserve({ ...observation, window }, 'agent-b', 1_001)).toThrow(/stale or unknown/)

    const receipt = store.remember(window, owner, 2_000)
    store.reserve({ ...receipt, window }, owner, 2_001)
    expect(() => store.reserveReceipt({ ...receipt, window }, 'agent-b', 2_002)).toThrow(/another owner/)
    expect(store.reserveReceipt({ ...receipt, window }, owner, 2_003)).toEqual(window)
    expect(() => store.reserveReceipt({ ...receipt, window }, owner, 2_004)).toThrow(/stale/)
  })

  it('copies observed identity so caller mutation cannot rewrite the stored target', () => {
    const store = new WindowObservationStore()
    const mutable = { ...window, bounds: { ...window.bounds } }
    const observation = store.remember(mutable, owner, 1_000)
    mutable.bounds.x = 999
    expect(() => store.validate({ ...observation, window: mutable }, owner, 1_001)).toThrow(/stale or unknown/)
  })

  it('revokes an older same-owner observation but preserves another owner', () => {
    const store = new WindowObservationStore()
    const first = store.remember(window, owner, 1_000)
    const other = store.remember(window, 'agent-b', 1_001)
    const latest = store.remember(window, owner, 1_002)
    expect(() => store.reserve({ ...first, window }, owner, 1_003)).toThrow(/stale or unknown/)
    expect(store.reserve({ ...latest, window }, owner, 1_003)).toEqual(window)
    expect(store.reserve({ ...other, window }, 'agent-b', 1_003)).toEqual(window)
  })

  it('rejects a byte-identical window token after the desktop mutation epoch advances', () => {
    const store = new WindowObservationStore()
    const observation = store.remember(window, owner, 1_000, 7)
    expect(() => store.reserve({ ...observation, window }, owner, 1_001, 8)).toThrow(/stale or unknown/)
  })

  it('invalidates every pending owner while retaining only the current mutation receipt', () => {
    const store = new WindowObservationStore()
    const current = store.remember(window, owner, 1_000)
    store.reserve({ ...current, window }, owner, 1_001)
    const olderReceipt = store.remember(window, 'agent-b', 1_002)
    store.reserve({ ...olderReceipt, window }, 'agent-b', 1_003)
    const pending = store.remember(window, 'agent-c', 1_004)

    store.invalidateForMutation(current.observationId)

    expect(() => store.validate({ ...pending, window }, 'agent-c', 1_005)).toThrow(/stale/)
    expect(() => store.reserveReceipt({ ...olderReceipt, window }, 'agent-b', 1_005)).toThrow(/stale/)
    expect(store.reserveReceipt({ ...current, window }, owner, 1_005)).toEqual(window)
  })

  it('clears pending and receipt-stage observations for only one disposed owner', () => {
    const store = new WindowObservationStore()
    const consumedA = store.remember(window, owner, 1_000)
    store.reserve({ ...consumedA, window }, owner, 1_001)
    const pendingA = store.remember(window, owner, 1_002)
    const pendingB = store.remember(window, 'agent-b', 1_003)

    store.clearOwner(owner)

    expect(() => store.validate({ ...pendingA, window }, owner, 1_004)).toThrow(/stale/)
    expect(() => store.reserveReceipt({ ...consumedA, window }, owner, 1_004)).toThrow(/stale/)
    expect(store.validate({ ...pendingB, window }, 'agent-b', 1_004)).toEqual(window)
  })
})

describe('display-coordinate observation freshness', () => {
  const process = { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4 }
  const display = { id: 1, bounds: { x: 0, y: 0, width: 400, height: 300 } }
  const pixels = { width: 800, height: 600 }
  const target = { process, window, display, pixels }
  const current = { process, window, display }

  it('fails closed when the foreground process, selected window, or display swaps', () => {
    const processStore = new ScreenObservationStore()
    const processObservation = processStore.remember(target, owner, 1_000)
    expect(() => processStore.validate(processObservation.observationId, owner, {
      ...current,
      process: { ...process, pid: 5 },
      window: { ...window, pid: 5 },
    }, 1_001)).toThrow(/stale or unknown/)

    const windowStore = new ScreenObservationStore()
    const windowObservation = windowStore.remember(target, owner, 2_000)
    expect(() => windowStore.validate(windowObservation.observationId, owner, {
      ...current,
      window: { ...window, id: 42 },
    }, 2_001)).toThrow(/stale or unknown/)

    const displayStore = new ScreenObservationStore()
    const displayObservation = displayStore.remember(target, owner, 3_000)
    expect(() => displayStore.validate(displayObservation.observationId, owner, {
      ...current,
      display: { ...display, id: 2 },
    }, 3_001)).toThrow(/stale or unknown/)
  })

  it('atomically consumes a display-coordinate token and rejects owner mismatch or replay', () => {
    const mismatchStore = new ScreenObservationStore()
    const mismatch = mismatchStore.remember(target, owner, 1_000)
    expect(() => mismatchStore.reserve(mismatch.observationId, 'agent-b', 1_001)).toThrow(/stale or unknown/)

    const store = new ScreenObservationStore()
    const observation = store.remember(target, owner, 2_000)
    expect(store.reserve(observation.observationId, owner, 2_001)).toEqual(target)
    expect(() => store.reserve(observation.observationId, owner, 2_002)).toThrow(/stale or unknown/)
  })

  it('revokes an older same-owner screen token but preserves another owner', () => {
    const store = new ScreenObservationStore()
    const first = store.remember(target, owner, 1_000)
    const other = store.remember(target, 'agent-b', 1_001)
    const latest = store.remember(target, owner, 1_002)
    expect(() => store.reserve(first.observationId, owner, 1_003)).toThrow(/stale or unknown/)
    expect(store.reserve(latest.observationId, owner, 1_003)).toEqual(target)
    expect(store.reserve(other.observationId, 'agent-b', 1_003)).toEqual(target)
  })

  it('rejects a byte-identical screen token after the desktop mutation epoch advances', () => {
    const store = new ScreenObservationStore()
    const observation = store.remember(target, owner, 1_000, 7)
    expect(() => store.reserve(observation.observationId, owner, 1_001, 8)).toThrow(/stale or unknown/)
  })

  it('clears display-coordinate observations for only one disposed owner', () => {
    const store = new ScreenObservationStore()
    const first = store.remember(target, owner, 1_000)
    const other = store.remember(target, 'agent-b', 1_001)
    store.clearOwner(owner)

    expect(() => store.reserve(first.observationId, owner, 1_002)).toThrow(/stale/)
    expect(store.reserve(other.observationId, 'agent-b', 1_002)).toEqual(target)
  })
})

describe('macOS observation owner lifecycle', () => {
  it('revokes both observation stores when the exact Agent is disposed', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', {} as never)
    await ctx.plugin(MacosUseService)
    const stores = ctx.macosUse as unknown as {
      windowObservations: WindowObservationStore
      screenObservations: ScreenObservationStore
    }
    const windowObservation = stores.windowObservations.remember(window, owner, 1_000)
    const screenTarget = {
      process: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 4 },
      window,
      display: { id: 1, bounds: { x: 0, y: 0, width: 400, height: 300 } },
      pixels: { width: 800, height: 600 },
    }
    const screenObservation = stores.screenObservations.remember(screenTarget, owner, 1_000)

    ctx.emit('agent/disposed', { agent: { id: owner } as unknown as Agent })

    expect(() => stores.windowObservations.validate({ ...windowObservation, window }, owner, 1_001)).toThrow(/stale/)
    expect(() => stores.screenObservations.reserve(screenObservation.observationId, owner, 1_001)).toThrow(/stale/)
    await ctx.fiber.dispose()
  })
})
