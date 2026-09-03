/**
 * Model-facing Consumer of the `ctx.macosUse` / `ctx.guiModel` / `ctx.browserUse` capability seams: primitive
 * screen, keyboard, and app-launch tools; primitive browser navigation/selector tools; and two
 * vision-model-driven task tools (`computer_use_task`, `browser_use_task`) that loop screenshot -> `ctx.guiModel`
 * decision -> action until the model reports the task done.
 * @module @deepseek-ai/dsh-tool-macos-use
 */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolExecution, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SettingsNamespace, SettingsSectionHooks } from '@deepseek-ai/dsh-settings'
import type {
  MacosActionReceipt,
  MacosWindow,
  ObservedWindowTarget,
  ScreenObservationResult,
  ScreenshotResult,
} from '@deepseek-ai/dsh-macos-use'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type {} from '@deepseek-ai/dsh-browser-use'
import { TaskCoordinator } from './coordinator.ts'
import { browserTaskExecutor, macosTaskExecutor } from './executors.ts'
import { fitPngToAttachmentLimits } from './image.ts'
import { GuiTaskRunError, runGuiTask } from './loop.ts'
import type { RunTaskResult, TaskStepLog } from './loop.ts'
import {
  approveAutonomousAction,
  deferredDesktopTaskApprovalReason,
  guiPreExecutionDecision,
} from './policy.ts'
import { watchGuiTaskProgressRemote } from './progress-host.ts'
import { GuiTaskProgressStore } from './progress.ts'
import { Config, DEFAULT_MAX_STEPS, MAX_TASK_STEPS, validateSettings } from './settings.ts'
import { createTaskProgressReporter } from './task-progress.ts'
import { ElementTokenStore } from './tokens.ts'
import {
  assertBrowserPostcondition,
  assertMacosPostcondition,
  modelDoneNotReached,
  unverifiedModelDone,
  verifyBrowserPostcondition,
  verifyMacosPostcondition,
  type TaskVerification,
} from './verification.ts'

export const name = 'tool-macos-use'
export const inject = ['tools', 'macosUse', 'guiModel', 'browserUse', 'attachments']
export { Config } from './settings.ts'
export type { Config as ToolMacosUseConfig } from './settings.ts'

/** Live settings namespace for user-owned task presentation preferences. */
export const TOOL_MACOS_USE_SETTINGS_NAMESPACE = 'tool-macos-use' as SettingsNamespace

type InstallSection = (
  owner: Context,
  ns: SettingsNamespace,
  schema: typeof Config,
  entry: Config,
  hooks: SettingsSectionHooks<Config>,
) => void

const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

const OBSERVATION_BOUND_COMPUTER_TOOLS = new Set([
  'computer_click',
  'computer_type',
  'computer_move',
  'computer_drag',
  'computer_scroll',
  'computer_key',
])

const MAX_PENDING_APPROVAL_FOCUS_RECOVERIES = 128

type ApprovalFocusRecovery =
  | { kind: 'direct'; ownerId: string }
  | { kind: 'task'; ownerId: string; observationId: string }

function approvalFocusRecoveryKey(ownerId: unknown, callId: unknown): string | undefined {
  if (typeof ownerId !== 'string' || ownerId.trim() === ''
      || typeof callId !== 'string' || callId.trim() === '') return undefined
  return JSON.stringify([ownerId, callId])
}

function ownerIsUnloading(ctx: Context): boolean {
  const state: number = ctx.fiber.state
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED
}

/** Use alpha.5's provider-owned API when present, with the alpha.1 lifecycle as a bounded compatibility fallback. */
function installCompatibleSettingsSection(
  ctx: Context,
  ns: SettingsNamespace,
  schema: typeof Config,
  entry: Config,
  hooks: SettingsSectionHooks<Config>,
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const provider = settingsCtx.settings as typeof settingsCtx.settings & { installSection?: InstallSection }
    if (typeof provider.installSection === 'function') {
      provider.installSection(ctx, ns, schema, entry, hooks)
      return
    }
    const scope = provider.register(ns, schema, {
      base: entry,
      ...hooks.validate === undefined ? {} : { validate: hooks.validate },
    })
    hooks.setSource(() => scope.get())
    settingsCtx.effect(() => () => {
      if (ownerIsUnloading(ctx)) return
      hooks.setSource(() => entry)
      hooks.onChange()
    })
    hooks.onChange()
    scope.watch(() => {
      if (!ownerIsUnloading(ctx)) hooks.onChange()
    })
  })
}

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
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'number', required: true },
        height: { type: 'number', required: true },
      },
    },
  },
} as const

const BOUNDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
  },
} as const

const WINDOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer', required: true },
    app: { type: 'string', required: true },
    pid: { type: 'integer', required: true },
    bundleId: { type: 'string' },
    title: { type: 'string', required: true },
    bounds: { ...BOUNDS_SCHEMA, required: true },
    onScreen: { type: 'boolean', required: true },
  },
} as const

const FRONTMOST_PROCESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    bundleId: { type: 'string' },
    pid: { type: 'integer', required: true },
  },
} as const

const SCREEN_OBSERVATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    screenshot: { ...IMAGE_REF_SCHEMA, required: true },
    observationId: { type: 'string', required: true },
    observedAt: { type: 'string', required: true },
    frontmostProcess: FRONTMOST_PROCESS_SCHEMA,
    targetWindow: WINDOW_SCHEMA,
  },
} as const

const ELEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    token: { type: 'string', required: true },
    role: { type: 'string', required: true },
    subrole: { type: 'string' },
    name: { type: 'string' },
    value: { type: 'string' },
    description: { type: 'string' },
    enabled: { type: 'boolean', required: true },
    bounds: BOUNDS_SCHEMA,
  },
} as const

const ACTION_RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    observationId: { type: 'string', required: true },
    observedAt: { type: 'string', required: true },
    targetState: { type: 'string', required: true, enum: ['present', 'missing', 'unscoped'] as const },
    window: WINDOW_SCHEMA,
    screenshot: { ...IMAGE_REF_SCHEMA, required: true },
  },
} as const

