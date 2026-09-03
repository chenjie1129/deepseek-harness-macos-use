/** Bounded, expiring, one-action window observation identities. */

import { randomUUID } from 'node:crypto'
import { sameObservedWindow, sameProcessIdentity } from './target.ts'
import { MacosUseError } from './types.ts'
import type {
  FrontmostProcess,
  MacosDisplay,
  MacosWindow,
  ObservedWindowTarget,
  ScreenPixelSize,
} from './types.ts'

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ENTRIES = 64

interface StoredWindowObservation {
  window: MacosWindow
  ownerId: string
  createdAt: number
  epoch: number
  rasterDigest?: string
}

/** Detached proof carried from an exact-window capture into one control or focus restoration. */
export interface WindowObservationProof {
  window: MacosWindow
  rasterDigest?: string
}

/** Process and selected frontmost window captured by one display-coordinate observation. */
export interface ScreenTargetState {
  process: FrontmostProcess
  window?: MacosWindow
  display: MacosDisplay
}

/** Display-coordinate target plus the synthesized canvas dimensions required for pixel-to-point mapping. */
export interface ScreenObservationTarget extends ScreenTargetState {
  pixels: ScreenPixelSize
  /** SHA-256 of decoded exact-window pixels; never exposed to the model. */
  rasterDigest?: string
}

interface StoredScreenObservation extends ScreenObservationTarget {
  ownerId: string
  createdAt: number
  epoch: number
}

function cloneWindow(window: MacosWindow): MacosWindow {
  return { ...window, bounds: { ...window.bounds } }
}

function cloneProcess(process: FrontmostProcess): FrontmostProcess {
  return { ...process }
}

function cloneDisplay(display: MacosDisplay): MacosDisplay {
  return { ...display, bounds: { ...display.bounds } }
}

function cloneScreenTarget(target: ScreenObservationTarget): ScreenObservationTarget {
  return {
    process: cloneProcess(target.process),
    display: cloneDisplay(target.display),
    pixels: { ...target.pixels },
    ...target.rasterDigest === undefined ? {} : { rasterDigest: target.rasterDigest },
    ...target.window === undefined ? {} : { window: cloneWindow(target.window) },
  }
}

function cloneWindowProof(observation: StoredWindowObservation): WindowObservationProof {
  return {
    window: cloneWindow(observation.window),
    ...observation.rasterDigest === undefined ? {} : { rasterDigest: observation.rasterDigest },
  }
}

/**
 * Compare the foreground process, selected window, and display captured at two instants.
 * @param observed - target identity bound into the original screenshot observation.
 * @param current - freshly queried target identity to compare with the observation.
 * @returns whether every process, display, and optional window identity field still matches.
 */
export function sameScreenObservationTarget(
  observed: ScreenTargetState,
  current: ScreenTargetState,
): boolean {
  if (!sameProcessIdentity(observed.process, current.process)
      || observed.display.id !== current.display.id
      || observed.display.bounds.x !== current.display.bounds.x
      || observed.display.bounds.y !== current.display.bounds.y
      || observed.display.bounds.width !== current.display.bounds.width
      || observed.display.bounds.height !== current.display.bounds.height) return false
  return observed.window === undefined
    ? current.window === undefined
    : current.window !== undefined && sameObservedWindow(observed.window, current.window)
}

/** Keeps observations opaque, bounded, expiring, and single-use for control. */
export class WindowObservationStore {
  private readonly observations = new Map<string, StoredWindowObservation>()
  private readonly consumed = new Map<string, StoredWindowObservation>()

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  /** Revoke every pending and receipt-stage window observation. */
  clear(): void {
    this.observations.clear()
    this.consumed.clear()
  }

  /**
   * Revoke observations made before or during a native mutation while retaining
   * only the receipt proof for the mutation that is currently being dispatched.
   * @param preserveReceiptObservationId - consumed token whose own action may still request a receipt.
   */
  invalidateForMutation(preserveReceiptObservationId?: string): void {
    this.observations.clear()
    for (const id of this.consumed.keys()) {
      if (id !== preserveReceiptObservationId) this.consumed.delete(id)
    }
  }

  /**
   * Revoke every pending and receipt-stage observation for one exact owner.
   * @param ownerId - byte-exact Agent/session identity whose observations are retired.
   */
  clearOwner(ownerId: string): void {
    for (const [id, observation] of this.observations) {
      if (observation.ownerId === ownerId) this.observations.delete(id)
    }
    for (const [id, observation] of this.consumed) {
      if (observation.ownerId === ownerId) this.consumed.delete(id)
    }
  }

