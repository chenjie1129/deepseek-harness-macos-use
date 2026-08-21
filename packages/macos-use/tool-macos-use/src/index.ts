/**
 * Model-facing Consumer of the `ctx.macosUse` / `ctx.guiModel` / `ctx.browserUse` capability seams: primitive
 * screen, keyboard, app-launch, and AppleScript tools; primitive browser navigation/selector tools; and two
 * vision-model-driven task tools (`computer_use_task`, `browser_use_task`) that loop screenshot -> `ctx.guiModel`
 * decision -> action until the model reports the task done.
 * @module @deepseek-ai/dsh-tool-macos-use
 */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-macos-use'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type {} from '@deepseek-ai/dsh-browser-use'
import { browserTaskExecutor, macosTaskExecutor } from './executors.ts'
import { runGuiTask } from './loop.ts'
import type { TaskStepLog } from './loop.ts'

export const name = 'tool-macos-use'
export const inject = ['tools', 'macosUse', 'guiModel', 'browserUse', 'attachments']

/** Config for the macOS-use / browser-use tool consumer. */
export interface Config {
  /** Default `max_steps` for `computer_use_task` / `browser_use_task` when the model omits it. Defaults to 20. */
  defaultMaxSteps?: number
}

const TOOL_MACOS_USE_DEFAULT_MAX_STEPS = 20

export const Config: z<Config> = z.object({
  defaultMaxSteps: z.number().step(1).min(1),
})

const IMAGE_REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'number', required: true },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
    name: { type: 'string' },
  },
} as const

const STEP_LOG_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', required: true },
      outcome: { type: 'string' },
    },
  },
} as const

/**
 * Describe a saved screenshot as text rather than an `image` content block. The DeepSeek chat-completions
 * adapter (this harness's primary driving model) rejects image tool-result content outright — GUI grounding
 * already goes through `ctx.guiModel`'s own vision call, entirely outside the driving model's context, so the
 * driving model only ever needs to know a capture happened and where its durable record lives.
 */
function describeScreenshot(ref: ImageAttachmentRef): string {
  return `Screenshot captured (${String(ref.width)}x${String(ref.height)}, ${String(ref.bytes)} bytes, attachment ${ref.attachmentId}).`
}

function renderStepLog(steps: readonly TaskStepLog[]): string {
  return steps.map((entry, index) => {
    const outcome = entry.outcome === undefined ? '' : ` -> ${entry.outcome}`
    return `${index + 1}. ${JSON.stringify(entry.action)}${outcome}`
  }).join('\n')
}

interface EncodedStep {
  action: string
  outcome?: string
}

function decodeSteps(steps: readonly EncodedStep[]): TaskStepLog[] {
  return steps.map(step => ({
    action: JSON.parse(step.action) as GuiAction,
    ...step.outcome !== undefined ? { outcome: step.outcome } : {},
  }))
}

function encodeSteps(steps: readonly TaskStepLog[]): EncodedStep[] {
  return steps.map(step => ({
    action: JSON.stringify(step.action),
    ...step.outcome !== undefined ? { outcome: step.outcome } : {},
  }))
}

interface TaskResultValue {
  completed: boolean
  summary: string
  steps: readonly EncodedStep[]
  finalScreenshot: ImageAttachmentRef
}

function renderTaskResult(value: TaskResultValue) {
  const status = value.completed ? 'Completed' : 'Stopped'
  const log = renderStepLog(decodeSteps(value.steps))
  const screenshot = describeScreenshot(value.finalScreenshot)
  return [{ type: 'text' as const, text: `${status}: ${value.summary}\n\n${log}\n\n${screenshot}` }]
}

