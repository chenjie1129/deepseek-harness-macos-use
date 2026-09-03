import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { TaskCoordinator } from '../src/coordinator.ts'
import {
  approveAutonomousAction,
  deferredDesktopTaskApprovalReason,
  guiPreExecutionDecision,
} from '../src/policy.ts'
import { GUI_TASK_PROGRESS_REMOTE_DESCRIPTORS } from '../src/progress-remote.ts'
import { parseAppIdentityRules, resolveSettings } from '../src/settings.ts'
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
    const agent = 'agent-a'
    const element = {
      role: 'AXButton',
      name: 'Save',
      enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }
    const first = store.create(agent, window, [element])
    expect(store.reserve(agent, first.elements[0]?.token ?? '').revalidate({
      window,
      observationId: 'observation-2',
      elements: [element],
    })).toEqual({
      x: 40,
      y: 45,
      target: { observationId: 'observation-2', window },
    })

    store.create(agent, window, [])

    expect(() => store.reserve(agent, first.elements[0]?.token ?? '').revalidate({
      window,
      observationId: 'observation-3',
      elements: [element],
    })).toThrow(/stale/)
  })

  it('fails closed when the target window moves', () => {
    const store = new ElementTokenStore()
    const agent = 'agent-a'
    const element = {
      role: 'AXButton', enabled: true, bounds: { x: 30, y: 40, width: 20, height: 10 },
    }
    const snapshot = store.create(agent, window, [element])
    expect(() => store.reserve(agent, snapshot.elements[0]?.token ?? '').revalidate({
      window: { ...window, bounds: { ...window.bounds, x: 11 } },
      observationId: 'observation-2',
      elements: [element],
    })).toThrow(/stale/)
  })

  it('revalidates exact Accessibility identity and bounds before dispatch', () => {
    const store = new ElementTokenStore()
    const agent = 'agent-a'
    const element = {
      role: 'AXButton', name: 'Delete', enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }
    const snapshot = store.create(agent, window, [element])
    expect(() => store.reserve(agent, snapshot.elements[0]?.token ?? '').revalidate({
      window,
      observationId: 'fresh-observation',
      elements: [{ ...element, name: 'Save' }],
    })).toThrow(/exact Accessibility element changed/)
  })

  it('atomically rejects concurrent replay before either caller can dispatch', async () => {
    const store = new ElementTokenStore()
    const agent = 'agent-a'
    const element = {
      role: 'AXButton', name: 'Save', enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }
    const snapshot = store.create(agent, window, [element])
    const token = snapshot.elements[0]?.token ?? ''
    const dispatch = vi.fn()
    const use = async () => {
      const reservation = store.reserve(agent, token)
      await Promise.resolve()
      const target = reservation.revalidate({
        window,
        observationId: 'fresh-observation',
        elements: [element],
      })
      dispatch(target)
    }
    const results = await Promise.allSettled([use(), use()])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('rejects an element token presented by a different Agent owner', () => {
    const store = new ElementTokenStore()
    const snapshot = store.create('agent-a', window, [{
      role: 'AXButton', name: 'Save', enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }])
    expect(() => store.reserve('agent-b', snapshot.elements[0]?.token ?? ''))
      .toThrow(/stale|does not belong/)
  })

  it('invalidates one disposed owner without disturbing another owner token', () => {
    const store = new ElementTokenStore()
    const element = {
      role: 'AXButton', name: 'Save', enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }
    const first = store.create('agent-a', window, [element])
    const second = store.create('agent-b', window, [element])
    store.invalidate('agent-a')

    expect(() => store.reserve('agent-a', first.elements[0]?.token ?? '')).toThrow(/stale/)
    expect(store.reserve('agent-b', second.elements[0]?.token ?? '').windowId).toBe(window.id)
  })

  it('expires old snapshots and caps retained Agent owners', () => {
    let now = 1_000
    const store = new ElementTokenStore(() => now)
    const element = {
      role: 'AXButton', name: 'Save', enabled: true,
      bounds: { x: 30, y: 40, width: 20, height: 10 },
    }
    const expired = store.create('expiring-agent', window, [element])
    now += 60_001
    expect(() => store.reserve('expiring-agent', expired.elements[0]?.token ?? '')).toThrow(/stale/)

    const snapshots = Array.from({ length: 65 }, (_value, index) =>
      store.create(`bounded-agent-${String(index)}`, window, [element]))
    expect(() => store.reserve('bounded-agent-0', snapshots[0]?.elements[0]?.token ?? '')).toThrow(/stale/)
    expect(store.reserve('bounded-agent-64', snapshots[64]?.elements[0]?.token ?? '').windowId).toBe(window.id)
  })
})

