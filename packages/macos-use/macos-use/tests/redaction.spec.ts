import { describe, expect, it } from 'vitest'
import {
  capturePixelToGlobalPoint,
  collectRedactionRectangles,
  sameScreenBounds,
  screenBoundsContain,
} from '../src/redaction.ts'
import type { MacosWindow } from '../src/types.ts'

const restricted: MacosWindow = {
  id: 41,
  app: 'Passwords',
  bundleId: 'com.apple.Passwords',
  layer: 0,
  pid: 4,
  title: 'Passwords',
  bounds: { x: 10, y: 10, width: 20, height: 20 },
  onScreen: true,
}

describe('race-safe screenshot redaction geometry', () => {
  it('masks the union of a restricted window position before and after capture', () => {
    const rectangles = collectRedactionRectangles(
      [restricted],
      [{ ...restricted, bounds: { ...restricted.bounds, x: 30 } }],
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 200, height: 200 },
      () => true,
    )
    expect(rectangles).toEqual([
      { x: 20, y: 20, width: 40, height: 40 },
      { x: 60, y: 20, width: 40, height: 40 },
    ])
  })

  it('includes nonzero overlays and desktop layers, clips partial windows, and ignores other displays', () => {
    const rectangles = collectRedactionRectangles(
      [
        { ...restricted, layer: 25, bounds: { x: -10, y: 0, width: 20, height: 10 } },
        { ...restricted, id: 42, bounds: { x: 110, y: 0, width: 20, height: 10 } },
        { ...restricted, id: 43, layer: -2_147_483_648, bounds: { x: 40, y: 40, width: 10, height: 10 } },
      ],
      [],
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 200, height: 200 },
      () => true,
    )
    expect(rectangles).toEqual([
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 80, y: 80, width: 20, height: 20 },
    ])
  })

  it('detects main-display topology changes', () => {
    const display = { x: 0, y: 0, width: 100, height: 100 }
    expect(sameScreenBounds(display, { ...display })).toBe(true)
    expect(sameScreenBounds(display, { ...display, width: 101 })).toBe(false)
  })

  it('maps 1x and 2x capture pixels into global point space', () => {
    expect(capturePixelToGlobalPoint({
      displayId: 1,
      globalPointRect: { x: 0, y: 0, width: 100, height: 80 },
      capturePixels: { width: 100, height: 80 },
    }, { x: 25, y: 40 })).toEqual({ x: 25, y: 40 })
    expect(capturePixelToGlobalPoint({
      displayId: 1,
      globalPointRect: { x: 0, y: 0, width: 100, height: 80 },
      capturePixels: { width: 200, height: 160 },
    }, { x: 50, y: 80 })).toEqual({ x: 25, y: 40 })
  })

  it('maps a negative-origin display and rejects pixels outside the capture', () => {
    const geometry = {
      displayId: 2,
      globalPointRect: { x: -1440, y: -200, width: 1440, height: 900 },
      capturePixels: { width: 2880, height: 1800 },
    }
    expect(capturePixelToGlobalPoint(geometry, { x: 1440, y: 900 }))
      .toEqual({ x: -720, y: 250 })
    expect(capturePixelToGlobalPoint(geometry, { x: 2880, y: 0 })).toBeUndefined()
  })

  it('requires the complete foreground window to fit the captured display', () => {
    const main = { x: 0, y: 0, width: 100, height: 100 }
    expect(screenBoundsContain(main, { x: 10, y: 10, width: 80, height: 80 })).toBe(true)
    expect(screenBoundsContain(main, { x: 90, y: 10, width: 20, height: 20 })).toBe(false)
    expect(screenBoundsContain(main, { x: -100, y: 10, width: 80, height: 80 })).toBe(false)
  })
})
