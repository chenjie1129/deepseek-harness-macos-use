/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-browser-use`.
 * @module @deepseek-ai/dsh-browser-use/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-browser-use'

/** Cordis companion plugin name. */
export const name = 'browser-use-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the one owned mutable relation — a live `page` implies a live `browser` — is a private
 * implementation detail with no independently observable event sequence.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
