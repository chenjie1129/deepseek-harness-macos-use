/**
 * {@link TaskExecutor} adapters translating a {@link GuiAction} into `ctx.macosUse` / `ctx.browserUse` calls.
 * @module @deepseek-ai/dsh-tool-macos-use/executors
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
import type {} from '@deepseek-ai/dsh-macos-use'
import type {} from '@deepseek-ai/dsh-browser-use'
import type { TaskExecutor } from './loop.ts'

function requireXY(action: GuiAction): { x: number; y: number } {
  if (action.x === undefined || action.y === undefined) {
    throw new Error(`"${action.kind}" action is missing x/y`)
  }
  return { x: action.x, y: action.y }
}

function requireText(action: GuiAction): string {
  if (action.text === undefined) throw new Error('"type" action is missing text')
  return action.text
}

function requireCombo(action: GuiAction): string {
  if (action.combo === undefined) throw new Error('"key" action is missing combo')
  return action.combo
}

function requireDirection(action: GuiAction): 'up' | 'down' | 'left' | 'right' {
  if (action.direction === undefined) throw new Error('"scroll" action is missing direction')
  return action.direction
}

/**
 * Drive the macOS desktop through its capability service.
 * @param ctx - context carrying `macosUse`.
 * @returns the desktop task executor.
 */
export function macosTaskExecutor(ctx: Context): TaskExecutor {
  return {
    screenshot: signal => ctx.macosUse.screenshot(signal),
    async perform(action, signal) {
      switch (action.kind) {
        case 'click': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.click({ x, y, button: 'left' }, signal)
        }
        case 'double_click': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.click({ x, y, doubleClick: true }, signal)
        }
        case 'right_click': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.click({ x, y, button: 'right' }, signal)
        }
        case 'type':
          return ctx.macosUse.type({ text: requireText(action) }, signal)
        case 'key':
          return ctx.macosUse.key({ combo: requireCombo(action) }, signal)
        case 'scroll':
          return ctx.macosUse.scroll({
            direction: requireDirection(action),
            ...action.amount !== undefined ? { amount: action.amount } : {},
          }, signal)
        default:
          throw new Error(`unsupported action kind for computer_use_task: ${action.kind}`)
      }
    },
  }
}

/** Map a GUI scroll direction to the Playwright key that approximates it. */
const BROWSER_SCROLL_KEY: Record<'up' | 'down' | 'left' | 'right', string> = {
  up: 'PageUp',
  down: 'PageDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}

/**
 * Drive the active browser tab through its capability service.
 * @param ctx - context carrying `browserUse`.
 * @returns the browser task executor.
 */
export function browserTaskExecutor(ctx: Context): TaskExecutor {
  return {
    screenshot: signal => ctx.browserUse.screenshot(signal),
    async perform(action, signal) {
      switch (action.kind) {
        case 'click': {
          const { x, y } = requireXY(action)
          return ctx.browserUse.clickAt({ x, y }, signal)
        }
        case 'double_click': {
          const { x, y } = requireXY(action)
          return ctx.browserUse.clickAt({ x, y, doubleClick: true }, signal)
        }
        case 'right_click':
          throw new Error('right_click is not supported for browser_use_task')
        case 'type':
          return ctx.browserUse.type({ text: requireText(action) }, signal)
        case 'key':
          return ctx.browserUse.key({ key: requireCombo(action) }, signal)
        case 'scroll': {
          const key = BROWSER_SCROLL_KEY[requireDirection(action)]
          const steps = Math.max(1, Math.min(10, Math.trunc(action.amount ?? 1)))
          for (let index = 0; index < steps; index += 1) await ctx.browserUse.key({ key }, signal)
          return
        }
        default:
          throw new Error(`unsupported action kind for browser_use_task: ${action.kind}`)
      }
    },
  }
}
