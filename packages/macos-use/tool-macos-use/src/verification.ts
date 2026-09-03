/** Fresh, host-side postcondition checks for autonomous GUI tasks. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-browser-use'
import { normalizedAppName, type MacosWindow } from '@deepseek-ai/dsh-macos-use'

/** Browser criteria checked only after the GUI model reports `done`. */
export interface BrowserTaskPostcondition {
  /** Exact current page URL. */
  url_equals?: string
  /** Case-sensitive substring required in the current page URL. */
  url_contains?: string
  /** Exact current page title. */
  title_equals?: string
  /** Case-sensitive substring required in the current page title. */
  title_contains?: string
  /** Case-sensitive substring required in body text, or selector text when `selector` is supplied. */
  text_contains?: string
  /** Selector that must resolve; when supplied, `text_contains` applies to its text. */
  selector?: string
}

/** Exact-window criteria for a desktop task postcondition. */
export interface MacosWindowPostcondition {
  id?: number
  app?: string
  title?: string
  title_contains?: string
}

/** Native desktop criteria checked only after the GUI model reports `done`. */
export interface MacosTaskPostcondition {
  frontmost_app?: string
  frontmost_pid?: number
  window?: MacosWindowPostcondition
}

/** One deterministic comparison made by the host. */
export interface TaskVerificationCheck {
  criterion: string
  expected: string
  observed: string
  passed: boolean
}

/** Completion confidence reported beside every autonomous task result. */
export interface TaskVerification {
  modelDone: boolean
  status: 'not_reached' | 'model_done_unverified' | 'verified' | 'postcondition_failed' | 'verification_error'
  /** Wall-clock time after the fresh host-side read completed. */
  checkedAt?: string
  checks: TaskVerificationCheck[]
  error?: string
}

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

/**
 * Reject an empty or meaningless browser postcondition before taking any actions.
 * @param value - candidate independent browser completion criteria.
 */
export function assertBrowserPostcondition(value: BrowserTaskPostcondition): void {
  if (nonEmpty(value.url_equals) || nonEmpty(value.url_contains)
    || nonEmpty(value.title_equals) || nonEmpty(value.title_contains)
    || nonEmpty(value.text_contains) || nonEmpty(value.selector)) return
  throw new Error('browser_use_task postcondition must contain at least one non-empty criterion')
}

/**
 * Reject an empty or meaningless native postcondition before taking any actions.
 * @param value - candidate independent macOS completion criteria.
 */
export function assertMacosPostcondition(value: MacosTaskPostcondition): void {
  const window = value.window
  const hasWindow = window !== undefined && (
    window.id !== undefined || nonEmpty(window.app) || nonEmpty(window.title) || nonEmpty(window.title_contains)
  )
  if (nonEmpty(value.frontmost_app) || value.frontmost_pid !== undefined || hasWindow) return
  throw new Error('computer_use_task postcondition must contain at least one non-empty criterion')
}

function check(criterion: string, expected: string, observed: string, passed: boolean): TaskVerificationCheck {
  return { criterion, expected, observed, passed }
}

/**
 * Build the explicit compatibility status used when no independent criterion was requested.
 * @returns model-done result that makes the absence of independent verification explicit.
 */
export function unverifiedModelDone(): TaskVerification {
  return { modelDone: true, status: 'model_done_unverified', checks: [] }
}

/**
 * Build the status used when the model never reached its candidate `done` action.
 * @param error - optional stop or execution detail to surface with the result.
 * @returns result marked as not having reached model completion.
 */
export function modelDoneNotReached(error?: string): TaskVerification {
  return {
    modelDone: false,
    status: 'not_reached',
    checks: [],
    ...error === undefined ? {} : { error },
  }
}

/**
 * Verify browser state through one fresh, internally consistent `pageState` read.
 * @param ctx - context carrying the isolated browser capability.
 * @param expected - independent browser criteria requested before execution.
 * @param ownerId - trusted Agent owner identity selecting its browser context.
 * @param signal - optional cancellation signal for the fresh read.
 * @returns verification status and criterion-by-criterion evidence.
 */
