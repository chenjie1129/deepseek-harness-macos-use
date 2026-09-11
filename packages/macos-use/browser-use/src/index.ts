/**
 * Service Definition and Playwright-backed implementation for the browser-use capability seam (`ctx.browserUse`):
 * a real Playwright Chromium process with one isolated context/page per Agent, offering both DOM-selector actions
 * (navigate, click, fill, extract text — reliable and fast) and coordinate-grounded actions (click at a pixel,
 * type, press a key — for the vision-model-driven `browser_use_task` loop in
 * `@deepseek-ai/dsh-tool-macos-use`). Chromium launches lazily and closes on plugin disposal.
 * @module @deepseek-ai/dsh-browser-use
 */

import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { startPinnedBrowserProxy } from './pinned-proxy.ts'
import type { PinnedBrowserProxy, PinnedBrowserProxyOptions } from './pinned-proxy.ts'
import { EgoBrowserBackend } from './ego-backend.ts'
import { BrowserUseError } from './types.ts'
import type {
  BrowserBackendType,
  BrowserScreenshotResult,
  BrowserScreenshotRequest,
  BrowserPageState,
  BrowserPageStateRequest,
  BrowserUseRuntimeSettings,
  BrowserScrollRequest,
  ClickAtRequest,
  ClickSelectorRequest,
  DragAtRequest,
  ExtractTextRequest,
  FillSelectorRequest,
  KeyPressRequest,
  MoveAtRequest,
  NavigateRequest,
  TypeTextRequest,
} from './types.ts'

export { BrowserUseError } from './types.ts'
export { EgoBrowserBackend } from './ego-backend.ts'
export type {
  BrowserBackendType,
  BrowserScreenshotResult,
  BrowserScreenshotRequest,
  BrowserOwnerScope,
  BrowserPageState,
  BrowserPageStateRequest,
  BrowserUseRuntimeSettings,
  BrowserScrollRequest,
  BrowserUseErrorCode,
  ClickAtRequest,
  ClickSelectorRequest,
  DragAtRequest,
  ExtractTextRequest,
  FillSelectorRequest,
  KeyPressRequest,
  MoveAtRequest,
  NavigateRequest,
  TypeTextRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    browserUse: BrowserUseService
  }
}

/** Config for the browser-use seam. */
export interface Config {
  /** Run Chromium headless. Defaults to true; set false to watch the browser drive itself. */
  headless?: boolean
  /** Browser automation backend. 'playwright' (default) is the secure isolated backend; 'ego' is experimental and requires the ego lite app. */
  backend?: BrowserBackendType
  /** Command used to invoke the ego-browser CLI when backend is 'ego'. Defaults to 'ego-browser'. */
  egoBrowserCommand?: string
  /** Timeout in milliseconds for one ego-browser CLI invocation. Defaults to 30000. */
  egoBrowserTimeoutMs?: number
}

const BROWSER_USE_DEFAULT_HEADLESS = true
const BROWSER_USE_DEFAULT_ALLOW_PRIVATE_NETWORK = false
const BROWSER_USE_DEFAULT_BACKEND: BrowserBackendType = 'playwright'
const BROWSER_USE_DEFAULT_EGO_COMMAND = 'ego-browser'
const BROWSER_USE_DEFAULT_EGO_TIMEOUT_MS = 30_000
const BROWSER_USE_CHROMIUM_ARGS = [
  '--disable-blink-features=WebTransport',
  '--disable-quic',
  // Chromium sends destination hostnames to the authenticated proxy. Deny a
  // fallback browser-side DNS path so the proxy's validated numeric answer is
  // the only address used for a task connection.
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  // Chromium normally bypasses proxies for loopback targets. Remove that
  // implicit exception so private-network policy applies there as well.
  '--proxy-bypass-list=<-loopback>',
] as const
const BLOCKED_BROWSER_GLOBALS = [
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'WebTransport',
  // Playwright's HTTP and WebSocket routes do not see WebTransport opened
  // inside a Dedicated Worker. Blocking both worker constructors closes that
  // alternate execution realm as well as the window-level constructor below.
  'Worker',
  'SharedWorker',
] as const

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  const detail = typeof reason === 'string' || typeof reason === 'number'
    || typeof reason === 'boolean' || typeof reason === 'bigint'
    ? String(reason)
    : undefined
  return new Error(detail === undefined ? 'browser action aborted' : `browser action aborted: ${detail}`)
}

async function awaitAbortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  let listener!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => {
      onAbort?.()
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', listener, { once: true })
  })
  if (signal.aborted) listener()
  try {
    const result = await Promise.race([promise, aborted])
    signal.throwIfAborted()
    return result
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    signal.removeEventListener('abort', listener)
  }
}