const ACTION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { receipt: { ...ACTION_RECEIPT_SCHEMA, required: true } },
} as const

const STEP_LOG_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string' },
      phase: { type: 'string', enum: ['decision'] as const },
      outcome: { type: 'string' },
      screenshot: IMAGE_REF_SCHEMA,
    },
  },
} as const

const TASK_VERIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    modelDone: { type: 'boolean', required: true },
    status: {
      type: 'string',
      required: true,
      enum: [
        'not_reached',
        'model_done_unverified',
        'verified',
        'postcondition_failed',
        'verification_error',
      ] as const,
    },
    checkedAt: { type: 'string' },
    checks: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion: { type: 'string', required: true },
          expected: { type: 'string', required: true },
          observed: { type: 'string', required: true },
          passed: { type: 'boolean', required: true },
        },
      },
    },
    error: { type: 'string' },
  },
} as const

const MACOS_POSTCONDITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Optional host-verified completion criteria. An empty object is rejected.',
  properties: {
    frontmost_app: { type: 'string', description: 'Expected frontmost application name (case/punctuation-insensitive).' },
    frontmost_pid: { type: 'integer', description: 'Expected frontmost process id.' },
    window: {
      type: 'object',
      additionalProperties: false,
      description: 'A visible window that must match every supplied field.',
      properties: {
        id: { type: 'integer' },
        app: { type: 'string' },
        title: { type: 'string' },
        title_contains: { type: 'string' },
      },
    },
  },
} as const

const BROWSER_POSTCONDITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Optional host-verified completion criteria. An empty object is rejected.',
  properties: {
    url_equals: { type: 'string', description: 'Exact expected page URL.' },
    url_contains: { type: 'string', description: 'Case-sensitive substring required in the page URL.' },
    title_equals: { type: 'string', description: 'Exact expected page title.' },
    title_contains: { type: 'string', description: 'Case-sensitive substring required in the page title.' },
    text_contains: { type: 'string', description: 'Case-sensitive substring required in body or selector text.' },
    selector: { type: 'string', description: 'Selector that must resolve; text_contains applies to it when supplied.' },
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

/** Resolve the trusted Session owner for observation signing; never expose it as a model parameter. */
function requireOwnerId(exec: { readonly agent?: { readonly id?: unknown } }): string {
  const candidate = exec.agent?.id
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('a live agent/session owner is required for macOS observation and control')
  }
  return candidate
}

function requireObservationId(value: string | undefined): string {
  if (value === undefined) {
    throw new Error('observation_id from a fresh computer_screenshot is required when element is omitted')
  }
  return value
}

function taskStepBudget(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > MAX_TASK_STEPS) {
    throw new Error(`max_steps must be a whole number from 1 to ${String(MAX_TASK_STEPS)}`)
  }
  return candidate
}

function renderStepLog(steps: readonly TaskStepLog[]): string {
  return steps.map((entry, index) => {
    const outcome = entry.outcome === undefined ? '' : ` -> ${entry.outcome}`
    const operation = entry.action === undefined ? `${entry.phase ?? 'unknown'} failed` : JSON.stringify(entry.action)
    return `${index + 1}. ${operation}${outcome}`
  }).join('\n')
}

interface EncodedStep {
  action?: string
  phase?: 'decision'
  outcome?: string
  screenshot?: ImageAttachmentRef
}

function decodeSteps(steps: readonly EncodedStep[]): TaskStepLog[] {
  return steps.map(step => ({
    ...step.action === undefined ? {} : { action: JSON.parse(step.action) as GuiAction },
    ...step.phase === undefined ? {} : { phase: step.phase },
    ...step.outcome !== undefined ? { outcome: step.outcome } : {},
  }))
}

function outputAction(action: GuiAction): GuiAction {
  if (action.kind !== 'type' || action.text === undefined) return action
  return { ...action, text: `[redacted ${String(action.text.length)} typed characters]` }
}

function encodeSteps(steps: readonly TaskStepLog[], screenshots: readonly (ImageAttachmentRef | undefined)[]): EncodedStep[] {
  return steps.map((step, index) => ({
    // The executor and model history retain the exact text, but durable
    // Session state and user-facing output never persist provider-generated
    // typed secrets.
    ...step.action === undefined ? {} : { action: JSON.stringify(outputAction(step.action)) },
    ...step.phase === undefined ? {} : { phase: step.phase },
    ...step.outcome !== undefined ? { outcome: step.outcome } : {},
    ...screenshots[index] !== undefined ? { screenshot: screenshots[index] } : {},
  }))
}

interface TaskResultValue {
  completed: boolean
  summary: string
  steps: readonly EncodedStep[]
  finalScreenshot?: ImageAttachmentRef
  verification: TaskVerification
}

function taskVerificationValue(value: unknown, completed: boolean): TaskVerification {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const status = (value as { status?: unknown }).status
    if (status === 'not_reached' || status === 'model_done_unverified' || status === 'verified'
      || status === 'postcondition_failed' || status === 'verification_error') return value as TaskVerification
  }
  return completed ? unverifiedModelDone() : modelDoneNotReached()
}

function taskResultValue(value: {
  completed: boolean
  summary: string
  steps: readonly { action?: string; phase?: 'decision'; outcome?: string; screenshot?: unknown }[]
  finalScreenshot?: unknown
  verification?: unknown
}): TaskResultValue {
  return {
    completed: value.completed,
    summary: value.summary,
    steps: value.steps.map(step => ({
      ...step.action === undefined ? {} : { action: step.action },
      ...step.phase === undefined ? {} : { phase: step.phase },
      ...step.outcome === undefined ? {} : { outcome: step.outcome },
      ...step.screenshot === undefined ? {} : { screenshot: step.screenshot as ImageAttachmentRef },
    })),
    ...value.finalScreenshot === undefined
      ? {}
      : { finalScreenshot: value.finalScreenshot as ImageAttachmentRef },
    verification: taskVerificationValue(value.verification, value.completed),
  }
}