export async function verifyBrowserPostcondition(
  ctx: Context,
  expected: BrowserTaskPostcondition,
  ownerId: string,
  signal?: AbortSignal,
): Promise<TaskVerification> {
  try {
    const state = await ctx.browserUse.pageState({
      ...expected.selector === undefined ? {} : { selector: expected.selector },
      maxTextChars: 100_000,
      ownerId,
    }, signal)
    const checkedAt = new Date().toISOString()
    const checks: TaskVerificationCheck[] = []
    if (expected.url_equals !== undefined) {
      checks.push(check('url_equals', expected.url_equals, state.url, state.url === expected.url_equals))
    }
    if (expected.url_contains !== undefined) {
      checks.push(check('url_contains', expected.url_contains, state.url, state.url.includes(expected.url_contains)))
    }
    if (expected.title_equals !== undefined) {
      checks.push(check('title_equals', expected.title_equals, state.title, state.title === expected.title_equals))
    }
    if (expected.title_contains !== undefined) {
      checks.push(check('title_contains', expected.title_contains, state.title, state.title.includes(expected.title_contains)))
    }
    if (expected.text_contains !== undefined) {
      checks.push(check(
        'text_contains',
        expected.text_contains,
        state.text.includes(expected.text_contains) ? 'substring present' : 'substring absent',
        state.text.includes(expected.text_contains),
      ))
    }
    if (expected.selector !== undefined) {
      checks.push(check('selector', expected.selector, 'selector resolved', true))
    }
    return {
      modelDone: true,
      status: checks.every(candidate => candidate.passed) ? 'verified' : 'postcondition_failed',
      checkedAt,
      checks,
    }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      modelDone: true,
      status: 'verification_error',
      checkedAt: new Date().toISOString(),
      checks: [],
      error: String(error),
    }
  }
}

function windowMatches(window: MacosWindow, expected: MacosWindowPostcondition): boolean {
  return (expected.id === undefined || window.id === expected.id)
    && (expected.app === undefined || normalizedAppName(window.app) === normalizedAppName(expected.app))
    && (expected.title === undefined || window.title === expected.title)
    && (expected.title_contains === undefined || window.title.includes(expected.title_contains))
}

/**
 * Verify the frontmost process and matching windows through one policy-filtered native completion snapshot.
 * @param ctx - context carrying the macOS capability.
 * @param expected - independent native criteria requested before execution.
 * @param ownerId - trusted task owner associated with the result being verified.
 * @param signal - optional cancellation signal for the fresh native read.
 * @returns verification status and criterion-by-criterion evidence.
 */
export async function verifyMacosPostcondition(
  ctx: Context,
  expected: MacosTaskPostcondition,
  ownerId: string,
  signal?: AbortSignal,
): Promise<TaskVerification> {
  try {
    void ownerId
    const state = await ctx.macosUse.completionState(signal)
    const frontmost = state.frontmostProcess
    const windows = state.windows
    const checkedAt = new Date().toISOString()
    const checks: TaskVerificationCheck[] = []
    if (expected.frontmost_app !== undefined) {
      checks.push(check(
        'frontmost_app',
        expected.frontmost_app,
        frontmost?.name ?? 'not visible in application read scope',
        frontmost !== undefined && normalizedAppName(frontmost.name) === normalizedAppName(expected.frontmost_app),
      ))
    }
    if (expected.frontmost_pid !== undefined) {
      checks.push(check(
        'frontmost_pid',
        String(expected.frontmost_pid),
        frontmost === undefined ? 'not visible in application read scope' : String(frontmost.pid),
        frontmost?.pid === expected.frontmost_pid,
      ))
    }
    if (expected.window !== undefined) {
      const match = windows.find(window => windowMatches(window, expected.window as MacosWindowPostcondition))
      checks.push(check(
        'window',
        JSON.stringify(expected.window),
        match === undefined ? 'no matching window' : JSON.stringify(match),
        match !== undefined,
      ))
    }
    return {
      modelDone: true,
      status: checks.every(candidate => candidate.passed) ? 'verified' : 'postcondition_failed',
      checkedAt,
      checks,
    }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      modelDone: true,
      status: 'verification_error',
      checkedAt: new Date().toISOString(),
      checks: [],
      error: String(error),
    }
  }
}
