/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-macos-use`.
 * @module @deepseek-ai/dsh-tool-macos-use/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-macos-use'

/** Cordis companion plugin name. */
export const name = 'tool-macos-use-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each tool call is a stateless request into `ctx.macosUse`/`ctx.guiModel`/`ctx.browserUse`
 * with no independent event sequence or mutable data relation owned by this package.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
