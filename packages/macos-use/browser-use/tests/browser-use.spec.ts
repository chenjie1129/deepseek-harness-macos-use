import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserUseService, { assertBrowserUrlPolicy, BrowserUseError } from '@deepseek-ai/dsh-browser-use'
import type { PinnedBrowserProxy, PinnedBrowserProxyOptions } from '../src/pinned-proxy.ts'

const mock = vi.hoisted(() => {
  const lookup = vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }]))
  const click = vi.fn(() => Promise.resolve())
  const dblclick = vi.fn(() => Promise.resolve())
  const fill = vi.fn(() => Promise.resolve())
  const innerText = vi.fn(() => Promise.resolve('page text'))
  const key = vi.fn(() => Promise.resolve())
  const type = vi.fn(() => Promise.resolve())
  const goto = vi.fn(() => Promise.resolve(null))
  const screenshot = vi.fn(() => Promise.resolve(Buffer.from('png')))
  const title = vi.fn(() => Promise.resolve('Fixture'))
  const evaluate = vi.fn((_callback?: unknown, argument?: unknown) => Promise.resolve(
    typeof argument === 'number'
      ? 'page text'
      : { url: 'about:blank', title: 'Fixture', text: 'page text' },
  ))
  const move = vi.fn(() => Promise.resolve())
  const down = vi.fn(() => Promise.resolve())
  const up = vi.fn(() => Promise.resolve())
  const wheel = vi.fn(() => Promise.resolve())
  const closeContext = vi.fn(() => Promise.resolve())
  const closeBrowser = vi.fn(() => Promise.resolve())
  const closeProxy = vi.fn(() => Promise.resolve())
  const playwrightProxy = Object.freeze({
    server: 'http://127.0.0.1:32123',
    username: 'fixture-user',
    password: 'fixture-password',
  })
  const startPinnedBrowserProxy = vi.fn((_options: unknown) => Promise.resolve({ playwrightProxy, close: closeProxy }))
  const first = vi.fn(() => ({ click, evaluate, fill, innerText }))
  const locator = vi.fn(() => ({ first }))
  const page = {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => 'about:blank'),
    title,
    goto,
    locator,
    mouse: { click, dblclick, move, down, up, wheel },
    keyboard: { type, press: key },
    screenshot,
    context: vi.fn(),
  }
  const route = vi.fn(() => Promise.resolve())
  const routeWebSocket = vi.fn(() => Promise.resolve())
  const addInitScript = vi.fn(() => Promise.resolve())
  const context = {
    addInitScript,
    newPage: vi.fn(() => Promise.resolve(page)),
    close: closeContext,
    route,
    routeWebSocket,
  }
  page.context.mockReturnValue(context)
  const browser = { newContext: vi.fn(() => Promise.resolve(context)), close: closeBrowser }
  const launch = vi.fn(() => Promise.resolve(browser))
  return {
    browser,
    addInitScript,
    click,
    closeBrowser,
    closeContext,
    closeProxy,
    context,
    dblclick,
    down,
    evaluate,
    fill,
    first,
    goto,
    innerText,
    key,
    launch,
    lookup,
    locator,
    move,
    page,
    playwrightProxy,
    screenshot,
    startPinnedBrowserProxy,
    title,
    type,
    up,
    wheel,
    route,
    routeWebSocket,
  }
})

vi.mock('node:dns/promises', () => ({ lookup: mock.lookup }))
vi.mock('playwright', () => ({ chromium: { launch: mock.launch } }))

class BrowserUseServiceHarness extends BrowserUseService {
  protected override createNetworkProxy(options: PinnedBrowserProxyOptions): Promise<PinnedBrowserProxy> {
    return mock.startPinnedBrowserProxy(options)
  }
}

const EXPECTED_CHROMIUM_ARGS = [
  '--disable-blink-features=WebTransport',
  '--disable-quic',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  '--proxy-bypass-list=<-loopback>',
]

const OWNER_ID = 'agent-1'

beforeEach(() => {
  vi.clearAllMocks()
  mock.startPinnedBrowserProxy.mockResolvedValue({
    playwrightProxy: mock.playwrightProxy,
    close: mock.closeProxy,
  })
  mock.launch.mockResolvedValue(mock.browser)
  mock.browser.newContext.mockResolvedValue(mock.context)
  mock.context.newPage.mockResolvedValue(mock.page)
  mock.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  mock.page.isClosed.mockReturnValue(false)
  mock.page.url.mockReturnValue('about:blank')
  mock.goto.mockResolvedValue(null)
  mock.click.mockResolvedValue()
  mock.screenshot.mockResolvedValue(Buffer.from('png'))
  mock.evaluate.mockImplementation((_callback?: unknown, argument?: unknown) => Promise.resolve(
    typeof argument === 'number'
      ? 'page text'
      : { url: 'about:blank', title: 'Fixture', text: 'page text' },
  ))
})

