/** Fail-closed installed-application selection for exact Launch Services activation. */

import { MacosUseError } from './types.ts'
import type { OpenAppRequest, ResolvedMacosApplication } from './types.ts'

function normalizedExactName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

/**
 * Select one canonical application bundle; name or bundle ambiguity is never guessed through.
 * @param applications - installed application bundles returned by Launch Services inspection.
 * @param request - exact display name and/or bundle identifier supplied by the trusted caller.
 * @returns the sole installed bundle satisfying every supplied selector.
 */
export function selectResolvedApplication(
  applications: readonly ResolvedMacosApplication[],
  request: OpenAppRequest,
): ResolvedMacosApplication {
  const requestedName = request.name?.trim()
  const requestedBundle = request.bundleId?.trim()
  if ((requestedName === undefined || requestedName.length === 0)
      && (requestedBundle === undefined || requestedBundle.length === 0)) {
    throw new MacosUseError('openApp requires an exact application name or bundleId', 'MACOS_USE_APP_NOT_FOUND')
  }
  const candidates = [...new Map(applications
    .filter(application => (
      (requestedName === undefined || requestedName.length === 0
        || normalizedExactName(application.name) === normalizedExactName(requestedName))
      && (requestedBundle === undefined || requestedBundle.length === 0
        || application.bundleId.toLocaleLowerCase('en-US') === requestedBundle.toLocaleLowerCase('en-US'))
    ))
    .map(application => [application.path, application])).values()]
  const selected = candidates[0]
  if (selected === undefined) {
    throw new MacosUseError(
      `application bundle was not found for ${JSON.stringify(request)}`,
      'MACOS_USE_APP_NOT_FOUND',
    )
  }
  if (candidates.length !== 1) {
    throw new MacosUseError(
      `application selector is ambiguous across ${String(candidates.length)} bundles; provide a unique bundleId`,
      'MACOS_USE_APP_AMBIGUOUS',
    )
  }
  return selected
}

/**
 * Compare a verified running-app name with its resolved bundle metadata.
 * @param left - one application display name.
 * @param right - the other application display name.
 * @returns whether the names are equal after the same exact-name normalization used for selection.
 */
export function sameExactApplicationName(left: string, right: string): boolean {
  return normalizedExactName(left) === normalizedExactName(right)
}
