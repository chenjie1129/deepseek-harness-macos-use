/** Optional Host registration for process-local GUI task progress. */

import { Service, type Context } from '@deepseek-ai/cordis'
import { GuiTaskProgressStore, type GuiTaskProgressSnapshotResult } from './progress.ts'
import {
  GUI_TASK_PROGRESS_HOST_CONTRIBUTION,
  GUI_TASK_PROGRESS_REMOTE_NAMESPACE,
  GUI_TASK_PROGRESS_REMOTE_SERVICE,
} from './progress-remote.ts'

interface TypertRegistryLike {
  register(contribution: typeof GUI_TASK_PROGRESS_HOST_CONTRIBUTION): () => Promise<void>
}

class GuiTaskProgressRemoteService extends Service {
  readonly typertRemote: {
    readonly service: GuiTaskProgressRemoteService
    readonly serviceKey: typeof GUI_TASK_PROGRESS_REMOTE_SERVICE
    readonly namespace: typeof GUI_TASK_PROGRESS_REMOTE_NAMESPACE
  }

  constructor(ctx: Context, private readonly store: GuiTaskProgressStore) {
    super(ctx, GUI_TASK_PROGRESS_REMOTE_SERVICE)
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: GUI_TASK_PROGRESS_REMOTE_SERVICE,
      namespace: GUI_TASK_PROGRESS_REMOTE_NAMESPACE,
    })
  }

  snapshot(callId: string): Promise<GuiTaskProgressSnapshotResult> {
    const agent = (this.ctx as Context & { agent?: { readonly id?: unknown } }).agent
    if (agent?.id === undefined) return Promise.resolve(null)
    const result = this.store.snapshot(String(agent.id), callId)
    return Promise.resolve(result?.callId === callId ? result : null)
  }
}

/** Disposal handle for the optional Remote contribution. */
export interface GuiTaskProgressRemoteInstallation {
  dispose(): Promise<void>
}

/**
 * Resolve a progress call only for its exact live Agent Context and registered call.
 * @param store - process-local progress registry.
 * @param agent - authenticated live Agent Context supplied by Typert.
 * @param callId - exact Tool call whose snapshot is requested.
 * @returns detached progress for the matching Agent/call tuple, or null.
 */
export function progressSnapshotForAgent(
  store: GuiTaskProgressStore,
  agent: { readonly id: string },
  callId: string,
): GuiTaskProgressSnapshotResult {
  const result = store.snapshot(agent.id, callId)
  return result?.callId === callId ? result : null
}

/**
 * Register the bridge when the current Harness exposes Typert; otherwise final results remain the fallback.
 * @param ctx - Host context that may expose the Typert registry.
 * @param store - process-local progress registry served by the bridge.
 * @returns disposal handle when registered, or undefined when Typert is absent.
 */
export function installGuiTaskProgressRemote(
  ctx: Context,
  store: GuiTaskProgressStore,
): GuiTaskProgressRemoteInstallation | undefined {
  const typert = ctx.get('typert') as TypertRegistryLike | undefined
  if (typeof typert?.register !== 'function') return undefined
  new GuiTaskProgressRemoteService(ctx, store)
  const removeContribution = typert.register(GUI_TASK_PROGRESS_HOST_CONTRIBUTION)
  return {
    async dispose(): Promise<void> {
      await removeContribution()
    },
  }
}

/**
 * Follow Typert's service lifecycle instead of checking once during plugin boot.
 * This keeps live progress available when the tool plugin loads before Typert,
 * and tears the contribution down if Typert is later replaced or unloaded.
 * @param ctx - plugin context whose Typert lifecycle should be observed.
 * @param store - process-local progress registry exposed while Typert is available.
 */
export function watchGuiTaskProgressRemote(ctx: Context, store: GuiTaskProgressStore): void {
  ctx.inject(['typert'], (typeCtx) => {
    const installation = installGuiTaskProgressRemote(typeCtx, store)
    if (installation === undefined) return
    typeCtx.effect(
      () => () => installation.dispose(),
      'tool-macos-use: dispose GUI task progress Remote contribution',
    )
  })
}
