/** Staged settings form shared by the plugin-owned visual configuration cards. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
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
}

interface PlannedWrite {
  run: (() => Promise<boolean>) | undefined
}

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
 * @returns field formatting and parsing contract.
 */
export function textField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: text => text.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: text.trim() },
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
      invalid: plan.some(item => item.run === undefined),
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

  /** Commit every valid staged mutation through the revision-fenced scope. */
  async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) landed = await write() && landed
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secrets.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ run: () => this.clear(field) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ run: undefined })
      else if (write.kind === 'clear') plan.push({ run: () => this.clear(field) })
      else plan.push({ run: () => this.store(field, write.value) })
    }
    return plan
  }

  private async clear(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    return this.userLayer()?.[field] === value
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
