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
import type { JsonValue, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-macos-use'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type {} from '@deepseek-ai/dsh-browser-use'
import { browserTaskExecutor, macosTaskExecutor } from './executors.ts'
import { fitPngToAttachmentLimits } from './image.ts'
import { runGuiTask } from './loop.ts'
import type { TaskStepLog } from './loop.ts'

export const name = 'tool-macos-use'
export const inject = ['tools', 'macosUse', 'guiModel', 'browserUse', 'attachments']

/** Config for the macOS-use / browser-use tool consumer. */
export interface Config {
  /** Default `max_steps` for `computer_use_task` / `browser_use_task` when the model omits it. Defaults to 20. */
  defaultMaxSteps?: number
  /** Save and show the screenshot that grounded each task step. Defaults to true. */
  showStepScreenshots?: boolean
}

const TOOL_MACOS_USE_DEFAULT_MAX_STEPS = 20
const TOOL_MACOS_USE_DEFAULT_SHOW_STEP_SCREENSHOTS = true

export const Config: z<Config> = z.object({
  defaultMaxSteps: z.number().step(1).min(1).default(TOOL_MACOS_USE_DEFAULT_MAX_STEPS),
  showStepScreenshots: z.boolean().default(TOOL_MACOS_USE_DEFAULT_SHOW_STEP_SCREENSHOTS),
})

/** Live settings namespace for user-owned task presentation preferences. */
export const TOOL_MACOS_USE_SETTINGS_NAMESPACE = settingsNamespace('tool-macos-use')

interface TaskPresentationSettings {
  showStepScreenshots?: boolean
}

const TaskPresentationSettings: z<TaskPresentationSettings> = z.object({
  showStepScreenshots: z.boolean().default(TOOL_MACOS_USE_DEFAULT_SHOW_STEP_SCREENSHOTS),
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
      screenshot: IMAGE_REF_SCHEMA,
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
  screenshot?: ImageAttachmentRef
}

function decodeSteps(steps: readonly EncodedStep[]): TaskStepLog[] {
  return steps.map(step => ({
    action: JSON.parse(step.action) as GuiAction,
    ...step.outcome !== undefined ? { outcome: step.outcome } : {},
  }))
}

function encodeSteps(steps: readonly TaskStepLog[], screenshots: readonly ImageAttachmentRef[]): EncodedStep[] {
  return steps.map((step, index) => ({
    action: JSON.stringify(step.action),
    ...step.outcome !== undefined ? { outcome: step.outcome } : {},
    ...screenshots[index] !== undefined ? { screenshot: screenshots[index] } : {},
  }))
}

interface TaskResultValue {
  completed: boolean
  summary: string
  steps: readonly EncodedStep[]
  finalScreenshot: ImageAttachmentRef
}

function taskResultValue(value: {
  completed: boolean
  summary: string
  steps: readonly { action: string; outcome?: string; screenshot?: unknown }[]
  finalScreenshot?: unknown
}): TaskResultValue {
  return {
    completed: value.completed,
    summary: value.summary,
    steps: value.steps.map(step => ({
      action: step.action,
      ...step.outcome === undefined ? {} : { outcome: step.outcome },
      ...step.screenshot === undefined ? {} : { screenshot: step.screenshot as ImageAttachmentRef },
    })),
    finalScreenshot: value.finalScreenshot as ImageAttachmentRef,
  }
}

function renderTaskResult(value: TaskResultValue) {
  const status = value.completed ? 'Completed' : 'Stopped'
  const log = renderStepLog(decodeSteps(value.steps))
  const screenshot = describeScreenshot(value.finalScreenshot)
  return [{ type: 'text' as const, text: `${status}: ${value.summary}\n\n${log}\n\n${screenshot}` }]
}

function taskPresentationContent(value: TaskResultValue) {
  const status = value.completed ? 'Completed' : 'Stopped'
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; attachment: ImageAttachmentRef }
  > = [{ type: 'text', text: `${status}: ${value.summary}` }]
  for (const [index, step] of value.steps.entries()) {
    const outcome = step.outcome === undefined ? '' : ` -> ${step.outcome}`
    content.push({ type: 'text', text: `Step ${String(index + 1)}: ${step.action}${outcome}` })
    if (step.screenshot !== undefined) content.push({ type: 'image', attachment: step.screenshot })
  }
  content.push({ type: 'text', text: describeScreenshot(value.finalScreenshot) })
  return content
}

function taskPresentationMeta(value: TaskResultValue): JsonValue {
  return { content: taskPresentationContent(value) } as unknown as JsonValue
}

function taskPresentationContentFromMeta(meta: JsonValue | undefined): ReturnType<typeof taskPresentationContent> | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const candidate = (meta as { content?: unknown }).content
  if (!Array.isArray(candidate)) return undefined
  const content: ReturnType<typeof taskPresentationContent> = []
  for (const item of candidate) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const block = item as { type?: unknown; text?: unknown; attachment?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') {
      content.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type !== 'image' || typeof block.attachment !== 'object'
      || block.attachment === null || Array.isArray(block.attachment)) return undefined
    const ref = block.attachment as Record<string, unknown>
    if (typeof ref.attachmentId !== 'string' || typeof ref.mediaType !== 'string'
      || typeof ref.bytes !== 'number' || typeof ref.width !== 'number' || typeof ref.height !== 'number'
      || (ref.name !== undefined && typeof ref.name !== 'string')) return undefined
    content.push({ type: 'image', attachment: ref as unknown as ImageAttachmentRef })
  }
  return content
}

