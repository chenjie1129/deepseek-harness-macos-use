/** Staged settings form shared by the plugin-owned visual configuration cards. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { JsonValue, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** One validated settings-field mutation planned from staged text. */
export type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

/** Formatting and parsing contract for one ordinary settings field. */
export interface CardFieldSpec {
  field: string
  format: (value: unknown) => string
  parse: (text: string) => FieldWrite | undefined
}

/** Write-only secret field whose value never enters the settings snapshot. */
export interface CardSecretSpec {
  field: string
  write: (text: string) => Promise<boolean>
  /** Capture the exact credential target when the user stages removal. */
  prepareRemove: () => () => Promise<boolean>
  configured: () => boolean
}

/** Render state for one staged card field. */
export interface CardFieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

/** Namespace-level state shared by every visual settings card. */
export interface CardShell {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

/** Mutations exposed by a visual settings card. */
export interface CardActions {
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

interface StagedEdit {
  text: string
  clear: boolean
  remove?: () => Promise<boolean>
}

type PlannedWrite =
  | { kind: 'setting'; field: string; op: SettingsPathOpView; landed: () => boolean }
  | { kind: 'secret'; field: string; run: () => Promise<boolean> }
  | { kind: 'invalid'; field: string }

/**
 * Define a numeric settings field with optional integer and range bounds.
 * @param field - settings field name.
 * @param limits - accepted numeric shape and bounds.
 * @returns field formatting and parsing contract.
 */
export function numberField(
  field: string,
  limits: { integer?: boolean; min?: number; max?: number } = {},
): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed)) return undefined
      if (limits.integer === true && !Number.isInteger(parsed)) return undefined
      if (limits.min !== undefined && parsed < limits.min) return undefined
      if (limits.max !== undefined && parsed > limits.max) return undefined
      return { kind: 'set', value: parsed }
    },
  }
}

/**
 * Define a trimmed text settings field whose empty value clears the override.
 * @param field - settings field name.
 * @param validate - optional predicate for accepting a non-empty trimmed value.
 * @returns field formatting and parsing contract.
 */
export function textField(field: string, validate?: (value: string) => boolean): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      // Empty is an explicit override. Otherwise a composition-layer allowlist
      // or endpoint would spring back after the user visibly cleared it.
      if (trimmed === '') return { kind: 'set', value: '' }
      return validate?.(trimmed) === false ? undefined : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * Define a boolean settings field serialized as switch text.
 * @param field - settings field name.
 * @returns field formatting and parsing contract.
 */
export function booleanField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: text => text === 'true'
      ? { kind: 'set', value: true }
      : text === 'false' ? { kind: 'set', value: false } : undefined,
  }
}

/** Stages edits and commits them through one namespace's revision-fenced scope. */
export class CardForm<T> {
  private readonly specs: Map<string, CardFieldSpec>
  private readonly secrets: Map<string, CardSecretSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<T>,
    specs: CardFieldSpec[],
    secrets: CardSecretSpec[] = [],
  ) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    this.secrets = new Map(secrets.map(spec => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Bind a reactive snapshot store to a projection of this form.
   * @param project - pure projection read after each form change.
   * @returns reactive snapshot store for one card.
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * Project namespace availability and staged-save state.
   * @returns render state shared by the card.
   */
  shell(): CardShell {
    const plan = this.plan()
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.kind === 'invalid'),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /**
   * Project one ordinary or secret field for rendering.
   * @param field - registered settings or secret field.
   * @returns current staged render state.
   */
  field(field: string): CardFieldState {
    const staged = this.staged.get(field)
    if (this.secrets.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /**
   * Return stable card actions backed by this staged form.
   * @returns edit, reset, save, and discard mutations.
   */
  actions(): CardActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Stage removal of one configured write-only secret through the card's Save action.
   * @param field - registered secret field to remove when the form is saved.
   */
  removeSecret(field: string): void {
    const secret = this.secrets.get(field)
    if (secret === undefined) throw new Error(`macos-use settings card has no secret ${field}`)
    if (!secret.configured()) return
    this.stage(field, { text: '', clear: true, remove: secret.prepareRemove() })
  }

  /** Commit every valid staged mutation through the revision-fenced scope. */
  async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || this.saving || plan.some(item => item.kind === 'invalid')) return
    const settings = plan.filter((item): item is Extract<PlannedWrite, { kind: 'setting' }> => item.kind === 'setting')
    const secrets = plan.filter((item): item is Extract<PlannedWrite, { kind: 'secret' }> => item.kind === 'secret')
    const plannedEdits = new Map(plan.map(item => [item.field, this.staged.get(item.field)]))
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      // Ordinary fields are one namespace transaction. Besides preventing
      // half-applied safety grants, this guarantees a newly staged credential
      // reference is active before its write-only secret is stored.
      if (settings.length > 0) {
        await this.scope.mutate(settings.map(item => item.op))
        landed = settings.every(item => item.landed())
      }
      if (landed) {
        for (const secret of secrets) {
          if (!await secret.run()) {
            landed = false
            break
          }
        }
      }
    } catch {
      landed = false
    }
    if (landed) {
      // A field may be edited again while a remote mutation is settling. Clear
      // only the exact staged object this save planned; later user input wins.
      for (const [field, edit] of plannedEdits) {
        if (edit !== undefined && this.staged.get(field) === edit) this.staged.delete(field)
      }
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secrets.get(field)
      if (secret !== undefined) {
        if (staged.clear) {
          // The target is captured when Remove is clicked. The ordinary
          // settings transaction may change the active reference before this
          // operation executes, so resolving it here would remove the new
          // reference and silently leave the old secret behind.
          if (staged.remove !== undefined) plan.push({ kind: 'secret', field, run: staged.remove })
          continue
        }
        const value = staged.text.trim()
        if (value !== '') plan.push({ kind: 'secret', field, run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) {
          plan.push({
            kind: 'setting',
            field,
            op: { op: 'unset', path: [field] },
            landed: () => !this.stored(field),
          })
        }
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ kind: 'invalid', field })
      else if (write.kind === 'clear') {
        plan.push({
          kind: 'setting',
          field,
          op: { op: 'unset', path: [field] },
          landed: () => !this.stored(field),
        })
      } else {
        plan.push({
          kind: 'setting',
          field,
          op: { op: 'set', path: [field], value: write.value as JsonValue },
          landed: () => this.stored(field) && this.userLayer()?.[field] === write.value,
        })
      }
    }
    return plan
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): CardFieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`macos-use settings card has no field ${field}`)
    return spec
  }

  private snapshot(): SettingsScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return (this.snapshot().value as Record<string, unknown> | undefined)?.[field]
  }

  private baseValue(field: string): unknown {
    return (this.snapshot().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshot().user as Record<string, unknown> | undefined
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
