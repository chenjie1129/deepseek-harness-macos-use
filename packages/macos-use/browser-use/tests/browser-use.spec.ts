import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserUseService, { BrowserUseError } from '@deepseek-ai/dsh-browser-use'

const mock = vi.hoisted(() => {
  const click = vi.fn(() => Promise.resolve())
  const dblclick = vi.fn(() => Promise.resolve())
  const fill = vi.fn(() => Promise.resolve())
  const innerText = vi.fn(() => Promise.resolve('page text'))
  const key = vi.fn(() => Promise.resolve())
  const type = vi.fn(() => Promise.resolve())
  const goto = vi.fn(() => Promise.resolve(null))
  const screenshot = vi.fn(() => Promise.resolve(Buffer.from('png')))
  const closeContext = vi.fn(() => Promise.resolve())
  const closeBrowser = vi.fn(() => Promise.resolve())
  const first = vi.fn(() => ({ click, fill, innerText }))
  const locator = vi.fn(() => ({ first }))
  const page = {
    isClosed: vi.fn(() => false),
    goto,
    locator,
    mouse: { click, dblclick },
    keyboard: { type, press: key },
    screenshot,
    context: vi.fn(),
  }
  const context = { newPage: vi.fn(() => Promise.resolve(page)), close: closeContext }
  page.context.mockReturnValue(context)
  const browser = { newContext: vi.fn(() => Promise.resolve(context)), close: closeBrowser }
  const launch = vi.fn(() => Promise.resolve(browser))
  return {
    browser,
    click,
    closeBrowser,
    closeContext,
    context,
    dblclick,
    fill,
    first,
    goto,
    innerText,
    key,
    launch,
    locator,
    page,
    screenshot,
    type,
  }
})

vi.mock('playwright', () => ({ chromium: { launch: mock.launch } }))

beforeEach(() => {
  vi.clearAllMocks()
  mock.launch.mockResolvedValue(mock.browser)
  mock.browser.newContext.mockResolvedValue(mock.context)
  mock.context.newPage.mockResolvedValue(mock.page)
  mock.page.isClosed.mockReturnValue(false)
  mock.goto.mockResolvedValue(null)
  mock.click.mockResolvedValue()
})

async function bench(config: { headless?: boolean } = {}) {
  const ctx = new Context()
  const fiber = ctx.plugin(BrowserUseService, config)
  await fiber
  return { ctx, fiber }
}

describe('browser-use service', () => {
  it('reuses one lazy page across selector, coordinate, keyboard, and screenshot actions', async () => {
    const { ctx } = await bench()

    await ctx.browserUse.navigate({ url: 'https://example.test/' })
    await ctx.browserUse.clickSelector({ selector: '#submit' })
    await ctx.browserUse.fillSelector({ selector: '#name', text: 'Ada' })
    await expect(ctx.browserUse.extractText()).resolves.toBe('page text')
    await expect(ctx.browserUse.extractText({ selector: 'main' })).resolves.toBe('page text')
    await ctx.browserUse.clickAt({ x: 12, y: 34 })
    await ctx.browserUse.clickAt({ x: 56, y: 78, doubleClick: true })
    await ctx.browserUse.type({ text: 'hello' })
    await ctx.browserUse.key({ key: 'Enter' })
    await expect(ctx.browserUse.screenshot()).resolves.toEqual({ pngBase64: Buffer.from('png').toString('base64') })

    expect(mock.launch).toHaveBeenCalledOnce()
    expect(mock.launch).toHaveBeenCalledWith({ headless: true })
    expect(mock.browser.newContext).toHaveBeenCalledOnce()
    expect(mock.context.newPage).toHaveBeenCalledOnce()
    expect(mock.goto).toHaveBeenCalledWith('https://example.test/', { waitUntil: 'domcontentloaded' })
    expect(mock.locator.mock.calls).toEqual([['#submit'], ['#name'], ['body'], ['main']])
    expect(mock.click).toHaveBeenCalledWith(12, 34)
    expect(mock.dblclick).toHaveBeenCalledWith(56, 78)
    expect(mock.type).toHaveBeenCalledWith('hello')
    expect(mock.key).toHaveBeenCalledWith('Enter')
  })

  it('honors headed configuration and closes the page context and browser on disposal', async () => {
    const { ctx, fiber } = await bench({ headless: false })
    await ctx.browserUse.navigate({ url: 'about:blank' })

    await fiber.dispose()

    expect(mock.launch).toHaveBeenCalledWith({ headless: false })
    expect(mock.closeContext).toHaveBeenCalledOnce()
    expect(mock.closeBrowser).toHaveBeenCalledOnce()
  })

  it('reports browser launch failures with the stable launch error code', async () => {
    mock.launch.mockRejectedValueOnce(new Error('browser missing'))
    const { ctx } = await bench()

    await expect(ctx.browserUse.navigate({ url: 'about:blank' })).rejects.toMatchObject({
      name: 'BrowserUseError',
      code: 'BROWSER_USE_LAUNCH_FAILED',
    } satisfies Partial<BrowserUseError>)
  })

  it('reports Playwright action failures with the stable action error code', async () => {
    mock.goto.mockRejectedValueOnce(new Error('navigation failed'))
    const { ctx } = await bench()

    await expect(ctx.browserUse.navigate({ url: 'https://example.test/' })).rejects.toMatchObject({
      name: 'BrowserUseError',
      code: 'BROWSER_USE_ACTION_FAILED',
    } satisfies Partial<BrowserUseError>)
  })

  it('does not start an action after its signal has already aborted', async () => {
    const { ctx } = await bench()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(ctx.browserUse.navigate({ url: 'https://example.test/' }, controller.signal))
      .rejects.toThrow('cancelled')
    expect(mock.goto).not.toHaveBeenCalled()
  })
})
