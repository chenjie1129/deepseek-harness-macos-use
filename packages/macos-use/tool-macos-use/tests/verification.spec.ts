import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  assertBrowserPostcondition,
  assertMacosPostcondition,
  verifyBrowserPostcondition,
  verifyMacosPostcondition,
} from '../src/verification.ts'

describe('GUI task host-side completion verification', () => {
  it('checks fresh browser URL/title/text and selector state', async () => {
    const pageState = vi.fn(async () => ({
      url: 'https://example.test/done',
      title: 'Checkout complete',
      text: 'Order 42 confirmed',
    }))
    const result = await verifyBrowserPostcondition({
      browserUse: { pageState },
    } as unknown as Context, {
      url_contains: '/done',
      title_equals: 'Checkout complete',
      text_contains: 'confirmed',
      selector: '#receipt',
    }, 'session-owner-1')
    expect(pageState).toHaveBeenCalledWith({
      selector: '#receipt',
      maxTextChars: 100_000,
      ownerId: 'session-owner-1',
    }, undefined)
    expect(result.status).toBe('verified')
    expect(result.checkedAt).toBeTypeOf('string')
    expect(result.checks).toHaveLength(4)
  })

  it('turns an unavailable browser criterion into verification_error, never completion', async () => {
    const result = await verifyBrowserPostcondition({
      browserUse: { pageState: async () => { throw new Error('selector missing') } },
    } as unknown as Context, { selector: '#missing' }, 'session-owner-1')
    expect(result).toMatchObject({ modelDone: true, status: 'verification_error', checks: [] })
  })

  it('checks frontmost process and exact window criteria from fresh native reads', async () => {
    const result = await verifyMacosPostcondition({
      macosUse: {
        completionState: async () => ({
          observedAt: new Date().toISOString(),
          frontmostProcess: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 41 },
          windows: [{
            id: 9,
            app: 'Notes',
            bundleId: 'com.apple.Notes',
            pid: 41,
            title: 'Release checklist',
            bounds: { x: 0, y: 0, width: 800, height: 600 },
            onScreen: true,
          }],
        }),
      },
    } as unknown as Context, {
      frontmost_app: 'notes',
      frontmost_pid: 41,
      window: { app: 'Notes', title_contains: 'checklist' },
    }, 'session-owner-1')
    expect(result.status).toBe('verified')
    expect(result.checks.every(check => check.passed)).toBe(true)
  })

  it('never stitches a foreground app and window from separate desktop moments', async () => {
    const screenshot = vi.fn(async () => ({
      pngBase64: 'unused', observationId: 'old', observedAt: new Date().toISOString(),
      frontmostProcess: { name: 'A', pid: 1 },
    }))
    const listWindows = vi.fn(async () => [{
      id: 2,
      app: 'B',
      pid: 2,
      title: 'Only while B is frontmost',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      onScreen: true,
    }])
    const completionState = vi.fn(async () => ({
      observedAt: new Date().toISOString(),
      frontmostProcess: { name: 'A', pid: 1 },
      windows: [],
    }))
    const result = await verifyMacosPostcondition({
      macosUse: { screenshot, listWindows, completionState },
    } as unknown as Context, {
      frontmost_app: 'A',
      window: { app: 'B', title: 'Only while B is frontmost' },
    }, 'session-owner-1')

    expect(result.status).toBe('postcondition_failed')
    expect(completionState).toHaveBeenCalledOnce()
    expect(screenshot).not.toHaveBeenCalled()
    expect(listWindows).not.toHaveBeenCalled()
  })

  it('rejects empty postcondition objects before an autonomous task starts', () => {
    expect(() => { assertBrowserPostcondition({}) }).toThrow(/at least one/)
    expect(() => { assertMacosPostcondition({ window: {} }) }).toThrow(/at least one/)
  })
})
