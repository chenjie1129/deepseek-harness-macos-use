/** Snapshot-scoped opaque element tokens for safe semantic targeting. */

import { randomUUID } from 'node:crypto'
import type {
  AccessibilityElement,
  MacosWindow,
  ObservedWindowTarget,
  WindowStateResult,
} from '@deepseek-ai/dsh-macos-use'

/** Model-facing semantic element with an opaque action token. */
export interface TokenizedElement extends AccessibilityElement {
  token: string
}

interface TargetPoint {
  element: AccessibilityElement
  reserved: boolean
}

interface Snapshot {
  id: string
  ownerId: string
  createdAt: number
  window: MacosWindow
  observationId?: string
  targets: ReadonlyMap<string, TargetPoint>
}

const ELEMENT_TOKEN_TTL_MS = 60_000
const MAX_ELEMENT_TOKEN_OWNERS = 64

/** One synchronously consumed token awaiting a fresh host-side revalidation. */
export interface ReservedElementToken {
  readonly windowId: number
  /** Return the original owner-bound exact-window observation for approval-focus restoration. */
  reactivationTarget(): ObservedWindowTarget
  revalidate(current: Pick<WindowStateResult, 'window' | 'observationId' | 'elements'>): {
    x: number
    y: number
    target: ObservedWindowTarget
  }
}

function sameWindowState(left: MacosWindow, right: MacosWindow): boolean {
  return left.id === right.id
    && left.pid === right.pid
    && left.app === right.app
    && left.bundleId === right.bundleId
    && left.title === right.title
    && left.onScreen === right.onScreen
    && left.bounds.x === right.bounds.x
    && left.bounds.y === right.bounds.y
    && left.bounds.width === right.bounds.width
    && left.bounds.height === right.bounds.height
}

function sameElementState(left: AccessibilityElement, right: AccessibilityElement): boolean {
  return left.role === right.role
    && left.subrole === right.subrole
    && left.name === right.name
    && left.value === right.value
    && left.description === right.description
    && left.enabled === right.enabled
    && left.bounds?.x === right.bounds?.x
    && left.bounds?.y === right.bounds?.y
    && left.bounds?.width === right.bounds?.width
    && left.bounds?.height === right.bounds?.height
}

function copyWindow(window: MacosWindow): MacosWindow {
  return { ...window, bounds: { ...window.bounds } }
}

/** Keeps only the latest snapshot for each agent; a newer observation invalidates all older tokens. */
export class ElementTokenStore {
  private readonly byOwner = new Map<string, Snapshot>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Invalidate an agent's current semantic snapshot.
   * @param ownerId - trusted owning Agent identity.
   */
  invalidate(ownerId: string): void {
    this.byOwner.delete(ownerId)
  }

  /**
   * Create the newest token set for one exact window.
   * @param ownerId - trusted owning Agent identity.
   * @param window - exact source window and geometry.
   * @param elements - semantic elements to filter and tokenize.
   * @param observationId - owner-bound exact-window observation captured with the semantic snapshot.
   * @returns snapshot id and only elements carrying usable point targets.
   */
  create(
    ownerId: string,
    window: MacosWindow,
    elements: readonly AccessibilityElement[],
    observationId?: string,
  ): { snapshotId: string; elements: readonly TokenizedElement[] } {
    if (ownerId.trim() === '') throw new Error('element token owner identity is required')
    this.prune()
    const id = randomUUID()
    const targets = new Map<string, TargetPoint>()
    const tokenized: TokenizedElement[] = []
    for (const element of elements) {
      const bounds = element.bounds
      if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) continue
      const token = randomUUID()
      targets.set(token, { element: { ...element, bounds: { ...bounds } }, reserved: false })
      tokenized.push({ ...element, token })
    }
    const snapshot = {
      id,
      ownerId,
      createdAt: this.now(),
      window: copyWindow(window),
      targets,
      ...observationId === undefined ? {} : { observationId },
    }
    this.byOwner.delete(ownerId)
    this.byOwner.set(ownerId, snapshot)
    while (this.byOwner.size > MAX_ELEMENT_TOKEN_OWNERS) {
      const oldestOwner = this.byOwner.keys().next().value
      if (oldestOwner === undefined) break
      this.byOwner.delete(oldestOwner)
    }
    return { snapshotId: id, elements: tokenized }
  }

  /**
   * Atomically consume one token before any asynchronous re-snapshot. A replay
   * loses synchronously, so two concurrent calls cannot both reach native dispatch.
   * @param ownerId - trusted Agent owner identity that created the snapshot.
   * @param token - opaque one-action element token to reserve.
   * @returns reservation that revalidates the exact window and element before dispatch.
   */
  reserve(ownerId: string, token: string): ReservedElementToken {
    this.prune()
    const snapshot = this.byOwner.get(ownerId)
    if (snapshot === undefined) throw new Error('element token is stale; call computer_get_window_state again')
    if (snapshot.ownerId !== ownerId) throw new Error('element token does not belong to this agent')
    const stored = snapshot.targets.get(token)
    if (stored === undefined || stored.reserved) {
      throw new Error('element token is stale, already used, or does not belong to this agent')
    }
    stored.reserved = true
    return {
      windowId: snapshot.window.id,
      reactivationTarget() {
        if (snapshot.observationId === undefined) {
          throw new Error('element token lacks its original window observation')
        }
        return { observationId: snapshot.observationId, window: copyWindow(snapshot.window) }
      },
      revalidate(current) {
        if (!sameWindowState(snapshot.window, current.window)) {
          throw new Error('element token is stale; its exact window identity or geometry changed')
        }
        const matches = current.elements.filter(candidate => sameElementState(stored.element, candidate))
        if (matches.length !== 1) {
          throw new Error('element token is stale; the exact Accessibility element changed or became ambiguous')
        }
        const bounds = matches[0]?.bounds
        if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) {
          throw new Error('element token is stale; the exact Accessibility element has no usable bounds')
        }
        return {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
          target: { observationId: current.observationId, window: current.window },
        }
      },
    }
  }

  private prune(): void {
    const cutoff = this.now() - ELEMENT_TOKEN_TTL_MS
    for (const [ownerId, snapshot] of this.byOwner) {
      if (snapshot.createdAt < cutoff) this.byOwner.delete(ownerId)
    }
  }

}