function taskStatus(value: TaskResultValue): string {
  switch (value.verification.status) {
    case 'verified': return 'Postcondition verified'
    case 'model_done_unverified': return 'Model done (unverified)'
    case 'postcondition_failed': return 'Postcondition failed'
    case 'verification_error': return 'Verification error'
    case 'not_reached': return 'Stopped'
  }
}

function renderTaskResult(value: TaskResultValue) {
  const status = taskStatus(value)
  const log = renderStepLog(decodeSteps(value.steps))
  const screenshot = value.finalScreenshot === undefined
    ? 'No final screenshot was available.'
    : describeScreenshot(value.finalScreenshot)
  return [{
    type: 'text' as const,
    text: `${status}: ${value.summary}\nVerification: ${JSON.stringify(value.verification)}\n\n${log}\n\n${screenshot}`,
  }]
}

function taskPresentationContent(value: TaskResultValue) {
  const status = taskStatus(value)
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; attachment: ImageAttachmentRef }
  > = [{ type: 'text', text: `${status}: ${value.summary}` }]
  for (const [index, step] of value.steps.entries()) {
    const outcome = step.outcome === undefined ? '' : ` -> ${step.outcome}`
    const operation = step.action ?? `${step.phase ?? 'unknown'} failed`
    content.push({ type: 'text', text: `Step ${String(index + 1)}: ${operation}${outcome}` })
    if (step.screenshot !== undefined) content.push({ type: 'image', attachment: step.screenshot })
  }
  if (value.finalScreenshot !== undefined) {
    content.push({ type: 'text', text: describeScreenshot(value.finalScreenshot) })
  }
  return content
}

function stoppedRun(error: unknown): { result: RunTaskResult; error: string } {
  const failure = error instanceof Error ? error.message : String(error)
  return {
    result: {
      completed: false,
      summary: `Stopped: ${failure}`,
      steps: error instanceof GuiTaskRunError ? error.steps : [],
    },
    error: failure,
  }
}

