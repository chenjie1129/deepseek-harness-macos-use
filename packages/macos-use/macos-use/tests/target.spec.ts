import { describe, expect, it } from 'vitest'
import type { MacosWindow } from '../src/types.ts'
import {
  assertPointsInsideWindow,
  sameObservedWindow,
  sameProcessIdentity,
  selectWindowTarget,
} from '../src/target.ts'

const notes: MacosWindow = {
  id: 41,
  app: 'Notes',
  bundleId: 'com.apple.Notes',
  pid: 4,
  title: 'Draft',
  bounds: { x: 10, y: 20, width: 300, height: 200 },
  onScreen: true,
}

describe('exact window target selection', () => {
  it('treats a supplied id as authoritative and never falls back to app/title', () => {
    try {
      selectWindowTarget([notes], { id: 99, app: 'Notes', title: 'Draft' })
      throw new Error('expected exact id lookup to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'MACOS_USE_WINDOW_NOT_FOUND' })
    }
  })

  it('fails closed when app/title identifies more than one window', () => {
    try {
      selectWindowTarget([notes, { ...notes, id: 42 }], { app: 'Notes', title: 'Draft' })
      throw new Error('expected ambiguous lookup to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'MACOS_USE_WINDOW_AMBIGUOUS' })
    }
  })

  it('accepts only a complete fresh identity and geometry match', () => {
    expect(sameObservedWindow(notes, { ...notes })).toBe(true)
    expect(sameObservedWindow(notes, { ...notes, pid: 5 })).toBe(false)
    expect(sameObservedWindow(notes, { ...notes, bundleId: 'example.other' })).toBe(false)
    expect(sameObservedWindow(notes, { ...notes, title: 'Renamed' })).toBe(false)
    expect(sameObservedWindow(notes, { ...notes, bounds: { ...notes.bounds, x: 11 } })).toBe(false)
  })

  it('keeps non-Latin app identities distinct', () => {
    expect(selectWindowTarget([
      { ...notes, app: '微信' },
      { ...notes, id: 42, app: '密码' },
    ], { app: '微信' }).app).toBe('微信')
    expect(sameProcessIdentity(
      { name: '微信', bundleId: 'example.wechat', pid: 4 },
      { name: '密码', bundleId: 'example.wechat', pid: 4 },
    )).toBe(false)
  })

  it('rejects coordinate actions outside the observed window bounds', () => {
    expect(() => {
      assertPointsInsideWindow(notes, [{ x: 10, y: 20 }, { x: 309, y: 219 }])
    }).not.toThrow()
    expect(() => {
      assertPointsInsideWindow(notes, [{ x: 310, y: 219 }])
    })
      .toThrow(/escapes observed window/)
  })
})
