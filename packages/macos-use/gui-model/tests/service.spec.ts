import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import GuiModelService, { Config, GUI_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-gui-model'

const REQUEST = {
  screenshotPngBase64: Buffer.from('png').toString('base64'),
  task: 'Click the button',
}

class MemorySettings extends SettingsProvider {
  readonly doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function boot(config: ConstructorParameters<typeof GuiModelService>[1] = {}, apiKey?: string) {
  const ctx = new Context()
  if (apiKey !== undefined) {
    ctx.provide('credentials', {
      resolve: vi.fn(() => Promise.resolve({ value: apiKey, source: 'memory' })),
    } as never)
  }
  const fiber = ctx.plugin(GuiModelService, config)
  await fiber
  return { ctx, fiber }
}

describe('GUI model visual configuration gate', () => {
  it('accepts an empty composition so a fresh install can render Plugin Configuration', () => {
    expect(Config({})).toMatchObject({
      apiKeyEnv: 'GUI_MODEL_API_KEY',
      baseURL: '',
      model: '',
      maxOutputTokens: 512,
    })
  })

  it('boots with no endpoint or model and fails closed before resolving credentials or fetching', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { ctx, fiber } = await boot()

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.toMatchObject({
      code: 'GUI_MODEL_NOT_CONFIGURED',
    })
    expect(fetch).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('rejects an invalid visual settings save before persistence and preserves the last good value', async () => {
    const ctx = new Context()
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber
    const guiFiber = ctx.plugin(GuiModelService, {})
    await guiFiber
    const before = ctx.settings.get(GUI_MODEL_SETTINGS_NAMESPACE)

    await expect(ctx.settings.update(GUI_MODEL_SETTINGS_NAMESPACE, {
      baseURL: 'file:///tmp/provider',
      model: 'vision-model',
    })).rejects.toThrow(/HTTP\(S\)/)
    expect(ctx.settings.get(GUI_MODEL_SETTINGS_NAMESPACE)).toEqual(before)
    expect((ctx.settings as MemorySettings).doc[GUI_MODEL_SETTINGS_NAMESPACE]).toBeUndefined()

    await guiFiber.dispose()
    await settingsFiber.dispose()
  })

  it.each([
    'file:///tmp/provider',
    'https://user:password@example.test/v1',
    'https://example.test/v1?route=other',
    'http://[::ffff:7f0:1]/v1',
    'http://[::ffff:7eff:ffff]/v1',
    'not a url',
  ])('rejects unsafe or invalid endpoint %j before fetching', async (baseURL) => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { ctx, fiber } = await boot({ baseURL, model: 'vision-model' })

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.toMatchObject({
      code: 'GUI_MODEL_NOT_CONFIGURED',
    })
    expect(fetch).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('refuses to send screenshots over non-loopback HTTP even without a credential', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { ctx, fiber } = await boot({
      baseURL: 'http://provider.example/v1',
      model: 'vision-model',
    })

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.toMatchObject({
      code: 'GUI_MODEL_NOT_CONFIGURED',
    })
    expect(fetch).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it.each([
    'http://127.0.0.1:9000/v1',
    'http://[::ffff:127.0.0.1]:9000/v1',
    'http://[::ffff:127.255.255.255]:9000/v1',
  ])('allows exact loopback HTTP for a local vision provider at %s', async (baseURL) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"kind":"done","summary":"Complete."}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { ctx, fiber } = await boot({
      baseURL,
      model: 'vision-model',
    })

    await expect(ctx.guiModel.nextAction(REQUEST)).resolves.toMatchObject({ kind: 'done' })
    expect(fetch).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('rejects an invalid visual credential reference before network access', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { ctx, fiber } = await boot({
      apiKeyEnv: 'not a credential ref',
      baseURL: 'https://provider.example/v1',
      model: 'vision-model',
    })

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.toMatchObject({
      code: 'GUI_MODEL_NOT_CONFIGURED',
    })
    expect(fetch).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('uses a visually supplied endpoint and model on the next action', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"kind":"done","summary":"Complete."}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { ctx, fiber } = await boot({
      baseURL: 'https://provider.example/v1/',
      model: 'vision-model',
    }, 'secret')

    await expect(ctx.guiModel.nextAction(REQUEST)).resolves.toMatchObject({ kind: 'done' })
    expect(fetch).toHaveBeenCalledOnce()
    const [input, init] = fetch.mock.calls[0] ?? []
    expect(input).toBe('https://provider.example/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
    await fiber.dispose()
  })

  it('rejects an oversized provider response before buffering it all', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', {
      status: 200,
      headers: { 'content-length': '1048577' },
    }))
    const { ctx, fiber } = await boot({
      baseURL: 'https://provider.example/v1',
      model: 'vision-model',
    })

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.toMatchObject({
      code: 'GUI_MODEL_RESPONSE_TOO_LARGE',
    })
    expect(fetch).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('rejects a streamed provider response that crosses the byte limit without a content-length header', async () => {
    const oversized = new Uint8Array(1_048_577)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversized)
        controller.close()
      },
    }), { status: 200 }))
    const { ctx, fiber } = await boot({
      baseURL: 'https://provider.example/v1',
      model: 'vision-model',
    })

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.toMatchObject({
      code: 'GUI_MODEL_RESPONSE_TOO_LARGE',
    })
    expect(fetch).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('does not copy an untrusted provider error body into the surfaced failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('provider-secret-detail', {
      status: 500,
    }))
    const { ctx, fiber } = await boot({
      baseURL: 'https://provider.example/v1',
      model: 'vision-model',
    })

    await expect(ctx.guiModel.nextAction(REQUEST)).rejects.not.toThrow(/provider-secret-detail/)
    expect(fetch).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
})
