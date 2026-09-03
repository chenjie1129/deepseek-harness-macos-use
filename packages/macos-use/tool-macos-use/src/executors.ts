/**
 * {@link TaskExecutor} adapters translating a {@link GuiAction} into `ctx.macosUse` / `ctx.browserUse` calls.
 * @module @deepseek-ai/dsh-tool-macos-use/executors
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GuiAction } from '@deepseek-ai/dsh-gui-model'
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

function requireDestination(action: GuiAction): { toX: number; toY: number } {
  if (action.toX === undefined || action.toY === undefined) {
    throw new Error('"drag" action is missing toX/toY')
  }
  return { toX: action.toX, toY: action.toY }
}

function requireApp(action: GuiAction): string {
  if (action.app === undefined) throw new Error(`"${action.kind}" action is missing app`)
  return action.app
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
 * @param ownerId - trusted Agent owner identity bound to observations and actions.
 * @returns the desktop task executor.
 */
export function macosTaskExecutor(ctx: Context, ownerId: string): TaskExecutor {
  return {
    screenshot: signal => ctx.macosUse.screenshot(signal, ownerId),
    async perform(action, observationId, signal, restoreObservedFocus) {
      switch (action.kind) {
        case 'click': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.click({
            x,
            y,
            button: 'left',
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        }
        case 'double_click': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.click({
            x,
            y,
            doubleClick: true,
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        }
        case 'right_click': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.click({
            x,
            y,
            button: 'right',
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        }
        case 'move': {
          const { x, y } = requireXY(action)
          return ctx.macosUse.move({
            x,
            y,
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        }
        case 'drag': {
          const { x, y } = requireXY(action)
          const { toX, toY } = requireDestination(action)
          return ctx.macosUse.drag({
            x,
            y,
            toX,
            toY,
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        }
        case 'type':
          return ctx.macosUse.type({
            text: requireText(action),
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        case 'key':
          return ctx.macosUse.key({
            combo: requireCombo(action),
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        case 'scroll':
          return ctx.macosUse.scroll({
            direction: requireDirection(action),
            ...action.amount !== undefined ? { amount: action.amount } : {},
            observationId,
            ...restoreObservedFocus === true ? { restoreObservedFocus: true } : {},
          }, signal, ownerId)
        case 'open_app':
          return ctx.macosUse.openApp({ name: requireApp(action) }, signal).then(() => {})
        case 'focus_window':
          return ctx.macosUse.focusWindow({
            app: requireApp(action),
            ...action.windowTitle === undefined ? {} : { title: action.windowTitle },
          }, signal).then(() => {})
        default:
          throw new Error(`unsupported action kind for computer_use_task: ${action.kind}`)
      }
    },
  }
}

/**
 * Drive the active browser tab through its capability service.
 * @param ctx - context carrying `browserUse`.
 * @param ownerId - trusted Agent owner identity selecting the isolated browser context.
 * @returns the browser task executor.
 */
export function browserTaskExecutor(ctx: Context, ownerId: string): TaskExecutor {
  return {
    screenshot: signal => ctx.browserUse.screenshot({ ownerId }, signal),
    async perform(action, observationId, signal) {
      switch (action.kind) {
        case 'click': {
          const { x, y } = requireXY(action)
          return ctx.browserUse.clickAt({ x, y, observationId, ownerId }, signal)
        }
        case 'double_click': {
          const { x, y } = requireXY(action)
          return ctx.browserUse.clickAt({
            x,
            y,
            doubleClick: true,
            observationId,
            ownerId,
          }, signal)
        }
        case 'right_click':
          throw new Error('right_click is not supported for browser_use_task')
        case 'move': {
          const { x, y } = requireXY(action)
          return ctx.browserUse.moveAt({ x, y, observationId, ownerId }, signal)
        }
        case 'drag': {
          const { x, y } = requireXY(action)
          const { toX, toY } = requireDestination(action)
          return ctx.browserUse.dragAt({
            x,
            y,
            toX,
            toY,
            observationId,
            ownerId,
          }, signal)
        }
        case 'type':
          return ctx.browserUse.type({
            text: requireText(action),
            observationId,
            ownerId,
          }, signal)
        case 'key':
          return ctx.browserUse.key({
            key: requireCombo(action),
            observationId,
            ownerId,
          }, signal)
        case 'scroll':
          return ctx.browserUse.scroll({
            direction: requireDirection(action),
            ...action.amount === undefined ? {} : { amount: action.amount },
            observationId,
            ownerId,
          }, signal)
        case 'open_app':
        case 'focus_window':
          throw new Error(`${action.kind} is not supported for browser_use_task`)
        default:
          throw new Error(`unsupported action kind for browser_use_task: ${action.kind}`)
      }
    },
  }
}
