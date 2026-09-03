/** Live settings contract for the complete GUI-agent P0 surface. */

import z from '@deepseek-ai/schemastery'
import {
  validateReadControlGrantPolicy,
  type MacosAppIdentityRule,
} from '@deepseek-ai/dsh-macos-use'

/** Default autonomous action budget, also embedded in model-facing task schema prose. */
export const DEFAULT_MAX_STEPS = 20
/** Hard ceiling for a single autonomous loop, including caller-supplied overrides. */
export const MAX_TASK_STEPS = 100
const DEFAULT_TASK_TIMEOUT_MS = 120_000
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000
const DEFAULT_MAX_ELEMENTS = 250
const DEFAULT_SHOW_STEP_SCREENSHOTS = true
const DEFAULT_BROWSER_HEADLESS = true
const DEFAULT_BROWSER_ALLOW_PRIVATE_NETWORK = false
const DEFAULT_CONFIRM_DESTRUCTIVE = true
const DEFAULT_CONFIRM_EVERY_MUTATION = true
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
  /** Store and render fresh visual evidence for each autonomous step. */
  showStepScreenshots?: boolean
  /** Launch the managed Chromium page without visible browser chrome. */
  browserHeadless?: boolean
  /** Comma/newline list of exact or parent-domain browser grants; empty denies network navigation. */
  browserAllowedDomains?: string
  /** Comma/newline list of exact or parent-domain browser denials. */
  browserDeniedDomains?: string
  /** Permit the managed browser to navigate to loopback, link-local, and private-network targets. */
  browserAllowPrivateNetwork?: boolean
  /** Legacy comma/newline name grants; empty grants no app when precise grants are also empty. */
  allowedApps?: string
  /** Comma/newline list of applications desktop actions must never control. */
  deniedApps?: string
  /** Newline list of precise app identities allowed for discovery/capture. */
  readAppGrants?: string
  /** Newline list of precise app identities allowed for control. */
  controlAppGrants?: string
  /** Newline list of precise app identities denied for both read and control. */
  deniedAppIdentities?: string
  /** Comma/newline list whose foreground display-coordinate and exact-window captures fail closed. */
  excludedScreenshotApps?: string
  /** Enable a heuristic one-shot prompt for risky drags, keys, and task wording; not a semantic effect boundary. */
  confirmDestructiveActions?: boolean
  /** Require one-shot approval before every model-selected or direct GUI mutation. */
  confirmEveryMutation?: boolean
  /** Reject a new GUI tool while an autonomous GUI task is active. */
  singleActiveTask?: boolean
  /** Monotonic visual abort request; operational, not rendered as a value field. */
  abortRevision?: number
}