export const Config: z<Config> = z.object({
  headless: z.boolean(),
  backend: z.union(['playwright', 'ego'] as const).default('playwright'),
  egoBrowserCommand: z.string().default('ego-browser'),
  egoBrowserTimeoutMs: z.number().step(1).min(1000).default(30000),
})

interface BrowserObservation {
  id: string
  page: Page
  url: string
  viewportDigest: string
  createdAt: number
}

interface BrowserOwnerState {
  readonly ownerId: string
  context: BrowserContext | undefined
  page: Page | undefined
  pagePromise: Promise<Page> | undefined
  observation: BrowserObservation | undefined
  blockedNavigation: BrowserUseError | undefined
}

const BROWSER_OBSERVATION_TTL_MS = 60_000
const MAX_BROWSER_OWNERS = 64
const DEFAULT_BROWSER_TEXT_CHARS = 20_000
const MAX_BROWSER_TEXT_CHARS = 100_000
const MAX_BROWSER_TITLE_CHARS = 4_096
const MAX_BROWSER_URL_CHARS = 8_192

function viewportDigest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('base64url')
}

function normalizedDomain(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase('en-US').replace(/^\.+/, '')
  const ipLiteral = normalizeIpLiteralHost(trimmed)
  if (isIP(ipLiteral) !== 0) return ipLiteral
  try {
    return normalizeIpLiteralHost(new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname)
      .replace(/\.$/, '')
  } catch {
    return trimmed.replace(/\.$/, '')
  }
}

function domainMatches(hostname: string, rule: string): boolean {
  const candidate = normalizeIpLiteralHost(hostname).replace(/\.$/, '')
  const expected = normalizedDomain(rule)
  return expected.length > 0 && (candidate === expected || candidate.endsWith(`.${expected}`))
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(value => Number(value))
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a = 0, b = 0] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
}

function normalizeIpLiteralHost(address: string): string {
  return (address.toLocaleLowerCase('en-US').split('%')[0] ?? address)
    .replace(/^\[/, '')
    .replace(/\]$/, '')
}

function expandIpv6(address: string): number[] | undefined {
  const normalized = normalizeIpLiteralHost(address)
  if (isIP(normalized) !== 6) return undefined
  const [head = '', tail = '', ...extra] = normalized.split('::')
  if (extra.length > 0) return undefined
  const parse = (part: string): number[] | undefined => {
    if (part.length === 0) return []
    const values = part.split(':').map(value => Number.parseInt(value, 16))
    return values.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)
      ? values
      : undefined
  }
  const before = parse(head)
  const after = parse(tail)
  if (before === undefined || after === undefined) return undefined
  if (!normalized.includes('::')) return before.length === 8 ? before : undefined
  const omitted = 8 - before.length - after.length
  if (omitted < 1) return undefined
  return [...before, ...Array.from({ length: omitted }, () => 0), ...after]
}

function isPrivateIp(address: string): boolean {
  const normalized = normalizeIpLiteralHost(address)
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized)
  const groups = expandIpv6(normalized)
  if (groups === undefined) return false
  const [first = 0] = groups
  const penultimate = groups[6] ?? 0
  const last = groups[7] ?? 0
  if (groups.slice(0, 7).every(value => value === 0) && last <= 1) return true
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true

  // IPv4-compatible and IPv4-mapped spellings are commonly normalized into
  // hexadecimal groups (for example ::ffff:127.0.0.1 -> ::ffff:7f00:1).
  const ipv4Compatible = groups.slice(0, 6).every(value => value === 0)
  const ipv4Mapped = groups.slice(0, 5).every(value => value === 0) && groups[5] === 0xffff
  if (!ipv4Compatible && !ipv4Mapped) return false
  const a = penultimate >> 8
  const b = penultimate & 0xff
  const c = last >> 8
  const d = last & 0xff
  return isPrivateIpv4(`${a}.${b}.${c}.${d}`)
}

/**
 * Enforce the synchronous URL policy before browser navigation or a DNS check.
 * @param rawUrl - candidate absolute browser URL.
 * @param settings - resolved destination grants and private-network policy.
 * @returns parsed URL when its scheme, credentials, host rules, and literal address are allowed.
 */
