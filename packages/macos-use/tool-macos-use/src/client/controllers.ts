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

/**
 * Mirror the credential seam's POSIX-portable reference grammar.
 * @param value - candidate credential reference entered on the visual card.
 * @returns whether the value is a valid portable credential reference.
 */
export function validCredentialReference(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function isIpv4Loopback(address: string): boolean {
  const octets = address.split('.')
  return octets.length === 4
    && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127
}

function isMappedIpv4Loopback(address: string): boolean {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address)
  if (mapped === null) return false
  const highWord = Number.parseInt(mapped[1] ?? '', 16)
  return (highWord & 0xff00) === 0x7f00
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase('en-US').replace(/^\[/, '').replace(/\]$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost')
    || normalized === '::1' || isMappedIpv4Loopback(normalized)
    || isIpv4Loopback(normalized)
}

/**
 * Accept the empty first-run state and restrict non-empty endpoints to safe HTTP(S) bases.
 * @param value - candidate GUI-model endpoint base entered on the visual card.
 * @returns whether the endpoint is empty or passes the client-side URL policy.
 */
export function validGuiModelBaseURL(value: string): boolean {
  if (value.trim() === '') return true
  try {
    const endpoint = new URL(value)
    return (endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && isLoopbackHostname(endpoint.hostname)))
      && endpoint.username === '' && endpoint.password === ''
      && endpoint.search === '' && endpoint.hash === ''
  } catch {
    return false
  }
}

/**
 * Mirror the Host grammar so malformed precise rules are visibly invalid before Save.
 * @param value - newline-delimited precise application rules from the visual card.
 * @returns whether every non-empty structured rule has valid, unique identity fields.
 */
export function validAppIdentityRules(value: string): boolean {
  for (const source of value.split('\n')) {
    const line = source.trim()
    if (line === '' || !line.includes('=')) continue
    const seen = new Set<string>()
    for (const sourcePart of line.split('|')) {
      const match = /^(name|bundleId|pid)\s*=\s*(.+)$/.exec(sourcePart.trim())
      if (match === null) return false
      const key = match[1]
      const text = match[2]?.trim() ?? ''
      if (text === '') return false
      if (key === undefined || seen.has(key)) return false
      seen.add(key)
      if (key === 'pid') {
        const pid = Number(text)
        if (!Number.isSafeInteger(pid) || pid <= 0) return false
      }
    }
  }
  return true
}

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
  removeKey: () => void
}

type CredentialsRemote = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>

/** Coordinates staged GUI-model settings and write-only credential state. */
export class GuiModelCardController {
  private readonly form: CardForm<GuiModelSettings>
  private readonly store: SnapshotStore<GuiModelCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }
  private credentialReadGeneration = 0

  constructor(
    private readonly scope: SettingsScope<GuiModelSettings>,
    private readonly credentials: CredentialsRemote,
  ) {
    this.form = new CardForm(
      scope,
      [
        textField('apiKeyEnv', validCredentialReference),
        textField('baseURL', validGuiModelBaseURL),
        textField('model'),
        numberField('maxOutputTokens', { integer: true, min: 1 }),
      ],
      [{
        field: API_KEY_FIELD,
        write: value => this.writeKey(value),
        prepareRemove: () => {
          const ref = this.credential.ref
          return () => this.removeKey(ref)
        },
        configured: () => this.credential.configured,
      }],
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
    const generation = ++this.credentialReadGeneration
    const ref = credentialRef(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<CredentialsRemote['describe']>>
    try {
      response = await this.credentials.describe([ref])
    } catch {
      return
    }
    if (!response.ok || generation !== this.credentialReadGeneration
      || ref !== credentialRef(this.scope.getSnapshot())) return
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
    return {
      hooks: { guiModelCard: this.store },
      ...this.form.actions(),
      removeKey: () => { this.form.removeSecret(API_KEY_FIELD) },
    }
  }

  private async writeKey(value: string): Promise<boolean> {
    const ref = credentialRef(this.scope.getSnapshot())
    let response: Awaited<ReturnType<CredentialsRemote['set']>>
    try {
      response = await this.credentials.set(ref, value)
    } catch {
      await this.readCredential()
      return false
    }
    if (!response.ok) {
      await this.readCredential()
      return false
    }
    await this.readCredential()
    return this.credential.ref === ref && this.credential.configured
  }

  private async removeKey(ref: string): Promise<boolean> {
    let response: Awaited<ReturnType<CredentialsRemote['unset']>>
    try {
      response = await this.credentials.unset(ref)
    } catch {
      await this.readCredential()
      return false
    }
    if (!response.ok) {
      await this.readCredential()
      return false
    }
    let verified = false
    try {
      const confirmation = await this.credentials.describe([ref])
      verified = confirmation.ok && !(confirmation.value[ref]?.configured ?? false)
    } catch {
      verified = false
    }
    await this.readCredential()
    return verified
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
  browserAllowedDomains?: string
  browserDeniedDomains?: string
  browserAllowPrivateNetwork?: boolean
  allowedApps?: string
  deniedApps?: string
  readAppGrants?: string
  controlAppGrants?: string
  deniedAppIdentities?: string
  excludedScreenshotApps?: string
  confirmDestructiveActions?: boolean
  confirmEveryMutation?: boolean
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
  browserAllowedDomains: CardFieldState
  browserDeniedDomains: CardFieldState
  browserAllowPrivateNetwork: CardFieldState
  allowedApps: CardFieldState
  deniedApps: CardFieldState
  readAppGrants: CardFieldState
  controlAppGrants: CardFieldState
  deniedAppIdentities: CardFieldState
  excludedScreenshotApps: CardFieldState
  confirmDestructiveActions: CardFieldState
  confirmEveryMutation: CardFieldState
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
      numberField('defaultMaxSteps', { integer: true, min: 1, max: 100 }),
      numberField('taskTimeoutMs', { integer: true, min: 1 }),
      numberField('commandTimeoutMs', { integer: true, min: 1 }),
      numberField('maxElementsPerSnapshot', { integer: true, min: 1, max: 2000 }),
      booleanField('showStepScreenshots'),
      booleanField('browserHeadless'),
      textField('browserAllowedDomains'),
      textField('browserDeniedDomains'),
      booleanField('browserAllowPrivateNetwork'),
      textField('allowedApps'),
      textField('deniedApps'),
      textField('readAppGrants', validAppIdentityRules),
      textField('controlAppGrants', validAppIdentityRules),
      textField('deniedAppIdentities', validAppIdentityRules),
      textField('excludedScreenshotApps'),
      booleanField('confirmDestructiveActions'),
      booleanField('confirmEveryMutation'),
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
      browserAllowedDomains: this.form.field('browserAllowedDomains'),
      browserDeniedDomains: this.form.field('browserDeniedDomains'),
      browserAllowPrivateNetwork: this.form.field('browserAllowPrivateNetwork'),
      allowedApps: this.form.field('allowedApps'),
      deniedApps: this.form.field('deniedApps'),
      readAppGrants: this.form.field('readAppGrants'),
      controlAppGrants: this.form.field('controlAppGrants'),
      deniedAppIdentities: this.form.field('deniedAppIdentities'),
      excludedScreenshotApps: this.form.field('excludedScreenshotApps'),
      confirmDestructiveActions: this.form.field('confirmDestructiveActions'),
      confirmEveryMutation: this.form.field('confirmEveryMutation'),
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
    } catch {
      this.abortFailed = true
    }
    this.aborting = false
    this.store.set(this.projection())
  }
}