function taskPresentationMeta(value: TaskResultValue): JsonValue {
  return {
    content: taskPresentationContent(value),
    verificationStatus: value.verification.status,
  } as unknown as JsonValue
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

async function saveScreenshot(ctx: Context, pngBase64: string, name: string): Promise<ImageAttachmentRef> {
  const data = await fitPngToAttachmentLimits(Buffer.from(pngBase64, 'base64'), ctx.attachments.imageLimits)
  return ctx.attachments.saveImage({
    data,
    mediaType: 'image/png',
    name,
  })
}

interface ActionReceiptValue {
  observationId: string
  observedAt: string
  targetState: 'present' | 'missing' | 'unscoped'
  window?: MacosWindow
  screenshot: ImageAttachmentRef
}

async function saveActionReceiptCapture(
  ctx: Context,
  capture: ScreenshotResult & { targetState: ActionReceiptValue['targetState']; window?: MacosWindow },
  name: string,
): Promise<ActionReceiptValue> {
  const screenshot = await saveScreenshot(ctx, capture.pngBase64, name)
  return {
    observationId: capture.observationId,
    observedAt: capture.observedAt,
    targetState: capture.targetState,
    ...capture.window === undefined ? {} : { window: capture.window },
    screenshot,
  }
}

async function saveActionReceipt(
  ctx: Context,
  target: ObservedWindowTarget | undefined,
  signal: AbortSignal,
  name: string,
  ownerId: string,
): Promise<ActionReceiptValue> {
  const capture: MacosActionReceipt = await ctx.macosUse.actionReceipt(target, signal, ownerId)
  return saveActionReceiptCapture(ctx, capture, name)
}

function renderActionReceipt(action: string, receipt: ActionReceiptValue) {
  return [{
    type: 'text' as const,
    text: `${action}; fresh action receipt ${receipt.targetState}. ${describeScreenshot(receipt.screenshot)}`,
  }]
}

function targetFromReceipt(receipt: MacosActionReceipt): ObservedWindowTarget {
  if (receipt.targetState !== 'present' || receipt.window === undefined) {
    throw new Error('the observed window disappeared before the follow-up action')
  }
  return { observationId: receipt.observationId, window: receipt.window }
}

export function apply(ctx: Context, config: Config = {}): void {
  const coordinator = new TaskCoordinator()
  const tokens = new ElementTokenStore()
  const progress = new GuiTaskProgressStore()
  // Harness passes the same execution object from pre-execute through the
  // approved tool body. Weak identity records which direct calls actually
  // crossed the same-Mac approval UI without retaining rejected calls.
  const approvalFocusRecoveries = new WeakSet<ToolExecution>()
  // Approval events expose the exact owner/call pair but not the ToolExecution
  // object. Retain only a bounded one-shot recovery capability until that exact
  // call enters its body or reports a final result.
  const approvedFocusRecoveries = new Map<string, ApprovalFocusRecovery>()
  // Reserve owner/call identity before awaiting the answerer. The reservation
  // closes duplicate-key and capacity races while the approval UI is pending.
  const pendingApprovalFocusRecoveries = new Map<string, { ownerId: string }>()
  // Internal per-step approvals reuse computer_use_task's owner/call id. Mark
  // the body lifetime so those grounded approvals do not take an extra capture
  // that would invalidate the action's existing observation.
  const activeComputerTaskKeys = new Set<string>()
  watchGuiTaskProgressRemote(ctx, progress)
  ctx.effect(() => () => { progress.clear() }, 'tool-macos-use: dispose GUI task progress')
  ctx.on('agent/disposed', ({ agent }) => {
    const ownerId = agent.id
    coordinator.abortOwner(ownerId, 'GUI task aborted because its owning agent was disposed')
    tokens.invalidate(ownerId)
    progress.clearOwner(ownerId)
    for (const [key, recovery] of approvedFocusRecoveries) {
      if (recovery.ownerId === ownerId) approvedFocusRecoveries.delete(key)
    }
    for (const [key, recovery] of pendingApprovalFocusRecoveries) {
      if (recovery.ownerId === ownerId) pendingApprovalFocusRecoveries.delete(key)
    }
  })
  let current = () => config
  let live = validateSettings(config)
  let lastAbortRevision = live.abortRevision
  const synchronize = () => {
    const next = validateSettings(current())
    ctx.macosUse.configure({
      commandTimeoutMs: next.commandTimeoutMs,
      allowedApps: next.allowedApps,
      deniedApps: next.deniedApps,
      excludedScreenshotApps: next.excludedScreenshotApps,
      maxElementsPerSnapshot: next.maxElementsPerSnapshot,
      readAppGrants: next.readAppGrants,
      controlAppGrants: next.controlAppGrants,
      deniedAppIdentities: next.deniedAppIdentities,
    })
    ctx.browserUse.configure({
      headless: next.browserHeadless,
      allowedDomains: next.browserAllowedDomains,
      deniedDomains: next.browserDeniedDomains,
      allowPrivateNetwork: next.browserAllowPrivateNetwork,
    })
    if (next.abortRevision > lastAbortRevision) coordinator.abortAll('All GUI tasks aborted from Plugin Configuration')
    lastAbortRevision = next.abortRevision
    live = next
  }
  synchronize()
  installCompatibleSettingsSection(ctx, TOOL_MACOS_USE_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    // Precise identity rules carry a cross-field grammar that Schemastery cannot express.
    // Validate before persistence so an invalid visual edit cannot leave the UI looking saved
    // while the live policy silently keeps or loses a prior projection.
    validate: (value) => { validateSettings(value) },
    onChange: synchronize,
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const local = guiPreExecutionDecision(exec, live, coordinator.hasActiveTask())
    // A local concurrency denial is monotonic and must not consult a later
    // hook. Otherwise preserve downstream deny/ask; only a downstream allow
    // leaves room for this plugin's local approval request.
    if (local?.kind === 'deny') return local
    const downstream = await next()
    let decision = downstream
    if (local?.kind === 'ask' && downstream.kind !== 'deny') {
      if (downstream.kind === 'allow') decision = local
      else {
        const reasons = [...new Set([downstream.reason, local.reason]
          .filter((reason): reason is string => reason !== undefined && reason.length > 0))]
        decision = reasons.length === 0
          ? { kind: 'ask' }
          : { kind: 'ask', reason: reasons.join('\n\n') }
      }
    }
    // Any final approval UI can steal same-Mac focus, including an approval
    // requested by a downstream policy while this plugin's strict switch is
    // relaxed. Restore only observation-bound desktop mutations.
    if (decision.kind === 'ask' && OBSERVATION_BOUND_COMPUTER_TOOLS.has(exec.name)) {
      approvalFocusRecoveries.add(exec)
    }
    return decision
  }, { prepend: true })

  // Wrap the public approval seam rather than relying on tools/pre-execute
  // listener order. For an outer desktop task, capture the exact target before
  // any answerer can focus Harness. Direct tools already carry an observation;
  // they only need the one-shot fact that an approval UI was crossed.
  ctx.on('approval/request', async (request, next) => {
    const ownerId = request.agent.id
    const key = approvalFocusRecoveryKey(ownerId, request.callId)
    const direct = OBSERVATION_BOUND_COMPUTER_TOOLS.has(request.toolName)
    const outerTask = request.toolName === 'computer_use_task'
      && key !== undefined
      && !activeComputerTaskKeys.has(key)
    if (key === undefined || (!direct && !outerTask)) return next()
    // Reused call identity or unbounded pending UI state is ambiguous. Do not
    // evict another call's proof or continue without a recovery capability.
    if (approvedFocusRecoveries.has(key)
        || pendingApprovalFocusRecoveries.has(key)
        || approvedFocusRecoveries.size + pendingApprovalFocusRecoveries.size
          >= MAX_PENDING_APPROVAL_FOCUS_RECOVERIES) {
      return 'unavailable'
    }
    const reservation = { ownerId }
    pendingApprovalFocusRecoveries.set(key, reservation)
    try {
      const observed = outerTask
        ? await ctx.macosUse.screenshot(request.signal, ownerId)
        : undefined
      const outcome = await next()
      // ApprovalService may settle cancellation before a slow answerer returns.
      // Never retain a late grant after the owning tool signal was aborted or
      // after agent disposal retired this exact reservation.
      if (outcome === 'allowed-once' && request.signal?.aborted !== true) {
        if (pendingApprovalFocusRecoveries.get(key) !== reservation) return 'unavailable'
        approvedFocusRecoveries.set(key, observed === undefined
          ? { kind: 'direct', ownerId }
          : { kind: 'task', ownerId, observationId: observed.observationId })
      }
      return outcome
    } finally {
      if (pendingApprovalFocusRecoveries.get(key) === reservation) {
        pendingApprovalFocusRecoveries.delete(key)
      }
    }
  }, { prepend: true })

  ctx.on('tools/result', (exec) => {
    const key = approvalFocusRecoveryKey(exec.agent?.id, exec.callId)
    if (key !== undefined) approvedFocusRecoveries.delete(key)
  })

  const consumeApprovalFocusRecovery = (exec: ToolExecution): boolean => {
    const key = approvalFocusRecoveryKey(exec.agent?.id, exec.callId)
    const keyed = key === undefined ? undefined : approvedFocusRecoveries.get(key)
    if (key !== undefined && keyed?.kind === 'direct') approvedFocusRecoveries.delete(key)
    const required = approvalFocusRecoveries.has(exec) || keyed?.kind === 'direct'
    approvalFocusRecoveries.delete(exec)
    return required
  }

  const pointFor = async (
    args: { x?: number; y?: number; element?: string; observation_id?: string },
    exec: { signal: AbortSignal },
    ownerId: string,
    restoreObservedFocus: boolean,
  ): Promise<{ x: number; y: number; target?: ObservedWindowTarget; observationId?: string }> => {
    if (args.element !== undefined) {
      const reserved = tokens.reserve(ownerId, args.element)
      if (restoreObservedFocus) {
        await ctx.macosUse.reactivateWindowObservation(
          reserved.reactivationTarget(),
          exec.signal,
          ownerId,
        )
      }
      const state = await ctx.macosUse.windowState({
        id: reserved.windowId,
        maxElements: live.maxElementsPerSnapshot,
      }, exec.signal, ownerId)
      return reserved.revalidate(state)
    }
    if (args.x === undefined || args.y === undefined) throw new Error('provide x/y or an element token')
    if (args.observation_id === undefined) {
      throw new Error('observation_id from a fresh computer_screenshot is required for coordinate control')
    }
    return { x: args.x, y: args.y, observationId: args.observation_id }
  }

  ctx.tools.register(defineTool({
    name: 'computer_screenshot',
    description: 'Capture only the exact authorized foreground window on an otherwise black main-display coordinate '
      + 'canvas and return a one-action observation token. An excluded or unreadable foreground target fails closed. '
      + 'Pass observationId as observation_id to the next focus-dependent coordinate, typing, key, or scroll action.',
    parameters: {},
    output: {
      schema: SCREEN_OBSERVATION_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Screen observation ${value.observationId} captured at ${value.observedAt}. `
          + `${describeScreenshot(value.screenshot as unknown as ImageAttachmentRef)} `
          + `Readable target: ${JSON.stringify({
            frontmostProcess: value.frontmostProcess,
            targetWindow: value.targetWindow,
          })}`,
      }],
    },
    async execute(_args, exec) {
      const ownerId = requireOwnerId(exec)
      tokens.invalidate(ownerId)
      const result: ScreenObservationResult = await ctx.macosUse.screenshot(exec.signal, ownerId)
      const screenshot = await saveScreenshot(ctx, result.pngBase64, 'screenshot.png')
      return {
        screenshot,
        observationId: result.observationId,
        observedAt: result.observedAt,
        ...result.frontmostProcess === undefined ? {} : { frontmostProcess: result.frontmostProcess },
        ...result.targetWindow === undefined ? {} : { targetWindow: result.targetWindow },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_list_apps',
    description: 'List running foreground-capable macOS applications allowed by the visual app policy.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            bundleId: { type: 'string' },
            pid: { type: 'integer', required: true },
            active: { type: 'boolean', required: true },
            hidden: { type: 'boolean', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (_args, exec) => [...await ctx.macosUse.listApps(exec.signal)],
  }))

  ctx.tools.register(defineTool({
    name: 'computer_list_windows',
    description: 'List exact on-screen macOS windows with ids, titles, apps, and bounds.',
    parameters: {},
    output: {
      schema: { type: 'array', items: WINDOW_SCHEMA },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (_args, exec) => [...await ctx.macosUse.listWindows(exec.signal)],
  }))

  ctx.tools.register(defineTool({
    name: 'computer_screenshot_window',
    description: 'Capture one exact allowed window. Sensitive screenshot-excluded apps fail closed.',
    parameters: {
      window_id: { type: 'integer', description: 'CoreGraphics window id from computer_list_windows.' },
      app: { type: 'string', description: 'Application name when window_id is omitted.' },
      title: { type: 'string', description: 'Exact window title when selecting by app.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          window: { ...WINDOW_SCHEMA, required: true },
          screenshot: { ...IMAGE_REF_SCHEMA, required: true },
          observationId: { type: 'string', required: true },
          observedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Window captured: ${JSON.stringify(value.window)}. ${describeScreenshot(value.screenshot as unknown as ImageAttachmentRef)}`,
      }],
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      tokens.invalidate(ownerId)
      const result = await ctx.macosUse.screenshotWindow({
        ...args.window_id === undefined ? {} : { id: args.window_id },
        ...args.app === undefined ? {} : { app: args.app },
        ...args.title === undefined ? {} : { title: args.title },
      }, exec.signal, ownerId)
      const screenshot = await saveScreenshot(ctx, result.pngBase64, `window-${String(result.window.id)}.png`)
      return {
        window: result.window,
        screenshot,
        observationId: result.observationId,
        observedAt: result.observedAt,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_get_window_state',
    description: 'Capture one exact window and return its structured Accessibility controls with opaque tokens. '
      + 'Tokens become stale after the next snapshot or if the window moves/resizes.',
    parameters: {
      window_id: { type: 'integer', description: 'CoreGraphics window id from computer_list_windows.' },
      app: { type: 'string', description: 'Application name when window_id is omitted.' },
      title: { type: 'string', description: 'Exact window title when selecting by app.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          snapshotId: { type: 'string', required: true },
          observationId: { type: 'string', required: true },
          observedAt: { type: 'string', required: true },
          window: { ...WINDOW_SCHEMA, required: true },
          screenshot: { ...IMAGE_REF_SCHEMA, required: true },
          elements: { type: 'array', required: true, items: ELEMENT_SCHEMA },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Window state ${value.snapshotId}: ${JSON.stringify(value.elements)}. `
          + describeScreenshot(value.screenshot as unknown as ImageAttachmentRef),
      }],
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const state = await ctx.macosUse.windowState({
        ...args.window_id === undefined ? {} : { id: args.window_id },
        ...args.app === undefined ? {} : { app: args.app },
        ...args.title === undefined ? {} : { title: args.title },
        maxElements: live.maxElementsPerSnapshot,
      }, exec.signal, ownerId)
      const tokenized = tokens.create(ownerId, state.window, state.elements, state.observationId)
      const screenshot = await saveScreenshot(ctx, state.pngBase64, `window-state-${String(state.window.id)}.png`)
      return {
        snapshotId: tokenized.snapshotId,
        observationId: state.observationId,
        observedAt: state.observedAt,
        window: state.window,
        screenshot,
        elements: [...tokenized.elements],
        truncated: state.truncated,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_click',
    description: 'Click, double-click, or right-click using either an opaque element token from '
      + 'computer_get_window_state or pixel coordinates from a fresh computer_screenshot.',
    parameters: {
      element: { type: 'string', description: 'Snapshot-scoped element token. Prefer this over coordinates.' },
      x: { type: 'number', description: 'Screenshot pixel x coordinate when element is omitted.' },
      y: { type: 'number', description: 'Screenshot pixel y coordinate when element is omitted.' },
      observation_id: {
        type: 'string',
        description: 'Required with x/y. One-action token returned by the immediately preceding computer_screenshot.',
      },
      button: { type: 'string', enum: ['left', 'right'] as const, description: 'Defaults to "left".' },
      double_click: { type: 'boolean', description: 'Double-click instead of a single click. Ignored when button is "right".' },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('clicked', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const restoreObservedFocus = consumeApprovalFocusRecovery(exec)
      const point = await pointFor(args, exec, ownerId, restoreObservedFocus)
      await ctx.macosUse.click({
        ...point,
        ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
        ...args.button !== undefined ? { button: args.button } : {},
        ...args.double_click !== undefined ? { doubleClick: args.double_click } : {},
      }, exec.signal, ownerId)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, point.target, exec.signal, 'computer-click-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_type',
    description: 'Type literal text into the focused macOS element, optionally focusing a fresh semantic element token first.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to type.' },
      element: { type: 'string', description: 'Optional token from computer_get_window_state to focus before typing.' },
      observation_id: {
        type: 'string',
        description: 'Required when element is omitted. One-action token from the immediately preceding computer_screenshot.',
      },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('typed', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const restoreObservedFocus = consumeApprovalFocusRecovery(exec)
      let target: ObservedWindowTarget | undefined
      if (args.element !== undefined) {
        const point = await pointFor({ element: args.element }, exec, ownerId, restoreObservedFocus)
        await ctx.macosUse.click({
          ...point,
          ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
        }, exec.signal, ownerId)
        target = targetFromReceipt(await ctx.macosUse.actionReceipt(point.target, exec.signal, ownerId))
      }
      await ctx.macosUse.type({
        text: args.text,
        ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
        ...target === undefined ? { observationId: requireObservationId(args.observation_id) } : { target },
      }, exec.signal, ownerId)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, target, exec.signal, 'computer-type-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_move',
    description: 'Move the macOS pointer to a semantic element token or fresh screenshot pixel coordinate without clicking.',
    parameters: {
      element: { type: 'string', description: 'Snapshot-scoped element token.' },
      x: { type: 'number', description: 'Screenshot pixel x when element is omitted.' },
      y: { type: 'number', description: 'Screenshot pixel y when element is omitted.' },
      observation_id: {
        type: 'string',
        description: 'Required with x/y. One-action token returned by the immediately preceding computer_screenshot.',
      },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('moved', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const restoreObservedFocus = consumeApprovalFocusRecovery(exec)
      const point = await pointFor(args, exec, ownerId, restoreObservedFocus)
      await ctx.macosUse.move({
        ...point,
        ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
      }, exec.signal, ownerId)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, point.target, exec.signal, 'computer-move-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_drag',
    description: 'Drag from a semantic element token or fresh screenshot pixel coordinate. With an element token, '
      + 'the destination is a global macOS point; with raw coordinates, it is a screenshot pixel. '
      + 'Heuristic human confirmation is on by default.',
    parameters: {
      element: { type: 'string', description: 'Snapshot-scoped token for the drag start.' },
      x: { type: 'number', description: 'Screenshot pixel start x when element is omitted.' },
      y: { type: 'number', description: 'Screenshot pixel start y when element is omitted.' },
      observation_id: {
        type: 'string',
        description: 'Required with x/y. One-action token returned by the immediately preceding computer_screenshot.',
      },
      to_x: { type: 'number', required: true, description: 'Global macOS point x with element; screenshot pixel x otherwise.' },
      to_y: { type: 'number', required: true, description: 'Global macOS point y with element; screenshot pixel y otherwise.' },
      duration_ms: { type: 'integer', description: 'Drag duration; defaults to 300ms.' },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('dragged', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const restoreObservedFocus = consumeApprovalFocusRecovery(exec)
      const point = await pointFor(args, exec, ownerId, restoreObservedFocus)
      await ctx.macosUse.drag({
        ...point,
        ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
        toX: args.to_x,
        toY: args.to_y,
        ...args.duration_ms === undefined ? {} : { durationMs: args.duration_ms },
      }, exec.signal, ownerId)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, point.target, exec.signal, 'computer-drag-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_scroll',
    description: 'Scroll the frontmost app, optionally focusing a fresh semantic element token first.',
    parameters: {
      direction: { type: 'string', required: true, enum: ['up', 'down', 'left', 'right'] as const },
      amount: { type: 'integer', description: 'Bounded scroll step count; defaults to 5.' },
      element: { type: 'string', description: 'Optional token to focus before scrolling.' },
      observation_id: {
        type: 'string',
        description: 'Required when element is omitted. One-action token from the immediately preceding computer_screenshot.',
      },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('scrolled', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const restoreObservedFocus = consumeApprovalFocusRecovery(exec)
      let target: ObservedWindowTarget | undefined
      if (args.element !== undefined) {
        const point = await pointFor({ element: args.element }, exec, ownerId, restoreObservedFocus)
        await ctx.macosUse.click({
          ...point,
          ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
        }, exec.signal, ownerId)
        target = targetFromReceipt(await ctx.macosUse.actionReceipt(point.target, exec.signal, ownerId))
      }
      await ctx.macosUse.scroll({
        direction: args.direction,
        ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
        ...args.amount === undefined ? {} : { amount: args.amount },
        ...target === undefined ? { observationId: requireObservationId(args.observation_id) } : { target },
      }, exec.signal, ownerId)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, target, exec.signal, 'computer-scroll-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_key',
    description: 'Press a single key or modifier combo on macOS, e.g. "return", "escape", "cmd+shift+t", "a".',
    parameters: {
      combo: { type: 'string', required: true, description: 'Key or "+"-joined modifier combo.' },
      observation_id: {
        type: 'string',
        required: true,
        description: 'One-action token returned by the immediately preceding computer_screenshot.',
      },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('pressed', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const restoreObservedFocus = consumeApprovalFocusRecovery(exec)
      await ctx.macosUse.key({
        combo: args.combo,
        observationId: args.observation_id,
        ...restoreObservedFocus ? { restoreObservedFocus: true } : {},
      }, exec.signal, ownerId)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, undefined, exec.signal, 'computer-key-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_open_app',
    description: 'Launch or bring to the front one uniquely resolved installed macOS application by exact display name.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact installed application display name; ambiguous matches fail closed.' },
    },
    output: {
      schema: ACTION_RESULT_SCHEMA,
      render: (_args, value) => renderActionReceipt('opened', value.receipt as unknown as ActionReceiptValue),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      await ctx.macosUse.openApp({ name: args.name }, exec.signal)
      tokens.invalidate(ownerId)
      return { receipt: await saveActionReceipt(ctx, undefined, exec.signal, 'computer-open-app-receipt.png', ownerId) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_focus_window',
    description: 'Bring one exact allowed macOS window to the front by id or app/title.',
    parameters: {
      window_id: { type: 'integer', description: 'CoreGraphics window id from computer_list_windows.' },
      app: { type: 'string', description: 'Application name when window_id is omitted.' },
      title: { type: 'string', description: 'Exact window title when selecting by app.' },
    },
    output: {
      schema: {
        ...WINDOW_SCHEMA,
        properties: {
          ...WINDOW_SCHEMA.properties,
          receipt: { ...ACTION_RECEIPT_SCHEMA, required: true },
        },
      },
      render: (_args, value) => renderActionReceipt(
        `focused ${JSON.stringify({ id: value.id, app: value.app, title: value.title })}`,
        value.receipt as unknown as ActionReceiptValue,
      ),
    },
    async execute(args, exec) {
      const ownerId = requireOwnerId(exec)
      const window = await ctx.macosUse.focusWindow({
        ...args.window_id === undefined ? {} : { id: args.window_id },
        ...args.app === undefined ? {} : { app: args.app },
        ...args.title === undefined ? {} : { title: args.title },
      }, exec.signal)
      tokens.invalidate(ownerId)
      const capture = await ctx.macosUse.screenshotWindow({ id: window.id }, exec.signal, ownerId)
      const receipt = await saveActionReceiptCapture(ctx, {
        ...capture,
        targetState: 'present',
      }, 'computer-focus-window-receipt.png')
      return { ...window, receipt }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_abort',
    description: 'Immediately cancel active computer_use_task/browser_use_task calls owned by this same agent only. '
      + 'It cannot stop another agent; the visual Emergency Stop is explicitly global.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { aborted: { type: 'integer', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `aborted ${String(value.aborted)} active GUI task(s)` }],
    },
    isConcurrencySafe: () => true,
    execute: (_args, exec) => Promise.resolve({ aborted: coordinator.abortOwner(requireOwnerId(exec)) }),
  }))

  ctx.tools.register(defineTool({
    name: 'computer_use_task',
    description: 'Autonomously operate the macOS desktop to accomplish a task: repeatedly screenshots the screen, '
      + 'asks the configured GUI model where to click/type/press next, and executes that action, until the model '
      + 'reports the task done or the step budget runs out. Use this for open-ended desktop tasks; prefer the '
      + 'primitive computer_* tools for one specific, already-known action.',
    parameters: {
      task: { type: 'string', required: true, description: 'The task to accomplish on the desktop, in natural language.' },
      max_steps: { type: 'integer', description: `Step budget from 1 to ${String(MAX_TASK_STEPS)} before giving up. Defaults to ${String(DEFAULT_MAX_STEPS)} unless changed visually.` },
      postcondition: MACOS_POSTCONDITION_SCHEMA,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          completed: {
            type: 'boolean',
            required: true,
            description: 'True only after the model reports done and a requested fresh host-side postcondition check passes.',
          },
          summary: { type: 'string', required: true },
          steps: STEP_LOG_SCHEMA,
          finalScreenshot: IMAGE_REF_SCHEMA,
          verification: TASK_VERIFICATION_SCHEMA,
        },
      },
      render: (_args, value) => renderTaskResult(taskResultValue(value)),
      presentationMeta: (_args, value) => taskPresentationMeta(taskResultValue(value)),
    },
    async execute(args, exec) {
      if (args.postcondition !== undefined) assertMacosPostcondition(args.postcondition)
      const ownerId = requireOwnerId(exec)
      const taskKey = approvalFocusRecoveryKey(ownerId, exec.callId)
      const pendingRecovery = taskKey === undefined ? undefined : approvedFocusRecoveries.get(taskKey)
      if (taskKey !== undefined && pendingRecovery !== undefined) approvedFocusRecoveries.delete(taskKey)
      const settings = live
      // Mark every task body, even one without an outer approval, so its own
      // per-action approval requests cannot be mistaken for a task-start UI.
      if (taskKey !== undefined) activeComputerTaskKeys.add(taskKey)
      try {
        return await coordinator.run(exec, ownerId, {
          singleActiveTask: settings.singleActiveTask,
          timeoutMs: settings.taskTimeoutMs,
        }, async (signal) => {
          const reporter = createTaskProgressReporter({
            store: progress,
            exec,
            toolName: 'computer_use_task',
            namePrefix: 'computer-use-task',
            saveScreenshot: (pngBase64, name) => saveScreenshot(ctx, pngBase64, name),
          })
          try {
            // Fail the call before the first autonomous screenshot if exact
            // owner/TTL/epoch/window/display/pixel restoration cannot succeed.
            if (pendingRecovery?.kind === 'task') {
              await ctx.macosUse.reactivateScreenObservation(
                pendingRecovery.observationId,
                signal,
                ownerId,
              )
            }
            let result: RunTaskResult
            let stoppedError: string | undefined
            try {
              let deferredTaskReason = deferredDesktopTaskApprovalReason(args.task, settings)
              result = await runGuiTask(ctx.guiModel, macosTaskExecutor(ctx, ownerId), {
                task: args.task,
                maxSteps: taskStepBudget(args.max_steps, settings.defaultMaxSteps),
                retainStepScreenshots: settings.showStepScreenshots,
                signal,
                beforeAction: async (action, actionSignal) => {
                  const approved = await approveAutonomousAction(
                    ctx,
                    exec,
                    action,
                    settings,
                    actionSignal ?? signal,
                    deferredTaskReason,
                  )
                  deferredTaskReason = undefined
                  return approved
                },
                onProgress: (event, progressSignal) => reporter.onProgress(event, progressSignal),
              })
            } catch (error) {
              ({ result, error: stoppedError } = stoppedRun(error))
            }
            let verification: TaskVerification
            try {
              verification = !result.completed ? modelDoneNotReached(stoppedError)
                : args.postcondition === undefined ? unverifiedModelDone()
                  : await verifyMacosPostcondition(ctx, args.postcondition, ownerId, signal)
            } catch (error) {
              verification = {
                modelDone: result.completed,
                status: result.completed ? 'verification_error' : 'not_reached',
                checkedAt: new Date().toISOString(),
                checks: [],
                error: String(error),
              }
            }
            let finalScreenshot: ImageAttachmentRef | undefined
            try {
              const { pngBase64 } = await ctx.macosUse.screenshot(signal, ownerId)
              finalScreenshot = await saveScreenshot(ctx, pngBase64, 'computer-use-task-result.png')
            } catch (error) {
              const message = `final screenshot failed: ${String(error)}`
              verification = result.completed
                ? { modelDone: true, status: 'verification_error', checkedAt: new Date().toISOString(), checks: [], error: message }
                : modelDoneNotReached(stoppedError === undefined ? message : `${stoppedError}; ${message}`)
            }
            return {
              completed: result.completed && verification.status === 'verified',
              summary: result.summary,
              steps: encodeSteps(result.steps, reporter.stepScreenshots),
              ...finalScreenshot === undefined ? {} : { finalScreenshot },
              verification,
            }
          } finally {
            reporter.finish()
          }
        })
      } finally {
        if (taskKey !== undefined) activeComputerTaskKeys.delete(taskKey)
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
      const ownerId = requireOwnerId(exec)
      await ctx.browserUse.navigate({ url: args.url, ownerId }, exec.signal)
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
      const ownerId = requireOwnerId(exec)
      await ctx.browserUse.clickSelector({ selector: args.selector, ownerId }, exec.signal)
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
      const ownerId = requireOwnerId(exec)
      await ctx.browserUse.fillSelector({ selector: args.selector, text: args.text, ownerId }, exec.signal)
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
      const ownerId = requireOwnerId(exec)
      const text = await ctx.browserUse.extractText({
        ...args.selector !== undefined ? { selector: args.selector } : {},
        ownerId,
      }, exec.signal)
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
      const ownerId = requireOwnerId(exec)
      const { pngBase64 } = await ctx.browserUse.screenshot({ ownerId }, exec.signal)
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
      max_steps: { type: 'integer', description: `Step budget from 1 to ${String(MAX_TASK_STEPS)} before giving up. Defaults to ${String(DEFAULT_MAX_STEPS)} unless changed visually.` },
      postcondition: BROWSER_POSTCONDITION_SCHEMA,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          completed: {
            type: 'boolean',
            required: true,
            description: 'True only after the model reports done and a requested fresh host-side postcondition check passes.',
          },
          summary: { type: 'string', required: true },
          steps: STEP_LOG_SCHEMA,
          finalScreenshot: IMAGE_REF_SCHEMA,
          verification: TASK_VERIFICATION_SCHEMA,
        },
      },
      render: (_args, value) => renderTaskResult(taskResultValue(value)),
      presentationMeta: (_args, value) => taskPresentationMeta(taskResultValue(value)),
    },
    async execute(args, exec) {
      if (args.postcondition !== undefined) assertBrowserPostcondition(args.postcondition)
      const ownerId = requireOwnerId(exec)
      const settings = live
      return coordinator.run(exec, ownerId, {
        singleActiveTask: settings.singleActiveTask,
        timeoutMs: settings.taskTimeoutMs,
      }, async (signal) => {
        if (args.url !== undefined) await ctx.browserUse.navigate({ url: args.url, ownerId }, signal)
        const reporter = createTaskProgressReporter({
          store: progress,
          exec,
          toolName: 'browser_use_task',
          namePrefix: 'browser-use-task',
          saveScreenshot: (pngBase64, name) => saveScreenshot(ctx, pngBase64, name),
        })
        try {
          let result: RunTaskResult
          let stoppedError: string | undefined
          try {
            result = await runGuiTask(ctx.guiModel, browserTaskExecutor(ctx, ownerId), {
              task: args.task,
              maxSteps: taskStepBudget(args.max_steps, settings.defaultMaxSteps),
              retainStepScreenshots: settings.showStepScreenshots,
              signal,
              beforeAction: (action, actionSignal) => approveAutonomousAction(
                ctx,
                exec,
                action,
                settings,
                actionSignal ?? signal,
              ),
              onProgress: (event, progressSignal) => reporter.onProgress(event, progressSignal),
            })
          } catch (error) {
            ({ result, error: stoppedError } = stoppedRun(error))
          }
          let verification: TaskVerification
          try {
            verification = !result.completed ? modelDoneNotReached(stoppedError)
              : args.postcondition === undefined ? unverifiedModelDone()
                : await verifyBrowserPostcondition(ctx, args.postcondition, ownerId, signal)
          } catch (error) {
            verification = {
              modelDone: result.completed,
              status: result.completed ? 'verification_error' : 'not_reached',
              checkedAt: new Date().toISOString(),
              checks: [],
              error: String(error),
            }
          }
          let finalScreenshot: ImageAttachmentRef | undefined
          try {
            const { pngBase64 } = await ctx.browserUse.screenshot({ ownerId }, signal)
            finalScreenshot = await saveScreenshot(ctx, pngBase64, 'browser-use-task-result.png')
          } catch (error) {
            const message = `final screenshot failed: ${String(error)}`
            verification = result.completed
              ? { modelDone: true, status: 'verification_error', checkedAt: new Date().toISOString(), checks: [], error: message }
              : modelDoneNotReached(stoppedError === undefined ? message : `${stoppedError}; ${message}`)
          }
          return {
            completed: result.completed && verification.status === 'verified',
            summary: result.summary,
            steps: encodeSteps(result.steps, reporter.stepScreenshots),
            ...finalScreenshot === undefined ? {} : { finalScreenshot },
            verification,
          }
        } finally {
          reporter.finish()
        }
      })
    },
    presentResult: (_args, result) => presentTaskResult(result),
  }))
}