export function assertBrowserUrlPolicy(
  rawUrl: string,
  settings: Pick<BrowserUseRuntimeSettings, 'allowedDomains' | 'deniedDomains' | 'allowPrivateNetwork'>,
): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BrowserUseError(`blocked invalid browser URL: ${JSON.stringify(rawUrl)}`, 'BROWSER_USE_URL_BLOCKED')
  }
  if (url.protocol === 'about:' && url.href === 'about:blank') return url
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowserUseError(`blocked browser URL scheme: ${url.protocol}`, 'BROWSER_USE_URL_BLOCKED')
  }
  const hostname = url.hostname.toLocaleLowerCase('en-US').replace(/\.$/, '')
  if (settings.deniedDomains.some(rule => domainMatches(hostname, rule))) {
    throw new BrowserUseError(`browser destination is denied: ${hostname}`, 'BROWSER_USE_URL_BLOCKED')
  }
  if (settings.allowedDomains.length === 0) {
    throw new BrowserUseError(
      'browser networking is disabled until an allowed domain is configured',
      'BROWSER_USE_URL_BLOCKED',
    )
  }
  if (!settings.allowedDomains.some(rule => domainMatches(hostname, rule))) {
    throw new BrowserUseError(`browser destination is not granted: ${hostname}`, 'BROWSER_USE_URL_BLOCKED')
  }
  if (!settings.allowPrivateNetwork && (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname))) {
    throw new BrowserUseError(`private browser destination is blocked: ${hostname}`, 'BROWSER_USE_URL_BLOCKED')
  }
  return url
}

/**
 * Browser-use service. Registered as `ctx.browserUse` (one instance per context). Requires Playwright's Chromium
 * browser to be installed (`pnpm exec playwright install chromium`) — a missing browser surfaces as
 * `BROWSER_USE_LAUNCH_FAILED` on first use, not at plugin load.
 */
export class BrowserUseService extends Service {
  static Config = Config

