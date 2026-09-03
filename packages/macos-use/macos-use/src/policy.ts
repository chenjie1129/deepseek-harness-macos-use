/** Pure application identity and read/control scope evaluation. */

import type { MacosAppIdentityRule, MacosUseRuntimeSettings } from './types.ts'

/** Minimal running-application identity evaluated by read and control scope policy. */
export interface MacosAppIdentity {
  name: string
  bundleId?: string
  pid?: number
}

/**
 * Normalize an application display name for Unicode-safe policy comparison.
 * @param value - untrusted or platform-supplied application display name.
 * @returns the compatibility-normalized, case-folded alphanumeric name.
 */
export function normalizedAppName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '')
}

function normalizedBundleId(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

/**
 * Test one application identity against every selector declared by a precise rule.
 * @param identity - freshly observed application identity.
 * @param rule - configured name, bundle-id, and/or pid constraints.
 * @returns whether the rule is non-empty and every declared field matches.
 */
export function appIdentityMatches(identity: MacosAppIdentity, rule: MacosAppIdentityRule): boolean {
  const hasField = rule.name !== undefined || rule.bundleId !== undefined || rule.pid !== undefined
  if (!hasField) return false
  if (rule.name !== undefined && normalizedAppName(identity.name) !== normalizedAppName(rule.name)) return false
  if (rule.bundleId !== undefined
      && (identity.bundleId === undefined
        || normalizedBundleId(identity.bundleId) !== normalizedBundleId(rule.bundleId))) return false
  return rule.pid === undefined || identity.pid === rule.pid
}

/**
 * Evaluate one read or control scope. Precise grants take priority when
 * present; otherwise the legacy display-name allow list remains authoritative.
 * Empty precise and legacy grants fail closed. Legacy and precise denials
 * always win.
 * @param identity - freshly observed application identity to authorize.
 * @param options - precise grants and denials plus legacy display-name lists.
 * @returns whether the identity is granted for the evaluated scope and not denied.
 */
export function appScopeAllows(
  identity: MacosAppIdentity,
  options: {
    grants?: readonly MacosAppIdentityRule[]
    legacyAllowedApps: readonly string[]
    legacyDeniedApps: readonly string[]
    deniedIdentities?: readonly MacosAppIdentityRule[]
  },
): boolean {
  if (options.legacyDeniedApps.some(name => normalizedAppName(name) === normalizedAppName(identity.name))) return false
  if (options.deniedIdentities?.some(rule => appIdentityMatches(identity, rule)) === true) return false
  if (options.grants !== undefined && options.grants.length > 0) {
    return options.grants.some(rule => appIdentityMatches(identity, rule))
  }
  return options.legacyAllowedApps.some(name => normalizedAppName(name) === normalizedAppName(identity.name))
}

function validRule(rule: MacosAppIdentityRule): boolean {
  const validName = rule.name === undefined || normalizedAppName(rule.name).length > 0
  const validBundle = rule.bundleId === undefined || normalizedBundleId(rule.bundleId).length > 0
  const validPid = rule.pid === undefined || Number.isInteger(rule.pid) && rule.pid > 0
  return validName && validBundle && validPid
    && (rule.name !== undefined || rule.bundleId !== undefined || rule.pid !== undefined)
}

function activeGrantRules(
  grants: readonly MacosAppIdentityRule[] | undefined,
  legacyAllowedApps: readonly string[],
): readonly MacosAppIdentityRule[] {
  if (grants !== undefined && grants.length > 0) return grants
  return legacyAllowedApps.map(name => ({ name }))
}

/**
 * Determine whether every identity admitted by a control rule is also admitted by a read rule.
 * @param read - candidate equal-or-broader read grant.
 * @param control - control grant that must be a subset of the read grant.
 * @returns whether both rules are valid and the read constraints cover the control constraints.
 */
export function readRuleCoversControlRule(
  read: MacosAppIdentityRule,
  control: MacosAppIdentityRule,
): boolean {
  if (!validRule(read) || !validRule(control)) return false
  if (read.name !== undefined
      && (control.name === undefined
        || normalizedAppName(read.name) !== normalizedAppName(control.name))) return false
  if (read.bundleId !== undefined
      && (control.bundleId === undefined
        || normalizedBundleId(read.bundleId) !== normalizedBundleId(control.bundleId))) return false
  return read.pid === undefined || control.pid === read.pid
}

/**
 * Return a visual-settings validation error when a rule is malformed or when
 * control could admit an identity that read does not. Denials are deliberately
 * ignored for this conservative subset proof because they can be changed later.
 * @param settings - current legacy and precise application-scope settings.
 * @returns a human-facing validation error, or `undefined` when the grant policy is coherent.
 */
export function validateReadControlGrantPolicy(
  settings: Pick<
    MacosUseRuntimeSettings,
    'allowedApps' | 'readAppGrants' | 'controlAppGrants' | 'deniedAppIdentities'
  >,
): string | undefined {
  const namedSets: ReadonlyArray<readonly MacosAppIdentityRule[]> = [
    settings.readAppGrants ?? [],
    settings.controlAppGrants ?? [],
    settings.deniedAppIdentities ?? [],
  ]
  if (namedSets.some(rules => rules.some(rule => !validRule(rule)))) {
    return 'Each app identity rule must contain a non-empty name or bundleId, or a positive integer pid.'
  }
  if (settings.allowedApps.some(name => normalizedAppName(name).length === 0)) {
    return 'Legacy allowedApps entries must contain a non-empty application name.'
  }
  const readRules = activeGrantRules(settings.readAppGrants, settings.allowedApps)
  const controlRules = activeGrantRules(settings.controlAppGrants, settings.allowedApps)
  const uncovered = controlRules.find(control => !readRules.some(read => readRuleCoversControlRule(read, control)))
  if (uncovered !== undefined) {
    return `Every Control app grant must be covered by an equal or broader Read app grant; uncovered=${JSON.stringify(uncovered)}`
  }
  return undefined
}
