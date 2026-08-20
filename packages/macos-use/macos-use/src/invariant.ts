/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-macos-use`.
 * @module @deepseek-ai/dsh-macos-use/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-macos-use'

/** Cordis companion plugin name. */
export const name = 'macos-use-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every action is a single request/response `ctx.subprocess` call with no independent
 * event sequence or mutable data relation of its own — the subprocess seam owns process-tree correctness.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
