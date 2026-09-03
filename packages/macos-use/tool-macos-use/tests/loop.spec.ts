import { describe, expect, it } from 'vitest'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type { GuiModelService } from '@deepseek-ai/dsh-gui-model'
import { GuiTaskRunError, runGuiTask } from '../src/loop.ts'
import type { TaskExecutor } from '../src/loop.ts'

function fakeGuiModel(actions: readonly GuiAction[]): GuiModelService {
  let index = 0
  return {
    nextAction: async () => {
      const action = actions[index]
      index += 1
      if (action === undefined) throw new Error('fakeGuiModel: ran out of scripted actions')
      return action
    },
  } as unknown as GuiModelService
}

function fakeExecutor(overrides: Partial<TaskExecutor> = {}): TaskExecutor & { performed: GuiAction[] } {
  const performed: GuiAction[] = []
  return {
    performed,
    screenshot: async () => ({ pngBase64: 'fake', observationId: 'observation' }),
    perform: async (action) => {
      performed.push(action)
    },
    ...overrides,
  }
}

describe('runGuiTask', () => {
  it('stops immediately on a done action and reports its summary', async () => {
    const guiModel = fakeGuiModel([{ kind: 'done', summary: 'All set.' }])
    const executor = fakeExecutor()
    const result = await runGuiTask(guiModel, executor, { task: 'do the thing', maxSteps: 5 })
    expect(result).toEqual({
      completed: true,
      summary: 'All set.',
      steps: [{ action: { kind: 'done', summary: 'All set.' } }],
    })
    expect(executor.performed).toEqual([])
  })

  it('falls back to a default summary when done carries none', async () => {
    const guiModel = fakeGuiModel([{ kind: 'done' }])
    const result = await runGuiTask(guiModel, fakeExecutor(), { task: 't', maxSteps: 5 })
    expect(result.completed).toBe(true)
    expect(result.summary).toBe('Task completed.')
  })

  it('executes non-terminal actions via the executor and logs their outcome', async () => {
    const guiModel = fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'type', text: 'hi' },
      { kind: 'done', summary: 'done' },
    ])
    const executor = fakeExecutor()
    const result = await runGuiTask(guiModel, executor, { task: 't', maxSteps: 5 })
    expect(executor.performed).toEqual([{ kind: 'click', x: 1, y: 2 }, { kind: 'type', text: 'hi' }])
    expect(result.steps[0]).toEqual({ action: { kind: 'click', x: 1, y: 2 }, outcome: 'ok' })
    expect(result.steps[1]).toEqual({ action: { kind: 'type', text: 'hi' }, outcome: 'ok' })
  })

  it('binds an action to the observation that grounded the model decision', async () => {
    const observations: Array<string | undefined> = []
    const executor = fakeExecutor({
      screenshot: async () => ({ pngBase64: 'fake', observationId: 'observation-1' }),
      perform: async (_action, observationId) => { observations.push(observationId) },
    })
    await runGuiTask(fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'done', summary: 'done' },
    ]), executor, { task: 't', maxSteps: 5 })
    expect(observations).toEqual(['observation-1'])
  })

  it('passes post-approval focus restoration only to the approved concrete action', async () => {
    const restorations: Array<boolean | undefined> = []
    let decision = 0
    const executor = fakeExecutor({
      perform: async (_action, _observationId, _signal, restoreObservedFocus) => {
        restorations.push(restoreObservedFocus)
      },
    })
    await runGuiTask(fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'type', text: 'hello' },
      { kind: 'done', summary: 'done' },
    ]), executor, {
      task: 't',
      maxSteps: 5,
      beforeAction: async () => {
        decision += 1
        return decision === 1
      },
    })
    expect(restorations).toEqual([true, false])
  })

  it('keeps the executor restore flag false when no approval gate is configured', async () => {
    const restorations: Array<boolean | undefined> = []
    await runGuiTask(fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'done', summary: 'done' },
    ]), fakeExecutor({
      perform: async (_action, _observationId, _signal, restoreObservedFocus) => {
        restorations.push(restoreObservedFocus)
      },
    }), { task: 't', maxSteps: 5 })
    expect(restorations).toEqual([false])
  })

  it('never retries after perform may have applied a side effect and then rejects', async () => {
    let decisions = 0
    let sideEffects = 0
    const guiModel = {
      nextAction: async () => {
        decisions += 1
        return decisions === 1
          ? { kind: 'click', x: 1, y: 2 }
          : { kind: 'click', x: 3, y: 4 }
      },
    } as unknown as GuiModelService
    const executor = fakeExecutor({
      perform: async () => {
        sideEffects += 1
        throw new Error('driver failed after dispatch')
      },
    })
    let failure: unknown
    try {
      await runGuiTask(guiModel, executor, { task: 't', maxSteps: 5 })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(GuiTaskRunError)
    expect((failure as GuiTaskRunError).steps[0]?.outcome).toBe('error: Error: driver failed after dispatch')
    expect(sideEffects).toBe(1)
    expect(decisions).toBe(1)
  })

  it('stops when the safety gate denies a model-selected action', async () => {
    const executor = fakeExecutor()
    await expect(runGuiTask(fakeGuiModel([{ kind: 'click', x: 1, y: 2 }]), executor, {
      task: 't',
      maxSteps: 5,
      beforeAction: async () => { throw new Error('approval denied') },
    })).rejects.toThrow('approval denied')
    expect(executor.performed).toEqual([])
  })

  it('settles a decision failure with the screenshot that already exists', async () => {
    const guiModel = {
      nextAction: async () => { throw new Error('vision provider unavailable') },
    } as unknown as GuiModelService
    const settled: Array<{ screenshot?: string; phase?: string; outcome?: string }> = []
    let failure: unknown

    try {
      await runGuiTask(guiModel, fakeExecutor({
        screenshot: async () => ({ pngBase64: 'observed-before-failure', observationId: 'observation-1' }),
      }), {
        task: 't',
        maxSteps: 1,
        retainStepScreenshots: true,
        onProgress: (event) => {
          if (event.kind === 'settled') {
            settled.push({
              ...event.screenshotPngBase64 === undefined ? {} : { screenshot: event.screenshotPngBase64 },
              ...event.entry.phase === undefined ? {} : { phase: event.entry.phase },
              ...event.entry.outcome === undefined ? {} : { outcome: event.entry.outcome },
            })
          }
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(GuiTaskRunError)
    expect((failure as GuiTaskRunError).steps).toEqual([{
      phase: 'decision',
      outcome: 'error: Error: vision provider unavailable',
    }])
    expect(settled).toEqual([{
      screenshot: 'observed-before-failure',
      phase: 'decision',
      outcome: 'error: Error: vision provider unavailable',
    }])
  })

  it('stops on every executor error but still reports a settled transition', async () => {
    const events: string[] = []
    const fatal = new Error('destination blocked')
    const executor = fakeExecutor({
      perform: async () => { throw fatal },
    })
    await expect(runGuiTask(fakeGuiModel([{ kind: 'click', x: 1, y: 2 }]), executor, {
      task: 't',
      maxSteps: 5,
      onProgress: (event) => { events.push(event.kind) },
    })).rejects.toThrow('destination blocked')
    expect(events).toEqual(['observed', 'decided', 'settled'])
  })

  it('records a dispatched action as stopped when its mandatory post-action capture fails', async () => {
    let captures = 0
    const executor = fakeExecutor({
      screenshot: async () => {
        captures += 1
        if (captures > 1) throw new Error('post-action capture failed')
        return { pngBase64: 'before', observationId: 'observation-1' }
      },
    })
    let failure: unknown
    try {
      await runGuiTask(fakeGuiModel([{ kind: 'click', x: 1, y: 2 }]), executor, {
        task: 't', maxSteps: 5,
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GuiTaskRunError)
    const failedSteps = (failure as GuiTaskRunError).steps
    expect(failedSteps).toHaveLength(1)
    expect(failedSteps[0]?.action).toEqual({ kind: 'click', x: 1, y: 2 })
    expect(failedSteps[0]?.outcome).toContain('action dispatched but post-action screenshot failed')
    expect(executor.performed).toHaveLength(1)
  })

  it('waits without calling the executor for a wait action', async () => {
    const guiModel = fakeGuiModel([{ kind: 'wait', ms: 1 }, { kind: 'done', summary: 'done' }])
    const executor = fakeExecutor()
    const result = await runGuiTask(guiModel, executor, { task: 't', maxSteps: 5 })
    expect(executor.performed).toEqual([])
    expect(result.steps[0]).toEqual({ action: { kind: 'wait', ms: 1 }, outcome: 'waited' })
  })

  it('settles the current wait step before returning a structured timeout cause', async () => {
    const controller = new AbortController()
    const settled: string[] = []
    const running = runGuiTask(fakeGuiModel([{ kind: 'wait', ms: 5000 }]), fakeExecutor(), {
      task: 't',
      maxSteps: 1,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.kind === 'settled') settled.push(event.entry.outcome ?? '')
      },
    })
    controller.abort(new Error('task timeout'))
    let timeoutFailure: unknown
    try {
      await running
    } catch (error) {
      timeoutFailure = error
    }
    expect(timeoutFailure).toBeInstanceOf(GuiTaskRunError)
    const timeoutSteps = (timeoutFailure as GuiTaskRunError).steps
    expect(timeoutSteps).toHaveLength(1)
    expect(timeoutSteps[0]?.action).toEqual({ kind: 'wait', ms: 5000 })
    expect(timeoutSteps[0]?.outcome).toContain('task timeout')
    expect(settled).toHaveLength(1)
  })

  it('stops after maxSteps without reaching done', async () => {
    const guiModel = fakeGuiModel([
      { kind: 'click', x: 1, y: 1 },
      { kind: 'click', x: 2, y: 2 },
      { kind: 'click', x: 3, y: 3 },
    ])
    const result = await runGuiTask(guiModel, fakeExecutor(), { task: 't', maxSteps: 2 })
    expect(result.completed).toBe(false)
    expect(result.summary).toBe('Stopped after 2 steps without reaching "done".')
    expect(result.steps).toHaveLength(2)
  })

  it('streams requested screenshots without retaining a full-resolution base64 history in the result', async () => {
    let capture = 0
    const executor = fakeExecutor({
      screenshot: async () => {
        capture += 1
        return { pngBase64: `capture-${String(capture)}`, observationId: `observation-${String(capture)}` }
      },
    })
    const guiModel = fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'done', summary: 'done' },
    ])

    const streamed: string[] = []
    const result = await runGuiTask(guiModel, executor, {
      task: 't', maxSteps: 5, retainStepScreenshots: true,
      onProgress(event) {
        if (event.kind === 'settled' && event.screenshotPngBase64 !== undefined) {
          streamed.push(event.screenshotPngBase64)
        }
      },
    })

    expect(streamed).toEqual(['capture-2', 'capture-2'])
    expect(result).not.toHaveProperty('stepScreenshotsPngBase64')
  })

  it('emits each screenshot and phase before moving to the next operation', async () => {
    const events: Array<{ kind: string; step: number; screenshot?: string }> = []
    let capture = 0
    await runGuiTask(fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'done', summary: 'done' },
    ]), fakeExecutor({
      screenshot: async () => {
        capture += 1
        return {
          pngBase64: `step-image-${String(capture)}`,
          observationId: `observation-${String(capture)}`,
        }
      },
    }), {
      task: 't',
      maxSteps: 5,
      retainStepScreenshots: true,
      onProgress: (event) => {
        events.push({
          kind: event.kind,
          step: event.step,
          ...event.kind === 'observed' || event.kind === 'settled'
            ? { screenshot: event.screenshotPngBase64 }
            : {},
        })
      },
    })
    expect(events).toEqual([
      { kind: 'observed', step: 1, screenshot: 'step-image-1' },
      { kind: 'decided', step: 1 },
      { kind: 'settled', step: 1, screenshot: 'step-image-2' },
      { kind: 'observed', step: 2, screenshot: 'step-image-2' },
      { kind: 'decided', step: 2 },
      { kind: 'settled', step: 2, screenshot: 'step-image-2' },
    ])
  })

  it('stops immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const guiModel = fakeGuiModel([{ kind: 'done', summary: 'unreachable' }])
    await expect(runGuiTask(guiModel, fakeExecutor(), { task: 't', maxSteps: 5, signal: controller.signal }))
      .rejects.toThrow()
  })
})
