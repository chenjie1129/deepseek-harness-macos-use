/** Pure geometry helpers for race-safe, display-scoped screenshot redaction. */

import type { MacosWindow, ScreenBounds, ScreenCaptureGeometry } from './types.ts'

/** Integer capture-pixel rectangle to cover before a screenshot leaves the host. */
export interface PixelRectangle {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert one capture-pixel coordinate to global macOS point space.
 * @param geometry - captured pixel dimensions and corresponding global point rectangle.
 * @param point - zero-based coordinate within the captured image.
 * @returns the mapped global point, or `undefined` when geometry or coordinates are invalid.
 */
export function capturePixelToGlobalPoint(
  geometry: ScreenCaptureGeometry,
  point: { x: number; y: number },
): { x: number; y: number } | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0
      || point.x >= geometry.capturePixels.width || point.y >= geometry.capturePixels.height
      || geometry.capturePixels.width <= 0 || geometry.capturePixels.height <= 0
      || geometry.globalPointRect.width <= 0 || geometry.globalPointRect.height <= 0) return undefined
  return {
    x: geometry.globalPointRect.x
      + point.x * geometry.globalPointRect.width / geometry.capturePixels.width,
    y: geometry.globalPointRect.y
      + point.y * geometry.globalPointRect.height / geometry.capturePixels.height,
  }
}

/**
 * Compare the point-space bounds/topology of one captured display.
 * @param left - display bounds observed before capture.
 * @param right - display bounds observed after capture.
 * @returns whether every origin and size coordinate is identical.
 */
export function sameScreenBounds(left: ScreenBounds, right: ScreenBounds): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height
}

/**
 * Test whether two point-space rectangles overlap with positive area.
 * @param left - first point-space rectangle.
 * @param right - second point-space rectangle.
 * @returns whether the rectangles have a non-empty intersection.
 */
export function screenBoundsIntersect(left: ScreenBounds, right: ScreenBounds): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y
}

/**
 * Test whether an inner point-space rectangle is fully captured by an outer display.
 * @param outer - captured display bounds.
 * @param inner - candidate window bounds.
 * @returns whether the positive-size inner rectangle lies wholly within the outer rectangle.
 */
export function screenBoundsContain(outer: ScreenBounds, inner: ScreenBounds): boolean {
  return inner.width > 0 && inner.height > 0
    && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

function intersection(left: ScreenBounds, right: ScreenBounds): ScreenBounds | undefined {
  if (!screenBoundsIntersect(left, right)) return undefined
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height)
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}

function pixelRectangle(
  bounds: ScreenBounds,
  display: ScreenBounds,
  pixels: { width: number; height: number },
): PixelRectangle | undefined {
  const clipped = intersection(bounds, display)
  if (clipped === undefined) return undefined
  const scaleX = pixels.width / display.width
  const scaleY = pixels.height / display.height
  const x = Math.max(0, Math.floor((clipped.x - display.x) * scaleX))
  const y = Math.max(0, Math.floor((clipped.y - display.y) * scaleY))
  const right = Math.min(pixels.width, Math.ceil((clipped.x + clipped.width - display.x) * scaleX))
  const bottom = Math.min(pixels.height, Math.ceil((clipped.y + clipped.height - display.y) * scaleY))
  if (right <= x || bottom <= y) return undefined
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Map the union of restricted windows seen before and after capture to exact
 * pixel rectangles. Keeping both positions prevents a moved/closed window's
 * old pixels from escaping the mask.
 * @param before - window inventory captured immediately before the screenshot.
 * @param after - window inventory captured immediately after the screenshot.
 * @param display - global point-space bounds represented by the image.
 * @param pixels - actual captured-image dimensions.
 * @param shouldMask - policy predicate selecting windows whose pixels cannot leave the host.
 * @returns unique, display-clipped integer pixel rectangles that must be redacted.
 */
export function collectRedactionRectangles(
  before: readonly MacosWindow[],
  after: readonly MacosWindow[],
  display: ScreenBounds,
  pixels: { width: number; height: number },
  shouldMask: (window: MacosWindow) => boolean,
): readonly PixelRectangle[] {
  const rectangles = [...before, ...after]
    .filter(window => window.onScreen && shouldMask(window))
    .map(window => pixelRectangle(window.bounds, display, pixels))
    .filter((rectangle): rectangle is PixelRectangle => rectangle !== undefined)
  const unique = new Map<string, PixelRectangle>()
  for (const rectangle of rectangles) {
    unique.set(`${String(rectangle.x)}:${String(rectangle.y)}:${String(rectangle.width)}:${String(rectangle.height)}`, rectangle)
  }
  return [...unique.values()]
}
