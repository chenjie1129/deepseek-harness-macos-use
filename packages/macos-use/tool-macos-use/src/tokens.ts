/** Snapshot-scoped opaque element tokens for safe semantic targeting. */

import { randomUUID } from 'node:crypto'
import type { AccessibilityElement, MacosWindow } from '@deepseek-ai/dsh-macos-use'

/** Model-facing semantic element with an opaque action token. */
export interface TokenizedElement extends AccessibilityElement {
  token: string
}

interface TargetPoint {
  x: number
  y: number
}

interface Snapshot {
  id: string
  window: MacosWindow
  targets: ReadonlyMap<string, TargetPoint>
}

function sameWindowState(left: MacosWindow, right: MacosWindow): boolean {
  return left.id === right.id
    && left.bounds.x === right.bounds.x
    && left.bounds.y === right.bounds.y
    && left.bounds.width === right.bounds.width
    && left.bounds.height === right.bounds.height
}

/** Keeps only the latest snapshot for each agent; a newer observation invalidates all older tokens. */
export class ElementTokenStore {
  private readonly byAgent = new WeakMap<object, Snapshot>()
  private global: Snapshot | undefined

  /**
   * Invalidate an agent's current semantic snapshot.
   * @param agent - owning agent identity, or undefined for non-agent executions.
   */
  invalidate(agent: object | undefined): void {
    if (agent === undefined) this.global = undefined
    else this.byAgent.delete(agent)
  }

  /**
   * Create the newest token set for one exact window.
   * @param agent - owning agent identity, or undefined for non-agent executions.
   * @param window - exact source window and geometry.
   * @param elements - semantic elements to filter and tokenize.
   * @returns snapshot id and only elements carrying usable point targets.
   */
  create(
    agent: object | undefined,
    window: MacosWindow,
    elements: readonly AccessibilityElement[],
  ): { snapshotId: string; elements: readonly TokenizedElement[] } {
    const id = randomUUID()
    const targets = new Map<string, TargetPoint>()
    const tokenized: TokenizedElement[] = []
    for (const element of elements) {
      const bounds = element.bounds
      if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) continue
      const token = randomUUID()
      targets.set(token, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
      tokenized.push({ ...element, token })
    }
    const snapshot = { id, window, targets }
    if (agent === undefined) this.global = snapshot
    else this.byAgent.set(agent, snapshot)
    return { snapshotId: id, elements: tokenized }
  }

  /**
   * Resolve a token only when it belongs to the newest snapshot and the window has not moved or resized.
   * @param agent - owning agent identity, or undefined for non-agent executions.
   * @param token - opaque token issued by the newest snapshot.
   * @param currentWindow - freshly resolved source-window geometry.
   * @returns current safe target point.
   */
  resolve(agent: object | undefined, token: string, currentWindow: MacosWindow): TargetPoint {
    const snapshot = agent === undefined ? this.global : this.byAgent.get(agent)
    if (snapshot === undefined || !sameWindowState(snapshot.window, currentWindow)) {
      throw new Error('element token is stale; call computer_get_window_state again')
    }
    const point = snapshot.targets.get(token)
    if (point === undefined) throw new Error('element token is stale or does not belong to this agent')
    return point
  }

  /**
   * Return the window id the latest snapshot was captured from.
   * @param agent - owning agent identity, or undefined for non-agent executions.
   * @returns latest exact window id, or undefined without a current snapshot.
   */
  windowId(agent: object | undefined): number | undefined {
    return (agent === undefined ? this.global : this.byAgent.get(agent))?.window.id
  }
}
