/** Live step-screenshot setting and the model/UI output split for GUI task tools. */

import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as plugin from '../src/index.ts'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(
  nextAction: () => Promise<unknown> = () => Promise.resolve({ kind: 'done', summary: 'Finished.' }),
  config: plugin.ToolMacosUseConfig = {},
) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemorySettings)
  const saveImage = vi.fn((input: { data: Buffer; mediaType: 'image/png'; name?: string }) => Promise.resolve({
    attachmentId: `attachment-${input.name ?? 'image'}`,
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    width: 2,
    height: 2,
    originalDimensions: { width: 2880, height: 1800 },
    ...input.name === undefined ? {} : { name: input.name },
  }))
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 3.5 * 1024 * 1024,
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 40_000_000,
      maxImageDimension: 2000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    saveImage,
  } as never)
  ctx.provide('guiModel', {
    nextAction,
  } as never)
  const macosConfigure = vi.fn()
  const macosScreenshot = vi.fn(() => Promise.resolve({
    pngBase64: TINY_PNG_BASE64,
    observationId: 'macos-observation',
    observedAt: new Date().toISOString(),
  }))
  const macosClick = vi.fn(() => Promise.resolve())
  const macosKey = vi.fn(() => Promise.resolve())
  const macosMove = vi.fn(() => Promise.resolve())
  const macosDrag = vi.fn(() => Promise.resolve())
  const macosType = vi.fn(() => Promise.resolve())
  const macosScroll = vi.fn(() => Promise.resolve())
  const semanticWindow = {
    id: 41,
    app: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4,
    title: 'Draft',
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    onScreen: true,
  }
  let semanticObservation = 0
  const macosWindowState = vi.fn(() => {
    semanticObservation += 1
    return Promise.resolve({
      window: semanticWindow,
      pngBase64: TINY_PNG_BASE64,
      observationId: `window-observation-${String(semanticObservation)}`,
      observedAt: new Date().toISOString(),
      elements: [{
        role: 'AXButton',
        name: 'Save',
        enabled: true,
        bounds: { x: 30, y: 40, width: 20, height: 10 },
      }],
      truncated: false,
    })
  })
  const macosReactivateWindowObservation = vi.fn((target: unknown) => Promise.resolve(target))
  const macosReactivateScreenObservation = vi.fn(() => Promise.resolve())
  ctx.provide('macosUse', {
    configure: macosConfigure,
    screenshot: macosScreenshot,
    click: macosClick,
    key: macosKey,
    move: macosMove,
    drag: macosDrag,
    type: macosType,
    scroll: macosScroll,
    windowState: macosWindowState,
    reactivateWindowObservation: macosReactivateWindowObservation,
    reactivateScreenObservation: macosReactivateScreenObservation,
    actionReceipt: () => Promise.resolve({
      pngBase64: TINY_PNG_BASE64,
      observationId: 'receipt-observation',
      observedAt: new Date().toISOString(),
      targetState: 'unscoped',
    }),
  } as never)
  const browserConfigure = vi.fn()
  const browserNavigate = vi.fn(() => Promise.resolve())
  const browserPageState = vi.fn(() => Promise.resolve({
    url: 'https://example.test/', title: 'Example', text: 'Ready',
  }))
  ctx.provide('browserUse', {
    configure: browserConfigure,
    navigate: browserNavigate,
    screenshot: () => Promise.resolve({
      pngBase64: TINY_PNG_BASE64,
      observationId: 'browser-observation',
      url: 'https://example.test/',
    }),
    pageState: browserPageState,
  } as never)
  // Functional tests invoke tools without an interactive approval surface.
  // The production default remains confirmEveryMutation=true and is asserted in p0.spec.ts.
  await ctx.plugin(plugin, Object.assign({ confirmEveryMutation: false }, config))
  return {
    ctx,
    saveImage,
    macosConfigure,
    macosScreenshot,
    macosClick,
    macosKey,
    macosMove,
    macosDrag,
    macosType,
    macosScroll,
    macosWindowState,
    macosReactivateWindowObservation,
    macosReactivateScreenObservation,
    browserConfigure,
    browserNavigate,
    browserPageState,
  }
}

async function runComputerTask(ctx: Context) {
  const tool = ctx.tools.get('computer_use_task')
  if (tool === undefined) throw new Error('computer_use_task was not registered')
  const args = { task: 'open settings' }
  const value = await tool.execute(args, {
    agent: { id: 'session-1' },
    callId: 'computer-task-call',
    signal: new AbortController().signal,
  } as never) as JsonValue
  const content = tool.output.render(args, value)
  const meta = tool.output.presentationMeta?.(args, value)
  const view = tool.presentResult?.(args, { content, isError: false, ...meta === undefined ? {} : { meta } })
  return { value, content, view }
}

type TestApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