export function apply(ctx: Context, config: Config = {}): void {
  const defaultMaxSteps = config.defaultMaxSteps ?? TOOL_MACOS_USE_DEFAULT_MAX_STEPS

  ctx.tools.register(defineTool({
    name: 'computer_screenshot',
    description: 'Capture a screenshot of the current macOS screen and return it as an image.',
    parameters: {},
    output: {
      schema: IMAGE_REF_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: describeScreenshot(value as unknown as ImageAttachmentRef) }],
    },
    async execute(_args, exec) {
      const { pngBase64 } = await ctx.macosUse.screenshot(exec.signal)
      const ref = await ctx.attachments.saveImage({ data: Buffer.from(pngBase64, 'base64'), mediaType: 'image/png', name: 'screenshot.png' })
      return ref
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_click',
    description: 'Click, double-click, or right-click at absolute macOS screen coordinates (top-left origin, in points). '
      + 'Take a computer_screenshot first to find target coordinates.',
    parameters: {
      x: { type: 'number', required: true, description: 'Absolute screen x coordinate.' },
      y: { type: 'number', required: true, description: 'Absolute screen y coordinate.' },
      button: { type: 'string', enum: ['left', 'right'] as const, description: 'Defaults to "left".' },
      double_click: { type: 'boolean', description: 'Double-click instead of a single click. Ignored when button is "right".' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'clicked' }],
    },
    async execute(args, exec) {
      await ctx.macosUse.click({
        x: args.x,
        y: args.y,
        ...args.button !== undefined ? { button: args.button } : {},
        ...args.double_click !== undefined ? { doubleClick: args.double_click } : {},
      }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_type',
    description: 'Type literal text into the currently focused macOS element via keystroke events.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to type.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'typed' }],
    },
    async execute(args, exec) {
      await ctx.macosUse.type({ text: args.text }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_key',
    description: 'Press a single key or modifier combo on macOS, e.g. "return", "escape", "cmd+shift+t", "a".',
    parameters: {
      combo: { type: 'string', required: true, description: 'Key or "+"-joined modifier combo.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'pressed' }],
    },
    async execute(args, exec) {
      await ctx.macosUse.key({ combo: args.combo }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_open_app',
    description: 'Launch or bring to the front a macOS application by name, e.g. "Safari", "Notes".',
    parameters: {
      name: { type: 'string', required: true, description: 'Application name as `open -a` resolves it.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'opened' }],
    },
    async execute(args, exec) {
      await ctx.macosUse.openApp({ name: args.name }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_run_applescript',
    description: 'Run arbitrary AppleScript via `osascript` for macOS automation the other computer_* tools do not '
      + 'cover directly (e.g. reading window titles, controlling a specific application\'s own scripting dictionary).',
    parameters: {
      script: { type: 'string', required: true, description: 'Complete AppleScript source.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.stdout }],
    },
    async execute(args, exec) {
      const stdout = await ctx.macosUse.runAppleScript({ script: args.script }, exec.signal)
      return { stdout }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_use_task',
    description: 'Autonomously operate the macOS desktop to accomplish a task: repeatedly screenshots the screen, '
      + 'asks the configured GUI model where to click/type/press next, and executes that action, until the model '
      + 'reports the task done or the step budget runs out. Use this for open-ended desktop tasks; prefer the '
      + 'primitive computer_* tools for one specific, already-known action.',
    parameters: {
      task: { type: 'string', required: true, description: 'The task to accomplish on the desktop, in natural language.' },
      max_steps: { type: 'integer', description: `Step budget before giving up. Defaults to ${String(defaultMaxSteps)}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          completed: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
          steps: STEP_LOG_SCHEMA,
          finalScreenshot: IMAGE_REF_SCHEMA,
        },
      },
      render: (_args, value) => renderTaskResult({
        ...value,
        finalScreenshot: value.finalScreenshot as unknown as ImageAttachmentRef,
      }),
    },
    async execute(args, exec) {
      const result = await runGuiTask(ctx.guiModel, macosTaskExecutor(ctx), {
        task: args.task,
        maxSteps: args.max_steps ?? defaultMaxSteps,
        signal: exec.signal,
      })
      const { pngBase64 } = await ctx.macosUse.screenshot(exec.signal)
      const finalScreenshot = await ctx.attachments.saveImage({ data: Buffer.from(pngBase64, 'base64'), mediaType: 'image/png', name: 'computer-use-task-result.png' })
      return {
        completed: result.completed,
        summary: result.summary,
        steps: encodeSteps(result.steps),
        finalScreenshot,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: 'Navigate the automated browser tab to a URL, launching the browser first if needed.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute URL to load.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'navigated' }],
    },
    async execute(args, exec) {
      await ctx.browserUse.navigate({ url: args.url }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click the first element matching a CSS or Playwright text/role selector on the current page, '
      + 'e.g. "#submit" or \'text=Sign in\'. Prefer this over browser_use_task for one known, selector-addressable click.',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS or Playwright text/role selector.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'clicked' }],
    },
    async execute(args, exec) {
      await ctx.browserUse.clickSelector({ selector: args.selector }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_fill',
    description: 'Replace the value of the first input matching a selector with literal text.',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS or Playwright text/role selector for the input.' },
      text: { type: 'string', required: true, description: 'Text to set as the input\'s value.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: () => [{ type: 'text', text: 'filled' }],
    },
    async execute(args, exec) {
      await ctx.browserUse.fillSelector({ selector: args.selector, text: args.text }, exec.signal)
      return {}
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_extract_text',
    description: 'Read the inner text of the first element matching a selector, or the whole page body when omitted.',
    parameters: {
      selector: { type: 'string', description: 'CSS or Playwright selector; omitted = the whole page body.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const text = await ctx.browserUse.extractText(args.selector !== undefined ? { selector: args.selector } : {}, exec.signal)
      return { text }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the automated browser tab\'s current viewport and return it as an image.',
    parameters: {},
    output: {
      schema: IMAGE_REF_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: describeScreenshot(value as unknown as ImageAttachmentRef) }],
    },
    async execute(_args, exec) {
      const { pngBase64 } = await ctx.browserUse.screenshot(exec.signal)
      const ref = await ctx.attachments.saveImage({ data: Buffer.from(pngBase64, 'base64'), mediaType: 'image/png', name: 'browser-screenshot.png' })
      return ref
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_use_task',
    description: 'Autonomously operate the browser to accomplish a task: repeatedly screenshots the page, asks the '
      + 'configured GUI model where to click/type/press next, and executes that action, until the model reports the '
      + 'task done or the step budget runs out. Optionally navigates to a starting URL first. Use this for open-ended '
      + 'browsing tasks; prefer browser_navigate/browser_click/browser_fill/browser_extract_text when the exact '
      + 'selectors and steps are already known.',
    parameters: {
      task: { type: 'string', required: true, description: 'The task to accomplish in the browser, in natural language.' },
      url: { type: 'string', description: 'Optional starting URL to navigate to before the loop begins.' },
      max_steps: { type: 'integer', description: `Step budget before giving up. Defaults to ${String(defaultMaxSteps)}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          completed: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
          steps: STEP_LOG_SCHEMA,
          finalScreenshot: IMAGE_REF_SCHEMA,
        },
      },
      render: (_args, value) => renderTaskResult({
        ...value,
        finalScreenshot: value.finalScreenshot as unknown as ImageAttachmentRef,
      }),
    },
    async execute(args, exec) {
      if (args.url !== undefined) await ctx.browserUse.navigate({ url: args.url }, exec.signal)
      const result = await runGuiTask(ctx.guiModel, browserTaskExecutor(ctx), {
        task: args.task,
        maxSteps: args.max_steps ?? defaultMaxSteps,
        signal: exec.signal,
      })
      const { pngBase64 } = await ctx.browserUse.screenshot(exec.signal)
      const finalScreenshot = await ctx.attachments.saveImage({ data: Buffer.from(pngBase64, 'base64'), mediaType: 'image/png', name: 'browser-use-task-result.png' })
      return {
        completed: result.completed,
        summary: result.summary,
        steps: encodeSteps(result.steps),
        finalScreenshot,
      }
    },
  }))
}
