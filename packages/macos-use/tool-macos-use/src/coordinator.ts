/** Single-session task coordination, cooperative abort, and wall-clock deadlines. */

import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

interface ActiveTask {
  controller: AbortController
  agent: ToolRunContext['agent']
}

/** Coordinates the two autonomous GUI task tools owned by one plugin instance. */
export class TaskCoordinator {
  private readonly active = new Map<symbol, ActiveTask>()

  /**
   * Whether another GUI task is currently controlling a surface.
   * @returns true while at least one coordinated task has not settled.
   */
  hasActiveTask(): boolean {
    return this.active.size > 0
  }

  /**
   * Abort every active task immediately and report how many were signalled.
   * @param reason - diagnostic delivered as the abort reason.
   * @returns number of tasks signalled during this call.
   */
  abort(reason = 'GUI task aborted by the user'): number {
    const tasks = [...this.active.values()]
    for (const task of tasks) task.controller.abort(new Error(reason))
    return tasks.length
  }

  /**
   * Run one autonomous task under the active-session lock and timeout.
   * @param exec - tool execution owning cancellation and agent identity.
   * @param options - live lock and deadline settings.
   * @param run - task body receiving the fused cancellation signal.
   * @returns the task body's result when it finishes before cancellation.
   */
  async run<T>(
    exec: ToolRunContext,
    options: { singleActiveTask: boolean; timeoutMs: number },
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (options.singleActiveTask && this.active.size > 0) {
      throw new Error('another GUI task is already active; abort it or wait for it to finish')
    }
    const token = Symbol(String(exec.callId))
    const controller = new AbortController()
    this.active.set(token, { controller, agent: exec.agent })
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal = AbortSignal.any([exec.signal, controller.signal, timeout])
    try {
      return await run(signal)
    } finally {
      this.active.delete(token)
    }
  }
}
