/** Approval classification for high-impact direct tools and autonomous actions. */

import type { Context } from '@deepseek-ai/cordis'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type { PreToolDecision, ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ResolvedSettings } from './settings.ts'

// This is deliberately a conservative prompt heuristic, not a semantic effect boundary. Raw
// coordinate clicks cannot reveal whether the pixel is Delete, Send, Buy, or something harmless.
const HIGH_IMPACT_TASK_PATTERNS = [
  /\b(delete|remove|trash|erase|uninstall|purchase|buy|pay|transfer|send|submit|post|publish|checkout|order)\b/i,
  /删除|移除|清空|抹掉|卸载|购买|买下|付款|支付|转账|汇款|发送|提交|发布|发帖|下单/,
  /削除|消去|ゴミ箱|アンインストール|購入|買う|支払(?:い|う)?|決済|送金|送信|提出|投稿|公開|注文/,
]

const DIRECT_MUTATING_TOOLS = new Set([
  'computer_click',
  'computer_type',
  'computer_move',
  'computer_drag',
  'computer_scroll',
  'computer_key',
  'computer_open_app',
  'computer_focus_window',
  'browser_navigate',
  'browser_click',
  'browser_fill',
])

/** Exact surface owned by this package; prefix-matching would interfere with unrelated plugins. */
const OWNED_GUI_TOOLS = new Set([
  ...DIRECT_MUTATING_TOOLS,
  'computer_screenshot',
  'computer_list_apps',
  'computer_list_windows',
  'computer_screenshot_window',
  'computer_get_window_state',
  'computer_abort',
  'computer_use_task',
  'browser_extract_text',
  'browser_screenshot',
  'browser_use_task',
])

function looksHighImpactTask(task: string): boolean {
  return HIGH_IMPACT_TASK_PATTERNS.some(pattern => pattern.test(task))
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
}

/**
 * Explain why a direct tool call requires one-shot human approval.
 * @param exec - pending model tool execution.
 * @param settings - live visual safety settings.
 * @returns an approval explanation, or undefined when the call can proceed normally.
 */
export function directApprovalReason(exec: ToolExecution, settings: ResolvedSettings): string | undefined {
  const args = record(exec.arguments)
  if (settings.confirmEveryMutation) {
    if (DIRECT_MUTATING_TOOLS.has(exec.name)) {
      return `The GUI agent wants to run ${exec.name}, which changes GUI state. Allow this action once?`
    }
    if (exec.name === 'browser_use_task' && typeof args.url === 'string') {
      return 'The browser task will navigate to its starting URL. Allow this navigation once?'
    }
  }
  if (!settings.confirmDestructiveActions) return undefined
  if (exec.name === 'computer_drag') return 'Dragging can move or replace user data. Allow this drag once?'
  if (exec.name === 'computer_key') {
    const combo = typeof args.combo === 'string' ? args.combo.toLowerCase() : ''
    if (/delete|backspace|cmd\+x|command\+x/.test(combo)) return `The GUI agent wants to press destructive key combo ${JSON.stringify(combo)}.`
  }
  // Desktop task approval is deliberately deferred until the first concrete
  // model-selected mutation. Asking here would focus the same-Mac Harness UI
  // before computer_use_task takes the screenshot that grounds that action.
  if (exec.name === 'browser_use_task'
      && typeof args.task === 'string' && looksHighImpactTask(args.task)) {
    return 'This autonomous GUI task appears to send, submit, purchase, transfer, publish, or delete something. Allow it once?'
  }
  return undefined
}

/**
 * Return the one deferred high-impact desktop-task reason, when per-mutation
 * confirmation is disabled. The caller asks only after a concrete mutation is
 * grounded in a desktop screenshot, then restores that exact observation.
 * @param task - natural-language desktop task.
 * @param settings - live visual safety settings captured for this task run.
 * @returns a one-shot reason or undefined when no deferred prompt is needed.
 */
export function deferredDesktopTaskApprovalReason(
  task: string,
  settings: ResolvedSettings,
): string | undefined {
  if (settings.confirmEveryMutation || !settings.confirmDestructiveActions || !looksHighImpactTask(task)) {
    return undefined
  }
  return 'This autonomous desktop task appears to send, submit, purchase, transfer, publish, or delete something. Allow its first concrete action once?'
}

/**
 * Return the configured pre-execution decision for one GUI tool.
 * @param exec - pending model tool execution.
 * @param settings - live visual safety settings.
 * @param activeTask - whether a coordinated task is already active.
 * @returns an ask/deny decision, or undefined to defer to the ordinary pipeline.
 */
export function guiPreExecutionDecision(
  exec: ToolExecution,
  settings: ResolvedSettings,
  activeTask: boolean,
): PreToolDecision | undefined {
  if (!OWNED_GUI_TOOLS.has(exec.name) || exec.name === 'computer_abort') return undefined
  if (settings.singleActiveTask && activeTask) {
    return { kind: 'deny', reason: 'another GUI task is active; abort it or wait for it to finish' }
  }
  const reason = directApprovalReason(exec, settings)
  return reason === undefined ? undefined : { kind: 'ask', reason }
}

function actionApprovalReason(action: GuiAction): string | undefined {
  if (action.kind === 'drag') return 'The GUI model selected a drag, which can move or replace user data.'
  if (action.kind === 'key' && action.combo !== undefined
      && /delete|backspace|cmd\+x|command\+x/i.test(action.combo)) {
    return `The GUI model selected destructive key combo ${JSON.stringify(action.combo)}.`
  }
  return undefined
}

/**
 * Ask inside an autonomous GUI task immediately before a model-selected action.
 * @param ctx - plugin context supplying the approval capability.
 * @param exec - parent autonomous tool execution.
 * @param action - next model-selected GUI action.
 * @param settings - live visual safety settings.
 * @param signal - task cancellation signal forwarded to the prompt.
 * @param deferredTaskReason - optional one-shot desktop task-level reason deferred until this grounded action.
 * @returns true only when an approval prompt was shown and allowed once.
 */
export async function approveAutonomousAction(
  ctx: Context,
  exec: ToolRunContext,
  action: GuiAction,
  settings: ResolvedSettings,
  signal: AbortSignal,
  deferredTaskReason?: string,
): Promise<boolean> {
  const reason = settings.confirmEveryMutation
    ? `The GUI model selected ${action.kind}, which changes GUI state. Allow this action once?`
    : deferredTaskReason ?? (settings.confirmDestructiveActions ? actionApprovalReason(action) : undefined)
  if (reason === undefined) return false
  const approval = ctx.get('approval')
  if (approval === undefined || exec.agent === undefined) {
    throw new Error(`${reason} Approval is required but no user approval channel is available.`)
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    reason,
    signal,
  })
  if (outcome !== 'allowed-once') throw new Error(`GUI action was not approved (${outcome})`)
  return true
}
