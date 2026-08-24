import { describe, expect, it, vi } from 'vitest'
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { TaskCoordinator } from '../src/coordinator.ts'
import { guiPreExecutionDecision } from '../src/policy.ts'
import { resolveSettings } from '../src/settings.ts'
import { ElementTokenStore } from '../src/tokens.ts'

const window = {
  id: 41,
  app: 'Notes',
  pid: 4,
  title: 'P0',
  bounds: { x: 10, y: 20, width: 300, height: 200 },
  onScreen: true,
}

describe('P0 element tokens', () => {
  it('resolves a fresh token and rejects it after a newer snapshot', () => {
    const store = new ElementTokenStore()
    const agent = {}
    const first = store.create(agent, window, [{
      role: 'AXButton',
      name: 'Save',
      enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }])
    expect(store.resolve(agent, first.elements[0]?.token ?? '', window)).toEqual({ x: 40, y: 45 })

    store.create(agent, window, [])

    expect(() => store.resolve(agent, first.elements[0]?.token ?? '', window)).toThrow(/stale/)
  })

  it('fails closed when the target window moves', () => {
    const store = new ElementTokenStore()
    const agent = {}
    const snapshot = store.create(agent, window, [{
      role: 'AXButton', enabled: true, bounds: { x: 30, y: 40, width: 20, height: 10 },
    }])
    expect(() => store.resolve(agent, snapshot.elements[0]?.token ?? '', {
      ...window,
      bounds: { ...window.bounds, x: 11 },
    })).toThrow(/stale/)
  })
})

describe('P0 approval policy', () => {
  function execution(name: string, args: unknown): ToolExecution {
    return { name, arguments: args } as ToolExecution
  }

  it('asks for arbitrary AppleScript and destructive direct actions by default', () => {
    const settings = resolveSettings({})
    expect(guiPreExecutionDecision(execution('computer_run_applescript', { script: 'beep' }), settings, false)?.kind).toBe('ask')
    expect(guiPreExecutionDecision(execution('computer_drag', {}), settings, false)?.kind).toBe('ask')
    expect(guiPreExecutionDecision(execution('computer_key', { combo: 'cmd+delete' }), settings, false)?.kind).toBe('ask')
  })

  it('blocks overlapping GUI control while the single-task switch is on', () => {
    expect(guiPreExecutionDecision(execution('computer_click', {}), resolveSettings({}), true)).toMatchObject({ kind: 'deny' })
    expect(guiPreExecutionDecision(execution('computer_abort', {}), resolveSettings({}), true)).toBeUndefined()
    expect(guiPreExecutionDecision(
      execution('computer_click', {}),
      resolveSettings({ singleActiveTask: false }),
      true,
    )).toBeUndefined()
  })
})

describe('P0 task coordinator', () => {
  function execution(signal: AbortSignal): ToolRunContext {
    return { callId: 'p0', signal } as unknown as ToolRunContext
  }

  it('enforces one active task and aborts the live body', async () => {
    const subject = new TaskCoordinator()
    const release = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    const body = vi.fn((signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      started.resolve(undefined)
      signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
      void release.promise.then(resolve)
    }))
    const first = subject.run(execution(new AbortController().signal), {
      singleActiveTask: true,
      timeoutMs: 10_000,
    }, body)
    await started.promise
    await expect(subject.run(execution(new AbortController().signal), {
      singleActiveTask: true,
      timeoutMs: 10_000,
    }, () => Promise.resolve())).rejects.toThrow(/already active/)

    expect(subject.abort()).toBe(1)
    await expect(first).rejects.toThrow(/aborted by the user/)
    expect(subject.hasActiveTask()).toBe(false)
    release.resolve(undefined)
  })
})
