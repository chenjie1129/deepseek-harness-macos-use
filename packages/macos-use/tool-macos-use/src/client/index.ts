/** Browser half: visual configuration and GUI-task step screenshot presentation. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isGuiTaskProgressSnapshot, type GuiTaskProgressSnapshotResult } from '../progress.ts'
import { GUI_TASK_PROGRESS_REMOTE_CONTRIBUTION } from '../progress-remote.ts'
import { GuiAgentCard, GuiModelCard } from './SettingsCards.tsx'
import { GUI_AGENT_NS, GUI_MODEL_NS, GuiAgentCardController, GuiModelCardController } from './controllers.ts'
import { GuiTaskView, type GuiTaskInjected } from './GuiTaskView.tsx'
import { en, zh, type MacosUseKey } from './locales.ts'

/** Public locale-key type for client extensions. */
export type { MacosUseKey } from './locales.ts'
/** Public decoder for the task-result presentation metadata contract. */
export { presentationContent } from './GuiTaskView.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** GUI agent settings and task output copy. */
    'macos-use': MacosUseKey
  }
}

const NS = 'macos-use'

interface ProgressRemoteResult {
  ok: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

interface ProgressRemoteNamespace {
  snapshot(callId: string): Promise<ProgressRemoteResult>
}

interface ProgressRemoteClient {
  $mount(contribution: typeof GUI_TASK_PROGRESS_REMOTE_CONTRIBUTION): Promise<() => Promise<void>>
}

/** Client services required by configuration cards and task rendering. */
export const inject = [
  'slots', 'locale', 'connection', 'remote', 'remote.credentials', 'settingsScope', 'sessions', 'uiConversation',
]

/** Install locale dictionaries, Plugin Configuration cards, task views, and the optional live-progress bridge. */
export async function apply(ctx: ClientContext): Promise<(() => Promise<void>) | undefined> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'macos-use: browser dictionaries')

  const remoteClient = ctx.get('remote') as unknown as ProgressRemoteClient | undefined
  let disposeProgressRemote: (() => Promise<void>) | undefined
  if (typeof remoteClient?.$mount === 'function') {
    try {
      disposeProgressRemote = await remoteClient.$mount(GUI_TASK_PROGRESS_REMOTE_CONTRIBUTION)
    } catch (error) {
      console.warn('[macos-use] live GUI task progress is unavailable:', error)
    }
  }

  const guiModel = new GuiModelCardController(
    ctx.settingsScope.bind({ namespace: GUI_MODEL_NS }),
    ctx.remote.credentials,
  )
  const guiAgent = new GuiAgentCardController(
    ctx.settingsScope.bind({ namespace: GUI_AGENT_NS }),
  )

  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { guiModel.refreshCredential(ref) }),
    'macos-use: GUI model credential invalidations',
  )

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: GUI_MODEL_NS,
      locale: NS,
      inject: () => guiModel.inject(),
    }, GuiModelCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: GUI_AGENT_NS,
      locale: NS,
      inject: () => guiAgent.inject(),
    }, GuiAgentCard)
  })

  ctx.slots.inject('tool.call.toolview', function* () {
    const injectTask = (sessionId: SessionId): GuiTaskInjected => {
      const agentScope = ctx.sessions.scope(sessionId)
      const remote = agentScope?.get('remote.guiTaskProgress') as ProgressRemoteNamespace | undefined
      return {
        loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
        ...remote === undefined ? {} : {
          async loadProgress(callId: string): Promise<GuiTaskProgressSnapshotResult> {
            const result = await remote.snapshot(callId)
            if (!result.ok) {
              throw new Error(`${result.error?.code ?? 'internal'}: ${result.error?.message ?? 'GUI task progress failed.'}`)
            }
            if (result.value === null) return null
            if (!isGuiTaskProgressSnapshot(result.value) || result.value.callId !== callId) {
              throw new Error('Host returned a malformed GUI task progress snapshot.')
            }
            return result.value
          },
        },
      }
    }
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'computer_use_task',
      locale: NS,
      inject: injectTask,
    }, GuiTaskView)
    yield ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'browser_use_task',
      locale: NS,
      inject: injectTask,
    }, GuiTaskView)
  })
  return disposeProgressRemote
}