function presentTaskResult(result: ToolResult): ToolResultView | undefined {
  if (result.isError) return undefined
  const content = taskPresentationContentFromMeta(result.meta)
  return content === undefined ? undefined : { card: 'generic', content }
}

async function saveStepScreenshots(
  ctx: Context,
  pngImages: readonly string[],
  namePrefix: string,
): Promise<ImageAttachmentRef[]> {
  const refs: ImageAttachmentRef[] = []
  for (const [index, pngBase64] of pngImages.entries()) {
    refs.push(await saveScreenshot(ctx, pngBase64, `${namePrefix}-step-${String(index + 1)}.png`))
  }
  return refs
}

async function saveScreenshot(ctx: Context, pngBase64: string, name: string): Promise<ImageAttachmentRef> {
  const data = await fitPngToAttachmentLimits(Buffer.from(pngBase64, 'base64'), ctx.attachments.imageLimits)
  return ctx.attachments.saveImage({
    data,
    mediaType: 'image/png',
    name,
  })
}

export function apply(ctx: Context, config: Config = {}): void {
  const defaultMaxSteps = config.defaultMaxSteps ?? TOOL_MACOS_USE_DEFAULT_MAX_STEPS
  const taskPresentationEntry: TaskPresentationSettings = {
    showStepScreenshots: config.showStepScreenshots ?? TOOL_MACOS_USE_DEFAULT_SHOW_STEP_SCREENSHOTS,
  }
  let currentTaskPresentation = () => taskPresentationEntry
  installSettingsSection(ctx, TOOL_MACOS_USE_SETTINGS_NAMESPACE, TaskPresentationSettings, taskPresentationEntry, {
    setSource: (source) => { currentTaskPresentation = source },
    onChange: () => {},
  })

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
      const ref = await saveScreenshot(ctx, pngBase64, 'screenshot.png')
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
          finalScreenshot: { ...IMAGE_REF_SCHEMA, required: true },
        },
      },
      render: (_args, value) => renderTaskResult(taskResultValue(value)),
      presentationMeta: (_args, value) => taskPresentationMeta(taskResultValue(value)),
    },
    async execute(args, exec) {
      const showStepScreenshots = currentTaskPresentation().showStepScreenshots
        ?? TOOL_MACOS_USE_DEFAULT_SHOW_STEP_SCREENSHOTS
      const result = await runGuiTask(ctx.guiModel, macosTaskExecutor(ctx), {
        task: args.task,
        maxSteps: args.max_steps ?? defaultMaxSteps,
        retainStepScreenshots: showStepScreenshots,
        signal: exec.signal,
      })
      const stepScreenshots = showStepScreenshots
        ? await saveStepScreenshots(ctx, result.stepScreenshotsPngBase64, 'computer-use-task')
        : []
      const { pngBase64 } = await ctx.macosUse.screenshot(exec.signal)
      const finalScreenshot = await saveScreenshot(ctx, pngBase64, 'computer-use-task-result.png')
      return {
        completed: result.completed,
        summary: result.summary,
        steps: encodeSteps(result.steps, stepScreenshots),
        finalScreenshot,
      }
    },
    presentResult: (_args, result) => presentTaskResult(result),
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
      const ref = await saveScreenshot(ctx, pngBase64, 'browser-screenshot.png')
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
          finalScreenshot: { ...IMAGE_REF_SCHEMA, required: true },
        },
      },
      render: (_args, value) => renderTaskResult(taskResultValue(value)),
      presentationMeta: (_args, value) => taskPresentationMeta(taskResultValue(value)),
    },
    async execute(args, exec) {
      if (args.url !== undefined) await ctx.browserUse.navigate({ url: args.url }, exec.signal)
      const showStepScreenshots = currentTaskPresentation().showStepScreenshots
        ?? TOOL_MACOS_USE_DEFAULT_SHOW_STEP_SCREENSHOTS
      const result = await runGuiTask(ctx.guiModel, browserTaskExecutor(ctx), {
        task: args.task,
        maxSteps: args.max_steps ?? defaultMaxSteps,
        retainStepScreenshots: showStepScreenshots,
        signal: exec.signal,
      })
      const stepScreenshots = showStepScreenshots
        ? await saveStepScreenshots(ctx, result.stepScreenshotsPngBase64, 'browser-use-task')
        : []
      const { pngBase64 } = await ctx.browserUse.screenshot(exec.signal)
      const finalScreenshot = await saveScreenshot(ctx, pngBase64, 'browser-use-task-result.png')
      return {
        completed: result.completed,
        summary: result.summary,
        steps: encodeSteps(result.steps, stepScreenshots),
        finalScreenshot,
      }
    },
    presentResult: (_args, result) => presentTaskResult(result),
  }))
}
