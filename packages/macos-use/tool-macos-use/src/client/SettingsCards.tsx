/** Plugin-owned GUI Model and GUI Agent cards for Settings → Plugins. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { GuiAgentCardFace, GuiModelCardFace } from './controllers.ts'
import { SecretField, SettingsCard, SwitchField, TextAreaField, ValueField } from './controls.tsx'
import css from './styles.module.css'

type CardRuntimeProps = PropsRuntime<'settings.plugin.item'> & PropsLocale<'macos-use'>

/** Runtime and injected props for the GUI Model configuration card. */
export type GuiModelCardProps = CardRuntimeProps & InjectFace<GuiModelCardFace>

/** Render every GUI vision-model endpoint and credential setting. */
export function GuiModelCard(props: GuiModelCardProps) {
  const state = props.useGuiModelCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <SettingsCard
      t={props.t}
      title="guiModel.title"
      description="guiModel.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-gui-model-key"
        t={props.t}
        label="guiModel.apiKey"
        hint="guiModel.apiKeyHint"
        state={state.apiKey}
        configured={state.apiKeyConfigured}
        disabled={!state.apiKeyWritable || state.saving}
        onEdit={(text) => { props.edit('apiKey', text) }}
        onRemove={props.removeKey}
      />
      <ValueField
        id="plugin-config-gui-model-credential-ref"
        t={props.t}
        label="guiModel.apiKeyEnv"
        hint="guiModel.apiKeyEnvHint"
        state={state.apiKeyEnv}
        disabled={disabled}
        onEdit={(text) => { props.edit('apiKeyEnv', text) }}
        onReset={() => { props.resetField('apiKeyEnv') }}
      />
      <ValueField
        id="plugin-config-gui-model-endpoint"
        t={props.t}
        label="guiModel.baseURL"
        hint="guiModel.baseURLHint"
        state={state.baseURL}
        disabled={disabled}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-gui-model-model"
        t={props.t}
        label="guiModel.model"
        hint="guiModel.modelHint"
        state={state.model}
        disabled={disabled}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      <ValueField
        id="plugin-config-gui-model-output-tokens"
        t={props.t}
        label="guiModel.maxOutputTokens"
        hint="guiModel.maxOutputTokensHint"
        state={state.maxOutputTokens}
        numeric
        disabled={disabled}
        onEdit={(text) => { props.edit('maxOutputTokens', text) }}
        onReset={() => { props.resetField('maxOutputTokens') }}
      />
    </SettingsCard>
  )
}

/** Runtime and injected props for the GUI Agent configuration card. */
export type GuiAgentCardProps = CardRuntimeProps & InjectFace<GuiAgentCardFace>

