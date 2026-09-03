/** Process-local live progress for autonomous desktop/browser task calls. */

/** Raw encoded preview bound; base64/data-URL overhead stays below 132 KiB. */
export const LIVE_PREVIEW_MAX_BYTES = 96 * 1024
/** Preview pixels are for progress visibility, never coordinate grounding. */
export const LIVE_PREVIEW_MAX_DIMENSION = 768

/** Strictly bounded ephemeral image carried only over the process-local progress RPC. */
export interface LiveScreenshotPreview {
  dataUrl: string
  mediaType: 'image/jpeg'
  bytes: number
  width: number
  height: number
}

/** Autonomous tools whose running cards can consume live progress. */
export type GuiTaskToolName = 'computer_use_task' | 'browser_use_task'

/** One task step as exposed to the browser while the owning Tool call is still running. */
export interface GuiTaskProgressStep {
  /** One-based step number. */
  step: number
  /** Current step phase; later updates replace the same step. */
  phase: 'observed' | 'decided' | 'settled'
  /** JSON-encoded GUI action once the vision model has answered. */
  action?: string
  /** Execution outcome once the step has settled. */
  outcome?: string
  /** Strictly bounded process-local preview; never persisted in the session log. */
  preview?: LiveScreenshotPreview
}

/** Cumulative running-state snapshot returned by the optional Remote bridge. */
export interface GuiTaskProgressSnapshot {
  callId: string
  toolName: GuiTaskToolName
  revision: number
  active: boolean
  steps: readonly GuiTaskProgressStep[]
}

/** Nullable Remote result for a call that may not have a live process entry. */
export type GuiTaskProgressSnapshotResult = GuiTaskProgressSnapshot | null

interface ProgressEntry {
  readonly sessionId: string
  snapshot: GuiTaskProgressSnapshot
  touchedAt: number
}

const MAX_PROGRESS_ENTRIES = 64
const SETTLED_PROGRESS_TTL_MS = 5 * 60_000
/** Aggregate encoded preview bound for any one RPC snapshot. */
export const LIVE_PROGRESS_MAX_DATA_URL_CHARS = 512 * 1024
/** Maximum model-action text retained for one live step. */
export const LIVE_PROGRESS_ACTION_MAX_CHARS = 4096
/** Maximum outcome text retained for one live step. */
export const LIVE_PROGRESS_OUTCOME_MAX_CHARS = 2048
/** Aggregate non-image text retained across one live task snapshot. */
export const LIVE_PROGRESS_MAX_TEXT_CHARS = 64 * 1024

function keyOf(sessionId: string, callId: string): string {
  // Both ids are opaque provider/session strings and may contain any delimiter.
  // JSON's escaped tuple encoding is injective for two JavaScript strings.
  return JSON.stringify([sessionId, callId])
}

function cloneStep(step: GuiTaskProgressStep): GuiTaskProgressStep {
  return {
    step: step.step,
    phase: step.phase,
    ...step.action === undefined ? {} : { action: step.action },
    ...step.outcome === undefined ? {} : { outcome: step.outcome },
    ...step.preview === undefined ? {} : { preview: { ...step.preview } },
  }
}

function cloneSnapshot(snapshot: GuiTaskProgressSnapshot): GuiTaskProgressSnapshot {
  return {
    callId: snapshot.callId,
    toolName: snapshot.toolName,
    revision: snapshot.revision,
    active: snapshot.active,
    steps: snapshot.steps.map(cloneStep),
  }
}

function boundedText(value: string, limit: number): string {
  if (value.length <= limit) return value
  const marker = '… [truncated]'
  return `${value.slice(0, limit - marker.length)}${marker}`
}

/** Bounded progress registry; final Tool results remain the durable authority. */
export class GuiTaskProgressStore {
  private readonly entries = new Map<string, ProgressEntry>()

