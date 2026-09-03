import { describe, expect, it } from 'vitest'
import {
  appIdentityMatches,
  appScopeAllows,
  readRuleCoversControlRule,
  validateReadControlGrantPolicy,
} from '../src/policy.ts'

const safari = { name: 'Safari', bundleId: 'com.apple.Safari', pid: 41 }

describe('application read/control scopes', () => {
  it('matches every precise identity field and rejects partial identity collisions', () => {
    expect(appIdentityMatches(safari, { bundleId: 'com.apple.safari', pid: 41 })).toBe(true)
    expect(appIdentityMatches(safari, { name: 'Safari', pid: 42 })).toBe(false)
    expect(appIdentityMatches(safari, {})).toBe(false)
  })

  it('uses precise grants when present while preserving legacy name grants otherwise', () => {
    expect(appScopeAllows(safari, {
      grants: [{ bundleId: 'com.apple.Safari', pid: 41 }],
      legacyAllowedApps: ['Notes'],
      legacyDeniedApps: [],
    })).toBe(true)
    expect(appScopeAllows(safari, {
      legacyAllowedApps: ['Safari'],
      legacyDeniedApps: [],
    })).toBe(true)
    expect(appScopeAllows(safari, {
      legacyAllowedApps: [],
      legacyDeniedApps: [],
    })).toBe(false)
  })

  it('gives legacy and precise denials priority over grants', () => {
    expect(appScopeAllows(safari, {
      grants: [{ bundleId: 'com.apple.Safari' }],
      legacyAllowedApps: [],
      legacyDeniedApps: ['Safari'],
    })).toBe(false)
    expect(appScopeAllows(safari, {
      grants: [{ bundleId: 'com.apple.Safari' }],
      legacyAllowedApps: [],
      legacyDeniedApps: [],
      deniedIdentities: [{ pid: 41 }],
    })).toBe(false)
  })

  it('does not collapse distinct Chinese or Japanese application names', () => {
    expect(appScopeAllows({ name: '微信' }, {
      legacyAllowedApps: ['密码'],
      legacyDeniedApps: [],
    })).toBe(false)
    expect(appIdentityMatches({ name: 'メモ' }, { name: '密码' })).toBe(false)
  })

  it('proves control is a subset of equal or broader read rules', () => {
    expect(readRuleCoversControlRule(
      { bundleId: 'com.apple.Notes' },
      { name: 'Notes', bundleId: 'com.apple.Notes', pid: 41 },
    )).toBe(true)
    expect(readRuleCoversControlRule(
      { name: 'Notes', bundleId: 'com.apple.Notes' },
      { bundleId: 'com.apple.Notes' },
    )).toBe(false)
    expect(readRuleCoversControlRule({ name: '微信' }, { name: '密码' })).toBe(false)
  })

  it('rejects an uncovered control grant before runtime configuration', () => {
    expect(validateReadControlGrantPolicy({
      allowedApps: [],
      readAppGrants: [{ bundleId: 'com.apple.Notes' }],
      controlAppGrants: [{ bundleId: 'com.apple.Passwords' }],
      deniedAppIdentities: [],
    })).toContain('Every Control app grant')
    expect(validateReadControlGrantPolicy({
      allowedApps: [],
      readAppGrants: [{ name: 'Notes' }],
      controlAppGrants: [{ name: 'Notes', bundleId: 'com.apple.Notes' }],
      deniedAppIdentities: [],
    })).toBeUndefined()
  })

  it('rejects malformed precise and legacy rules', () => {
    expect(validateReadControlGrantPolicy({
      allowedApps: [],
      readAppGrants: [{}],
      controlAppGrants: [],
      deniedAppIdentities: [],
    })).toContain('must contain')
    expect(validateReadControlGrantPolicy({
      allowedApps: ['---'],
      readAppGrants: [],
      controlAppGrants: [],
      deniedAppIdentities: [],
    })).toContain('Legacy')
  })
})
