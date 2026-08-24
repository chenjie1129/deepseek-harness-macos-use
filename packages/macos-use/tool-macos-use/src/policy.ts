/** Approval classification for high-impact direct tools and autonomous actions. */

import type { Context } from '@deepseek-ai/cordis'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type { PreToolDecision, ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ResolvedSettings } from './settings.ts'

const DESTRUCTIVE_TASK = /\b(delete|remove|trash|erase|uninstall|purchase|buy|pay|transfer|send|submit|post|publish)\b/i

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
  if (exec.name === 'computer_run_applescript' && settings.confirmAppleScript) {
    return 'The GUI agent wants to run arbitrary AppleScript. Review the script before allowing it once.'
  }
  if (!settings.confirmDestructiveActions) return undefined
  const args = record(exec.arguments)
  if (exec.name === 'computer_drag') return 'Dragging can move or replace user data. Allow this drag once?'
  if (exec.name === 'computer_key') {
    const combo = typeof args.combo === 'string' ? args.combo.toLowerCase() : ''
    if (/delete|backspace|cmd\+x|command\+x/.test(combo)) return `The GUI agent wants to press destructive key combo ${JSON.stringify(combo)}.`
  }
  if ((exec.name === 'computer_use_task' || exec.name === 'browser_use_task')
      && typeof args.task === 'string' && DESTRUCTIVE_TASK.test(args.task)) {
    return 'This autonomous GUI task appears to send, submit, purchase, transfer, publish, or delete something. Allow it once?'
  }
  return undefined
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
  const guiTool = exec.name.startsWith('computer_') || exec.name.startsWith('browser_')
  if (!guiTool || exec.name === 'computer_abort') return undefined
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
 * Ask inside an autonomous desktop task immediately before a destructive model-selected action.
 * @param ctx - plugin context supplying the approval capability.
 * @param exec - parent autonomous tool execution.
 * @param action - next model-selected GUI action.
 * @param settings - live visual safety settings.
 * @param signal - task cancellation signal forwarded to the prompt.
 * @returns once no confirmation is needed or the action was allowed once.
 */
export async function approveAutonomousAction(
  ctx: Context,
  exec: ToolRunContext,
  action: GuiAction,
  settings: ResolvedSettings,
  signal: AbortSignal,
): Promise<void> {
  if (!settings.confirmDestructiveActions) return
  const reason = actionApprovalReason(action)
  if (reason === undefined) return
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
  if (outcome !== 'allowed-once') throw new Error(`destructive GUI action was not approved (${outcome})`)
}
