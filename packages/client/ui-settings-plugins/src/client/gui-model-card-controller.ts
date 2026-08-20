/**
 * The GUI-grounding vision model card's staged form over the `gui-model` settings namespace.
 *
 * The key is the one control that does not live in the section: its literal never rides a response, so the card
 * learns only whether one is configured and writes it through the credentials domain, addressed by the
 * reference the section names — same split as {@link WebSearchCardController}.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the GUI-grounding vision model seam. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const GUI_MODEL_NS = 'gui-model'

/** Credential reference the seam resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'GUI_MODEL_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The GUI-grounding fields this card edits. */
export interface GuiModelSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** OpenAI-compatible vision endpoint base. */
  baseURL?: string
  /** Vision-capable model name. */
  model?: string
  /** `max_tokens` cap on the response. */
  maxOutputTokens?: number
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the GUI-grounding vision model card renders. */
export interface GuiModelCardState extends CardShell {
  /** Vision endpoint base. */
  baseURL: CardFieldState
  /** Vision-capable model name. */
  model: CardFieldState
  /** Response token cap. */
  maxOutputTokens: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the GUI-grounding vision model card's slot entry injects. */
export interface GuiModelCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useGuiModelCard. */
    guiModelCard: SnapshotStore<GuiModelCardState>
  }
}

/** Bridges the `gui-model` scope and the credentials domain onto the card. */
export class GuiModelCardController {
  private readonly form: CardForm<GuiModelSettings>
  private readonly store: SnapshotStore<GuiModelCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `gui-model` namespace.
   * @param api - wire face used for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<GuiModelSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), textField('model'), numberField('maxOutputTokens')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): GuiModelCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      model: this.form.field('model'),
      maxOutputTokens: this.form.field('maxOutputTokens'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can change between the request and its
   * response, and two reads can settle out of order, so a response is published only while it still answers for
   * the reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): GuiModelCardFace {
    return { hooks: { guiModelCard: this.store }, ...this.form.actions() }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value })
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the seam's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<GuiModelSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
