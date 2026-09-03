/**
 * The shared vision-grounded task loop backing `computer_use_task` and `browser_use_task`: screenshot ->
 * `ctx.guiModel.nextAction` -> execute -> repeat, until the model answers `done`, an unrecoverable error occurs,
 * or `maxSteps` is exhausted. Parameterized over a small {@link TaskExecutor} so the macOS and browser surfaces
 * share one loop instead of two near-duplicate ones.
 * @module @deepseek-ai/dsh-tool-macos-use/loop
 */

import type { GuiAction, GuiActionLogEntry } from '@deepseek-ai/dsh-gui-model'
import type { GuiModelService } from '@deepseek-ai/dsh-gui-model'

/** One surface (macOS desktop or browser page) the loop can drive. */
export interface TaskExecutor {
  /** Capture the current visual state as base64-encoded PNG bytes. */
  screenshot(signal?: AbortSignal): Promise<{ pngBase64: string; observationId: string }>
  /** Execute one non-`wait`, non-`done` {@link GuiAction} on this surface. */
  perform(
    action: GuiAction,
    observationId: string,
    signal?: AbortSignal,
    restoreObservedFocus?: boolean,
  ): Promise<void>
}

/** One completed loop iteration, kept as running context for the next model call. */
export interface TaskStepLog {
  /** Model-selected action; absent only when observation succeeded but decision failed. */
  action?: GuiAction
  /** Failure phase used when no model action exists to name the step. */
  phase?: 'decision'
  outcome?: string
}

/** One monotonic live-progress transition emitted by {@link runGuiTask}. */
export type TaskProgressEvent =
  | { kind: 'observed'; step: number; screenshotPngBase64?: string }
  | { kind: 'decided'; step: number; action: GuiAction }
  | { kind: 'settled'; step: number; entry: TaskStepLog; screenshotPngBase64?: string }

/** Result of {@link runGuiTask}. */
export interface RunTaskResult {
  /** True iff the model answered `done` before `maxSteps` was reached. */
  completed: boolean
  /** The model's `done` summary, or a stop reason when the loop ran out of steps. */
  summary: string
  steps: readonly TaskStepLog[]
}

/** A stopped loop that preserves every settled step for durable error presentation. */
export class GuiTaskRunError extends Error {
  /** Detached settled-step history available for durable stopped/error presentation. */
  readonly steps: readonly TaskStepLog[]

