/** Single-session task coordination, cooperative abort, and wall-clock deadlines. */

import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

interface ActiveTask {
  controller: AbortController
  ownerId: string
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
   * Abort only tasks owned by one exact agent/session.
   * @param ownerId - trusted Agent owner identity whose active tasks should stop.
   * @param reason - abort reason delivered to each matching task.
   * @returns number of matching active tasks signalled for cancellation.
   */
  abortOwner(ownerId: string, reason = 'GUI task aborted by its owning agent'): number {
    const tasks = [...this.active.values()].filter(task => task.ownerId === ownerId)
    for (const task of tasks) task.controller.abort(new Error(reason))
    return tasks.length
  }

  /**
   * Abort every active task. This is reserved for the explicitly global
   * Emergency Stop in Plugin Configuration, never a model-facing capability.
   * @param reason - abort reason delivered to every active task.
   * @returns number of active tasks signalled for cancellation.
   */
  abortAll(reason = 'All GUI tasks aborted from Plugin Configuration'): number {
    const tasks = [...this.active.values()]
    for (const task of tasks) task.controller.abort(new Error(reason))
    return tasks.length
  }

  /**
   * Run one autonomous task under the active-session lock and timeout.
   * @param exec - tool execution owning cancellation and agent identity.
   * @param ownerId - trusted Agent owner identity used for scoped aborts.
   * @param options - live lock and deadline settings.
   * @param run - task body receiving the fused cancellation signal.
   * @returns the task body's result when it finishes before cancellation.
   */
  async run<T>(
    exec: ToolRunContext,
    ownerId: string,
    options: { singleActiveTask: boolean; timeoutMs: number },
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (ownerId.trim() === '') throw new Error('GUI task owner identity is required')
    if (options.singleActiveTask && this.active.size > 0) {
      throw new Error('another GUI task is already active; abort it or wait for it to finish')
    }
    const token = Symbol(String(exec.callId))
    const controller = new AbortController()
    this.active.set(token, { controller, ownerId })
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal = AbortSignal.any([exec.signal, controller.signal, timeout])
    try {
      return await run(signal)
    } finally {
      this.active.delete(token)
    }
  }
}