  /**
   * Replace one owner's pending window observation with a fresh opaque token.
   * @param window - exact discovered window snapshot the token will bind.
   * @param ownerId - byte-exact Agent/session identity allowed to use the token.
   * @param now - creation time used for expiry and the public timestamp.
   * @param epoch - service-wide desktop mutation epoch at capture time.
   * @param rasterDigest - private digest of the decoded exact-window pixels, when captured.
   * @returns the new opaque observation id and its ISO timestamp.
   */
  remember(
    window: MacosWindow,
    ownerId: string,
    now = Date.now(),
    epoch = 0,
    rasterDigest?: string,
  ): { observationId: string; observedAt: string } {
    this.prune(now)
    for (const [id, observation] of this.observations) {
      if (observation.ownerId === ownerId) this.observations.delete(id)
    }
    const observationId = randomUUID()
    this.observations.set(observationId, {
      window: cloneWindow(window),
      ownerId,
      createdAt: now,
      epoch,
      ...rasterDigest === undefined ? {} : { rasterDigest },
    })
    while (this.observations.size > this.maxEntries) {
      const oldest = this.observations.keys().next().value
      if (oldest === undefined) break
      this.observations.delete(oldest)
    }
    return { observationId, observedAt: new Date(now).toISOString() }
  }

  /**
   * Validate a pending token without consuming it.
   * @param target - caller-presented token plus the exact window it claims.
   * @param ownerId - byte-exact Agent/session identity presenting the token.
   * @param now - comparison time used to enforce the observation TTL.
   * @param epoch - current service-wide desktop mutation epoch.
   * @returns a detached copy of the originally observed window.
   */
  validate(target: ObservedWindowTarget, ownerId: string, now = Date.now(), epoch = 0): MacosWindow {
    const stored = this.observations.get(target.observationId)
    if (stored === undefined || stored.ownerId !== ownerId || now - stored.createdAt > this.ttlMs
        || stored.epoch !== epoch
        || !sameObservedWindow(stored.window, target.window)) {
      this.observations.delete(target.observationId)
      throw new MacosUseError('window observation is stale or unknown', 'MACOS_USE_TARGET_STALE')
    }
    return cloneWindow(stored.window)
  }

  /**
   * Atomically consume a pending token and retain one receipt-stage proof.
   * @param target - caller-presented token plus the exact window it claims.
   * @param ownerId - byte-exact Agent/session identity reserving the target.
   * @param now - comparison time used to enforce the observation TTL.
   * @param epoch - current service-wide desktop mutation epoch.
   * @returns a detached copy of the reserved window.
   */
  reserve(target: ObservedWindowTarget, ownerId: string, now = Date.now(), epoch = 0): MacosWindow {
    return this.reserveProof(target, ownerId, now, epoch).window
  }

  /**
   * Atomically reserve a pending window observation together with its private
   * raster proof, retaining receipt-stage identity for the action that follows.
   * @param target - caller-presented opaque observation and exact window.
   * @param ownerId - byte-exact owner presenting the token.
   * @param now - comparison time used for expiry.
   * @param epoch - current service-wide desktop mutation epoch.
   * @returns detached window and optional decoded-raster digest.
   */
  reserveProof(
    target: ObservedWindowTarget,
    ownerId: string,
    now = Date.now(),
    epoch = 0,
  ): WindowObservationProof {
    this.validate(target, ownerId, now, epoch)
    const stored = this.observations.get(target.observationId)
    if (stored === undefined) {
      throw new MacosUseError('window observation is stale or unknown', 'MACOS_USE_TARGET_STALE')
    }
    this.observations.delete(target.observationId)
    this.consumed.set(target.observationId, {
      ...stored,
      window: cloneWindow(stored.window),
      createdAt: now,
    })
    this.trim(this.consumed)
    return cloneWindowProof(stored)
  }

  /**
   * Consume a pending exact-window token for post-approval focus restoration
   * without minting action-receipt authority.
   * @param target - caller-presented opaque observation and exact window.
   * @param ownerId - byte-exact owner presenting the token.
   * @param now - comparison time used for expiry.
   * @param epoch - current service-wide desktop mutation epoch.
   * @returns detached window and private raster proof.
   */
  takeForReactivation(
    target: ObservedWindowTarget,
    ownerId: string,
    now = Date.now(),
    epoch = 0,
  ): WindowObservationProof {
    this.validate(target, ownerId, now, epoch)
    const stored = this.observations.get(target.observationId)
    if (stored === undefined) {
      throw new MacosUseError('window observation is stale or unknown', 'MACOS_USE_TARGET_STALE')
    }
    this.observations.delete(target.observationId)
    return cloneWindowProof(stored)
  }

  /**
   * Consume proof that this owner actually reserved the exact target for an action.
   * @param target - caller-presented token plus the exact acted-on window.
   * @param ownerId - byte-exact Agent/session identity that performed the action.
   * @param now - comparison time used to enforce the receipt-stage TTL.
   * @returns a detached copy of the reserved window.
   */
  reserveReceipt(target: ObservedWindowTarget, ownerId: string, now = Date.now()): MacosWindow {
    const stored = this.consumed.get(target.observationId)
    if (stored === undefined || stored.ownerId !== ownerId || now - stored.createdAt > this.ttlMs
        || !sameObservedWindow(stored.window, target.window)) {
      throw new MacosUseError('action receipt target is stale or belongs to another owner', 'MACOS_USE_TARGET_STALE')
    }
    this.consumed.delete(target.observationId)
    return cloneWindow(stored.window)
  }