  private headless: boolean
  private runtime: BrowserUseRuntimeSettings
  private backendType: BrowserBackendType
  private ego: EgoBrowserBackend | undefined
  private egoCommand: string
  private egoTimeoutMs: number
  private browser: Browser | undefined
  private browserPromise: Promise<Browser> | undefined
  private proxy: PinnedBrowserProxy | undefined
  private generation = 0
  private disposed = false
  private readonly owners = new Map<string, BrowserOwnerState>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserUse')
    this.headless = config.headless ?? BROWSER_USE_DEFAULT_HEADLESS
    this.backendType = config.backend ?? BROWSER_USE_DEFAULT_BACKEND
    this.egoCommand = config.egoBrowserCommand ?? BROWSER_USE_DEFAULT_EGO_COMMAND
    this.egoTimeoutMs = config.egoBrowserTimeoutMs ?? BROWSER_USE_DEFAULT_EGO_TIMEOUT_MS
    this.runtime = {
      headless: this.headless,
      allowedDomains: [],
      deniedDomains: [],
      allowPrivateNetwork: BROWSER_USE_DEFAULT_ALLOW_PRIVATE_NETWORK,
      backend: this.backendType,
    }
    ctx.on('agent/disposed', ({ agent }) => {
      void this.releaseOwner(agent.id).catch((error: unknown) => {
        ctx.logger.warn(`browser-use: failed to retire disposed Agent ${String(agent.id)}: ${String(error)}`)
      })
    })
    ctx.effect(() => async () => {
      this.disposed = true
      this.generation += 1
      const contexts = new Set(
        [...this.owners.values()].map(state => state.context).filter(value => value !== undefined),
      )
      this.owners.clear()
      const browserPromise = this.browserPromise
      this.browserPromise = undefined
      const browser = this.browser
      this.browser = undefined
      const proxy = this.proxy
      this.proxy = undefined
      const ego = this.ego
      this.ego = undefined
      await Promise.all([...contexts].map(async context => context.close().catch(() => {})))
      await browser?.close().catch(() => {})
      await proxy?.close().catch(() => {})
      await browserPromise?.then(async pending => pending.close().catch(() => {})).catch(() => {})
      await ego?.dispose().catch(() => {})
    }, 'browser-use teardown')
  }

  /**
   * Apply the visually managed launch mode. An existing browser is retired;
   * the next action launches a fresh instance with the new value.
   * @param headless - whether the next Chromium instance has visible chrome.
   */
  configureHeadless(headless: boolean): void {
    this.configure({ ...this.runtime, headless })
  }

  /**
   * Apply all browser controls from the Plugin Configuration page.
   * @param settings - complete live browser policy and launch-mode projection.
   */
  configure(settings: BrowserUseRuntimeSettings): void {
    const nextBackend = settings.backend ?? BROWSER_USE_DEFAULT_BACKEND
    const backendChanged = this.backendType !== nextBackend
    const retireContext = this.headless !== settings.headless
      || this.runtime.allowPrivateNetwork !== settings.allowPrivateNetwork
      || this.runtime.allowedDomains.length !== settings.allowedDomains.length
      || this.runtime.allowedDomains.some((value, index) => value !== settings.allowedDomains[index])
      || this.runtime.deniedDomains.length !== settings.deniedDomains.length
      || this.runtime.deniedDomains.some((value, index) => value !== settings.deniedDomains[index])
    this.headless = settings.headless
    this.backendType = nextBackend
    this.runtime = {
      headless: settings.headless,
      allowedDomains: [...settings.allowedDomains],
      deniedDomains: [...settings.deniedDomains],
      allowPrivateNetwork: settings.allowPrivateNetwork,
      backend: nextBackend,
    }
    if (backendChanged) {
      const ego = this.ego
      this.ego = undefined
      void ego?.dispose().catch(() => {})
    }
    if (!retireContext) return
    this.generation += 1
    const contexts = new Set(
      [...this.owners.values()].map(state => state.context).filter(value => value !== undefined),
    )
    const browser = this.browser
    const browserPromise = this.browserPromise
    const proxy = this.proxy
    this.owners.clear()
    this.browser = undefined
    this.browserPromise = undefined
    this.proxy = undefined
    for (const context of contexts) void context.close().catch(() => {})
    void browser?.close().catch(() => {})
    void proxy?.close().catch(() => {})
    // A launch that completes under the retired generation closes itself; the
    // catch also ensures a configuration race cannot create an unhandled rejection.
    void browserPromise?.catch(() => {})
  }

  private isEgo(): boolean {
    return this.backendType === 'ego'
  }

  private assertCoordinateActionSupported(): void {
    if (this.isEgo()) {
      throw new BrowserUseError(
        'coordinate browser actions are not supported by the experimental Ego backend; use selector-based browser_navigate/browser_click/browser_fill or switch back to the Playwright backend',
        'BROWSER_USE_UNSUPPORTED_ACTION',
      )
    }
  }

  private ensureEgoBackend(): EgoBrowserBackend {
    if (this.ego === undefined) {
      this.ego = new EgoBrowserBackend(this.ctx.logger, this.egoCommand, this.egoTimeoutMs)
    }
    return this.ego
  }

  /**
   * Navigate the active tab, launching the browser first if needed.
   * @param request - absolute URL to load.
   * @param signal - rejects before dispatch when already aborted.
   */
  async navigate(request: NavigateRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.assertNavigationAllowed(request.url, signal)
    if (this.isEgo()) return this.ensureEgoBackend().navigate(request, signal)
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    state.observation = undefined
    await this.runAction(state, () => page.goto(request.url, { waitUntil: 'domcontentloaded' }), signal)
    await this.assertNavigationAllowed(page.url(), signal)
  }

  /**
   * Click the first element matching a CSS or Playwright text/role selector.
   * @param request - selector identifying the element.
   * @param signal - rejects before dispatch when already aborted.
   */
  async clickSelector(request: ClickSelectorRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.isEgo()) return this.ensureEgoBackend().clickSelector(request, signal)
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    state.observation = undefined
    await this.runAction(state, () => page.locator(request.selector).first().click(), signal)
  }

  /**
   * Fill the first matching input, replacing its current value.
   * @param request - selector and literal replacement text.
   * @param signal - rejects before dispatch when already aborted.
   */
  async fillSelector(request: FillSelectorRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.isEgo()) return this.ensureEgoBackend().fillSelector(request, signal)
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    state.observation = undefined
    await this.runAction(state, () => page.locator(request.selector).first().fill(request.text), signal)
  }

  /**
   * Read the first matching element, or the whole page body when the selector is omitted.
   * @param request - optional selector.
   * @param signal - rejects before dispatch when already aborted.
   * @returns the element's inner text.
   */
  async extractText(request: ExtractTextRequest, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (this.isEgo()) return this.ensureEgoBackend().extractText(request, signal)
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const selector = request.selector ?? 'body'
    const limit = Math.max(1, Math.min(MAX_BROWSER_TEXT_CHARS,
      Math.trunc(request.maxTextChars ?? DEFAULT_BROWSER_TEXT_CHARS)))
    const text = await this.runAction(state, () => page.locator(selector).first().evaluate((element, textLimit) => {
      const value: unknown = (element as HTMLElement).innerText
      if (typeof value !== 'string') return ''
      const length = value.length < textLimit ? value.length : textLimit
      let bounded = ''
      for (let index = 0; index < length; index += 1) {
        const codeUnit = value[index]
        if (codeUnit !== undefined) bounded += codeUnit
      }
      return bounded
    }, limit), signal)
    // Keep a host-side bound as defense in depth if the browser adapter ever
    // returns a value that did not originate from the page-world callback.
    return text.slice(0, limit)
  }

  /**
   * Click at absolute pixel coordinates within the current viewport.
   * @param request - point and optional double-click flag.
   * @param signal - rejects before dispatch when already aborted.
   */
  async clickAt(request: ClickAtRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertCoordinateActionSupported()
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const observation = this.consumeObservation(state, page, request.observationId)
    await this.runObservationBoundAction(
      state,
      page,
      observation,
      () => request.doubleClick === true
        ? page.mouse.dblclick(request.x, request.y)
        : page.mouse.click(request.x, request.y),
      signal,
    )
  }

  /**
   * Move the pointer within the viewport without clicking.
   * @param request - destination point in viewport pixels.
   * @param signal - rejects before dispatch when already aborted.
   */
  async moveAt(request: MoveAtRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertCoordinateActionSupported()
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const observation = this.consumeObservation(state, page, request.observationId)
    await this.runObservationBoundAction(state, page, observation, () => page.mouse.move(request.x, request.y), signal)
  }

  /**
   * Drag between two viewport coordinates with the primary mouse button.
   * @param request - start and destination points in viewport pixels.
   * @param signal - rejects before dispatch when already aborted.
   */
  async dragAt(request: DragAtRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertCoordinateActionSupported()
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const observation = this.consumeObservation(state, page, request.observationId)
    await this.runObservationBoundAction(state, page, observation, async () => {
      await page.mouse.move(request.x, request.y)
      await page.mouse.down()
      try {
        await page.mouse.move(request.toX, request.toY, { steps: 12 })
      } finally {
        await page.mouse.up()
      }
    }, signal)
  }

  /**
   * Scroll once within the current viewport, bound to a fresh screenshot observation.
   * @param request - direction, bounded amount, owner, and fresh observation token.
   * @param signal - rejects before dispatch when already aborted.
   */
  async scroll(request: BrowserScrollRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertCoordinateActionSupported()
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const observation = this.consumeObservation(state, page, request.observationId)
    const amount = Math.max(1, Math.min(10, Math.trunc(request.amount ?? 1))) * 640
    const [deltaX, deltaY] = request.direction === 'left'
      ? [-amount, 0]
      : request.direction === 'right'
        ? [amount, 0]
        : request.direction === 'up'
          ? [0, -amount]
          : [0, amount]
    await this.runObservationBoundAction(
      state,
      page,
      observation,
      () => page.mouse.wheel(deltaX, deltaY),
      signal,
    )
  }

  /**
   * Type literal text into the currently focused element.
   * @param request - text to type.
   * @param signal - rejects before dispatch when already aborted.
   */
  async type(request: TypeTextRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertCoordinateActionSupported()
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const observation = this.consumeObservation(state, page, request.observationId)
    await this.runObservationBoundAction(
      state,
      page,
      observation,
      () => page.keyboard.type(request.text),
      signal,
    )
  }

  /**
   * Press a key or modifier combo using Playwright's vocabulary.
   * @param request - key or combo such as `"Enter"` or `"Control+A"`.
   * @param signal - rejects before dispatch when already aborted.
   */
  async key(request: KeyPressRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertCoordinateActionSupported()
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const observation = this.consumeObservation(state, page, request.observationId)
    await this.runObservationBoundAction(
      state,
      page,
      observation,
      () => page.keyboard.press(request.key),
      signal,
    )
  }

  /**
   * Capture the current viewport.
   * @param request - Agent owner whose isolated page should be captured.
   * @param signal - rejects before dispatch when already aborted.
   * @returns base64-encoded PNG bytes.
   */
  async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshotResult> {
    signal?.throwIfAborted()
    if (this.isEgo()) return this.ensureEgoBackend().screenshot(request, signal)
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const buffer = await this.runAction(state, () => page.screenshot({ type: 'png' }), signal)
    const observation = {
      id: randomUUID(),
      page,
      url: page.url(),
      viewportDigest: viewportDigest(buffer),
      createdAt: Date.now(),
    }
    state.observation = observation
    return {
      pngBase64: buffer.toString('base64'),
      observationId: observation.id,
      url: observation.url.slice(0, MAX_BROWSER_URL_CHARS),
    }
  }

  /**
   * Return a bounded, fresh semantic postcondition snapshot of the current page.
   * @param request - owner, optional selector, and text-size bound.
   * @param signal - rejects before dispatch when already aborted.
   * @returns the current URL, title, and bounded visible text.
   */
  async pageState(request: BrowserPageStateRequest, signal?: AbortSignal): Promise<BrowserPageState> {
    signal?.throwIfAborted()
    if (this.isEgo()) return this.ensureEgoBackend().pageState(request, signal)
    const [page, state] = await this.ensurePage(request.ownerId, signal)
    const selector = request.selector ?? 'body'
    const limit = Math.max(1, Math.min(MAX_BROWSER_TEXT_CHARS,
      Math.trunc(request.maxTextChars ?? DEFAULT_BROWSER_TEXT_CHARS)))
    // Resolve the Playwright selector and read every completion criterion in
    // one synchronous page-world evaluation. Separate title/text/url reads can
    // straddle a navigation and fabricate a state no single page ever had.
    const result = await this.runAction(state, () => page.locator(selector).first().evaluate((element, limits) => {
      const ownerDocument = element.ownerDocument
      // The page can replace String.prototype methods. Copy indexed UTF-16
      // code units so its own `slice` implementation cannot bypass our caps.
      const bound = (value: unknown, maxChars: number): string => {
        if (typeof value !== 'string') return ''
        const length = value.length < maxChars ? value.length : maxChars
        let bounded = ''
        for (let index = 0; index < length; index += 1) {
          const codeUnit = value[index]
          if (codeUnit !== undefined) bounded += codeUnit
        }
        return bounded
      }
      return {
        url: bound(ownerDocument.defaultView?.location.href, limits.url),
        title: bound(ownerDocument.title, limits.title),
        text: bound((element as HTMLElement).innerText, limits.text),
      }
    }, {
      text: limit,
      title: MAX_BROWSER_TITLE_CHARS,
      url: MAX_BROWSER_URL_CHARS,
    }), signal)
    // Mirror the page-world caps at the trust boundary so a future adapter or
    // test double cannot accidentally turn this result into unbounded evidence.
    return {
      url: result.url.slice(0, MAX_BROWSER_URL_CHARS),
      title: result.title.slice(0, MAX_BROWSER_TITLE_CHARS),
      text: result.text.slice(0, limit),
    }
  }

  /**
   * Retire one exact Agent's isolated browser state on trusted lifecycle disposal.
   * @param ownerId - byte-exact trusted Agent/session identity.
   */
  async releaseOwner(ownerId: string): Promise<void> {
    if (this.isEgo()) {
      await this.ensureEgoBackend().releaseOwner(ownerId).catch((error: unknown) => {
        this.ctx.logger.warn(`browser-use: ego releaseOwner failed for ${String(ownerId)}: ${String(error)}`)
      })
      return
    }
    const state = this.owners.get(ownerId)
    if (state !== undefined) await this.retireOwnerState(state)
  }

  private ownerState(ownerId: string): BrowserOwnerState {
    if (this.disposed) {
      throw new BrowserUseError('browser service is disposed', 'BROWSER_USE_ACTION_FAILED')
    }
    if (ownerId.trim() === '') {
      throw new BrowserUseError('browser caller owner is required', 'BROWSER_USE_ACTION_FAILED')
    }
    // SessionId is an opaque identity, not user input to canonicalize. Preserve
    // every byte so two distinct registered Agents can never share cookies/page.
    const existing = this.owners.get(ownerId)
    if (existing !== undefined) return existing
    const state: BrowserOwnerState = {
      ownerId,
      context: undefined,
      page: undefined,
      pagePromise: undefined,
      observation: undefined,
      blockedNavigation: undefined,
    }
    this.owners.set(ownerId, state)
    while (this.owners.size > MAX_BROWSER_OWNERS) {
      const oldest = this.owners.values().next().value
      if (oldest === undefined || oldest === state) break
      void this.retireOwnerState(oldest)
    }
    return state
  }

  private ownerIsCurrent(state: BrowserOwnerState): boolean {
    return !this.disposed && this.owners.get(state.ownerId) === state
  }

  private generationIsCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private assertOwnerIsCurrent(state: BrowserOwnerState): void {
    if (!this.ownerIsCurrent(state)) {
      throw new BrowserUseError(
        'browser owner state was retired by cancellation or a configuration change',
        'BROWSER_USE_ACTION_FAILED',
      )
    }
  }

  /**
   * Create the mandatory outbound policy boundary for one Chromium lifecycle.
   * Protected only so the service contract can replace the loopback listener
   * with an in-memory test double; production delegates to the pinned proxy.
   * @param options - live URL policy and private-network projection.
   * @returns authenticated Playwright proxy settings and lifecycle cleanup.
   */
  protected createNetworkProxy(options: PinnedBrowserProxyOptions): Promise<PinnedBrowserProxy> {
    return startPinnedBrowserProxy(options)
  }

  private startNetworkProxy(): Promise<PinnedBrowserProxy> {
    return this.createNetworkProxy({
      // Keep URL syntax/domain policy separate from DNS. The proxy owns the
      // one resolution whose numeric answer is used by its socket.
      validateUrl: rawUrl => assertBrowserUrlPolicy(rawUrl, this.runtime),
      allowPrivateNetwork: () => this.runtime.allowPrivateNetwork,
    })
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.disposed) {
      throw new BrowserUseError('browser service is disposed', 'BROWSER_USE_ACTION_FAILED')
    }
    if (this.browser !== undefined) return this.browser
    if (this.browserPromise !== undefined) return this.browserPromise
    const generation = this.generation
    const start = (async () => {
      let proxy: PinnedBrowserProxy | undefined
      try {
        proxy = await this.startNetworkProxy()
        if (this.disposed || generation !== this.generation) {
          await proxy.close().catch(() => {})
          throw new BrowserUseError(
            'browser proxy launch was retired by a configuration or lifecycle change',
            'BROWSER_USE_ACTION_FAILED',
          )
        }
        this.proxy = proxy
        const browser = await chromium.launch({
          headless: this.headless,
          // Defense in depth with the constructor lockdown below: this Blink
          // runtime flag applies to worker realms that page init scripts do not.
          args: [...BROWSER_USE_CHROMIUM_ARGS],
          proxy: proxy.playwrightProxy,
        })
        if (!this.generationIsCurrent(generation)) {
          await browser.close().catch(() => {})
          await proxy.close().catch(() => {})
          if (this.proxy === proxy) this.proxy = undefined
          throw new BrowserUseError(
            'browser launch was retired by a configuration or lifecycle change',
            'BROWSER_USE_ACTION_FAILED',
          )
        }
        this.browser = browser
        return browser
      } catch (error) {
        if (proxy !== undefined) {
          await proxy.close().catch(() => {})
          if (this.proxy === proxy) this.proxy = undefined
        }
        if (error instanceof BrowserUseError) throw error
        throw new BrowserUseError(`failed to launch Chromium: ${String(error)}`, 'BROWSER_USE_LAUNCH_FAILED')
      }
    })()
    this.browserPromise = start
    const clear = (): void => {
      if (this.browserPromise === start) this.browserPromise = undefined
    }
    void start.then(clear, clear)
    return start
  }

  private async createOwnerPage(state: BrowserOwnerState): Promise<Page> {
    let context: BrowserContext | undefined
    try {
      const browser = await this.ensureBrowser()
      this.assertOwnerIsCurrent(state)
      // Playwright routing does not see requests fulfilled by Service Workers.
      // Disable them so every page-initiated network request crosses our guard.
      context = await browser.newContext({ serviceWorkers: 'block' })
      if (!this.ownerIsCurrent(state)) {
        await context.close().catch(() => {})
        this.assertOwnerIsCurrent(state)
      }
      state.context = context
      // WebRTC and WebTransport do not reliably traverse Playwright's HTTP route
      // interception. Remove their constructors before page code runs and block
      // worker creation so an allowed origin cannot regain WebTransport in a
      // Dedicated Worker realm.
      await context.addInitScript((blockedGlobalNames) => {
        for (const name of blockedGlobalNames) {
          Object.defineProperty(globalThis, name, {
            configurable: false,
            enumerable: false,
            value: undefined,
            writable: false,
          })
        }
      }, [...BLOCKED_BROWSER_GLOBALS])
      this.assertOwnerIsCurrent(state)
      await this.installNavigationGuard(context, state)
      this.assertOwnerIsCurrent(state)
      const page = await context.newPage()
      if (!this.ownerIsCurrent(state)) {
        await context.close().catch(() => {})
        this.assertOwnerIsCurrent(state)
      }
      state.page = page
      return page
    } catch (error) {
      if (context !== undefined) {
        if (state.context === context) state.context = undefined
        await context.close().catch(() => {})
      }
      if (error instanceof BrowserUseError) throw error
      throw new BrowserUseError(`failed to create browser page: ${String(error)}`, 'BROWSER_USE_ACTION_FAILED')
    }
  }

  private async ensurePage(ownerId: string, signal?: AbortSignal): Promise<readonly [Page, BrowserOwnerState]> {
    const state = this.ownerState(ownerId)
    if (state.page !== undefined && !state.page.isClosed()) return [state.page, state]
    if (state.pagePromise === undefined) {
      const creation = this.createOwnerPage(state)
      state.pagePromise = creation
      const clear = (): void => {
        if (state.pagePromise === creation) state.pagePromise = undefined
      }
      void creation.then(clear, clear)
    }
    const page = await awaitAbortable(state.pagePromise, signal, () => { void this.retireOwnerState(state) })
    this.assertOwnerIsCurrent(state)
    return [page, state]
  }

  private consumeObservation(
    state: BrowserOwnerState,
    page: Page,
    observationId: string | undefined,
  ): BrowserObservation {
    const observation = state.observation
    if (observationId === undefined || observation === undefined || observation.id !== observationId
      || observation.page !== page || observation.url !== page.url()
      || Date.now() - observation.createdAt > BROWSER_OBSERVATION_TTL_MS) {
      throw new BrowserUseError(
        'browser observation is stale; capture a fresh screenshot before the coordinate action',
        'BROWSER_USE_STALE_OBSERVATION',
      )
    }
    // Reserve and consume synchronously before the first action await. This
    // makes concurrent calls with one observation one-shot as well.
    state.observation = undefined
    return observation
  }

  private async runObservationBoundAction<T>(
    state: BrowserOwnerState,
    page: Page,
    observation: BrowserObservation,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.runAction(state, async () => {
      const currentViewport = await page.screenshot({ type: 'png' })
      this.assertOwnerIsCurrent(state)
      if (observation.page !== page || observation.url !== page.url()
        || Date.now() - observation.createdAt > BROWSER_OBSERVATION_TTL_MS
        || viewportDigest(currentViewport) !== observation.viewportDigest) {
        throw new BrowserUseError(
          'browser viewport changed after the screenshot observation; capture a fresh screenshot before the action',
          'BROWSER_USE_STALE_OBSERVATION',
        )
      }
      return action()
    }, signal)
  }

  private async assertNavigationAllowed(rawUrl: string, signal?: AbortSignal): Promise<void> {
    const url = assertBrowserUrlPolicy(rawUrl, this.runtime)
    const hostname = normalizeIpLiteralHost(url.hostname)
    if (this.runtime.allowPrivateNetwork || url.protocol === 'about:' || isIP(hostname) !== 0) return
    try {
      const addresses = await awaitAbortable(lookup(hostname, { all: true, order: 'verbatim' }), signal)
      if (addresses.some(({ address }) => isPrivateIp(address))) {
        throw new BrowserUseError(
          `browser destination resolves to a private address: ${url.hostname}`,
          'BROWSER_USE_URL_BLOCKED',
        )
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof BrowserUseError) throw error
      throw new BrowserUseError(
        `browser destination could not be resolved safely: ${url.hostname}`,
        'BROWSER_USE_URL_BLOCKED',
      )
    }
  }

  private async assertWebSocketAllowed(rawUrl: string): Promise<void> {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new BrowserUseError(`blocked invalid WebSocket URL: ${JSON.stringify(rawUrl)}`, 'BROWSER_USE_URL_BLOCKED')
    }
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new BrowserUseError(`blocked WebSocket URL scheme: ${url.protocol}`, 'BROWSER_USE_URL_BLOCKED')
    }
    url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:'
    await this.assertNavigationAllowed(url.href)
  }

  private async installNavigationGuard(context: BrowserContext, state: BrowserOwnerState): Promise<void> {
    await context.route('**/*', async (route) => {
      const request = route.request()
      let url: URL
      try {
        url = new URL(request.url())
      } catch {
        state.blockedNavigation = new BrowserUseError(
          `browser request uses an invalid URL: ${JSON.stringify(request.url())}`,
          'BROWSER_USE_URL_BLOCKED',
        )
        await route.abort('blockedbyclient')
        return
      }
      const isDocument = request.isNavigationRequest() && request.resourceType() === 'document'
      if (!isDocument && (url.protocol === 'data:' || url.protocol === 'blob:')) {
        await route.continue()
        return
      }
      try {
        await this.assertNavigationAllowed(request.url())
        await route.continue()
      } catch (error) {
        state.blockedNavigation = error instanceof BrowserUseError
          ? error
          : new BrowserUseError(`browser navigation blocked: ${String(error)}`, 'BROWSER_USE_URL_BLOCKED')
        await route.abort('blockedbyclient')
      }
    })
    await context.routeWebSocket('**/*', async (socket) => {
      try {
        await this.assertWebSocketAllowed(socket.url())
        socket.connectToServer()
      } catch (error) {
        state.blockedNavigation = error instanceof BrowserUseError
          ? error
          : new BrowserUseError(`browser WebSocket blocked: ${String(error)}`, 'BROWSER_USE_URL_BLOCKED')
        await socket.close({ code: 1008, reason: 'Destination blocked by browser policy' })
      }
    })
  }

  private async runAction<T>(
    state: BrowserOwnerState,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted()
    this.assertOwnerIsCurrent(state)
    state.blockedNavigation = undefined
    try {
      // Defer dispatch until the abort listener is installed. If cancellation
      // wins this microtask race, the page is already retired before action().
      const actionPromise = Promise.resolve().then(() => {
        signal?.throwIfAborted()
        this.assertOwnerIsCurrent(state)
        return action()
      })
      const result = await awaitAbortable(actionPromise, signal, () => {
        // Closing only this owner's isolated context cancels in-flight
        // Playwright work without disrupting another Agent's browser.
        void this.retireOwnerState(state)
      })
      signal?.throwIfAborted()
      const blocked = this.blockedNavigationError(state)
      if (blocked !== undefined) throw blocked
      return result
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof BrowserUseError) throw error
      const blocked = this.blockedNavigationError(state)
      if (blocked !== undefined) throw blocked
      throw new BrowserUseError(`browser action failed: ${String(error)}`, 'BROWSER_USE_ACTION_FAILED')
    }
  }

  private blockedNavigationError(state: BrowserOwnerState): BrowserUseError | undefined {
    return state.blockedNavigation
  }

  private async retireOwnerState(state: BrowserOwnerState): Promise<void> {
    if (this.owners.get(state.ownerId) === state) this.owners.delete(state.ownerId)
    const context = state.context ?? state.page?.context()
    state.context = undefined
    state.page = undefined
    state.pagePromise = undefined
    state.observation = undefined
    state.blockedNavigation = undefined
    await context?.close().catch(() => {})
  }
}

export default BrowserUseService
