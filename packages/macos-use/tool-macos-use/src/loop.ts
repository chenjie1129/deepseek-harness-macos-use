/**
 * The shared vision-grounded task loop backing `computer_use_task` and `browser_use_task`: screenshot ->
 * `ctx.guiModel.nextAction` -> execute -> repeat, until the model answers `done`, an unrecoverable error occurs,
 * or `maxSteps` is exhausted. Parameterized over a small {@link TaskExecutor} so the macOS and browser surfaces
 * share one loop instead of two near-duplicate ones.
 * @module @deepseek-ai/dsh-tool-macos-use/loop
 */

import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type { GuiModelService } from '@deepseek-ai/dsh-gui-model'

/** One surface (macOS desktop or browser page) the loop can drive. */
export interface TaskExecutor {
  /** Capture the current visual state as base64-encoded PNG bytes. */
  screenshot(signal?: AbortSignal): Promise<{ pngBase64: string }>
  /** Execute one non-`wait`, non-`done` {@link GuiAction} on this surface. */
  perform(action: GuiAction, signal?: AbortSignal): Promise<void>
}

/** One completed loop iteration, kept as running context for the next model call. */
export interface TaskStepLog {
  action: GuiAction
  outcome?: string
}

/** Result of {@link runGuiTask}. */
export interface RunTaskResult {
  /** True iff the model answered `done` before `maxSteps` was reached. */
  completed: boolean
  /** The model's `done` summary, or a stop reason when the loop ran out of steps. */
  summary: string
  steps: readonly TaskStepLog[]
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason as Error)
    }, { once: true })
  })
}

/** Bound one `wait` action's pause so a misbehaving model cannot stall the loop indefinitely. */
const MAX_WAIT_MS = 5000

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
  options: { task: string; maxSteps: number; signal?: AbortSignal },
): Promise<RunTaskResult> {
  const steps: TaskStepLog[] = []
  for (let step = 0; step < options.maxSteps; step += 1) {
    options.signal?.throwIfAborted()
    const { pngBase64 } = await executor.screenshot(options.signal)
    const action = await guiModel.nextAction({
      screenshotPngBase64: pngBase64,
      task: options.task,
      history: steps,
    }, options.signal)

    if (action.kind === 'done') {
      steps.push({ action })
      return { completed: true, summary: action.summary ?? 'Task completed.', steps }
    }
    if (action.kind === 'wait') {
      await sleep(Math.min(action.ms ?? 500, MAX_WAIT_MS), options.signal)
      steps.push({ action, outcome: 'waited' })
      continue
    }
    try {
      await executor.perform(action, options.signal)
      steps.push({ action, outcome: 'ok' })
    } catch (error) {
      steps.push({ action, outcome: `error: ${String(error)}` })
    }
  }
  return { completed: false, summary: `Stopped after ${options.maxSteps} steps without reaching "done".`, steps }
}
