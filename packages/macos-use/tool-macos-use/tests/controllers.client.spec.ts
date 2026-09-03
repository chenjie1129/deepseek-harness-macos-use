// @vitest-environment jsdom
/** Transaction and credential regressions for the visual Plugin Configuration cards. */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { CardForm, textField } from '../src/client/card-form.ts'
import {
  GuiModelCardController,
  type GuiModelSettings,
} from '../src/client/controllers.ts'

interface ScopeHarness<T> {
  scope: SettingsScope<T>
  mutate: Mock<SettingsScope<T>['mutate']>
  apply: (ops: readonly SettingsPathOpView[]) => void
  snapshot: () => SettingsScopeSnapshot<T>
}

function scopeHarness<T extends object>(base: T): ScopeHarness<T> {
  let user: Record<string, unknown> = {}
  let revision = 1
  let snapshot: SettingsScopeSnapshot<T> = {
    status: 'ready',
    value: { ...base },
    base: { ...base },
    user,
    revision,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()

  const apply = (ops: readonly SettingsPathOpView[]): void => {
    user = { ...user }
    for (const op of ops) {
      const field = op.path[0]
      if (field === undefined || op.path.length !== 1) throw new Error('test scope accepts scalar fields only')
      if (op.op === 'set') user[field] = op.value
      else Reflect.deleteProperty(user, field)
    }
    revision += 1
    snapshot = {
      ...snapshot,
      value: { ...base, ...user },
      user,
      revision,
    }
    for (const listener of listeners) listener()
  }

  const mutate = vi.fn<SettingsScope<T>['mutate']>(async (ops) => { apply(ops) })
  const scope: SettingsScope<T> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate,
    set: async (field, value) => { await mutate([{ op: 'set', path: [field], value: value as never }]) },
    unset: async (field) => { await mutate([{ op: 'unset', path: [field] }]) },
  }
  return { scope, mutate, apply, snapshot: () => snapshot }
}

async function waitForSave(controller: GuiModelCardController): Promise<void> {
  await vi.waitFor(() => {
    expect(controller.inject().hooks.guiModelCard.getSnapshot().saving).toBe(false)
  })
}