describe('P0 approval policy', () => {
  function execution(name: string, args: unknown): ToolExecution {
    return { name, arguments: args } as ToolExecution
  }

  it('asks for destructive direct actions by default', () => {
    const settings = resolveSettings({})
    expect(settings.confirmEveryMutation).toBe(true)
    expect(guiPreExecutionDecision(execution('computer_drag', {}), settings, false)?.kind).toBe('ask')
    expect(guiPreExecutionDecision(execution('computer_key', { combo: 'cmd+delete' }), settings, false)?.kind).toBe('ask')
    expect(guiPreExecutionDecision(execution('computer_click', {}), settings, false)?.kind).toBe('ask')
  })

  it('recognizes common English, Chinese, and Japanese high-impact task wording', () => {
    const settings = resolveSettings({})
    for (const task of [
      'submit the purchase order',
      '删除这封邮件并提交表单',
      'この投稿を削除して送信してください',
    ]) {
      expect(guiPreExecutionDecision(execution('computer_use_task', { task }), settings, false)).toBeUndefined()
      expect(guiPreExecutionDecision(execution('browser_use_task', { task }), settings, false)?.kind).toBe('ask')
    }
    expect(guiPreExecutionDecision(
      execution('computer_use_task', { task: 'open the settings page' }),
      settings,
      false,
    )).toBeUndefined()
  })

  it('defers high-impact desktop task approval until a concrete action only in relaxed mode', () => {
    expect(deferredDesktopTaskApprovalReason(
      'delete this draft',
      resolveSettings({ confirmEveryMutation: false, confirmDestructiveActions: true }),
    )).toContain('first concrete action')
    expect(deferredDesktopTaskApprovalReason('delete this draft', resolveSettings({}))).toBeUndefined()
    expect(deferredDesktopTaskApprovalReason(
      'open settings',
      resolveSettings({ confirmEveryMutation: false, confirmDestructiveActions: true }),
    )).toBeUndefined()
  })

  it('blocks overlapping GUI control while the single-task switch is on', () => {
    expect(guiPreExecutionDecision(execution('computer_click', {}), resolveSettings({}), true)).toMatchObject({ kind: 'deny' })
    expect(guiPreExecutionDecision(execution('computer_abort', {}), resolveSettings({}), true)).toBeUndefined()
    expect(guiPreExecutionDecision(
      execution('computer_click', {}),
      resolveSettings({
        singleActiveTask: false,
        confirmEveryMutation: false,
        confirmDestructiveActions: false,
      }),
      true,
    )).toBeUndefined()
  })

  it('never applies this plugin policy to another plugin that happens to share a tool-name prefix', () => {
    const strict = resolveSettings({ confirmEveryMutation: true, singleActiveTask: true })
    expect(guiPreExecutionDecision(execution('computer_secret_lookup', {}), strict, true)).toBeUndefined()
    expect(guiPreExecutionDecision(execution('browser_pdf_export', {}), strict, true)).toBeUndefined()
  })

  it('asks once for every direct mutation when the strict visual switch is enabled', () => {
    const settings = resolveSettings({
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    for (const name of [
      'computer_click', 'computer_type', 'computer_move', 'computer_drag', 'computer_scroll',
      'computer_key', 'computer_open_app', 'computer_focus_window',
      'browser_navigate', 'browser_click', 'browser_fill',
    ]) {
      expect(guiPreExecutionDecision(execution(name, {}), settings, false)?.kind).toBe('ask')
    }
    expect(guiPreExecutionDecision(execution('browser_use_task', { url: 'https://example.test' }), settings, false)?.kind).toBe('ask')
    for (const name of [
      'computer_screenshot', 'computer_list_apps', 'computer_list_windows',
      'computer_screenshot_window', 'computer_get_window_state', 'browser_extract_text',
      'browser_screenshot', 'computer_abort',
    ]) {
      expect(guiPreExecutionDecision(execution(name, {}), settings, false)).toBeUndefined()
    }
  })

  it('approves every autonomous mutation once and fails closed without an approval channel', async () => {
    const settings = resolveSettings({
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const request = vi.fn(() => Promise.resolve('allowed-once' as const))
    const ctx = { get: (key: string) => key === 'approval' ? { request } : undefined } as unknown as Context
    const exec = {
      agent: { id: 'agent-a' },
      name: 'computer_use_task',
      callId: 'call-a',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await expect(approveAutonomousAction(
      ctx,
      exec,
      { kind: 'click', x: 1, y: 2 },
      settings,
      exec.signal,
    )).resolves.toBe(true)
    expect(request).toHaveBeenCalledOnce()

    await expect(approveAutonomousAction(
      { get: () => undefined } as unknown as Context,
      exec,
      { kind: 'type', text: 'hello' },
      settings,
      exec.signal,
    )).rejects.toThrow(/no user approval channel/)
  })

  it('returns false without prompting when no autonomous action approval applies', async () => {
    const request = vi.fn(() => Promise.resolve('allowed-once' as const))
    const ctx = { get: (key: string) => key === 'approval' ? { request } : undefined } as unknown as Context
    const exec = {
      agent: { id: 'agent-a' },
      name: 'computer_use_task',
      callId: 'call-a',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await expect(approveAutonomousAction(
      ctx,
      exec,
      { kind: 'click', x: 1, y: 2 },
      resolveSettings({ confirmEveryMutation: false, confirmDestructiveActions: false }),
      exec.signal,
    )).resolves.toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('P0 progress Remote boundary', () => {
  it('exports progress only as an Agent-context invocation, never as a root direct method', () => {
    const [descriptor] = GUI_TASK_PROGRESS_REMOTE_DESCRIPTORS
    expect(descriptor?.invocation).toMatchObject({
      kind: 'context', context: 'agent', wire: 'agentId',
    })
    expect(descriptor?.parameters.map(parameter => parameter.name)).toEqual(['callId'])
    expect('scope' in (descriptor ?? {})).toBe(false)
  })
})

describe('P0 precise application policy settings', () => {
  it('parses name, bundle id, and pid combinations from the visual text format', () => {
    expect(parseAppIdentityRules([
      'Notes',
      'name=Safari | bundleId=com.apple.Safari | pid=41',
      'bundleId=com.apple.finder',
    ].join('\n'))).toEqual([
      { name: 'Notes' },
      { name: 'Safari', bundleId: 'com.apple.Safari', pid: 41 },
      { bundleId: 'com.apple.finder' },
    ])
  })

  it('rejects malformed precise rules rather than silently widening the scope', () => {
    expect(() => parseAppIdentityRules('bundle=com.apple.Safari')).toThrow(/invalid application identity rule/)
    expect(() => parseAppIdentityRules('pid=not-a-number')).toThrow(/invalid application pid/)
    expect(() => parseAppIdentityRules('name=Notes | name=Safari')).toThrow(/duplicate name/)
    expect(() => parseAppIdentityRules('bundleId=com.apple.Notes | bundleId=com.apple.Safari')).toThrow(/duplicate bundleId/)
    expect(() => parseAppIdentityRules('pid=41 | pid=42')).toThrow(/duplicate pid/)
  })
})

describe('P0 task coordinator', () => {
  function execution(signal: AbortSignal, ownerId = 'agent-a', callId = 'p0'): ToolRunContext {
    return { agent: { id: ownerId }, callId, signal } as unknown as ToolRunContext
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
    const first = subject.run(execution(new AbortController().signal), 'agent-a', {
      singleActiveTask: true,
      timeoutMs: 10_000,
    }, body)
    await started.promise
    await expect(subject.run(execution(new AbortController().signal), 'agent-b', {
      singleActiveTask: true,
      timeoutMs: 10_000,
    }, () => Promise.resolve())).rejects.toThrow(/already active/)

    expect(subject.abortOwner('agent-b')).toBe(0)
    expect(subject.abortOwner('agent-a')).toBe(1)
    await expect(first).rejects.toThrow(/owning agent/)
    expect(subject.hasActiveTask()).toBe(false)
    release.resolve(undefined)
  })

  it('keeps owner abort isolated while the visual emergency stop remains global', async () => {
    const subject = new TaskCoordinator()
    const startedA = Promise.withResolvers<AbortSignal>()
    const startedB = Promise.withResolvers<AbortSignal>()
    const hang = (started: PromiseWithResolvers<AbortSignal>) => (signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        started.resolve(signal)
        signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
      })
    const taskA = subject.run(execution(new AbortController().signal, 'agent-a', 'call-a'), 'agent-a', {
      singleActiveTask: false,
      timeoutMs: 10_000,
    }, hang(startedA))
    const taskB = subject.run(execution(new AbortController().signal, 'agent-b', 'call-b'), 'agent-b', {
      singleActiveTask: false,
      timeoutMs: 10_000,
    }, hang(startedB))
    const rejectedA = expect(taskA).rejects.toThrow(/owning agent/)
    const rejectedB = expect(taskB).rejects.toThrow(/Plugin Configuration/)
    const signalA = await startedA.promise
    const signalB = await startedB.promise

    expect(subject.abortOwner('agent-a')).toBe(1)
    await rejectedA
    expect(signalA.aborted).toBe(true)
    expect(signalB.aborted).toBe(false)
    expect(subject.abortAll()).toBe(1)
    await rejectedB
    expect(signalB.aborted).toBe(true)
    expect(subject.hasActiveTask()).toBe(false)
  })
})
