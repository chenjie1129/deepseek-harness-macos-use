import { describe, expect, it } from 'vitest'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type { GuiModelService } from '@deepseek-ai/dsh-gui-model'
import { runGuiTask } from '../src/loop.ts'
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
    screenshot: async () => ({ pngBase64: 'fake' }),
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
    expect(result).toEqual({ completed: true, summary: 'All set.', steps: [{ action: { kind: 'done', summary: 'All set.' } }] })
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

  it('logs a failed action outcome and continues instead of throwing', async () => {
    const guiModel = fakeGuiModel([
      { kind: 'click', x: 1, y: 2 },
      { kind: 'done', summary: 'done' },
    ])
    const executor = fakeExecutor({ perform: async () => { throw new Error('boom') } })
    const result = await runGuiTask(guiModel, executor, { task: 't', maxSteps: 5 })
    expect(result.completed).toBe(true)
    expect(result.steps[0]?.outcome).toBe('error: Error: boom')
  })

  it('waits without calling the executor for a wait action', async () => {
    const guiModel = fakeGuiModel([{ kind: 'wait', ms: 1 }, { kind: 'done', summary: 'done' }])
    const executor = fakeExecutor()
    const result = await runGuiTask(guiModel, executor, { task: 't', maxSteps: 5 })
    expect(executor.performed).toEqual([])
    expect(result.steps[0]).toEqual({ action: { kind: 'wait', ms: 1 }, outcome: 'waited' })
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

  it('stops immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const guiModel = fakeGuiModel([{ kind: 'done', summary: 'unreachable' }])
    await expect(runGuiTask(guiModel, fakeExecutor(), { task: 't', maxSteps: 5, signal: controller.signal }))
      .rejects.toThrow()
  })
})
