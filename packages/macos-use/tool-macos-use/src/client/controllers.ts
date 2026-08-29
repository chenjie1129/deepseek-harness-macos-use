/** Browser-side controllers for the plugin's two visual settings cards. */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  booleanField, CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Settings namespace owned by the GUI vision-model service. */
export const GUI_MODEL_NS = 'gui-model'
/** Settings namespace owned by the model-facing GUI agent tools. */
export const GUI_AGENT_NS = 'tool-macos-use'
const DEFAULT_API_KEY_REF = 'GUI_MODEL_API_KEY'
const API_KEY_FIELD = 'apiKey'

/** GUI-model values visible through the settings scope. */
export interface GuiModelSettings {
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  maxOutputTokens?: number
}

interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
}

/** Complete render snapshot for the GUI Model card. */
export interface GuiModelCardState extends CardShell {
  apiKeyEnv: CardFieldState
  baseURL: CardFieldState
  model: CardFieldState
  maxOutputTokens: CardFieldState
  apiKey: CardFieldState
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
}

/** Hooks and mutations injected into the GUI Model settings slot. */
export interface GuiModelCardFace extends CardActions {
  hooks: { guiModelCard: SnapshotStore<GuiModelCardState> }
}

type CredentialsRemote = Pick<ClientRemote['credentials'], 'describe' | 'set'>

