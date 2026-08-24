/** Live settings contract for the complete GUI-agent P0 surface. */

import z from '@deepseek-ai/schemastery'

/** Default autonomous action budget, also embedded in model-facing task schema prose. */
export const DEFAULT_MAX_STEPS = 20
const DEFAULT_TASK_TIMEOUT_MS = 120_000
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000
const DEFAULT_MAX_ELEMENTS = 250
const DEFAULT_SHOW_STEP_SCREENSHOTS = true
const DEFAULT_BROWSER_HEADLESS = true
const DEFAULT_CONFIRM_APPLESCRIPT = true
const DEFAULT_CONFIRM_DESTRUCTIVE = true
const DEFAULT_SINGLE_ACTIVE_TASK = true

/** Newline-separated because the visual settings card edits these as lists. */
export const DEFAULT_EXCLUDED_SCREENSHOT_APPS = [
  'Passwords',
  '1Password',
  'Keychain Access',
  'Terminal',
  'iTerm2',
  'Warp',
  'Notification Center',
  'NotificationCenter',
  'UserNotificationCenter',
  'Control Center',
].join('\n')

/** All user-adjustable GUI-agent configuration. */
export interface Config {
  /** Default action budget for autonomous desktop and browser tasks. */
  defaultMaxSteps?: number
  /** Wall-clock deadline in milliseconds for one autonomous GUI task. */
  taskTimeoutMs?: number
  /** Deadline in milliseconds for one native macOS command. */
  commandTimeoutMs?: number
  /** Maximum Accessibility elements returned by one semantic snapshot. */
  maxElementsPerSnapshot?: number
  /** Store and render the screenshot that grounded each autonomous step. */
  showStepScreenshots?: boolean
  /** Launch the managed Chromium page without visible browser chrome. */
  browserHeadless?: boolean
  /** Comma/newline list restricting desktop control; empty permits every app not denied. */
  allowedApps?: string
  /** Comma/newline list of applications desktop actions must never control. */
  deniedApps?: string
  /** Comma/newline list whose windows are masked in full-screen captures and reject exact capture. */
  excludedScreenshotApps?: string
  /** Require one-shot confirmation before arbitrary AppleScript. */
  confirmAppleScript?: boolean
  /** Require one-shot confirmation before drag, destructive keys, or destructive task intent. */
  confirmDestructiveActions?: boolean
  /** Reject a new GUI tool while an autonomous GUI task is active. */
  singleActiveTask?: boolean
  /** Monotonic visual abort request; operational, not rendered as a value field. */
  abortRevision?: number
}

export const Config: z<Config> = z.object({
  defaultMaxSteps: z.number().step(1).min(1).default(DEFAULT_MAX_STEPS),
  taskTimeoutMs: z.number().step(1).min(1).default(DEFAULT_TASK_TIMEOUT_MS),
  commandTimeoutMs: z.number().step(1).min(1).default(DEFAULT_COMMAND_TIMEOUT_MS),
  maxElementsPerSnapshot: z.number().step(1).min(1).max(2000).default(DEFAULT_MAX_ELEMENTS),
  showStepScreenshots: z.boolean().default(DEFAULT_SHOW_STEP_SCREENSHOTS),
  browserHeadless: z.boolean().default(DEFAULT_BROWSER_HEADLESS),
  allowedApps: z.string().default(''),
  deniedApps: z.string().default(''),
  excludedScreenshotApps: z.string().default(DEFAULT_EXCLUDED_SCREENSHOT_APPS),
  confirmAppleScript: z.boolean().default(DEFAULT_CONFIRM_APPLESCRIPT),
  confirmDestructiveActions: z.boolean().default(DEFAULT_CONFIRM_DESTRUCTIVE),
  singleActiveTask: z.boolean().default(DEFAULT_SINGLE_ACTIVE_TASK),
  abortRevision: z.number().step(1).min(0).default(0),
})

/** Fully resolved configuration used by executors. */
export interface ResolvedSettings {
  defaultMaxSteps: number
  taskTimeoutMs: number
  commandTimeoutMs: number
  maxElementsPerSnapshot: number
  showStepScreenshots: boolean
  browserHeadless: boolean
  allowedApps: readonly string[]
  deniedApps: readonly string[]
  excludedScreenshotApps: readonly string[]
  confirmAppleScript: boolean
  confirmDestructiveActions: boolean
  singleActiveTask: boolean
  abortRevision: number
}

/**
 * Parse comma/newline lists while preserving application names containing spaces.
 * @param value - visual list field contents.
 * @returns trimmed non-empty application names in display order.
 */
export function parseAppList(value: string | undefined): readonly string[] {
  return (value ?? '').split(/[\n,]/).map(item => item.trim()).filter(item => item.length > 0)
}

/**
 * Resolve optional Cordis config fields to the exact values the live policy enforces.
 * @param config - current settings-section projection.
 * @returns complete immutable runtime settings.
 */
export function resolveSettings(config: Config): ResolvedSettings {
  return {
    defaultMaxSteps: config.defaultMaxSteps ?? DEFAULT_MAX_STEPS,
    taskTimeoutMs: config.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
    commandTimeoutMs: config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    maxElementsPerSnapshot: config.maxElementsPerSnapshot ?? DEFAULT_MAX_ELEMENTS,
    showStepScreenshots: config.showStepScreenshots ?? DEFAULT_SHOW_STEP_SCREENSHOTS,
    browserHeadless: config.browserHeadless ?? DEFAULT_BROWSER_HEADLESS,
    allowedApps: parseAppList(config.allowedApps),
    deniedApps: parseAppList(config.deniedApps),
    excludedScreenshotApps: parseAppList(config.excludedScreenshotApps ?? DEFAULT_EXCLUDED_SCREENSHOT_APPS),
    confirmAppleScript: config.confirmAppleScript ?? DEFAULT_CONFIRM_APPLESCRIPT,
    confirmDestructiveActions: config.confirmDestructiveActions ?? DEFAULT_CONFIRM_DESTRUCTIVE,
    singleActiveTask: config.singleActiveTask ?? DEFAULT_SINGLE_ACTIVE_TASK,
    abortRevision: config.abortRevision ?? 0,
  }
}
