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

/** Client services required by configuration cards and task rendering. */
export const inject = [
  'slots', 'locale', 'connection', 'remote', 'remote.credentials', 'settingsScope', 'uiConversation',
]

/** Install locale dictionaries, Plugin Configuration cards, and task views. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'macos-use: browser dictionaries')

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
    const injectTask = (sessionId: SessionId): GuiTaskInjected => ({
      loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
    })
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
}