export const Config: z<Config> = z.object({
  defaultMaxSteps: z.number().step(1).min(1).max(MAX_TASK_STEPS).default(DEFAULT_MAX_STEPS),
  taskTimeoutMs: z.number().step(1).min(1).default(DEFAULT_TASK_TIMEOUT_MS),
  commandTimeoutMs: z.number().step(1).min(1).default(DEFAULT_COMMAND_TIMEOUT_MS),
  maxElementsPerSnapshot: z.number().step(1).min(1).max(2000).default(DEFAULT_MAX_ELEMENTS),
  showStepScreenshots: z.boolean().default(DEFAULT_SHOW_STEP_SCREENSHOTS),
  browserHeadless: z.boolean().default(DEFAULT_BROWSER_HEADLESS),
  browserAllowedDomains: z.string().default(''),
  browserDeniedDomains: z.string().default(''),
  browserAllowPrivateNetwork: z.boolean().default(DEFAULT_BROWSER_ALLOW_PRIVATE_NETWORK),
  allowedApps: z.string().default(''),
  deniedApps: z.string().default(''),
  readAppGrants: z.string().default(''),
  controlAppGrants: z.string().default(''),
  deniedAppIdentities: z.string().default(''),
  excludedScreenshotApps: z.string().default(DEFAULT_EXCLUDED_SCREENSHOT_APPS),
  confirmDestructiveActions: z.boolean().default(DEFAULT_CONFIRM_DESTRUCTIVE),
  confirmEveryMutation: z.boolean().default(DEFAULT_CONFIRM_EVERY_MUTATION),
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
  browserAllowedDomains: readonly string[]
  browserDeniedDomains: readonly string[]
  browserAllowPrivateNetwork: boolean
  allowedApps: readonly string[]
  deniedApps: readonly string[]
  readAppGrants: readonly MacosAppIdentityRule[]
  controlAppGrants: readonly MacosAppIdentityRule[]
  deniedAppIdentities: readonly MacosAppIdentityRule[]
  excludedScreenshotApps: readonly string[]
  confirmDestructiveActions: boolean
  confirmEveryMutation: boolean
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
 * Parse visual precise-app rules. A bare line is a name rule; composite rules
 * use `name=... | bundleId=... | pid=...`. Malformed input rejects instead of
 * silently widening the effective app scope.
 * @param value - newline-delimited precise application rules from visual settings.
 * @returns parsed rules in display order with identity fields preserved.
 */
export function parseAppIdentityRules(value: string | undefined): readonly MacosAppIdentityRule[] {
  const rules: MacosAppIdentityRule[] = []
  for (const [index, source] of (value ?? '').split('\n').entries()) {
    const line = source.trim()
    if (line === '') continue
    if (!line.includes('=')) {
      rules.push({ name: line })
      continue
    }
    const rule: { name?: string; bundleId?: string; pid?: number } = {}
    const seen = new Set<'name' | 'bundleId' | 'pid'>()
    for (const sourcePart of line.split('|')) {
      const part = sourcePart.trim()
      const match = /^(name|bundleId|pid)\s*=\s*(.+)$/.exec(part)
      if (match === null) throw new Error(`invalid application identity rule on line ${String(index + 1)}`)
      const key = match[1] as 'name' | 'bundleId' | 'pid'
      const raw = match[2]
      const text = raw?.trim() ?? ''
      if (text === '') {
        throw new Error(`invalid application identity rule on line ${String(index + 1)}`)
      }
      if (seen.has(key)) {
        throw new Error(`duplicate ${key} in application identity rule on line ${String(index + 1)}`)
      }
      seen.add(key)
      if (key === 'pid') {
        const pid = Number(text)
        if (!Number.isSafeInteger(pid) || pid <= 0) {
          throw new Error(`invalid application pid on line ${String(index + 1)}`)
        }
        rule.pid = pid
      } else if (key === 'name') {
        rule.name = text
      } else {
        rule.bundleId = text
      }
    }
    rules.push(rule)
  }
  return rules
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
    browserAllowedDomains: parseAppList(config.browserAllowedDomains),
    browserDeniedDomains: parseAppList(config.browserDeniedDomains),
    browserAllowPrivateNetwork: config.browserAllowPrivateNetwork ?? DEFAULT_BROWSER_ALLOW_PRIVATE_NETWORK,
    allowedApps: parseAppList(config.allowedApps),
    deniedApps: parseAppList(config.deniedApps),
    readAppGrants: parseAppIdentityRules(config.readAppGrants),
    controlAppGrants: parseAppIdentityRules(config.controlAppGrants),
    deniedAppIdentities: parseAppIdentityRules(config.deniedAppIdentities),
    excludedScreenshotApps: parseAppList(config.excludedScreenshotApps ?? DEFAULT_EXCLUDED_SCREENSHOT_APPS),
    confirmDestructiveActions: config.confirmDestructiveActions ?? DEFAULT_CONFIRM_DESTRUCTIVE,
    confirmEveryMutation: config.confirmEveryMutation ?? DEFAULT_CONFIRM_EVERY_MUTATION,
    singleActiveTask: config.singleActiveTask ?? DEFAULT_SINGLE_ACTIVE_TASK,
    abortRevision: config.abortRevision ?? 0,
  }
}

/**
 * Resolve and validate the exact desktop read/control relationship before persistence.
 * @param config - candidate settings-section projection.
 * @returns complete runtime settings when every control grant is covered by read scope.
 */
export function validateSettings(config: Config): ResolvedSettings {
  const settings = resolveSettings(config)
  const violation = validateReadControlGrantPolicy({
    allowedApps: settings.allowedApps,
    readAppGrants: settings.readAppGrants,
    controlAppGrants: settings.controlAppGrants,
    deniedAppIdentities: settings.deniedAppIdentities,
  })
  if (violation !== undefined) throw new Error(violation)
  return settings
}
