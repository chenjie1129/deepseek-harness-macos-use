/**
 * Prompt construction and response parsing for {@link GuiModelService}, isolated from `index.ts` so the
 * model-facing contract (what the assistant sees, what shape it must answer in) stays one independently
 * readable and testable unit.
 * @module @deepseek-ai/dsh-gui-model/parse
 */

import { GuiModelError } from './types.ts'
import type { GuiAction, GuiActionKind, GuiActionLogEntry } from './types.ts'

/** Instructs the model to answer with exactly one JSON action object and nothing else. */
export const SYSTEM_PROMPT = 'You are a GUI grounding model. You are given a screenshot and a task. '
  + 'Respond with exactly one JSON object describing the single next action to take toward completing the '
  + 'task — no prose, no markdown fences, just the JSON object. Its shape is:\n'
  + '{"kind": "click"|"double_click"|"right_click"|"type"|"key"|"scroll"|"wait"|"done", '
  + '"x"?: number, "y"?: number, "text"?: string, "combo"?: string, '
  + '"direction"?: "up"|"down"|"left"|"right", "amount"?: number, "ms"?: number, '
  + '"summary"?: string, "reason"?: string}\n'
  + '"x"/"y" are pixel coordinates in the screenshot for click/double_click/right_click. '
  + '"text" is literal text to type. "combo" is a key or modifier combo like "return" or "cmd+shift+t". '
  + '"direction"/"amount" are for scroll. "ms" is a pause duration for wait. '
  + 'Choose "done" with a "summary" only once the task is fully accomplished.'

/**
 * Build the user-turn text accompanying the screenshot.
 * @param task - requested outcome.
 * @param history - prior actions and outcomes, oldest first.
 * @returns the model-facing task and history text.
 */
export function buildUserPrompt(task: string, history: readonly GuiActionLogEntry[] | undefined): string {
  const lines = [`Task: ${task}`]
  if (history !== undefined && history.length > 0) {
    lines.push('Prior steps:')
    history.forEach((entry, index) => {
      const outcome = entry.outcome === undefined ? '' : ` -> ${entry.outcome}`
      lines.push(`${index + 1}. ${JSON.stringify(entry.action)}${outcome}`)
    })
  }
  lines.push('Screenshot of the current state is attached. Respond with the single next action as JSON.')
  return lines.join('\n')
}

const ACTION_KINDS: ReadonlySet<GuiActionKind> = new Set([
  'click', 'double_click', 'right_click', 'type', 'key', 'scroll', 'wait', 'done',
])

/** Extract the first balanced `{...}` object from `content`, tolerating surrounding prose or code fences. */
function extractJsonObject(content: string): string {
  const start = content.indexOf('{')
  if (start === -1) {
    throw new GuiModelError(`GUI model response carried no JSON object: ${content}`, 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  let depth = 0
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1
    else if (content[index] === '}') {
      depth -= 1
      if (depth === 0) return content.slice(start, index + 1)
    }
  }
  throw new GuiModelError(`GUI model response carried an unterminated JSON object: ${content}`, 'GUI_MODEL_MALFORMED_RESPONSE')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Parse and validate the model's raw response text into a {@link GuiAction}.
 * @param content - the assistant message content.
 * @returns the validated next action.
 * @throws {GuiModelError} `GUI_MODEL_MALFORMED_RESPONSE` when no valid action can be recovered.
 */
export function parseGuiAction(content: string): GuiAction {
  const json = extractJsonObject(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new GuiModelError(`GUI model response was not valid JSON: ${String(error)}`, 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new GuiModelError('GUI model response JSON was not an object', 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  const raw = parsed as Record<string, unknown>
  const kind = raw.kind
  if (typeof kind !== 'string' || !ACTION_KINDS.has(kind as GuiActionKind)) {
    throw new GuiModelError(`GUI model response carried an unknown action kind: ${JSON.stringify(kind)}`, 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  const action: GuiAction = { kind: kind as GuiActionKind }
  if (isFiniteNumber(raw.x)) action.x = raw.x
  if (isFiniteNumber(raw.y)) action.y = raw.y
  if (typeof raw.text === 'string') action.text = raw.text
  if (typeof raw.combo === 'string') action.combo = raw.combo
  if (raw.direction === 'up' || raw.direction === 'down' || raw.direction === 'left' || raw.direction === 'right') action.direction = raw.direction
  if (isFiniteNumber(raw.amount)) action.amount = raw.amount
  if (isFiniteNumber(raw.ms)) action.ms = raw.ms
  if (typeof raw.summary === 'string') action.summary = raw.summary
  if (typeof raw.reason === 'string') action.reason = raw.reason

  const requiresXY = action.kind === 'click' || action.kind === 'double_click' || action.kind === 'right_click'
  if (requiresXY && (action.x === undefined || action.y === undefined)) {
    throw new GuiModelError(`GUI model "${action.kind}" action is missing x/y: ${json}`, 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  if (action.kind === 'type' && action.text === undefined) {
    throw new GuiModelError(`GUI model "type" action is missing text: ${json}`, 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  if (action.kind === 'key' && action.combo === undefined) {
    throw new GuiModelError(`GUI model "key" action is missing combo: ${json}`, 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  if (action.kind === 'scroll' && action.direction === undefined) {
    throw new GuiModelError('GUI model "scroll" action is missing direction', 'GUI_MODEL_MALFORMED_RESPONSE')
  }
  return action
}