describe('visual settings transaction', () => {
  it('persists a visibly cleared text field as an empty override; Reset alone inherits base', async () => {
    const { scope, mutate, snapshot } = scopeHarness({ browserAllowedDomains: 'example.com' })
    const form = new CardForm(scope, [textField('browserAllowedDomains')])
    form.actions().edit('browserAllowedDomains', '')
    await form.save()

    expect(mutate).toHaveBeenLastCalledWith([
      { op: 'set', path: ['browserAllowedDomains'], value: '' },
    ])
    expect(snapshot().value?.browserAllowedDomains).toBe('')
    expect(snapshot().user).toHaveProperty('browserAllowedDomains', '')

    form.actions().resetField('browserAllowedDomains')
    await form.save()
    expect(mutate).toHaveBeenLastCalledWith([
      { op: 'unset', path: ['browserAllowedDomains'] },
    ])
    expect(snapshot().value?.browserAllowedDomains).toBe('example.com')
  })

  it('preserves a newer text edit made while an earlier settings save is settling', async () => {
    const { scope, mutate, apply, snapshot } = scopeHarness({ browserAllowedDomains: '' })
    const gate = Promise.withResolvers<undefined>()
    mutate.mockImplementation(async (ops: readonly SettingsPathOpView[]) => {
      await gate.promise
      apply(ops)
    })
    const form = new CardForm(scope, [textField('browserAllowedDomains')])
    form.actions().edit('browserAllowedDomains', 'first.example')
    const saving = form.save()
    expect(form.shell().saving).toBe(true)
    form.actions().edit('browserAllowedDomains', 'second.example')
    gate.resolve(undefined)
    await saving

    expect(snapshot().value?.browserAllowedDomains).toBe('first.example')
    expect(form.field('browserAllowedDomains').text).toBe('second.example')
    expect(form.shell()).toMatchObject({ dirty: true, failed: false, saving: false })
  })

  it('preserves a newer secret edit made while an earlier credential write is settling', async () => {
    const { scope } = scopeHarness({})
    const gate = Promise.withResolvers<undefined>()
    let configured = false
    const write = vi.fn(async () => {
      await gate.promise
      configured = true
      return true
    })
    const form = new CardForm(scope, [], [{
      field: 'apiKey',
      write,
      prepareRemove: () => async () => true,
      configured: () => configured,
    }])
    form.actions().edit('apiKey', 'first-secret')
    const saving = form.save()
    expect(form.shell().saving).toBe(true)
    form.actions().edit('apiKey', 'second-secret')
    gate.resolve(undefined)
    await saving

    expect(write).toHaveBeenCalledWith('first-secret')
    expect(form.field('apiKey').text).toBe('second-secret')
    expect(form.shell()).toMatchObject({ dirty: true, failed: false, saving: false })
  })

  it('writes a secret to the new reference even when the secret was edited first', async () => {
    const { scope, mutate, apply } = scopeHarness<GuiModelSettings>({ apiKeyEnv: 'OLD_GUI_KEY' })
    const order: string[] = []
    const configured = new Set<string>()
    mutate.mockImplementation(async (ops: readonly SettingsPathOpView[]) => {
      order.push('settings')
      apply(ops)
    })
    const credentials = {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, {
          configured: configured.has(ref),
          writable: true,
        }])),
      })),
      set: vi.fn(async (ref: string) => {
        order.push(`secret:${ref}`)
        configured.add(ref)
        return { ok: true as const, value: undefined }
      }),
      unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const controller = new GuiModelCardController(scope, credentials)
    const face = controller.inject()
    face.edit('apiKey', 'sk-new')
    face.edit('apiKeyEnv', 'NEW_GUI_KEY')
    face.save()
    await waitForSave(controller)

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(credentials.set).toHaveBeenCalledWith('NEW_GUI_KEY', 'sk-new')
    expect(order).toEqual(['settings', 'secret:NEW_GUI_KEY'])
    expect(face.hooks.guiModelCard.getSnapshot()).toMatchObject({ dirty: false, failed: false })
  })

  it('does not mistake an existing credential for a rejected secret write', async () => {
    const { scope } = scopeHarness<GuiModelSettings>({ apiKeyEnv: 'OLD_GUI_KEY' })
    const credentials = {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
      })),
      set: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'credential-rejected', message: 'read-only reference', details: {} },
      })),
      unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const controller = new GuiModelCardController(scope, credentials)
    const face = controller.inject()
    face.edit('apiKey', 'sk-rejected')
    face.save()
    await waitForSave(controller)

    expect(credentials.set).toHaveBeenCalledWith('OLD_GUI_KEY', 'sk-rejected')
    expect(face.hooks.guiModelCard.getSnapshot()).toMatchObject({ dirty: true, failed: true })
    expect(face.hooks.guiModelCard.getSnapshot().apiKey.text).toBe('sk-rejected')
  })

  it('removes a configured credential from Plugin Configuration', async () => {
    const { scope } = scopeHarness<GuiModelSettings>({ apiKeyEnv: 'GUI_KEY' })
    const configured = new Set(['GUI_KEY'])
    const credentials = {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, {
          configured: configured.has(ref),
          writable: true,
        }])),
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      unset: vi.fn(async (ref: string) => {
        configured.delete(ref)
        return { ok: true as const, value: undefined }
      }),
    }
    const controller = new GuiModelCardController(scope, credentials)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.guiModelCard.getSnapshot().apiKeyConfigured).toBe(true) })
    face.removeKey()
    expect(face.hooks.guiModelCard.getSnapshot().dirty).toBe(true)
    face.save()
    await waitForSave(controller)

    expect(credentials.unset).toHaveBeenCalledWith('GUI_KEY')
    expect(face.hooks.guiModelCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: false,
      dirty: false,
      failed: false,
    })
  })

  it('removes the staged old credential even when the same Save switches to a new reference', async () => {
    const { scope } = scopeHarness<GuiModelSettings>({ apiKeyEnv: 'OLD_GUI_KEY' })
    const configured = new Set(['OLD_GUI_KEY'])
    const credentials = {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, {
          configured: configured.has(ref),
          writable: true,
        }])),
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      unset: vi.fn(async (ref: string) => {
        configured.delete(ref)
        return { ok: true as const, value: undefined }
      }),
    }
    const controller = new GuiModelCardController(scope, credentials)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.guiModelCard.getSnapshot().apiKeyConfigured).toBe(true) })

    face.removeKey()
    face.edit('apiKeyEnv', 'NEW_GUI_KEY')
    face.save()
    await waitForSave(controller)

    expect(credentials.unset).toHaveBeenCalledWith('OLD_GUI_KEY')
    expect(credentials.unset).not.toHaveBeenCalledWith('NEW_GUI_KEY')
    expect(configured.has('OLD_GUI_KEY')).toBe(false)
    expect(face.hooks.guiModelCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: false,
      dirty: false,
      failed: false,
    })
  })

  it('ignores an older credential description that resolves after a newer successful save', async () => {
    const { scope } = scopeHarness<GuiModelSettings>({ apiKeyEnv: 'GUI_KEY' })
    const stale = Promise.withResolvers<{
      ok: true
      value: Record<string, { configured: boolean; writable: boolean }>
    }>()
    const configured = new Set<string>()
    const credentials = {
      describe: vi.fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async (refs: string[]) => ({
          ok: true as const,
          value: Object.fromEntries(refs.map(ref => [ref, {
            configured: configured.has(ref),
            writable: true,
          }])),
        })),
      set: vi.fn(async (ref: string) => {
        configured.add(ref)
        return { ok: true as const, value: undefined }
      }),
      unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const controller = new GuiModelCardController(scope, credentials)
    const face = controller.inject()
    face.edit('apiKey', 'new-secret')
    face.save()
    await waitForSave(controller)
    expect(face.hooks.guiModelCard.getSnapshot().apiKeyConfigured).toBe(true)

    stale.resolve({
      ok: true,
      value: { GUI_KEY: { configured: false, writable: true } },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(face.hooks.guiModelCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: true,
      dirty: false,
      failed: false,
    })
  })

  it('keeps a failed credential removal staged when the remote rejects it', async () => {
    const { scope } = scopeHarness<GuiModelSettings>({ apiKeyEnv: 'GUI_KEY' })
    const credentials = {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      unset: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'credential-rejected', message: 'read-only reference', details: {} },
      })),
    }
    const controller = new GuiModelCardController(scope, credentials)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.guiModelCard.getSnapshot().apiKeyConfigured).toBe(true) })
    face.removeKey()
    face.save()
    await waitForSave(controller)

    expect(credentials.unset).toHaveBeenCalledWith('GUI_KEY')
    expect(face.hooks.guiModelCard.getSnapshot()).toMatchObject({
      apiKeyConfigured: true,
      dirty: true,
      failed: true,
    })
  })
})