  /**
   * Start or replace one running call.
   * @param sessionId - trusted Agent/session owner identity.
   * @param callId - exact Tool call identity within the session.
   * @param toolName - autonomous GUI tool producing the progress.
   */
  begin(sessionId: string, callId: string, toolName: GuiTaskToolName): void {
    this.prune()
    const key = keyOf(sessionId, callId)
    this.entries.delete(key)
    this.entries.set(key, {
      sessionId,
      snapshot: { callId, toolName, revision: 1, active: true, steps: [] },
      touchedAt: Date.now(),
    })
    while (this.entries.size > MAX_PROGRESS_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /**
   * Replace the current representation of one one-based step.
   * @param sessionId - trusted Agent/session owner identity.
   * @param callId - exact active Tool call identity.
   * @param step - bounded phase update for one task step.
   */
  update(sessionId: string, callId: string, step: GuiTaskProgressStep): void {
    const key = keyOf(sessionId, callId)
    const entry = this.entries.get(key)
    if (entry === undefined || !entry.snapshot.active || step.step < 1 || !Number.isInteger(step.step)) return
    const steps = entry.snapshot.steps.map(cloneStep)
    const index = step.step - 1
    if (index > steps.length) return
    const previous = steps[index]
    const action = step.action === undefined
      ? previous?.action
      : boundedText(step.action, LIVE_PROGRESS_ACTION_MAX_CHARS)
    const outcome = step.outcome === undefined
      ? previous?.outcome
      : boundedText(step.outcome, LIVE_PROGRESS_OUTCOME_MAX_CHARS)
    const preview = step.preview === undefined ? previous?.preview : { ...step.preview }
    const next: GuiTaskProgressStep = {
      step: step.step,
      phase: step.phase,
      ...action === undefined ? {} : { action },
      ...outcome === undefined ? {} : { outcome },
      ...preview === undefined ? {} : { preview },
    }
    if (index === steps.length) steps.push(next)
    else steps[index] = next
    let previewChars = steps.reduce((sum, candidate) => sum + (candidate.preview?.dataUrl.length ?? 0), 0)
    for (const candidate of steps) {
      if (previewChars <= LIVE_PROGRESS_MAX_DATA_URL_CHARS) break
      if (candidate.preview === undefined) continue
      previewChars -= candidate.preview.dataUrl.length
      delete candidate.preview
    }
    let textChars = steps.reduce((sum, candidate) =>
      sum + (candidate.action?.length ?? 0) + (candidate.outcome?.length ?? 0), 0)
    for (const candidate of steps) {
      if (textChars <= LIVE_PROGRESS_MAX_TEXT_CHARS) break
      if (candidate.action !== undefined) {
        textChars -= candidate.action.length
        delete candidate.action
      }
      if (textChars <= LIVE_PROGRESS_MAX_TEXT_CHARS) break
      if (candidate.outcome !== undefined) {
        textChars -= candidate.outcome.length
        delete candidate.outcome
      }
    }
    entry.snapshot = {
      ...entry.snapshot,
      revision: entry.snapshot.revision + 1,
      steps,
    }
    entry.touchedAt = Date.now()
  }

  /**
   * Retain the last live snapshot briefly while the final `tool/result` reaches the browser.
   * @param sessionId - trusted Agent/session owner identity.
   * @param callId - exact active Tool call identity.
   */
  finish(sessionId: string, callId: string): void {
    const entry = this.entries.get(keyOf(sessionId, callId))
    if (entry === undefined || !entry.snapshot.active) return
    entry.snapshot = { ...entry.snapshot, revision: entry.snapshot.revision + 1, active: false }
    entry.touchedAt = Date.now()
  }

  /**
   * Read one detached snapshot; unknown calls return null.
   * @param sessionId - trusted Agent/session owner identity.
   * @param callId - exact Tool call identity.
   * @returns detached current snapshot, or null when the tuple is unknown.
   */
  snapshot(sessionId: string, callId: string): GuiTaskProgressSnapshot | null {
    this.prune()
    const entry = this.entries.get(keyOf(sessionId, callId))
    return entry === undefined ? null : cloneSnapshot(entry.snapshot)
  }

  /**
   * Read only a currently active call owned by this exact live Agent/session pair.
   * @param sessionId - trusted Agent/session owner identity.
   * @param callId - exact Tool call identity.
   * @returns detached active snapshot, or null when absent or already settled.
   */
  activeSnapshot(sessionId: string, callId: string): GuiTaskProgressSnapshot | null {
    const snapshot = this.snapshot(sessionId, callId)
    return snapshot?.active === true ? snapshot : null
  }

  /** Drop all process-local progress during plugin disposal. */
  clear(): void {
    this.entries.clear()
  }

  /**
   * Drop every live or settled preview owned by one disposed Agent/session.
   * @param sessionId - disposed Agent/session owner identity.
   */
  clearOwner(sessionId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId) this.entries.delete(key)
    }
  }

  private prune(): void {
    const cutoff = Date.now() - SETTLED_PROGRESS_TTL_MS
    for (const [key, entry] of this.entries) {
      if (!entry.snapshot.active && entry.touchedAt < cutoff) this.entries.delete(key)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLivePreview(value: unknown): value is LiveScreenshotPreview {
  if (!isRecord(value)) return false
  const dataUrl = value.dataUrl
  const payload = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/jpeg;base64,')
    ? dataUrl.slice('data:image/jpeg;base64,'.length)
    : undefined
  return value.mediaType === 'image/jpeg'
    && typeof dataUrl === 'string'
    && payload !== undefined
    && payload.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(payload)
    && dataUrl.length <= Math.ceil(LIVE_PREVIEW_MAX_BYTES * 4 / 3) + 64
    && typeof value.bytes === 'number' && Number.isInteger(value.bytes)
    && value.bytes >= 0 && value.bytes <= LIVE_PREVIEW_MAX_BYTES
    && typeof value.width === 'number' && Number.isInteger(value.width)
    && value.width >= 1 && value.width <= LIVE_PREVIEW_MAX_DIMENSION
    && typeof value.height === 'number' && Number.isInteger(value.height)
    && value.height >= 1 && value.height <= LIVE_PREVIEW_MAX_DIMENSION
}

function isProgressStep(value: unknown): value is GuiTaskProgressStep {
  if (!isRecord(value)) return false
  return typeof value.step === 'number' && Number.isInteger(value.step) && value.step >= 1
    && (value.phase === 'observed' || value.phase === 'decided' || value.phase === 'settled')
    && (value.action === undefined || (typeof value.action === 'string' && value.action.length <= LIVE_PROGRESS_ACTION_MAX_CHARS))
    && (value.outcome === undefined || (typeof value.outcome === 'string' && value.outcome.length <= LIVE_PROGRESS_OUTCOME_MAX_CHARS))
    && (value.preview === undefined || isLivePreview(value.preview))
}

/**
 * Runtime guard at the browser/Host boundary.
 * @param value - untrusted Remote result to validate.
 * @returns whether the value is a bounded GUI task progress snapshot.
 */
export function isGuiTaskProgressSnapshot(value: unknown): value is GuiTaskProgressSnapshot {
  if (!isRecord(value)) return false
  return typeof value.callId === 'string'
    && (value.toolName === 'computer_use_task' || value.toolName === 'browser_use_task')
    && typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 1
    && typeof value.active === 'boolean'
    && Array.isArray(value.steps) && value.steps.every(isProgressStep)
    && value.steps.reduce((sum, step) =>
      sum + (step.action?.length ?? 0) + (step.outcome?.length ?? 0), 0) <= LIVE_PROGRESS_MAX_TEXT_CHARS
}