/** Render every GUI-agent reliability, safety, browser, and screenshot setting. */
export function GuiAgentCard(props: GuiAgentCardProps) {
  const state = props.useGuiAgentCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  const value = (
    id: string,
    label: Parameters<typeof ValueField>[0]['label'],
    hint: Parameters<typeof ValueField>[0]['hint'],
    field: keyof Pick<typeof state, 'defaultMaxSteps' | 'taskTimeoutMs' | 'commandTimeoutMs' | 'maxElementsPerSnapshot'>,
  ) => (
    <ValueField
      id={id}
      t={props.t}
      label={label}
      hint={hint}
      state={state[field]}
      numeric
      disabled={disabled}
      onEdit={(text) => { props.edit(field, text) }}
      onReset={() => { props.resetField(field) }}
    />
  )
  const toggle = (
    id: string,
    label: Parameters<typeof SwitchField>[0]['label'],
    hint: Parameters<typeof SwitchField>[0]['hint'],
    field: keyof Pick<typeof state,
      'showStepScreenshots' | 'browserHeadless'
      | 'browserAllowPrivateNetwork' | 'confirmDestructiveActions' | 'confirmEveryMutation' | 'singleActiveTask'>,
  ) => (
    <SwitchField
      id={id}
      t={props.t}
      label={label}
      hint={hint}
      state={state[field]}
      disabled={disabled}
      onEdit={(text) => { props.edit(field, text) }}
      onReset={() => { props.resetField(field) }}
    />
  )
  const list = (
    id: string,
    label: Parameters<typeof TextAreaField>[0]['label'],
    hint: Parameters<typeof TextAreaField>[0]['hint'],
    field: keyof Pick<typeof state,
      'allowedApps' | 'deniedApps' | 'excludedScreenshotApps'
      | 'browserAllowedDomains' | 'browserDeniedDomains'
      | 'readAppGrants' | 'controlAppGrants' | 'deniedAppIdentities'>,
  ) => (
    <TextAreaField
      id={id}
      t={props.t}
      label={label}
      hint={hint}
      state={state[field]}
      disabled={disabled}
      onEdit={(text) => { props.edit(field, text) }}
      onReset={() => { props.resetField(field) }}
    />
  )
  return (
    <SettingsCard
      t={props.t}
      title="guiAgent.title"
      description="guiAgent.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <h4 className={css.groupTitle}>{props.t('guiAgent.reliability')}</h4>
      {value('plugin-config-gui-agent-max-steps', 'guiAgent.defaultMaxSteps', 'guiAgent.defaultMaxStepsHint', 'defaultMaxSteps')}
      {value('plugin-config-gui-agent-task-timeout', 'guiAgent.taskTimeoutMs', 'guiAgent.taskTimeoutMsHint', 'taskTimeoutMs')}
      {value('plugin-config-gui-agent-command-timeout', 'guiAgent.commandTimeoutMs', 'guiAgent.commandTimeoutMsHint', 'commandTimeoutMs')}
      {value('plugin-config-gui-agent-elements', 'guiAgent.maxElements', 'guiAgent.maxElementsHint', 'maxElementsPerSnapshot')}
      <h4 className={css.groupTitle}>{props.t('guiAgent.browser')}</h4>
      {toggle('plugin-config-gui-agent-browser-headless', 'guiAgent.browserHeadless', 'guiAgent.browserHeadlessHint', 'browserHeadless')}
      {list('plugin-config-gui-agent-browser-allowed-domains', 'guiAgent.browserAllowedDomains', 'guiAgent.browserAllowedDomainsHint', 'browserAllowedDomains')}
      {list('plugin-config-gui-agent-browser-denied-domains', 'guiAgent.browserDeniedDomains', 'guiAgent.browserDeniedDomainsHint', 'browserDeniedDomains')}
      {toggle('plugin-config-gui-agent-browser-private-network', 'guiAgent.browserAllowPrivateNetwork', 'guiAgent.browserAllowPrivateNetworkHint', 'browserAllowPrivateNetwork')}
      <h4 className={css.groupTitle}>{props.t('guiAgent.safety')}</h4>
      {list('plugin-config-gui-agent-read-grants', 'guiAgent.readAppGrants', 'guiAgent.readAppGrantsHint', 'readAppGrants')}
      {list('plugin-config-gui-agent-control-grants', 'guiAgent.controlAppGrants', 'guiAgent.controlAppGrantsHint', 'controlAppGrants')}
      {list('plugin-config-gui-agent-denied-identities', 'guiAgent.deniedAppIdentities', 'guiAgent.deniedAppIdentitiesHint', 'deniedAppIdentities')}
      {list('plugin-config-gui-agent-allowed-apps', 'guiAgent.allowedApps', 'guiAgent.allowedAppsHint', 'allowedApps')}
      {list('plugin-config-gui-agent-denied-apps', 'guiAgent.deniedApps', 'guiAgent.deniedAppsHint', 'deniedApps')}
      {toggle('plugin-config-gui-agent-confirm-destructive', 'guiAgent.confirmDestructive', 'guiAgent.confirmDestructiveHint', 'confirmDestructiveActions')}
      {toggle('plugin-config-gui-agent-confirm-every-mutation', 'guiAgent.confirmEveryMutation', 'guiAgent.confirmEveryMutationHint', 'confirmEveryMutation')}
      {toggle('plugin-config-gui-agent-single-task', 'guiAgent.singleTask', 'guiAgent.singleTaskHint', 'singleActiveTask')}
      <h4 className={css.groupTitle}>{props.t('guiAgent.privacy')}</h4>
      {toggle('plugin-config-gui-agent-step-screenshots', 'guiAgent.showStepScreenshots', 'guiAgent.showStepScreenshotsHint', 'showStepScreenshots')}
      {list('plugin-config-gui-agent-excluded-apps', 'guiAgent.excludedApps', 'guiAgent.excludedAppsHint', 'excludedScreenshotApps')}
      <div className={css.abortPanel}>
        <span>
          <strong>{props.t('guiAgent.abort')}</strong>
          <small>{props.t('guiAgent.abortHint')}</small>
        </span>
        <button
          type="button"
          className={css.dangerButton}
          disabled={!state.writable || state.aborting}
          onClick={props.abort}
        >
          {props.t(state.aborting ? 'guiAgent.aborting' : 'guiAgent.abortButton')}
        </button>
        {state.abortFailed ? <p className={css.error}>{props.t('guiAgent.abortFailed')}</p> : null}
      </div>
    </SettingsCard>
  )
}