/** Coordinates staged GUI-model settings and write-only credential state. */
export class GuiModelCardController {
  private readonly form: CardForm<GuiModelSettings>
  private readonly store: SnapshotStore<GuiModelCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  constructor(
    private readonly scope: SettingsScope<GuiModelSettings>,
    private readonly credentials: CredentialsRemote,
  ) {
    this.form = new CardForm(
      scope,
      [
        textField('apiKeyEnv'),
        textField('baseURL'),
        textField('model'),
        numberField('maxOutputTokens', { integer: true, min: 1 }),
      ],
      [{ field: API_KEY_FIELD, write: value => this.writeKey(value) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): GuiModelCardState {
    return {
      ...this.form.shell(),
      apiKeyEnv: this.form.field('apiKeyEnv'),
      baseURL: this.form.field('baseURL'),
      model: this.form.field('model'),
      maxOutputTokens: this.form.field('maxOutputTokens'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  private async readCredential(): Promise<void> {
    const ref = credentialRef(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<CredentialsRemote['describe']>>
    try {
      response = await this.credentials.describe([ref])
    } catch (_credentialReadFailure) {
      return
    }
    if (!response.ok || ref !== credentialRef(this.scope.getSnapshot())) return
    const view = response.value[ref]
    this.credential = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    this.store.set(this.projection())
  }

  /**
   * Refresh the credential badge when the active reference changes remotely.
   * @param ref - credential reference reported by the host.
   */
  refreshCredential(ref: string): void {
    if (ref === this.credential.ref) void this.readCredential()
  }

  /**
   * Build the face injected into the GUI Model card.
   * @returns reactive card hook and staged mutations.
   */
  inject(): GuiModelCardFace {
    return { hooks: { guiModelCard: this.store }, ...this.form.actions() }
  }

  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.credentials.set(credentialRef(this.scope.getSnapshot()), value)
    } catch (_credentialWriteFailure) {
      // The following describe is the authority on whether the write landed.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

function credentialRef(snapshot: SettingsScopeSnapshot<GuiModelSettings>): string {
  const declared = snapshot.value?.apiKeyEnv?.trim()
  return declared === undefined || declared === '' ? DEFAULT_API_KEY_REF : declared
}

/** GUI-agent reliability, safety, browser, and screenshot settings. */
export interface GuiAgentSettings {
  defaultMaxSteps?: number
  taskTimeoutMs?: number
  commandTimeoutMs?: number
  maxElementsPerSnapshot?: number
  showStepScreenshots?: boolean
  browserHeadless?: boolean
  allowedApps?: string
  deniedApps?: string
  excludedScreenshotApps?: string
  confirmAppleScript?: boolean
  confirmDestructiveActions?: boolean
  singleActiveTask?: boolean
  abortRevision?: number
}

/** Complete render snapshot for the GUI Agent card. */
export interface GuiAgentCardState extends CardShell {
  defaultMaxSteps: CardFieldState
  taskTimeoutMs: CardFieldState
  commandTimeoutMs: CardFieldState
  maxElementsPerSnapshot: CardFieldState
  showStepScreenshots: CardFieldState
  browserHeadless: CardFieldState
  allowedApps: CardFieldState
  deniedApps: CardFieldState
  excludedScreenshotApps: CardFieldState
  confirmAppleScript: CardFieldState
  confirmDestructiveActions: CardFieldState
  singleActiveTask: CardFieldState
  aborting: boolean
  abortFailed: boolean
}

/** Hooks and mutations injected into the GUI Agent settings slot. */
export interface GuiAgentCardFace extends CardActions {
  hooks: { guiAgentCard: SnapshotStore<GuiAgentCardState> }
  abort: () => void
}

/** Coordinates staged GUI-agent settings and the immediate abort action. */
export class GuiAgentCardController {
  private readonly form: CardForm<GuiAgentSettings>
  private readonly store: SnapshotStore<GuiAgentCardState>
  private aborting = false
  private abortFailed = false

  constructor(private readonly scope: SettingsScope<GuiAgentSettings>) {
    this.form = new CardForm(scope, [
      numberField('defaultMaxSteps', { integer: true, min: 1 }),
      numberField('taskTimeoutMs', { integer: true, min: 1 }),
      numberField('commandTimeoutMs', { integer: true, min: 1 }),
      numberField('maxElementsPerSnapshot', { integer: true, min: 1, max: 2000 }),
      booleanField('showStepScreenshots'),
      booleanField('browserHeadless'),
      textField('allowedApps'),
      textField('deniedApps'),
      textField('excludedScreenshotApps'),
      booleanField('confirmAppleScript'),
      booleanField('confirmDestructiveActions'),
      booleanField('singleActiveTask'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): GuiAgentCardState {
    return {
      ...this.form.shell(),
      defaultMaxSteps: this.form.field('defaultMaxSteps'),
      taskTimeoutMs: this.form.field('taskTimeoutMs'),
      commandTimeoutMs: this.form.field('commandTimeoutMs'),
      maxElementsPerSnapshot: this.form.field('maxElementsPerSnapshot'),
      showStepScreenshots: this.form.field('showStepScreenshots'),
      browserHeadless: this.form.field('browserHeadless'),
      allowedApps: this.form.field('allowedApps'),
      deniedApps: this.form.field('deniedApps'),
      excludedScreenshotApps: this.form.field('excludedScreenshotApps'),
      confirmAppleScript: this.form.field('confirmAppleScript'),
      confirmDestructiveActions: this.form.field('confirmDestructiveActions'),
      singleActiveTask: this.form.field('singleActiveTask'),
      aborting: this.aborting,
      abortFailed: this.abortFailed,
    }
  }

  /**
   * Build the face injected into the GUI Agent card.
   * @returns reactive card hook, staged mutations, and abort action.
   */
  inject(): GuiAgentCardFace {
    return {
      hooks: { guiAgentCard: this.store },
      ...this.form.actions(),
      abort: () => { void this.abort() },
    }
  }

  private async abort(): Promise<void> {
    if (this.aborting || !this.scope.getSnapshot().writable) return
    this.aborting = true
    this.abortFailed = false
    this.store.set(this.projection())
    const revision = this.scope.getSnapshot().value?.abortRevision ?? 0
    try {
      await this.scope.set('abortRevision', revision + 1)
      this.abortFailed = this.scope.getSnapshot().value?.abortRevision !== revision + 1
    } catch (_abortWriteFailure) {
      this.abortFailed = true
    }
    this.aborting = false
    this.store.set(this.projection())
  }
}