interface TestApprovalRequest {
  agent: { id: string }
  toolName: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

function provideWaterfallApproval(ctx: Context, outcome: TestApprovalOutcome) {
  // `answer` stands in for the terminal UI answerer. The plugin's prepended
  // wrapper must bind the desktop before this callback can focus Harness.
  const answer = vi.fn(() => Promise.resolve(outcome))
  const request = vi.fn((input: TestApprovalRequest) => ctx.waterfall(
    ctx as never,
    'approval/request',
    input as never,
    answer,
  ))
  ctx.provide('approval', { request } as never)
  return { request, answer }
}

function provideDeferredWaterfallApproval(ctx: Context) {
  const release = Promise.withResolvers<TestApprovalOutcome>()
  const answer = vi.fn(() => release.promise)
  const request = vi.fn((input: TestApprovalRequest) => ctx.waterfall(
    ctx as never,
    'approval/request',
    input as never,
    answer,
  ))
  ctx.provide('approval', { request } as never)
  return { request, answer, release }
}

describe('tool-macos-use task presentation settings', () => {
  it('registers the exact 21-tool surface and never exposes arbitrary AppleScript', async () => {
    const { ctx } = await boot()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'browser_click',
      'browser_extract_text',
      'browser_fill',
      'browser_navigate',
      'browser_screenshot',
      'browser_use_task',
      'computer_abort',
      'computer_click',
      'computer_drag',
      'computer_focus_window',
      'computer_get_window_state',
      'computer_key',
      'computer_list_apps',
      'computer_list_windows',
      'computer_move',
      'computer_open_app',
      'computer_screenshot',
      'computer_screenshot_window',
      'computer_scroll',
      'computer_type',
      'computer_use_task',
    ])
    expect(ctx.tools.get('computer_run_applescript')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('enforces the hard 100-step ceiling on both autonomous task tools before model dispatch', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'must not run' }))
    const { ctx } = await boot(nextAction)
    for (const name of ['computer_use_task', 'browser_use_task']) {
      const tool = ctx.tools.get(name)
      if (tool === undefined) throw new Error(`${name} was not registered`)
      const value = await tool.execute({ task: 'bounded task', max_steps: 101 }, {
        agent: { id: `session-${name}` },
        callId: `call-${name}`,
        signal: new AbortController().signal,
      } as never)
      expect(JSON.stringify(value)).toContain('max_steps must be a whole number from 1 to 100')
    }
    expect(nextAction).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('exposes a screen observation token and requires it for focus-dependent primitive controls', async () => {
    const { ctx, macosClick, macosKey, macosMove, macosDrag, macosType, macosScroll } = await boot()
    const screenshotTool = ctx.tools.get('computer_screenshot')
    const clickTool = ctx.tools.get('computer_click')
    const keyTool = ctx.tools.get('computer_key')
    if (screenshotTool === undefined || clickTool === undefined || keyTool === undefined) {
      throw new Error('primitive computer tools were not registered')
    }
    const signal = new AbortController().signal
    const exec = { agent: { id: 'session-1' }, signal } as never
    const capture = await screenshotTool.execute({}, exec) as {
      observationId: string
      screenshot: { attachmentId: string }
    }
    expect(capture).toMatchObject({
      observationId: 'macos-observation',
      screenshot: { attachmentId: 'attachment-screenshot.png' },
    })
    const renderedCapture = screenshotTool.output.render({}, capture)[0]
    expect(renderedCapture?.type).toBe('text')
    expect(renderedCapture?.type === 'text' ? renderedCapture.text : '').toContain(
      'Screen observation macos-observation',
    )

    await expect(clickTool.execute({ x: 1, y: 1 }, exec)).rejects.toThrow(/observation_id/)
    expect(macosClick).not.toHaveBeenCalled()
    await clickTool.execute({ x: 1, y: 1, observation_id: capture.observationId }, exec)
    expect(macosClick).toHaveBeenLastCalledWith({
      x: 1,
      y: 1,
      observationId: 'macos-observation',
    }, signal, 'session-1')

    await keyTool.execute({ combo: 'return', observation_id: capture.observationId }, exec)
    expect(macosKey).toHaveBeenLastCalledWith({
      combo: 'return',
      observationId: 'macos-observation',
    }, signal, 'session-1')

    const unboundCases: Array<[string, Record<string, unknown>, ReturnType<typeof vi.fn>]> = [
      ['computer_move', { x: 1, y: 1 }, macosMove],
      ['computer_drag', { x: 1, y: 1, to_x: 2, to_y: 2 }, macosDrag],
      ['computer_type', { text: 'hello' }, macosType],
      ['computer_scroll', { direction: 'down' }, macosScroll],
    ]
    for (const [name, args, nativeAction] of unboundCases) {
      const tool = ctx.tools.get(name)
      if (tool === undefined) throw new Error(`${name} was not registered`)
      await expect(tool.execute(args, exec)).rejects.toThrow(/observation_id/)
      expect(nativeAction).not.toHaveBeenCalled()
    }
    await ctx.fiber.dispose()
  })

  it('accepts normalized attachment metadata from the current Harness runtime', async () => {
    const { ctx } = await boot()
    const result = await ctx.tools.execute({
      callId: ToolCallId('computer-use-output-contract'),
      name: 'computer_use_task',
      arguments: { task: 'open settings' },
      agent: { id: 'session-1' },
      signal: new AbortController().signal,
    } as never)

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toMatchObject({
      completed: false,
      finalScreenshot: { originalDimensions: { width: 2880, height: 1800 } },
      steps: [{ screenshot: { originalDimensions: { width: 2880, height: 1800 } } }],
      verification: { status: 'model_done_unverified', modelDone: true },
    })
    await ctx.fiber.dispose()
  })

  it('shows step screenshots by default, then stops saving and presenting them after the live switch turns off', async () => {
    const { ctx, saveImage } = await boot()

    const shown = await runComputerTask(ctx)
    expect(saveImage.mock.calls.map(([input]) => input.name)).toEqual([
      'computer-use-task-step-1.png',
      'computer-use-task-result.png',
    ])
    expect(shown.content.every(block => block.type === 'text')).toBe(true)
    const shownContent = (shown.view as {
      content?: Array<{ type: string; text?: string }>
    } | undefined)?.content
    expect(shownContent?.slice(0, 2)).toEqual([
      { type: 'text', text: 'Model done (unverified): Finished.' },
      { type: 'text', text: 'Step 1: {"kind":"done","summary":"Finished."}' },
    ])
    expect(shownContent?.[2]?.type).toBe('image')
    expect(shownContent?.at(-1)?.text).toContain('Screenshot captured')

    saveImage.mockClear()
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, { showStepScreenshots: false })

    const hidden = await runComputerTask(ctx)
    expect(saveImage.mock.calls.map(([input]) => input.name)).toEqual(['computer-use-task-result.png'])
    const hiddenContent = (hidden.view as {
      content?: Array<{ type: string; text?: string }>
    } | undefined)?.content
    expect(hiddenContent?.slice(0, 2)).toEqual([
      { type: 'text', text: 'Model done (unverified): Finished.' },
      { type: 'text', text: 'Step 1: {"kind":"done","summary":"Finished."}' },
    ])
    expect(hiddenContent).toHaveLength(3)
    expect(hiddenContent?.at(-1)?.text).toContain('Screenshot captured')
    await ctx.fiber.dispose()
  })

