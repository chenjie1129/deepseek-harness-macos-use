import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  GuiTaskProgressStore,
  isGuiTaskProgressSnapshot,
  LIVE_PROGRESS_ACTION_MAX_CHARS,
  LIVE_PROGRESS_MAX_DATA_URL_CHARS,
  LIVE_PROGRESS_MAX_TEXT_CHARS,
  LIVE_PROGRESS_OUTCOME_MAX_CHARS,
  type LiveScreenshotPreview,
} from '../src/progress.ts'
import { progressSnapshotForAgent, watchGuiTaskProgressRemote } from '../src/progress-host.ts'
import { createTaskProgressReporter } from '../src/task-progress.ts'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function preview(dataUrl = 'data:image/jpeg;base64,AAAA'): LiveScreenshotPreview {
  return { dataUrl, mediaType: 'image/jpeg', bytes: 3, width: 1, height: 1 }
}

describe('GUI task live progress', () => {
  it('installs when Typert appears after the tool plugin and disposes with the lifecycle', async () => {
    const ctx = new Context()
    const remove = vi.fn(() => Promise.resolve())
    const register = vi.fn(() => remove)
    watchGuiTaskProgressRemote(ctx, new GuiTaskProgressStore())
    expect(register).not.toHaveBeenCalled()

    ctx.provide('typert', { register } as never)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledOnce() })
    await ctx.fiber.dispose()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('publishes monotonic detached snapshots and retains prior step fields across phases', () => {
    const store = new GuiTaskProgressStore()
    store.begin('session-1', 'call-1', 'browser_use_task')
    store.update('session-1', 'call-1', { step: 1, phase: 'observed', preview: preview() })
    store.update('session-1', 'call-1', { step: 1, phase: 'decided', action: '{"kind":"click"}' })
    const snapshot = store.snapshot('session-1', 'call-1')
    expect(snapshot).toMatchObject({
      callId: 'call-1',
      toolName: 'browser_use_task',
      revision: 3,
      active: true,
      steps: [{ phase: 'decided', action: '{"kind":"click"}', preview: { mediaType: 'image/jpeg' } }],
    })
    if (snapshot === null) throw new Error('missing snapshot')
    ;(snapshot.steps[0] as { action?: string }).action = 'mutated'
    expect(store.snapshot('session-1', 'call-1')?.steps[0]?.action).toBe('{"kind":"click"}')
  })

  it('denies cross-session/cross-call lookups and keeps an exact stopped snapshot briefly', () => {
    const store = new GuiTaskProgressStore()
    store.begin('session-1', 'call-1', 'computer_use_task')
    store.begin('session-2', 'call-2', 'browser_use_task')
    expect(progressSnapshotForAgent(store, { id: 'session-1' }, 'call-1'))
      .toMatchObject({ toolName: 'computer_use_task', active: true })
    expect(progressSnapshotForAgent(store, { id: 'session-1' }, 'call-2')).toBeNull()
    expect(progressSnapshotForAgent(store, { id: 'session-2' }, 'call-1')).toBeNull()
    store.finish('session-1', 'call-1')
    expect(progressSnapshotForAgent(store, { id: 'session-1' }, 'call-1'))
      .toMatchObject({ toolName: 'computer_use_task', active: false })
  })

  it('clears only previews owned by a disposed Agent/session', () => {
    const store = new GuiTaskProgressStore()
    store.begin('session-1', 'call-1', 'computer_use_task')
    store.begin('session-2', 'call-2', 'browser_use_task')
    store.clearOwner('session-1')
    expect(store.snapshot('session-1', 'call-1')).toBeNull()
    expect(store.snapshot('session-2', 'call-2')).toMatchObject({ active: true })
  })

  it('keeps opaque ids distinct even when delimiter concatenation would collide', () => {
    const store = new GuiTaskProgressStore()
    store.begin('a', 'b\u0000c', 'computer_use_task')
    store.begin('a\u0000b', 'c', 'browser_use_task')

    expect(store.snapshot('a', 'b\u0000c')).toMatchObject({
      callId: 'b\u0000c', toolName: 'computer_use_task',
    })
    expect(store.snapshot('a\u0000b', 'c')).toMatchObject({
      callId: 'c', toolName: 'browser_use_task',
    })

    store.clearOwner('a')
    expect(store.snapshot('a', 'b\u0000c')).toBeNull()
    expect(store.snapshot('a\u0000b', 'c')).toMatchObject({ toolName: 'browser_use_task' })
  })

  it('enforces a strict aggregate inline-preview bound by evicting oldest previews', () => {
    const store = new GuiTaskProgressStore()
    store.begin('session-1', 'call-1', 'computer_use_task')
    const dataUrl = `data:image/jpeg;base64,${'A'.repeat(120_000)}`
    for (let step = 1; step <= 6; step += 1) {
      store.update('session-1', 'call-1', { step, phase: 'observed', preview: preview(dataUrl) })
    }
    const snapshot = store.snapshot('session-1', 'call-1')
    const total = snapshot?.steps.reduce((sum, step) => sum + (step.preview?.dataUrl.length ?? 0), 0) ?? 0
    expect(total).toBeLessThanOrEqual(LIVE_PROGRESS_MAX_DATA_URL_CHARS)
    expect(snapshot?.steps[0]?.preview).toBeUndefined()
    expect(snapshot?.steps.at(-1)?.preview).toBeDefined()
  })

  it('bounds cumulative live action/outcome text across 100 steps', () => {
    const store = new GuiTaskProgressStore()
    store.begin('session-1', 'call-1', 'computer_use_task')
    for (let step = 1; step <= 100; step += 1) {
      store.update('session-1', 'call-1', {
        step,
        phase: 'settled',
        action: 'a'.repeat(LIVE_PROGRESS_ACTION_MAX_CHARS + 100),
        outcome: 'o'.repeat(LIVE_PROGRESS_OUTCOME_MAX_CHARS + 100),
      })
    }
    const snapshot = store.snapshot('session-1', 'call-1')
    const total = snapshot?.steps.reduce((sum, step) =>
      sum + (step.action?.length ?? 0) + (step.outcome?.length ?? 0), 0) ?? 0
    expect(total).toBeLessThanOrEqual(LIVE_PROGRESS_MAX_TEXT_CHARS)
    expect(isGuiTaskProgressSnapshot(snapshot)).toBe(true)
    expect(snapshot?.steps.at(-1)?.action?.length).toBeLessThanOrEqual(LIVE_PROGRESS_ACTION_MAX_CHARS)
  })

  it('saves a durable step image and exposes a bounded inline preview without appending session events', async () => {
    const append = vi.fn()
    const ref = {
      attachmentId: 'step-1',
      mediaType: 'image/png',
      bytes: 68,
      width: 1,
      height: 1,
      name: 'computer-use-task-step-1.png',
    } as ImageAttachmentRef
    const store = new GuiTaskProgressStore()
    const reporter = createTaskProgressReporter({
      store,
      exec: {
        agent: { id: 'session-1', session: { append } },
        callId: 'call-1',
        signal: new AbortController().signal,
      } as unknown as ToolRunContext,
      toolName: 'computer_use_task',
      namePrefix: 'computer-use-task',
      saveScreenshot: vi.fn(async () => ref),
    })
    await reporter.onProgress({ kind: 'observed', step: 1, screenshotPngBase64: TINY_PNG_BASE64 })
    expect(store.snapshot('session-1', 'call-1')?.steps[0]?.preview?.dataUrl)
      .toMatch(/^data:image\/jpeg;base64,/)
    await reporter.onProgress({
      kind: 'settled',
      step: 1,
      entry: { action: { kind: 'done', summary: 'done' } },
      screenshotPngBase64: TINY_PNG_BASE64,
    })
    expect(reporter.stepScreenshots).toEqual([ref])
    expect(append).not.toHaveBeenCalled()
  })

  it('never produces a preview or durable step attachment when screenshot presentation is off', async () => {
    const saveScreenshot = vi.fn()
    const store = new GuiTaskProgressStore()
    const reporter = createTaskProgressReporter({
      store,
      exec: {
        agent: { id: 'session-1' },
        callId: 'call-1',
        signal: new AbortController().signal,
      } as unknown as ToolRunContext,
      toolName: 'computer_use_task',
      namePrefix: 'computer-use-task',
      saveScreenshot,
    })
    await reporter.onProgress({ kind: 'observed', step: 1 })
    expect(saveScreenshot).not.toHaveBeenCalled()
    expect(store.snapshot('session-1', 'call-1')?.steps[0]?.preview).toBeUndefined()
  })

  it('fails soft when a live preview cannot be decoded while preserving durable evidence', async () => {
    const ref = {
      attachmentId: 'step-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1,
    } as ImageAttachmentRef
    const store = new GuiTaskProgressStore()
    const reporter = createTaskProgressReporter({
      store,
      exec: {
        agent: { id: 'session-1' }, callId: 'call-1', signal: new AbortController().signal,
      } as unknown as ToolRunContext,
      toolName: 'computer_use_task',
      namePrefix: 'computer-use-task',
      saveScreenshot: vi.fn(async () => ref),
    })
    await expect(reporter.onProgress({
      kind: 'settled',
      step: 1,
      entry: { action: { kind: 'done' } },
      screenshotPngBase64: 'not-an-image',
    })).resolves.toBeUndefined()
    expect(reporter.stepScreenshots).toEqual([ref])
    expect(store.snapshot('session-1', 'call-1')?.steps[0]?.preview).toBeUndefined()
  })

  it('fails soft when durable step attachment storage is unavailable', async () => {
    const store = new GuiTaskProgressStore()
    const reporter = createTaskProgressReporter({
      store,
      exec: {
        agent: { id: 'session-1' }, callId: 'call-1', signal: new AbortController().signal,
      } as unknown as ToolRunContext,
      toolName: 'computer_use_task',
      namePrefix: 'computer-use-task',
      saveScreenshot: vi.fn(() => Promise.reject(new Error('attachment store unavailable'))),
    })
    await expect(reporter.onProgress({
      kind: 'settled',
      step: 1,
      entry: { action: { kind: 'done', summary: 'done' }, outcome: 'done' },
      screenshotPngBase64: TINY_PNG_BASE64,
    })).resolves.toBeUndefined()
    expect(reporter.stepScreenshots).toEqual([])
    expect(store.snapshot('session-1', 'call-1')?.steps[0]).toMatchObject({
      phase: 'settled',
      action: '{"kind":"done","summary":"done"}',
      outcome: 'done',
      preview: { mediaType: 'image/jpeg' },
    })
  })

  it('rejects malformed or oversized previews at the Remote boundary', () => {
    expect(isGuiTaskProgressSnapshot({
      callId: 'call-1',
      toolName: 'computer_use_task',
      revision: 1,
      active: true,
      steps: [{
        step: 1,
        phase: 'observed',
        preview: preview(`data:image/jpeg;base64,${'A'.repeat(200_000)}`),
      }],
    })).toBe(false)
    expect(isGuiTaskProgressSnapshot({
      callId: 'call-1',
      toolName: 'computer_use_task',
      revision: 1,
      active: true,
      steps: [{ step: 1, phase: 'decided', action: 'x'.repeat(LIVE_PROGRESS_ACTION_MAX_CHARS + 1) }],
    })).toBe(false)
  })

  it('redacts literal typed text from the process-local live progress projection', async () => {
    const store = new GuiTaskProgressStore()
    const reporter = createTaskProgressReporter({
      store,
      exec: {
        agent: { id: 'session-1' }, callId: 'call-1', signal: new AbortController().signal,
      } as unknown as ToolRunContext,
      toolName: 'computer_use_task',
      namePrefix: 'computer-use-task',
      saveScreenshot: vi.fn(),
    })
    await reporter.onProgress({ kind: 'decided', step: 1, action: { kind: 'type', text: 'secret literal' } })
    const action = store.snapshot('session-1', 'call-1')?.steps[0]?.action ?? ''
    expect(action).toContain('[redacted 14 typed characters]')
    expect(action).not.toContain('secret literal')
  })
})
