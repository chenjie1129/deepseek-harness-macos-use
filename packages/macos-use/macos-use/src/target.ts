/** Pure target-selection and freshness checks for exact macOS windows. */

import { MacosUseError } from './types.ts'
import type { FrontmostProcess, MacosWindow, ScreenBounds, WindowTarget } from './types.ts'
import { normalizedAppName } from './policy.ts'

function normalizedBundleId(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('en-US')
}

/**
 * Compare two process snapshots as one exact running application identity.
 * @param observed - process identity bound into an earlier observation.
 * @param current - freshly queried process identity.
 * @returns whether pid, normalized display name, and normalized bundle identifier match.
 */
export function sameProcessIdentity(observed: FrontmostProcess, current: FrontmostProcess): boolean {
  return observed.pid === current.pid
    && normalizedAppName(observed.name) === normalizedAppName(current.name)
    && normalizedBundleId(observed.bundleId) === normalizedBundleId(current.bundleId)
}

/**
 * Compare a fresh window with the exact observed target.
 * @param observed - window identity and geometry bound into an observation.
 * @param current - freshly queried window identity and geometry.
 * @returns whether every target, visibility, title, and bounds field still matches.
 */
export function sameObservedWindow(observed: MacosWindow, current: MacosWindow): boolean {
  return observed.id === current.id
    && observed.pid === current.pid
    && normalizedAppName(observed.app) === normalizedAppName(current.app)
    && normalizedBundleId(observed.bundleId) === normalizedBundleId(current.bundleId)
    && observed.title === current.title
    && observed.onScreen === current.onScreen
    && observed.bounds.x === current.bounds.x
    && observed.bounds.y === current.bounds.y
    && observed.bounds.width === current.bounds.width
    && observed.bounds.height === current.bounds.height
}

/**
 * Apply half-open point containment to an observed window rectangle.
 * @param bounds - window bounds in global point coordinates.
 * @param point - action coordinate to test.
 * @returns whether the point is inside the rectangle including top/left but excluding bottom/right.
 */
export function boundsContainPoint(bounds: ScreenBounds, point: { x: number; y: number }): boolean {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width
    && point.y >= bounds.y && point.y < bounds.y + bounds.height
}

/**
 * Fail closed when any action coordinate is outside the exact observed window.
 * @param window - exact observed window that constrains the action.
 * @param points - every start, end, or click coordinate the action will use.
 */
export function assertPointsInsideWindow(
  window: MacosWindow,
  points: readonly { x: number; y: number }[],
): void {
  if (points.every(point => boundsContainPoint(window.bounds, point))) return
  throw new MacosUseError(
    `coordinate action escapes observed window ${String(window.id)}`,
    'MACOS_USE_TARGET_STALE',
  )
}

/**
 * Resolve exactly one window. An id is authoritative and never falls back to
 * app/title matching; an ambiguous app/title selector fails closed.
 * @param windows - fresh visible-window inventory.
 * @param target - exact id or application/title selector supplied by the caller.
 * @returns the sole window selected without fallback or ambiguity.
 */
export function selectWindowTarget(
  windows: readonly MacosWindow[],
  target: WindowTarget,
): MacosWindow {
  if (target.id !== undefined) {
    const window = windows.find(candidate => candidate.id === target.id)
    if (window !== undefined) return window
    throw new MacosUseError(
      `window id ${String(target.id)} is no longer available`,
      'MACOS_USE_WINDOW_NOT_FOUND',
    )
  }
  if (target.app === undefined) {
    throw new MacosUseError(
      'an exact window id or application selector is required',
      'MACOS_USE_WINDOW_NOT_FOUND',
    )
  }
  const app = normalizedAppName(target.app)
  const matches = windows.filter(candidate => normalizedAppName(candidate.app) === app
    && (target.title === undefined || candidate.title === target.title))
  if (matches.length === 0) {
    throw new MacosUseError('requested window is not currently available', 'MACOS_USE_WINDOW_NOT_FOUND')
  }
  if (matches.length > 1) {
    throw new MacosUseError(
      `window selector is ambiguous for ${JSON.stringify(target.app)}${target.title === undefined ? '' : ` / ${JSON.stringify(target.title)}`}; use window_id`,
      'MACOS_USE_WINDOW_AMBIGUOUS',
    )
  }
  return matches[0] as MacosWindow
}