  /**
   * Revoke one pending observation without creating receipt-stage proof.
   * @param observationId - opaque observation id to remove when present.
   */
  consume(observationId: string): void {
    this.observations.delete(observationId)
  }

  private prune(now: number): void {
    for (const [id, observation] of this.observations) {
      if (now - observation.createdAt > this.ttlMs) this.observations.delete(id)
    }
    for (const [id, observation] of this.consumed) {
      if (now - observation.createdAt > this.ttlMs) this.consumed.delete(id)
    }
  }

  private trim(values: Map<string, StoredWindowObservation>): void {
    while (values.size > this.maxEntries) {
      const oldest = values.keys().next().value
      if (oldest === undefined) break
      values.delete(oldest)
    }
  }
}

/** Keeps display-coordinate foreground targets opaque, bounded, expiring, and single-use. */
export class ScreenObservationStore {
  private readonly observations = new Map<string, StoredScreenObservation>()

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  /** Revoke every pending display-coordinate observation. */
  clear(): void {
    this.observations.clear()
  }

  /**
   * Revoke every display-coordinate observation for one exact owner.
   * @param ownerId - byte-exact Agent/session identity whose observations are retired.
   */
  clearOwner(ownerId: string): void {
    for (const [id, observation] of this.observations) {
      if (observation.ownerId === ownerId) this.observations.delete(id)
    }
  }

  /**
   * Replace one owner's display-coordinate observation with a fresh opaque token.
   * @param target - foreground process, optional window, display, and PNG dimensions to bind.
   * @param ownerId - byte-exact Agent/session identity allowed to use the token.
   * @param now - creation time used for expiry and the public timestamp.
   * @param epoch - service-wide desktop mutation epoch at capture time.
   * @returns the new opaque observation id and its ISO timestamp.
   */
  remember(
    target: ScreenObservationTarget,
    ownerId: string,
    now = Date.now(),
    epoch = 0,
  ): { observationId: string; observedAt: string } {
    this.prune(now)
    for (const [id, observation] of this.observations) {
      if (observation.ownerId === ownerId) this.observations.delete(id)
    }
    const observationId = randomUUID()
    this.observations.set(observationId, { ...cloneScreenTarget(target), ownerId, createdAt: now, epoch })
    while (this.observations.size > this.maxEntries) {
      const oldest = this.observations.keys().next().value
      if (oldest === undefined) break
      this.observations.delete(oldest)
    }
    return { observationId, observedAt: new Date(now).toISOString() }
  }

  /**
   * Validate a pending screen token against a fresh target snapshot without consuming it.
   * @param observationId - opaque screen observation id presented by the caller.
   * @param ownerId - byte-exact Agent/session identity presenting the token.
   * @param current - freshly queried foreground process, window, and display state.
   * @param now - comparison time used to enforce the observation TTL.
   * @param epoch - current service-wide desktop mutation epoch.
   * @returns a detached copy of the originally observed screen target and pixel geometry.
   */
  validate(
    observationId: string,
    ownerId: string,
    current: ScreenTargetState,
    now = Date.now(),
    epoch = 0,
  ): ScreenObservationTarget {
    const stored = this.observations.get(observationId)
    if (stored === undefined || stored.ownerId !== ownerId || now - stored.createdAt > this.ttlMs
        || stored.epoch !== epoch
        || !sameScreenObservationTarget(stored, current)) {
      this.observations.delete(observationId)
      throw new MacosUseError('screen observation is stale or unknown', 'MACOS_USE_TARGET_STALE')
    }
    return cloneScreenTarget(stored)
  }

  /**
   * Atomically consume a pending display-coordinate observation.
   * @param observationId - opaque display-coordinate observation id presented by the caller.
   * @param ownerId - byte-exact Agent/session identity reserving the observation.
   * @param now - comparison time used to enforce the observation TTL.
   * @param epoch - current service-wide desktop mutation epoch.
   * @returns a detached copy of the observed screen target and pixel geometry.
   */
  reserve(observationId: string, ownerId: string, now = Date.now(), epoch = 0): ScreenObservationTarget {
    const stored = this.observations.get(observationId)
    if (stored === undefined || stored.ownerId !== ownerId || now - stored.createdAt > this.ttlMs
        || stored.epoch !== epoch) {
      this.observations.delete(observationId)
      throw new MacosUseError('screen observation is stale or unknown', 'MACOS_USE_TARGET_STALE')
    }
    this.observations.delete(observationId)
    return cloneScreenTarget(stored)
  }

  /**
   * Revoke one pending display-coordinate observation when present.
   * @param observationId - opaque screen observation id to remove.
   */
  consume(observationId: string): void {
    this.observations.delete(observationId)
  }

  private prune(now: number): void {
    for (const [id, observation] of this.observations) {
      if (now - observation.createdAt > this.ttlMs) this.observations.delete(id)
    }
  }
}
