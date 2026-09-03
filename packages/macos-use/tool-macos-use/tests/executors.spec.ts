import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { browserTaskExecutor, macosTaskExecutor } from '../src/executors.ts'

describe('autonomous task executor observation gates', () => {
  it('binds each macOS control request and passes model screenshot pixels through unchanged', async () => {
    const click = vi.fn(async () => {})
    const executor = macosTaskExecutor({ macosUse: { click } } as unknown as Context, 'session-owner-1')
    await executor.perform({ kind: 'click', x: 10, y: 20 }, 'screen-observation-1')
    expect(click).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      button: 'left',
      observationId: 'screen-observation-1',
    }, undefined, 'session-owner-1')
  })

  it('marks only an approved macOS action for exact focus/pixel restoration', async () => {
    const click = vi.fn(async () => {})
    const executor = macosTaskExecutor({ macosUse: { click } } as unknown as Context, 'session-owner-1')
    await executor.perform(
      { kind: 'click', x: 10, y: 20 },
      'screen-observation-1',
      undefined,
      true,
    )
    expect(click).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      button: 'left',
      observationId: 'screen-observation-1',
      restoreObservedFocus: true,
    }, undefined, 'session-owner-1')
  })

  it('binds browser coordinate actions to the owning Agent observation', async () => {
    const clickAt = vi.fn(async () => {})
    const executor = browserTaskExecutor({ browserUse: { clickAt } } as unknown as Context, 'session-owner-1')
    await executor.perform({ kind: 'click', x: 3, y: 4 }, 'browser-observation-1')
    expect(clickAt).toHaveBeenCalledWith({
      x: 3,
      y: 4,
      observationId: 'browser-observation-1',
      ownerId: 'session-owner-1',
    }, undefined)
  })

  it('does not change browser requests when the shared loop reports an approval', async () => {
    const clickAt = vi.fn(async () => {})
    const executor = browserTaskExecutor({ browserUse: { clickAt } } as unknown as Context, 'session-owner-1')
    await executor.perform(
      { kind: 'click', x: 3, y: 4 },
      'browser-observation-1',
      undefined,
      true,
    )
    expect(clickAt).toHaveBeenCalledWith({
      x: 3,
      y: 4,
      observationId: 'browser-observation-1',
      ownerId: 'session-owner-1',
    }, undefined)
  })
})