async function bench(config: { headless?: boolean } = {}) {
  const ctx = new Context()
  const fiber = ctx.plugin(BrowserUseServiceHarness, config)
  await fiber
  return { ctx, fiber }
}

describe('browser-use service', () => {
  it('reuses one lazy page across selector, coordinate, keyboard, and screenshot actions', async () => {
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })

    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' })
    await ctx.browserUse.clickSelector({ ownerId: OWNER_ID, selector: '#submit' })
    await ctx.browserUse.fillSelector({ ownerId: OWNER_ID, selector: '#name', text: 'Ada' })
    await expect(ctx.browserUse.extractText({ ownerId: OWNER_ID })).resolves.toBe('page text')
    await expect(ctx.browserUse.extractText({ ownerId: OWNER_ID, selector: 'main' })).resolves.toBe('page text')
    await ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 12,
      y: 34,
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    await ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 56,
      y: 78,
      doubleClick: true,
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    await ctx.browserUse.moveAt({
      ownerId: OWNER_ID,
      x: 90,
      y: 91,
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    await ctx.browserUse.dragAt({
      ownerId: OWNER_ID,
      x: 10,
      y: 20,
      toX: 30,
      toY: 40,
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    await ctx.browserUse.scroll({
      ownerId: OWNER_ID,
      direction: 'down',
      amount: 2,
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    await ctx.browserUse.type({
      ownerId: OWNER_ID,
      text: 'hello',
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    await ctx.browserUse.key({
      ownerId: OWNER_ID,
      key: 'Enter',
      observationId: (await ctx.browserUse.screenshot({ ownerId: OWNER_ID })).observationId,
    })
    const finalScreenshot = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })
    expect(finalScreenshot).toMatchObject({
      pngBase64: Buffer.from('png').toString('base64'),
      url: 'about:blank',
    })
    expect(typeof finalScreenshot.observationId).toBe('string')

    expect(mock.launch).toHaveBeenCalledOnce()
    expect(mock.launch).toHaveBeenCalledWith({
      headless: true,
      args: EXPECTED_CHROMIUM_ARGS,
      proxy: mock.playwrightProxy,
    })
    expect(mock.startPinnedBrowserProxy).toHaveBeenCalledOnce()
    const proxyOptions = mock.startPinnedBrowserProxy.mock.calls[0]?.[0] as PinnedBrowserProxyOptions | undefined
    expect(proxyOptions).toBeDefined()
    if (proxyOptions === undefined) throw new Error('missing pinned browser proxy options')
    expect(proxyOptions.allowPrivateNetwork()).toBe(false)
    expect(proxyOptions.validateUrl('https://example.test/path')).toMatchObject({
      hostname: 'example.test',
      pathname: '/path',
    })
    expect(mock.browser.newContext).toHaveBeenCalledOnce()
    expect(mock.browser.newContext).toHaveBeenCalledWith({ serviceWorkers: 'block' })
    expect(mock.addInitScript).toHaveBeenCalledWith(expect.any(Function), [
      'RTCPeerConnection',
      'webkitRTCPeerConnection',
      'WebTransport',
      'Worker',
      'SharedWorker',
    ])
    expect(mock.context.newPage).toHaveBeenCalledOnce()
    expect(mock.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(mock.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function))
    expect(mock.goto).toHaveBeenCalledWith('https://example.test/', { waitUntil: 'domcontentloaded' })
    expect(mock.locator.mock.calls).toEqual([['#submit'], ['#name'], ['body'], ['main']])
    expect(mock.click).toHaveBeenCalledWith(12, 34)
    expect(mock.dblclick).toHaveBeenCalledWith(56, 78)
    expect(mock.move.mock.calls).toEqual([
      [90, 91],
      [10, 20],
      [30, 40, { steps: 12 }],
    ])
    expect(mock.down).toHaveBeenCalledOnce()
    expect(mock.up).toHaveBeenCalledOnce()
    expect(mock.wheel).toHaveBeenCalledWith(0, 1280)
    expect(mock.type).toHaveBeenCalledWith('hello')
    expect(mock.key).toHaveBeenCalledWith('Enter')
  })

  it('honors headed configuration and closes the page context and browser on disposal', async () => {
    const { ctx, fiber } = await bench({ headless: false })
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })

    await fiber.dispose()

    expect(mock.launch).toHaveBeenCalledWith({
      headless: false,
      args: EXPECTED_CHROMIUM_ARGS,
      proxy: mock.playwrightProxy,
    })
    expect(mock.closeContext).toHaveBeenCalledOnce()
    expect(mock.closeBrowser).toHaveBeenCalledOnce()
    expect(mock.closeProxy).toHaveBeenCalledOnce()
  })

  it('retires only the disposed Agent context and keeps another owner live', async () => {
    const { ctx } = await bench()
    const closeSecond = vi.fn(() => Promise.resolve())
    const secondPage = {
      ...mock.page,
      context: vi.fn(),
      isClosed: vi.fn(() => false),
    }
    const secondContext = {
      ...mock.context,
      addInitScript: vi.fn(() => Promise.resolve()),
      newPage: vi.fn(() => Promise.resolve(secondPage)),
      close: closeSecond,
      route: vi.fn(() => Promise.resolve()),
      routeWebSocket: vi.fn(() => Promise.resolve()),
    }
    secondPage.context.mockReturnValue(secondContext)
    mock.browser.newContext
      .mockResolvedValueOnce(mock.context)
      .mockResolvedValueOnce(secondContext)

    await ctx.browserUse.screenshot({ ownerId: 'agent-a' })
    await ctx.browserUse.screenshot({ ownerId: 'agent-b' })
    expect(mock.browser.newContext).toHaveBeenCalledTimes(2)

    ctx.emit('agent/disposed', { agent: { id: 'agent-a' } as unknown as Agent })
    await vi.waitFor(() => { expect(mock.closeContext).toHaveBeenCalledOnce() })
    expect(closeSecond).not.toHaveBeenCalled()

    await ctx.browserUse.screenshot({ ownerId: 'agent-b' })
    expect(mock.browser.newContext).toHaveBeenCalledTimes(2)
  })

  it('keeps byte-distinct Agent identities in separate browser contexts', async () => {
    const { ctx } = await bench()
    const secondPage = { ...mock.page, context: vi.fn(), isClosed: vi.fn(() => false) }
    const secondContext = {
      ...mock.context,
      addInitScript: vi.fn(() => Promise.resolve()),
      newPage: vi.fn(() => Promise.resolve(secondPage)),
      close: vi.fn(() => Promise.resolve()),
      route: vi.fn(() => Promise.resolve()),
      routeWebSocket: vi.fn(() => Promise.resolve()),
    }
    secondPage.context.mockReturnValue(secondContext)
    mock.browser.newContext
      .mockResolvedValueOnce(mock.context)
      .mockResolvedValueOnce(secondContext)

    await ctx.browserUse.screenshot({ ownerId: 'agent-a' })
    await ctx.browserUse.screenshot({ ownerId: ' agent-a ' })

    expect(mock.browser.newContext).toHaveBeenCalledTimes(2)
  })

  it('applies a visual headless setting change to a fresh browser instance', async () => {
    const { ctx } = await bench()
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })

    ctx.browserUse.configureHeadless(false)
    await Promise.resolve()
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })

    expect(mock.closeContext).toHaveBeenCalledOnce()
    expect(mock.closeBrowser).toHaveBeenCalledOnce()
    expect(mock.closeProxy).toHaveBeenCalledOnce()
    expect(mock.launch.mock.calls).toEqual([
      [{ headless: true, args: EXPECTED_CHROMIUM_ARGS, proxy: mock.playwrightProxy }],
      [{ headless: false, args: EXPECTED_CHROMIUM_ARGS, proxy: mock.playwrightProxy }],
    ])
  })

  it('single-flights a concurrent first browser launch across different owners', async () => {
    let releaseLaunch: (() => void) | undefined
    mock.launch.mockImplementationOnce(() => new Promise<typeof mock.browser>((resolve) => {
      releaseLaunch = () => { resolve(mock.browser) }
    }))
    const { ctx } = await bench()

    const first = ctx.browserUse.navigate({ ownerId: 'agent-a', url: 'about:blank' })
    const second = ctx.browserUse.navigate({ ownerId: 'agent-b', url: 'about:blank' })
    await vi.waitFor(() => { expect(mock.launch).toHaveBeenCalledOnce() })
    releaseLaunch?.()
    await Promise.all([first, second])

    expect(mock.launch).toHaveBeenCalledOnce()
    expect(mock.browser.newContext).toHaveBeenCalledTimes(2)
    expect(mock.context.newPage).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent page creation for the same owner', async () => {
    let releasePage: (() => void) | undefined
    mock.context.newPage.mockImplementationOnce(() => new Promise<typeof mock.page>((resolve) => {
      releasePage = () => { resolve(mock.page) }
    }))
    const { ctx } = await bench()

    const first = ctx.browserUse.screenshot({ ownerId: OWNER_ID })
    const second = ctx.browserUse.pageState({ ownerId: OWNER_ID })
    await vi.waitFor(() => { expect(mock.context.newPage).toHaveBeenCalledOnce() })
    releasePage?.()
    await Promise.all([first, second])

    expect(mock.browser.newContext).toHaveBeenCalledOnce()
    expect(mock.context.newPage).toHaveBeenCalledOnce()
  })

  it('retires the loaded page immediately when visual network policy is tightened', async () => {
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' })

    ctx.browserUse.configure({
      headless: true,
      allowedDomains: [],
      deniedDomains: ['example.test'],
      allowPrivateNetwork: false,
    })
    await Promise.resolve()

    expect(mock.closeContext).toHaveBeenCalledOnce()
    expect(mock.closeBrowser).toHaveBeenCalledOnce()
    expect(mock.closeProxy).toHaveBeenCalledOnce()
    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' }))
      .rejects.toMatchObject({ code: 'BROWSER_USE_URL_BLOCKED' })
    expect(mock.context.newPage).toHaveBeenCalledOnce()
  })

  it('reports browser launch failures with the stable launch error code', async () => {
    mock.launch.mockRejectedValueOnce(new Error('browser missing'))
    const { ctx } = await bench()

    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })).rejects.toMatchObject({
      name: 'BrowserUseError',
      code: 'BROWSER_USE_LAUNCH_FAILED',
    } satisfies Partial<BrowserUseError>)
    expect(mock.closeProxy).toHaveBeenCalledOnce()
  })

  it('fails closed before Chromium launch when the pinned proxy cannot start', async () => {
    mock.startPinnedBrowserProxy.mockRejectedValueOnce(new Error('loopback unavailable'))
    const { ctx } = await bench()

    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })).rejects.toMatchObject({
      name: 'BrowserUseError',
      code: 'BROWSER_USE_LAUNCH_FAILED',
    } satisfies Partial<BrowserUseError>)
    expect(mock.launch).not.toHaveBeenCalled()
  })

  it('reports Playwright action failures with the stable action error code', async () => {
    mock.goto.mockRejectedValueOnce(new Error('navigation failed'))
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })

    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' })).rejects.toMatchObject({
      name: 'BrowserUseError',
      code: 'BROWSER_USE_ACTION_FAILED',
    } satisfies Partial<BrowserUseError>)
  })

  it('does not start an action after its signal has already aborted', async () => {
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' }, controller.signal))
      .rejects.toThrow('cancelled')
    expect(mock.goto).not.toHaveBeenCalled()
  })

  it('returns promptly when cancellation occurs during DNS preflight', async () => {
    let releaseLookup: (() => void) | undefined
    mock.lookup.mockImplementationOnce(() => new Promise((resolve) => {
      releaseLookup = () => { resolve([{ address: '93.184.216.34', family: 4 }]) }
    }))
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })
    const controller = new AbortController()

    const pending = ctx.browserUse.navigate(
      { ownerId: OWNER_ID, url: 'https://example.test/' },
      controller.signal,
    )
    await vi.waitFor(() => { expect(mock.lookup).toHaveBeenCalledOnce() })
    controller.abort(new Error('cancelled during DNS'))

    await expect(pending).rejects.toThrow('cancelled during DNS')
    expect(mock.launch).not.toHaveBeenCalled()
    expect(mock.goto).not.toHaveBeenCalled()
    releaseLookup?.()
  })

  it('does not create a context when cancellation occurs during a shared browser launch', async () => {
    let releaseLaunch: (() => void) | undefined
    mock.launch.mockImplementationOnce(() => new Promise<typeof mock.browser>((resolve) => {
      releaseLaunch = () => { resolve(mock.browser) }
    }))
    const { ctx } = await bench()
    const controller = new AbortController()

    const pending = ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' }, controller.signal)
    await vi.waitFor(() => { expect(mock.launch).toHaveBeenCalledOnce() })
    controller.abort(new Error('cancelled during launch'))
    await expect(pending).rejects.toThrow('cancelled during launch')
    releaseLaunch?.()
    await ctx.browserUse.navigate({ ownerId: 'agent-after-abort', url: 'about:blank' })
    expect(mock.launch).toHaveBeenCalledOnce()
    expect(mock.browser.newContext).toHaveBeenCalledOnce()
  })

  it('closes a context that resolves after its owner was cancelled during creation', async () => {
    let releaseContext: (() => void) | undefined
    mock.browser.newContext.mockImplementationOnce(() => new Promise<typeof mock.context>((resolve) => {
      releaseContext = () => { resolve(mock.context) }
    }))
    const { ctx } = await bench()
    const controller = new AbortController()

    const pending = ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' }, controller.signal)
    await vi.waitFor(() => { expect(mock.browser.newContext).toHaveBeenCalledOnce() })
    controller.abort(new Error('cancelled during context creation'))
    await expect(pending).rejects.toThrow('cancelled during context creation')
    releaseContext?.()

    await vi.waitFor(() => { expect(mock.closeContext).toHaveBeenCalled() })
    expect(mock.context.newPage).not.toHaveBeenCalled()
    expect(mock.goto).not.toHaveBeenCalled()
  })

  it('closes the pending context and skips dispatch when cancelled during page creation', async () => {
    let releasePage: (() => void) | undefined
    mock.context.newPage.mockImplementationOnce(() => new Promise<typeof mock.page>((resolve) => {
      releasePage = () => { resolve(mock.page) }
    }))
    const { ctx } = await bench()
    const controller = new AbortController()

    const pending = ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' }, controller.signal)
    await vi.waitFor(() => { expect(mock.context.newPage).toHaveBeenCalledOnce() })
    controller.abort(new Error('cancelled during page creation'))
    await expect(pending).rejects.toThrow('cancelled during page creation')
    expect(mock.closeContext).toHaveBeenCalled()
    releasePage?.()

    await Promise.resolve()
    expect(mock.goto).not.toHaveBeenCalled()
  })

  it('does not dispatch in the microtask after an already-created page is cancelled', async () => {
    const { ctx } = await bench()
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })
    mock.click.mockClear()
    const controller = new AbortController()

    const pending = ctx.browserUse.clickSelector(
      { ownerId: OWNER_ID, selector: '#submit' },
      controller.signal,
    )
    queueMicrotask(() => { controller.abort(new Error('cancelled before dispatch microtask')) })

    await expect(pending).rejects.toThrow('cancelled before dispatch microtask')
    expect(mock.click).not.toHaveBeenCalled()
    expect(mock.closeContext).toHaveBeenCalled()
  })

  it('closes a launch that resolves under a retired visual configuration generation', async () => {
    let releaseLaunch: (() => void) | undefined
    mock.launch.mockImplementationOnce(() => new Promise<typeof mock.browser>((resolve) => {
      releaseLaunch = () => { resolve(mock.browser) }
    }))
    const { ctx } = await bench()

    const pending = ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })
    await vi.waitFor(() => { expect(mock.launch).toHaveBeenCalledOnce() })
    ctx.browserUse.configure({
      headless: false,
      allowedDomains: [],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })
    releaseLaunch?.()

    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_USE_ACTION_FAILED' })
    expect(mock.closeBrowser).toHaveBeenCalled()
    expect(mock.closeProxy).toHaveBeenCalled()
    expect(mock.browser.newContext).not.toHaveBeenCalled()
  })

  it('closes a pending page context when browser policy changes during setup', async () => {
    let releasePage: (() => void) | undefined
    mock.context.newPage.mockImplementationOnce(() => new Promise<typeof mock.page>((resolve) => {
      releasePage = () => { resolve(mock.page) }
    }))
    const { ctx } = await bench()

    const pending = ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })
    await vi.waitFor(() => { expect(mock.context.newPage).toHaveBeenCalledOnce() })
    ctx.browserUse.configure({
      headless: false,
      allowedDomains: [],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })
    releasePage?.()

    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_USE_ACTION_FAILED' })
    expect(mock.closeContext).toHaveBeenCalled()
    expect(mock.closeBrowser).toHaveBeenCalled()
    expect(mock.goto).not.toHaveBeenCalled()
  })

  it('closes only the owner context when an in-flight Playwright action is aborted', async () => {
    let releaseNavigation: (() => void) | undefined
    mock.goto.mockImplementationOnce(() => new Promise<null>((resolve) => {
      releaseNavigation = () => { resolve(null) }
    }))
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })
    const controller = new AbortController()

    const pending = ctx.browserUse.navigate(
      { ownerId: OWNER_ID, url: 'https://example.test/' },
      controller.signal,
    )
    await vi.waitFor(() => { expect(mock.goto).toHaveBeenCalledOnce() })
    controller.abort(new Error('emergency stop'))

    await expect(pending).rejects.toThrow('emergency stop')
    expect(mock.closeContext).toHaveBeenCalledOnce()

    // A later action receives a fresh isolated context rather than reusing the
    // page on which cancellation raced the original side effect.
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })
    expect(mock.browser.newContext).toHaveBeenCalledTimes(2)
    releaseNavigation?.()
  })

  it('fails closed without grants and blocks dangerous schemes, private targets, and non-granted domains', () => {
    const publicOnly = { allowedDomains: [], deniedDomains: [], allowPrivateNetwork: false }
    expect(() => assertBrowserUrlPolicy('file:///etc/passwd', publicOnly)).toThrow(/scheme/)
    expect(() => assertBrowserUrlPolicy('https://example.com/', publicOnly)).toThrow(/disabled/)
    expect(() => assertBrowserUrlPolicy('http://127.0.0.1/', {
      ...publicOnly,
      allowedDomains: ['127.0.0.1'],
    })).toThrow(/private/)
    expect(() => assertBrowserUrlPolicy('http://[::1]/', {
      ...publicOnly,
      allowedDomains: ['::1'],
    })).toThrow(/private/)
    expect(() => assertBrowserUrlPolicy('http://[::ffff:127.0.0.1]/', {
      ...publicOnly,
      allowedDomains: ['::ffff:7f00:1'],
    })).toThrow(/private/)
    expect(() => assertBrowserUrlPolicy('http://[::ffff:7f00:1]/', {
      ...publicOnly,
      allowedDomains: ['::ffff:7f00:1'],
    })).toThrow(/private/)
    expect(() => assertBrowserUrlPolicy('http://[::ffff:8.8.8.8]/', {
      ...publicOnly,
      allowedDomains: ['::ffff:808:808'],
    })).not.toThrow()
    expect(() => assertBrowserUrlPolicy('https://internal.example/', {
      ...publicOnly,
      allowedDomains: ['example.com'],
    })).toThrow(/not granted/)
    expect(() => assertBrowserUrlPolicy('https://safe.example.com/', {
      ...publicOnly,
      allowedDomains: ['example.com'],
    })).not.toThrow()
    expect(() => assertBrowserUrlPolicy('https://blocked.example.com/', {
      ...publicOnly,
      allowedDomains: ['example.com'],
      deniedDomains: ['blocked.example.com'],
    })).toThrow(/denied/)
  })

  it('blocks private subresources, not only top-level document navigation', async () => {
    const { ctx } = await bench()
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })
    const routeCalls = mock.route.mock.calls as unknown as Array<[string, (route: {
      request(): { url(): string; isNavigationRequest(): boolean; resourceType(): string }
      continue(): Promise<void>
      abort(reason: string): Promise<void>
    }) => Promise<void>]>
    const guard = routeCalls[0]?.[1]
    expect(guard).toBeDefined()
    const proceed = vi.fn(() => Promise.resolve())
    const abort = vi.fn(() => Promise.resolve())
    await guard?.({
      request: () => ({
        url: () => 'http://[::ffff:7f00:1]/secret.png',
        isNavigationRequest: () => false,
        resourceType: () => 'image',
      }),
      continue: proceed,
      abort,
    })
    expect(proceed).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalledWith('blockedbyclient')
  })

  it('fails closed when an allowed hostname cannot be resolved safely', async () => {
    mock.lookup.mockRejectedValueOnce(new Error('resolver unavailable'))
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })

    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' }))
      .rejects.toMatchObject({ code: 'BROWSER_USE_URL_BLOCKED' })
    expect(mock.goto).not.toHaveBeenCalled()
  })

  it('blocks an allowed hostname when DNS resolves it to a private address', async () => {
    mock.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['example.test'],
      deniedDomains: [],
      allowPrivateNetwork: false,
    })

    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'https://example.test/' }))
      .rejects.toMatchObject({ code: 'BROWSER_USE_URL_BLOCKED' })
    expect(mock.goto).not.toHaveBeenCalled()
  })

  it('blocks private WebSocket connections before opening the server connection', async () => {
    const { ctx } = await bench()
    await ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'about:blank' })
    const socketRouteCalls = mock.routeWebSocket.mock.calls as unknown as Array<[string, (socket: {
      url(): string
      connectToServer(): void
      close(options: { code: number; reason: string }): Promise<void>
    }) => Promise<void>]>
    const guard = socketRouteCalls[0]?.[1]
    expect(guard).toBeDefined()
    const connectToServer = vi.fn()
    const close = vi.fn(() => Promise.resolve())
    await guard?.({
      url: () => 'ws://127.0.0.1/private',
      connectToServer,
      close,
    })
    expect(connectToServer).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledWith({ code: 1008, reason: 'Destination blocked by browser policy' })
  })

  it('allows an explicitly configured private fixture destination', async () => {
    const { ctx } = await bench()
    ctx.browserUse.configure({
      headless: true,
      allowedDomains: ['127.0.0.1'],
      deniedDomains: [],
      allowPrivateNetwork: true,
    })
    await expect(ctx.browserUse.navigate({ ownerId: OWNER_ID, url: 'http://127.0.0.1:4173/' })).resolves.toBeUndefined()
  })

  it('binds coordinate actions to the most recent screenshot and invalidates it after one action', async () => {
    const { ctx } = await bench()
    const observation = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })

    await ctx.browserUse.clickAt({ ownerId: OWNER_ID, x: 12, y: 34, observationId: observation.observationId })
    await expect(ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 12,
      y: 34,
      observationId: observation.observationId,
    }))
      .rejects.toMatchObject({ code: 'BROWSER_USE_STALE_OBSERVATION' })
  })

  it('rejects every screenshot-derived action when the same URL swaps viewport content', async () => {
    const { ctx } = await bench()

    const expectSwapRejected = async (
      action: (observationId: string) => Promise<void>,
      assertNoDispatch: () => void,
    ): Promise<void> => {
      mock.screenshot.mockReset()
      mock.screenshot
        .mockResolvedValueOnce(Buffer.from('observed viewport'))
        .mockResolvedValueOnce(Buffer.from('swapped viewport'))
      const observation = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })

      await expect(action(observation.observationId)).rejects.toMatchObject({
        code: 'BROWSER_USE_STALE_OBSERVATION',
      })
      assertNoDispatch()
    }

    await expectSwapRejected(
      observationId => ctx.browserUse.clickAt({ ownerId: OWNER_ID, x: 12, y: 34, observationId }),
      () => { expect(mock.click).not.toHaveBeenCalled() },
    )
    await expectSwapRejected(
      observationId => ctx.browserUse.clickAt({
        ownerId: OWNER_ID,
        x: 12,
        y: 34,
        doubleClick: true,
        observationId,
      }),
      () => { expect(mock.dblclick).not.toHaveBeenCalled() },
    )
    await expectSwapRejected(
      observationId => ctx.browserUse.moveAt({ ownerId: OWNER_ID, x: 12, y: 34, observationId }),
      () => { expect(mock.move).not.toHaveBeenCalled() },
    )
    await expectSwapRejected(
      observationId => ctx.browserUse.dragAt({
        ownerId: OWNER_ID,
        x: 12,
        y: 34,
        toX: 56,
        toY: 78,
        observationId,
      }),
      () => {
        expect(mock.move).not.toHaveBeenCalled()
        expect(mock.down).not.toHaveBeenCalled()
        expect(mock.up).not.toHaveBeenCalled()
      },
    )
    await expectSwapRejected(
      observationId => ctx.browserUse.scroll({ ownerId: OWNER_ID, direction: 'down', observationId }),
      () => { expect(mock.wheel).not.toHaveBeenCalled() },
    )
    await expectSwapRejected(
      observationId => ctx.browserUse.type({ ownerId: OWNER_ID, text: 'secret', observationId }),
      () => { expect(mock.type).not.toHaveBeenCalled() },
    )
    await expectSwapRejected(
      observationId => ctx.browserUse.key({ ownerId: OWNER_ID, key: 'Enter', observationId }),
      () => { expect(mock.key).not.toHaveBeenCalled() },
    )
  })

  it('reserves an observation before awaiting dispatch so concurrent replay cannot double-click', async () => {
    let releaseClick: (() => void) | undefined
    mock.click.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseClick = resolve }))
    const { ctx } = await bench()
    const observation = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })

    const first = ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 12,
      y: 34,
      observationId: observation.observationId,
    })
    await vi.waitFor(() => { expect(mock.click).toHaveBeenCalledOnce() })
    await expect(ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 12,
      y: 34,
      observationId: observation.observationId,
    })).rejects.toMatchObject({ code: 'BROWSER_USE_STALE_OBSERVATION' })
    releaseClick?.()
    await first
    expect(mock.click).toHaveBeenCalledOnce()
  })

  it('isolates pages and observations by trusted agent owner', async () => {
    const { ctx } = await bench()
    const observation = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })

    await expect(ctx.browserUse.clickAt({
      ownerId: 'agent-2',
      x: 12,
      y: 34,
      observationId: observation.observationId,
    })).rejects.toMatchObject({ code: 'BROWSER_USE_STALE_OBSERVATION' })
    expect(mock.browser.newContext).toHaveBeenCalledTimes(2)
    expect(mock.click).not.toHaveBeenCalled()
  })

  it('expires an unused browser observation after sixty seconds', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { ctx } = await bench()
    const observation = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })
    clock.mockReturnValue(61_001)

    await expect(ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 12,
      y: 34,
      observationId: observation.observationId,
    })).rejects.toMatchObject({ code: 'BROWSER_USE_STALE_OBSERVATION' })
    clock.mockRestore()
    expect(mock.click).not.toHaveBeenCalled()
  })

  it('rejects coordinate actions that are not bound to a screenshot observation', async () => {
    const { ctx } = await bench()
    await expect(ctx.browserUse.clickAt({ ownerId: OWNER_ID, x: 12, y: 34 } as never))
      .rejects.toMatchObject({ code: 'BROWSER_USE_STALE_OBSERVATION' })
    expect(mock.click).not.toHaveBeenCalled()
  })

  it('returns bounded semantic state for a completion oracle', async () => {
    mock.evaluate.mockResolvedValueOnce({ url: 'about:blank', title: 'Fixture', text: 'abc' })
    const { ctx } = await bench()
    await expect(ctx.browserUse.pageState({ ownerId: OWNER_ID, selector: 'main', maxTextChars: 3 })).resolves.toEqual({
      url: 'about:blank',
      title: 'Fixture',
      text: 'abc',
    })
    expect(mock.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      text: 3,
      title: 4_096,
      url: 8_192,
    })
  })

  it('reads URL, title, and selector text from one atomic page evaluation', async () => {
    mock.evaluate.mockResolvedValueOnce({
      url: 'https://b.example/ready',
      title: 'B',
      text: 'Ready on B',
    })
    mock.page.url.mockReturnValue('https://c.example/raced')
    mock.title.mockResolvedValue('A')
    mock.innerText.mockResolvedValue('Ready on A')
    const { ctx } = await bench()

    await expect(ctx.browserUse.pageState({ ownerId: OWNER_ID, selector: 'main' })).resolves.toEqual({
      url: 'https://b.example/ready',
      title: 'B',
      text: 'Ready on B',
    })
    expect(mock.evaluate).toHaveBeenCalledOnce()
    expect(mock.title).not.toHaveBeenCalled()
    expect(mock.innerText).not.toHaveBeenCalled()
    expect(mock.page.url).not.toHaveBeenCalled()
    mock.page.url.mockReturnValue('about:blank')
    mock.title.mockResolvedValue('Fixture')
    mock.innerText.mockResolvedValue('page text')
  })

  it('bounds direct extracted page text before it reaches a model result', async () => {
    mock.evaluate.mockImplementationOnce((callback?: unknown, textLimit?: unknown) => {
      const runInPage = callback as (element: { innerText: string }, limit: number) => string
      return Promise.resolve(runInPage({ innerText: 'abcdef' }, textLimit as number))
    })
    const { ctx } = await bench()
    await expect(ctx.browserUse.extractText({
      ownerId: OWNER_ID,
      selector: 'main',
      maxTextChars: 3,
    })).resolves.toBe('abc')
    expect(mock.evaluate).toHaveBeenCalledWith(expect.any(Function), 3)
    expect(mock.innerText).not.toHaveBeenCalled()
  })

  it('bounds URL, title, and body inside the page world before serialization', async () => {
    const longUrl = `https://example.test/${'u'.repeat(10_000)}`
    const longTitle = 'h'.repeat(5_000)
    const longText = 't'.repeat(100_001)
    mock.evaluate.mockImplementationOnce((callback?: unknown, limits?: unknown) => {
      const runInPage = callback as (
        element: {
          innerText: string
          ownerDocument: {
            defaultView: { location: { href: string } }
            title: string
          }
        },
        bounds: { text: number; title: number; url: number },
      ) => { url: string; title: string; text: string }
      return Promise.resolve(runInPage({
        innerText: longText,
        ownerDocument: {
          defaultView: { location: { href: longUrl } },
          title: longTitle,
        },
      }, limits as { text: number; title: number; url: number }))
    })
    const { ctx } = await bench()

    const result = await ctx.browserUse.pageState({ ownerId: OWNER_ID, maxTextChars: 100_000 })

    expect(result.url).toBe(longUrl.slice(0, 8_192))
    expect(result.title).toBe(longTitle.slice(0, 4_096))
    expect(result.text).toBe(longText.slice(0, 100_000))
  })

  it('bounds the screenshot URL evidence without weakening the internal URL binding', async () => {
    const longUrl = `https://example.test/${'u'.repeat(10_000)}`
    mock.page.url.mockReturnValue(longUrl)
    const { ctx } = await bench()

    const observation = await ctx.browserUse.screenshot({ ownerId: OWNER_ID })

    expect(observation.url).toBe(longUrl.slice(0, 8_192))
    await expect(ctx.browserUse.clickAt({
      ownerId: OWNER_ID,
      x: 12,
      y: 34,
      observationId: observation.observationId,
    })).resolves.toBeUndefined()
  })
})