  it('executes typed text but redacts it from durable and user-facing task output', async () => {
    let decision = 0
    const { ctx, macosType } = await boot(() => Promise.resolve(decision++ === 0
      ? { kind: 'type', text: 'hunter2' }
      : { kind: 'done', summary: 'Typed securely.' }))

    const result = await runComputerTask(ctx)

    expect(macosType).toHaveBeenCalledWith({
      text: 'hunter2',
      observationId: 'macos-observation',
    }, expect.any(AbortSignal), 'session-1')
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).toContain('[redacted 7 typed characters]')
    await ctx.fiber.dispose()
  })

  it('settles and saves a step before the whole autonomous task finishes', async () => {
    const decision = Promise.withResolvers<unknown>()
    let calls = 0
    const { ctx, saveImage } = await boot(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ kind: 'click', x: 1, y: 1 })
        : decision.promise
    })
    const running = runComputerTask(ctx)
    await vi.waitFor(() => {
      expect(saveImage.mock.calls.map(([input]) => input.name)).toContain('computer-use-task-step-1.png')
    })
    expect(saveImage.mock.calls.map(([input]) => input.name)).not.toContain('computer-use-task-result.png')
    decision.resolve({ kind: 'done', summary: 'Finished.' })
    await running
    await ctx.fiber.dispose()
  })

  it('keeps the autonomous loop successful when one durable step attachment cannot be stored', async () => {
    const { ctx, saveImage } = await boot()
    const originalSave = saveImage.getMockImplementation()
    saveImage.mockImplementation(async (input) => {
      if (input.name?.includes('-step-')) throw new Error('step attachment unavailable')
      if (originalSave === undefined) throw new Error('missing test attachment implementation')
      return originalSave(input)
    })

    const result = await runComputerTask(ctx)

    expect(result.value).toMatchObject({
      summary: 'Finished.',
      steps: [{ action: '{"kind":"done","summary":"Finished."}' }],
      verification: { modelDone: true, status: 'model_done_unverified' },
    })
    if (typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
      throw new Error('computer task result was not an object')
    }
    const steps = result.value.steps
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('computer task result omitted its step log')
    const firstStep = steps[0]
    if (typeof firstStep !== 'object' || firstStep === null || Array.isArray(firstStep)) {
      throw new Error('computer task step was not an object')
    }
    expect(firstStep).not.toHaveProperty('screenshot')
    expect(saveImage.mock.calls.map(([input]) => input.name)).toEqual([
      'computer-use-task-step-1.png',
      'computer-use-task-result.png',
    ])
    await ctx.fiber.dispose()
  })

  it('returns a durable stopped result with the saved step screenshot when action approval is unavailable', async () => {
    const { ctx, saveImage, macosClick } = await boot(() => Promise.resolve({ kind: 'click', x: 1, y: 1 }))
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const stopped = await runComputerTask(ctx)
    expect(stopped.value).toMatchObject({
      completed: false,
      verification: {
        modelDone: false,
        status: 'not_reached',
      },
      steps: [{
        action: '{"kind":"click","x":1,"y":1}',
        screenshot: { attachmentId: 'attachment-computer-use-task-step-1.png' },
      }],
    })
    const serializedStopped = JSON.stringify(stopped.value)
    expect(serializedStopped).toContain('Stopped:')
    expect(serializedStopped).toContain('no user approval channel')
    expect(macosClick).not.toHaveBeenCalled()
    expect(saveImage.mock.calls.map(([input]) => input.name)).toEqual([
      'computer-use-task-step-1.png',
      'computer-use-task-result.png',
    ])
    const content = (stopped.view as { content?: Array<{ type: string }> } | undefined)?.content
    expect(content?.some(block => block.type === 'image')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('returns the already-captured step screenshot when the GUI model decision fails', async () => {
    const { ctx, saveImage } = await boot(() => Promise.reject(new Error('vision provider unavailable')))

    const stopped = await runComputerTask(ctx)

    expect(stopped.value).toMatchObject({
      completed: false,
      verification: {
        modelDone: false,
        status: 'not_reached',
      },
      steps: [{
        phase: 'decision',
        outcome: 'error: Error: vision provider unavailable',
        screenshot: { attachmentId: 'attachment-computer-use-task-step-1.png' },
      }],
    })
    expect(JSON.stringify(stopped.value)).toContain('vision provider unavailable')
    expect(saveImage.mock.calls.map(([input]) => input.name)).toEqual([
      'computer-use-task-step-1.png',
      'computer-use-task-result.png',
    ])
    const content = (stopped.view as {
      content?: Array<{ type: string; text?: string }>
    } | undefined)?.content
    expect(content).toContainEqual({
      type: 'text',
      text: 'Step 1: decision failed -> error: Error: vision provider unavailable',
    })
    expect(content?.some(block => block.type === 'image')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('fails a direct mutation closed before dispatch when confirm-every has no approval channel', async () => {
    const { ctx, macosClick } = await boot()
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('strict-direct-click'),
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    const failureContent = result.content[0]
    expect(failureContent?.type).toBe('text')
    expect(failureContent?.type === 'text' ? failureContent.text : '').toContain('changes GUI state')
    expect(macosClick).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('does not execute or restore a direct mutation when its approval is rejected', async () => {
    const { ctx, macosClick, macosReactivateWindowObservation } = await boot(undefined, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const request = vi.fn(() => Promise.resolve('rejected' as const))
    ctx.provide('approval', { request } as never)

    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('strict-direct-click-rejected'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('rejected')
    expect(request).toHaveBeenCalledOnce()
    expect(macosClick).not.toHaveBeenCalled()
    expect(macosReactivateWindowObservation).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('marks an allowed direct computer mutation for same-Mac focus restoration exactly once', async () => {
    const { ctx, macosClick } = await boot()
    const request = vi.fn((_input: { reason?: string }) => Promise.resolve('allowed-once' as const))
    ctx.provide('approval', { request } as never)
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('strict-direct-click-approved'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(request).toHaveBeenCalledOnce()
    expect(macosClick).toHaveBeenCalledWith({
      x: 1,
      y: 1,
      observationId: 'macos-observation',
      restoreObservedFocus: true,
    }, expect.any(AbortSignal), 'session-1')
    await ctx.fiber.dispose()
  })

  it('preserves a downstream denial instead of letting the local confirmation bypass it', async () => {
    const { ctx, macosClick } = await boot(undefined, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const request = vi.fn(() => Promise.resolve('allowed-once' as const))
    const downstream = vi.fn(() => Promise.resolve({
      kind: 'deny' as const,
      reason: 'downstream policy denied this target',
    }))
    ctx.provide('approval', { request } as never)
    ctx.on('tools/pre-execute', downstream)

    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('strict-direct-downstream-deny'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('downstream policy denied this target')
    expect(downstream).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
    expect(macosClick).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('restores a direct desktop observation after a downstream approval even when confirm-every is off', async () => {
    const { ctx, macosClick } = await boot()
    const request = vi.fn(() => Promise.resolve('allowed-once' as const))
    ctx.provide('approval', { request } as never)
    ctx.on('tools/pre-execute', () => Promise.resolve({
      kind: 'ask' as const,
      reason: 'organization policy requires approval',
    }))

    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('relaxed-direct-downstream-ask'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'organization policy requires approval',
    }))
    expect(macosClick).toHaveBeenCalledWith({
      x: 1,
      y: 1,
      observationId: 'macos-observation',
      restoreObservedFocus: true,
    }, expect.any(AbortSignal), 'session-1')
    await ctx.fiber.dispose()
  })

  it('marks an upstream-approved direct call without replacing its original screen token', async () => {
    const { ctx, macosClick, macosScreenshot } = await boot()
    const { request } = provideWaterfallApproval(ctx, 'allowed-once')
    // This later prepended hook short-circuits the plugin's pre-execute hook;
    // recovery must therefore come from the public approval lifecycle.
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'computer_click'
      ? Promise.resolve({ kind: 'ask' as const, reason: 'upstream policy requires approval' })
      : next(), { prepend: true })

    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'original-screen-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('upstream-approved-direct-click'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(request).toHaveBeenCalledOnce()
    // A direct call already has the correct private proof. Taking another
    // screenshot here would revoke the original owner-bound token.
    expect(macosScreenshot).not.toHaveBeenCalled()
    expect(macosClick).toHaveBeenCalledWith({
      x: 1,
      y: 1,
      observationId: 'original-screen-observation',
      restoreObservedFocus: true,
    }, expect.any(AbortSignal), 'session-1')
    await ctx.fiber.dispose()
  })

  it('combines local and downstream approval reasons without weakening either policy', async () => {
    const { ctx, macosClick } = await boot(undefined, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const request = vi.fn((_input: { reason?: string }) => Promise.resolve('allowed-once' as const))
    ctx.provide('approval', { request } as never)
    ctx.on('tools/pre-execute', () => Promise.resolve({
      kind: 'ask' as const,
      reason: 'organization policy requires approval',
    }))

    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('strict-direct-combined-ask'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    const reason = request.mock.calls[0]?.[0].reason
    expect(reason).toContain('organization policy requires approval')
    expect(reason).toContain('changes GUI state')
    expect(macosClick).toHaveBeenCalledWith(expect.objectContaining({
      restoreObservedFocus: true,
    }), expect.any(AbortSignal), 'session-1')
    await ctx.fiber.dispose()
  })

  it('short-circuits downstream policy when the local single-task guard denies', async () => {
    const decision = Promise.withResolvers<unknown>()
    const nextAction = vi.fn(() => decision.promise)
    const { ctx, macosClick } = await boot(nextAction)
    const downstream = vi.fn(() => Promise.resolve({ kind: 'allow' as const }))
    ctx.on('tools/pre-execute', downstream)
    const running = runComputerTask(ctx)
    await vi.waitFor(() => { expect(nextAction).toHaveBeenCalledOnce() })

    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { x: 1, y: 1, observation_id: 'macos-observation' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('single-task-local-deny'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('another GUI task is active')
    expect(downstream).not.toHaveBeenCalled()
    expect(macosClick).not.toHaveBeenCalled()
    decision.resolve({ kind: 'done', summary: 'Finished.' })
    await running
    await ctx.fiber.dispose()
  })

  it('rebinds a downstream-approved desktop task before taking its first model screenshot', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'Finished.' }))
    const {
      ctx,
      macosScreenshot,
      macosReactivateScreenObservation,
    } = await boot(nextAction)
    const { request, answer } = provideWaterfallApproval(ctx, 'allowed-once')
    // Installed after the plugin and prepended, this wrapper can short-circuit
    // the plugin's tools/pre-execute listener. The approval seam must still
    // capture before the terminal answerer focuses Harness.
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'computer_use_task'
      ? Promise.resolve({ kind: 'ask' as const, reason: 'outer task policy requires approval' })
      : next(), { prepend: true })

    const result = await ctx.tools.execute({
      name: 'computer_use_task',
      arguments: { task: 'inspect the current desktop' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('downstream-approved-desktop-task'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(request).toHaveBeenCalledOnce()
    expect(macosReactivateScreenObservation).toHaveBeenCalledWith(
      'macos-observation',
      expect.any(AbortSignal),
      'session-1',
    )
    expect(macosScreenshot).toHaveBeenCalledTimes(3)
    expect(macosScreenshot.mock.invocationCallOrder[0])
      .toBeLessThan(answer.mock.invocationCallOrder[0]!)
    expect(answer.mock.invocationCallOrder[0])
      .toBeLessThan(macosReactivateScreenObservation.mock.invocationCallOrder[0]!)
    expect(macosReactivateScreenObservation.mock.invocationCallOrder[0])
      .toBeLessThan(macosScreenshot.mock.invocationCallOrder[1]!)
    expect(macosScreenshot.mock.invocationCallOrder[1])
      .toBeLessThan(nextAction.mock.invocationCallOrder[0]!)
    await ctx.fiber.dispose()
  })

  it('atomically rejects a duplicate pending task approval and consumes only the first recovery', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'Finished.' }))
    const {
      ctx,
      macosScreenshot,
      macosReactivateScreenObservation,
    } = await boot(nextAction)
    const { request, answer, release } = provideDeferredWaterfallApproval(ctx)
    const approval: TestApprovalRequest = {
      agent: { id: 'session-1' },
      toolName: 'computer_use_task',
      callId: 'duplicate-task-approval',
      signal: new AbortController().signal,
    }

    const first = request(approval)
    await vi.waitFor(() => {
      expect(answer).toHaveBeenCalledOnce()
      expect(macosScreenshot).toHaveBeenCalledOnce()
    })
    await expect(request(approval)).resolves.toBe('unavailable')
    expect(answer).toHaveBeenCalledOnce()
    expect(macosScreenshot).toHaveBeenCalledOnce()
    release.resolve('allowed-once')
    await expect(first).resolves.toBe('allowed-once')

    const tool = ctx.tools.get('computer_use_task')
    if (tool === undefined) throw new Error('computer_use_task was not registered')
    const exec = {
      agent: { id: 'session-1' },
      callId: 'duplicate-task-approval',
      signal: new AbortController().signal,
    } as never
    await tool.execute({ task: 'inspect the current desktop' }, exec)
    await tool.execute({ task: 'inspect the current desktop' }, exec)
    expect(macosReactivateScreenObservation).toHaveBeenCalledOnce()
    expect(nextAction).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('bounds all pending approval recoveries and releases capacity after rejection', async () => {
    const { ctx, macosScreenshot } = await boot()
    const { request, answer, release } = provideDeferredWaterfallApproval(ctx)
    const pending = Array.from({ length: 128 }, (_, index) => request({
      agent: { id: `session-${String(index)}` },
      toolName: 'computer_click',
      callId: `bounded-${String(index)}`,
      signal: new AbortController().signal,
    }))
    await vi.waitFor(() => { expect(answer).toHaveBeenCalledTimes(128) })

    await expect(request({
      agent: { id: 'session-over-capacity' },
      toolName: 'computer_click',
      callId: 'bounded-over-capacity',
      signal: new AbortController().signal,
    })).resolves.toBe('unavailable')
    expect(answer).toHaveBeenCalledTimes(128)
    expect(macosScreenshot).not.toHaveBeenCalled()

    release.resolve('rejected')
    await expect(Promise.all(pending)).resolves.toEqual(Array.from({ length: 128 }, () => 'rejected'))
    await expect(request({
      agent: { id: 'session-after-capacity' },
      toolName: 'computer_click',
      callId: 'bounded-after-capacity',
      signal: new AbortController().signal,
    })).resolves.toBe('rejected')
    expect(answer).toHaveBeenCalledTimes(129)
    await ctx.fiber.dispose()
  })

  it('releases an exact pending approval reservation when its answerer throws', async () => {
    const { ctx, macosScreenshot } = await boot()
    const answer = vi.fn()
      .mockRejectedValueOnce(new Error('approval transport failed'))
      .mockResolvedValueOnce('rejected' as const)
    const request = vi.fn((input: TestApprovalRequest) => ctx.waterfall(
      ctx as never,
      'approval/request',
      input as never,
      answer,
    ))
    ctx.provide('approval', { request } as never)
    const approval: TestApprovalRequest = {
      agent: { id: 'session-1' },
      toolName: 'computer_use_task',
      callId: 'retry-after-answerer-error',
      signal: new AbortController().signal,
    }

    await expect(request(approval)).rejects.toThrow('approval transport failed')
    await expect(request(approval)).resolves.toBe('rejected')
    expect(answer).toHaveBeenCalledTimes(2)
    expect(macosScreenshot).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('does not restore or start a desktop task when its outer approval is rejected', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'must not run' }))
    const {
      ctx,
      macosScreenshot,
      macosReactivateScreenObservation,
    } = await boot(nextAction)
    const { request } = provideWaterfallApproval(ctx, 'rejected')
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'computer_use_task'
      ? Promise.resolve({ kind: 'ask' as const, reason: 'outer task policy requires approval' })
      : next(), { prepend: true })

    const result = await ctx.tools.execute({
      name: 'computer_use_task',
      arguments: { task: 'inspect the current desktop' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('rejected-downstream-desktop-task'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(macosScreenshot).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
    expect(macosReactivateScreenObservation).not.toHaveBeenCalled()
    expect(nextAction).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('fails the approved outer task before its first model screenshot when exact rebind fails', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'must not run' }))
    const {
      ctx,
      macosScreenshot,
      macosReactivateScreenObservation,
    } = await boot(nextAction)
    macosReactivateScreenObservation.mockRejectedValueOnce(new Error('approved target pixels changed'))
    provideWaterfallApproval(ctx, 'allowed-once')
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'computer_use_task'
      ? Promise.resolve({ kind: 'ask' as const, reason: 'outer task policy requires approval' })
      : next(), { prepend: true })

    const result = await ctx.tools.execute({
      name: 'computer_use_task',
      arguments: { task: 'inspect the current desktop' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('changed-approved-desktop-task'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('approved target pixels changed')
    expect(macosScreenshot).toHaveBeenCalledOnce()
    expect(macosReactivateScreenObservation).toHaveBeenCalledOnce()
    expect(nextAction).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('does not capture a task rebind when downstream policy denies before approval', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'must not run' }))
    const {
      ctx,
      macosScreenshot,
      macosReactivateScreenObservation,
    } = await boot(nextAction)
    const request = vi.fn(() => Promise.resolve('allowed-once' as const))
    ctx.provide('approval', { request } as never)
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'computer_use_task'
      ? Promise.resolve({ kind: 'deny' as const, reason: 'outer task policy denied' })
      : next())

    const result = await ctx.tools.execute({
      name: 'computer_use_task',
      arguments: { task: 'inspect the current desktop' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('denied-downstream-desktop-task'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(macosScreenshot).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(macosReactivateScreenObservation).not.toHaveBeenCalled()
    expect(nextAction).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('does not add desktop rebind behavior to an outer-approved browser task', async () => {
    const nextAction = vi.fn(() => Promise.resolve({ kind: 'done', summary: 'Finished.' }))
    const {
      ctx,
      macosScreenshot,
      macosReactivateScreenObservation,
    } = await boot(nextAction)
    const { request } = provideWaterfallApproval(ctx, 'allowed-once')
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'browser_use_task'
      ? Promise.resolve({ kind: 'ask' as const, reason: 'outer browser policy requires approval' })
      : next(), { prepend: true })

    const result = await ctx.tools.execute({
      name: 'browser_use_task',
      arguments: { task: 'inspect the current page' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('downstream-approved-browser-task'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(request).toHaveBeenCalledOnce()
    expect(nextAction).toHaveBeenCalledOnce()
    expect(macosScreenshot).not.toHaveBeenCalled()
    expect(macosReactivateScreenObservation).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('takes the desktop screenshot before strict autonomous approval and restores that observation', async () => {
    let action = 0
    const { ctx, macosScreenshot, macosClick } = await boot(
      () => Promise.resolve(action++ === 0
        ? { kind: 'click', x: 1, y: 1 }
        : { kind: 'done', summary: 'Finished.' }),
      { confirmEveryMutation: true, confirmDestructiveActions: false },
    )
    const { request } = provideWaterfallApproval(ctx, 'allowed-once')

    const result = await runComputerTask(ctx)

    expect(result.value).toMatchObject({ summary: 'Finished.' })
    expect(request).toHaveBeenCalledOnce()
    expect(macosScreenshot).toHaveBeenCalledTimes(3)
    expect(macosScreenshot.mock.invocationCallOrder[0])
      .toBeLessThan(request.mock.invocationCallOrder[0]!)
    expect(macosClick).toHaveBeenCalledWith({
      x: 1,
      y: 1,
      button: 'left',
      observationId: 'macos-observation',
      restoreObservedFocus: true,
    }, expect.any(AbortSignal), 'session-1')
    await ctx.fiber.dispose()
  })

  it('defers one relaxed high-impact desktop-task approval until its first grounded action', async () => {
    let action = 0
    const { ctx, macosScreenshot, macosClick } = await boot(() => Promise.resolve(action++ === 0
      ? { kind: 'click', x: 1, y: 1 }
      : { kind: 'done', summary: 'Deleted.' }))
    const request = vi.fn((_input: { reason?: string }) => Promise.resolve('allowed-once' as const))
    ctx.provide('approval', { request } as never)

    const result = await ctx.tools.execute({
      name: 'computer_use_task',
      arguments: { task: 'delete this draft' },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('relaxed-high-impact-desktop-task'),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0].reason).toContain('first concrete action')
    expect(macosScreenshot.mock.invocationCallOrder[0])
      .toBeLessThan(request.mock.invocationCallOrder[0]!)
    expect(macosClick).toHaveBeenCalledWith(expect.objectContaining({
      observationId: 'macos-observation',
      restoreObservedFocus: true,
    }), expect.any(AbortSignal), 'session-1')
    await ctx.fiber.dispose()
  })

  it('reactivates the original semantic target before fresh Accessibility revalidation', async () => {
    const {
      ctx,
      macosClick,
      macosReactivateWindowObservation,
      macosWindowState,
    } = await boot()
    const stateTool = ctx.tools.get('computer_get_window_state')
    if (stateTool === undefined) throw new Error('computer_get_window_state was not registered')
    const signal = new AbortController().signal
    const state = await stateTool.execute({ window_id: 41 }, {
      agent: { id: 'session-1' },
      callId: ToolCallId('semantic-state'),
      signal,
    } as never) as { elements: Array<{ token: string }> }
    const token = state.elements[0]?.token
    if (token === undefined) throw new Error('semantic fixture did not return a token')

    const request = vi.fn(() => Promise.resolve('allowed-once' as const))
    ctx.provide('approval', { request } as never)
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      confirmEveryMutation: true,
      confirmDestructiveActions: false,
    })
    const result = await ctx.tools.execute({
      name: 'computer_click',
      arguments: { element: token },
      agent: { id: 'session-1' } as never,
      callId: ToolCallId('semantic-click-approved'),
      signal,
    })

    expect(result.isError).toBe(false)
    expect(macosReactivateWindowObservation).toHaveBeenCalledWith({
      observationId: 'window-observation-1',
      window: {
        id: 41,
        app: 'Notes',
        bundleId: 'com.apple.Notes',
        pid: 4,
        title: 'Draft',
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        onScreen: true,
      },
    }, signal, 'session-1')
    expect(macosWindowState).toHaveBeenCalledTimes(2)
    expect(macosClick).toHaveBeenCalledWith({
      x: 40,
      y: 45,
      target: {
        observationId: 'window-observation-2',
        window: {
          id: 41,
          app: 'Notes',
          bundleId: 'com.apple.Notes',
          pid: 4,
          title: 'Draft',
          bounds: { x: 10, y: 20, width: 300, height: 200 },
          onScreen: true,
        },
      },
      restoreObservedFocus: true,
    }, signal, 'session-1')
    await ctx.fiber.dispose()
  })

  it('projects every browser policy field from live visual settings into the browser service', async () => {
    const { ctx, browserConfigure } = await boot()
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      browserHeadless: false,
      browserAllowedDomains: 'example.com\napi.example.com',
      browserDeniedDomains: 'private.example.com',
      browserAllowPrivateNetwork: true,
    })
    expect(browserConfigure).toHaveBeenLastCalledWith({
      headless: false,
      allowedDomains: ['example.com', 'api.example.com'],
      deniedDomains: ['private.example.com'],
      allowPrivateNetwork: true,
      backend: 'playwright',
    })
    await ctx.fiber.dispose()
  })

  it('rejects malformed precise app rules before persistence and preserves the last live policy', async () => {
    const { ctx, macosConfigure } = await boot()
    const settings = ctx.get('settings') as MemorySettings
    await ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      readAppGrants: 'name=Notes | bundleId=com.apple.Notes',
    })
    const acceptedDoc = structuredClone(settings.doc)
    const acceptedProjection: unknown = macosConfigure.mock.lastCall?.[0]
    const configureCalls = macosConfigure.mock.calls.length

    await expect(ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      readAppGrants: 'bundle=com.apple.Safari',
    })).rejects.toThrow(/invalid application identity rule/)
    expect(settings.doc).toEqual(acceptedDoc)
    expect(macosConfigure).toHaveBeenCalledTimes(configureCalls)
    expect(macosConfigure.mock.lastCall?.[0]).toEqual(acceptedProjection)

    await expect(ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      readAppGrants: 'name=Notes | name=Safari',
    })).rejects.toThrow(/duplicate name/)
    expect(settings.doc).toEqual(acceptedDoc)
    expect(macosConfigure).toHaveBeenCalledTimes(configureCalls)
    expect(macosConfigure.mock.lastCall?.[0]).toEqual(acceptedProjection)

    await expect(ctx.settings.update(plugin.TOOL_MACOS_USE_SETTINGS_NAMESPACE, {
      controlAppGrants: 'name=Safari | bundleId=com.apple.Safari',
    })).rejects.toThrow(/Read app grant/i)
    expect(settings.doc).toEqual(acceptedDoc)
    expect(macosConfigure).toHaveBeenCalledTimes(configureCalls)
    expect(macosConfigure.mock.lastCall?.[0]).toEqual(acceptedProjection)
    await ctx.fiber.dispose()
  })

  it('only reports verified completion when a requested browser postcondition passes', async () => {
    const { ctx, browserPageState } = await boot()
    const tool = ctx.tools.get('browser_use_task')
    if (tool === undefined) throw new Error('browser_use_task was not registered')
    const signal = new AbortController().signal
    const passed = await tool.execute({
      task: 'open the ready page',
      postcondition: { url_equals: 'https://example.test/', text_contains: 'Ready' },
    }, { agent: { id: 'session-1' }, callId: 'browser-task-pass', signal } as never) as {
      completed: boolean
      verification: { status: string; checks: Array<{ passed: boolean }> }
    }
    expect(passed.completed).toBe(true)
    expect(passed.verification.status).toBe('verified')
    expect(passed.verification.checks.every(check => check.passed)).toBe(true)

    browserPageState.mockResolvedValueOnce({
      url: 'https://example.test/login', title: 'Login', text: 'Sign in',
    })
    const failed = await tool.execute({
      task: 'open the ready page',
      postcondition: { url_equals: 'https://example.test/', text_contains: 'Ready' },
    }, { agent: { id: 'session-1' }, callId: 'browser-task-fail', signal } as never) as {
      completed: boolean
      verification: { status: string }
    }
    expect(failed.completed).toBe(false)
    expect(failed.verification.status).toBe('postcondition_failed')
    await ctx.fiber.dispose()
  })
})
