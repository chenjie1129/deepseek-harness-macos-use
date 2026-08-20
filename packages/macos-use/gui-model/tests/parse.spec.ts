import { describe, expect, it } from 'vitest'
import { buildUserPrompt, parseGuiAction } from '../src/parse.ts'
import { GuiModelError } from '../src/types.ts'

describe('parseGuiAction', () => {
  it('parses a click action', () => {
    expect(parseGuiAction('{"kind": "click", "x": 10, "y": 20, "reason": "click the button"}')).toEqual({
      kind: 'click',
      x: 10,
      y: 20,
      reason: 'click the button',
    })
  })

  it('parses a done action with a summary', () => {
    expect(parseGuiAction('{"kind": "done", "summary": "Task finished."}')).toEqual({
      kind: 'done',
      summary: 'Task finished.',
    })
  })

  it('tolerates surrounding prose and markdown fences', () => {
    const content = 'Sure, here it is:\n```json\n{"kind": "wait", "ms": 200}\n```\nHope that helps.'
    expect(parseGuiAction(content)).toEqual({ kind: 'wait', ms: 200 })
  })

  it('rejects content with no JSON object', () => {
    expect(() => parseGuiAction('no json here')).toThrow(GuiModelError)
  })

  it('rejects an unterminated JSON object', () => {
    expect(() => parseGuiAction('{"kind": "wait"')).toThrow(GuiModelError)
  })

  it('rejects invalid JSON', () => {
    expect(() => parseGuiAction('{"kind": }')).toThrow(GuiModelError)
  })

  it('rejects a response with no JSON object at all, e.g. a bare scalar', () => {
    expect(() => parseGuiAction('null')).toThrow(GuiModelError)
  })

  it('rejects an unknown action kind', () => {
    expect(() => parseGuiAction('{"kind": "explode"}')).toThrow(GuiModelError)
  })

  it('rejects click/double_click/right_click missing x or y', () => {
    expect(() => parseGuiAction('{"kind": "click", "x": 1}')).toThrow(GuiModelError)
    expect(() => parseGuiAction('{"kind": "double_click", "y": 1}')).toThrow(GuiModelError)
    expect(() => parseGuiAction('{"kind": "right_click"}')).toThrow(GuiModelError)
  })

  it('rejects type missing text, key missing combo, scroll missing direction', () => {
    expect(() => parseGuiAction('{"kind": "type"}')).toThrow(GuiModelError)
    expect(() => parseGuiAction('{"kind": "key"}')).toThrow(GuiModelError)
    expect(() => parseGuiAction('{"kind": "scroll"}')).toThrow(GuiModelError)
  })

  it('accepts a fully-specified scroll action', () => {
    expect(parseGuiAction('{"kind": "scroll", "direction": "down", "amount": 3}')).toEqual({
      kind: 'scroll',
      direction: 'down',
      amount: 3,
    })
  })
})

describe('buildUserPrompt', () => {
  it('includes the task with no history', () => {
    const prompt = buildUserPrompt('Open Safari', undefined)
    expect(prompt).toContain('Task: Open Safari')
    expect(prompt).not.toContain('Prior steps:')
  })

  it('numbers prior steps and includes their outcome', () => {
    const prompt = buildUserPrompt('Open Safari', [
      { action: { kind: 'click', x: 1, y: 2 }, outcome: 'ok' },
      { action: { kind: 'wait', ms: 100 } },
    ])
    expect(prompt).toContain('Prior steps:')
    expect(prompt).toContain('1. {"kind":"click","x":1,"y":2} -> ok')
    expect(prompt).toContain('2. {"kind":"wait","ms":100}')
  })
})
