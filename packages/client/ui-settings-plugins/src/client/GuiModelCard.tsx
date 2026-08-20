/**
 * The GUI-grounding vision model's card: its endpoint, its model, its response budget, and the key — which is
 * written through the credentials domain, never into the settings section, so the literal never rides a
 * response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { GuiModelCardFace } from './gui-model-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the GUI-grounding vision model card. */
export type GuiModelCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<GuiModelCardFace>

/**
 * Render the GUI-grounding vision model card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function GuiModelCard(props: GuiModelCardProps) {
  const { t } = props
  const state = props.useGuiModelCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="guiModelTitle"
      descriptionKey="guiModelDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-gui-model-key"
        label={t('guiModelApiKey')}
        hint={t('guiModelApiKeyHint')}
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('guiModelApiKeySet') : t('guiModelApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-gui-model-endpoint"
        label={t('guiModelBaseUrl')}
        hint={t('guiModelBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-gui-model-model"
        label={t('guiModelModel')}
        hint={t('guiModelModelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      <ValueField
        id="plugin-config-gui-model-max-output-tokens"
        label={t('guiModelMaxOutputTokens')}
        hint={t('guiModelMaxOutputTokensHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxOutputTokens}
        onEdit={(text) => { props.edit('maxOutputTokens', text) }}
        onReset={() => { props.resetField('maxOutputTokens') }}
      />
    </PluginCard>
  )
}