  constructor(cause: unknown, steps: readonly TaskStepLog[]) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'GuiTaskRunError'
    this.steps = steps.map(step => ({
      ...step,
      ...step.action === undefined ? {} : { action: { ...step.action } },
    }))
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Bound one `wait` action's pause so a misbehaving model cannot stall the loop indefinitely. */
const MAX_WAIT_MS = 5000
const MAX_STEP_OUTCOME_CHARS = 2048

function errorOutcome(prefix: string, error: unknown): string {
  const value = `${prefix}${String(error)}`
  if (value.length <= MAX_STEP_OUTCOME_CHARS) return value
  const marker = '… [truncated]'
  return `${value.slice(0, MAX_STEP_OUTCOME_CHARS - marker.length)}${marker}`
}

/**
 * Run the screenshot/decide/act loop until `done`, an aborted signal, or `maxSteps` is exhausted.
 * @param guiModel - the vision-grounding model service.
 * @param executor - the surface (macOS desktop or browser page) to drive.
 * @param options - the task description, step bound, and cancellation.
 * @returns whether the task completed, its summary, and the full step log.
 */
export async function runGuiTask(
  guiModel: GuiModelService,
  executor: TaskExecutor,
  options: {
    task: string
    maxSteps: number
    retainStepScreenshots?: boolean
    signal?: AbortSignal
    /** Optional safety gate evaluated immediately before each model-selected action. */
    beforeAction?: (action: GuiAction, signal?: AbortSignal) => Promise<boolean | void>
    /** Awaited progress sink; useful for saving and exposing each step before the task settles. */
    onProgress?: (event: TaskProgressEvent, signal?: AbortSignal) => Promise<void> | void
  },
): Promise<RunTaskResult> {
  const steps: TaskStepLog[] = []
  try {
    let nextObservation: Awaited<ReturnType<TaskExecutor['screenshot']>> | undefined
    for (let step = 0; step < options.maxSteps; step += 1) {
      options.signal?.throwIfAborted()
      const observation = nextObservation ?? await executor.screenshot(options.signal)
      nextObservation = undefined
      const { pngBase64, observationId } = observation
      const stepNumber = step + 1
      await options.onProgress?.({
        kind: 'observed',
        step: stepNumber,
        ...options.retainStepScreenshots === true ? { screenshotPngBase64: pngBase64 } : {},
      }, options.signal)
      let action: GuiAction
      try {
        const history: GuiActionLogEntry[] = steps.flatMap(entry => entry.action === undefined
          ? []
          : [{
            action: entry.action,
            ...entry.outcome === undefined ? {} : { outcome: entry.outcome },
          }])
        action = await guiModel.nextAction({
          screenshotPngBase64: pngBase64,
          task: options.task,
          history,
        }, options.signal)
      } catch (error) {
        const entry: TaskStepLog = { phase: 'decision', outcome: errorOutcome('error: ', error) }
        steps.push(entry)
        await options.onProgress?.({
          kind: 'settled',
          step: stepNumber,
          entry,
          ...options.retainStepScreenshots === true ? { screenshotPngBase64: pngBase64 } : {},
        }, options.signal)
        throw error
      }
      await options.onProgress?.({ kind: 'decided', step: stepNumber, action }, options.signal)

      if (action.kind === 'done') {
        const entry = { action }
        steps.push(entry)
        await options.onProgress?.({
          kind: 'settled',
          step: stepNumber,
          entry,
          ...options.retainStepScreenshots === true ? { screenshotPngBase64: pngBase64 } : {},
        }, options.signal)
        return { completed: true, summary: action.summary ?? 'Task completed.', steps }
      }
      if (action.kind === 'wait') {
        try {
          await sleep(Math.min(action.ms ?? 500, MAX_WAIT_MS), options.signal)
          nextObservation = await executor.screenshot(options.signal)
          const entry = { action, outcome: 'waited' }
          steps.push(entry)
          await options.onProgress?.({
            kind: 'settled',
            step: stepNumber,
            entry,
            ...options.retainStepScreenshots === true
              ? { screenshotPngBase64: nextObservation.pngBase64 }
              : {},
          }, options.signal)
        } catch (error) {
          const entry = { action, outcome: errorOutcome('error: ', error) }
          steps.push(entry)
          await options.onProgress?.({
            kind: 'settled',
            step: stepNumber,
            entry,
            ...options.retainStepScreenshots === true ? { screenshotPngBase64: pngBase64 } : {},
          }, options.signal)
          throw error
        }
        continue
      }
      let restoreObservedFocus = false
      try {
        restoreObservedFocus = await options.beforeAction?.(action, options.signal) === true
      } catch (error) {
        const entry = { action, outcome: errorOutcome('error: ', error) }
        steps.push(entry)
        await options.onProgress?.({
          kind: 'settled',
          step: stepNumber,
          entry,
          ...options.retainStepScreenshots === true ? { screenshotPngBase64: pngBase64 } : {},
        }, options.signal)
        throw error
      }
      try {
        await executor.perform(action, observationId, options.signal, restoreObservedFocus)
      } catch (error) {
        let errorObservation: Awaited<ReturnType<TaskExecutor['screenshot']>> | undefined
        try {
          errorObservation = await executor.screenshot(options.signal)
        } catch {
          // Preserve the original action failure; the pre-action capture remains the fallback evidence.
        }
        const entry = { action, outcome: errorOutcome('error: ', error) }
        steps.push(entry)
        await options.onProgress?.({
          kind: 'settled',
          step: stepNumber,
          entry,
          ...options.retainStepScreenshots === true
            ? { screenshotPngBase64: errorObservation?.pngBase64 ?? pngBase64 }
            : {},
        }, options.signal)
        // Crossing perform() is an uncertainty boundary: an OS/browser action
        // may already have submitted, purchased, sent, or typed before its
        // driver reports a timeout/navigation error. Never ask the model to
        // retry after that ambiguity, because a second action can duplicate
        // an irreversible side effect.
        throw error
      }
      try {
        nextObservation = await executor.screenshot(options.signal)
      } catch (error) {
        const entry = {
          action,
          outcome: errorOutcome('error: action dispatched but post-action screenshot failed: ', error),
        }
        steps.push(entry)
        await options.onProgress?.({
          kind: 'settled',
          step: stepNumber,
          entry,
          ...options.retainStepScreenshots === true ? { screenshotPngBase64: pngBase64 } : {},
        }, options.signal)
        throw error
      }
      const entry = { action, outcome: 'ok' }
      steps.push(entry)
      await options.onProgress?.({
        kind: 'settled',
        step: stepNumber,
        entry,
        ...options.retainStepScreenshots === true
          ? { screenshotPngBase64: nextObservation.pngBase64 }
          : {},
      }, options.signal)
    }
    return {
      completed: false,
      summary: `Stopped after ${options.maxSteps} steps without reaching "done".`,
      steps,
    }
  } catch (error) {
    if (error instanceof GuiTaskRunError) throw error
    throw new GuiTaskRunError(error, steps)
  }
}
