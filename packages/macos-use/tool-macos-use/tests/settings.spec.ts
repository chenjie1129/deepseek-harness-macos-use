/** Live step-screenshot setting and the model/UI output split for GUI task tools. */

import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as plugin from '../src/index.ts'

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

async function boot() {
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
    ...input.name === undefined ? {} : { name: input.name },
  }))
  ctx.provide('attachments', { saveImage } as never)
  ctx.provide('guiModel', {
    nextAction: () => Promise.resolve({ kind: 'done', summary: 'Finished.' }),
  } as never)
  ctx.provide('macosUse', {
    screenshot: () => Promise.resolve({ pngBase64: Buffer.from('png').toString('base64') }),
  } as never)
  ctx.provide('browserUse', {
    navigate: () => Promise.resolve(),
    screenshot: () => Promise.resolve({ pngBase64: Buffer.from('png').toString('base64') }),
  } as never)
  await ctx.plugin(plugin, {})
  return { ctx, saveImage }
}

async function runComputerTask(ctx: Context) {
  const tool = ctx.tools.get('computer_use_task')
  if (tool === undefined) throw new Error('computer_use_task was not registered')
  const args = { task: 'open settings' }
  const value = await tool.execute(args, { signal: new AbortController().signal } as never) as JsonValue
  const content = tool.output.render(args, value)
  const meta = tool.output.presentationMeta?.(args, value)
  const view = tool.presentResult?.(args, { content, isError: false, ...meta === undefined ? {} : { meta } })
  return { value, content, view }
}

describe('tool-macos-use task presentation settings', () => {
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
      { type: 'text', text: 'Completed: Finished.' },
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
      { type: 'text', text: 'Completed: Finished.' },
      { type: 'text', text: 'Step 1: {"kind":"done","summary":"Finished."}' },
    ])
    expect(hiddenContent).toHaveLength(3)
    expect(hiddenContent?.at(-1)?.text).toContain('Screenshot captured')
    await ctx.fiber.dispose()
  })
})
