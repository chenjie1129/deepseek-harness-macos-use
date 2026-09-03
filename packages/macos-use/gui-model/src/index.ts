/**
 * Service Definition and implementation for the GUI-grounding vision model seam (`ctx.guiModel`): calls an
 * OpenAI-compatible vision chat-completions endpoint with a screenshot and a task, and returns one structured
 * next action. This is the "GUI model key or access point" surface: `baseURL`/`model` live in the
 * `gui-model` settings section and `apiKey` is a credential reference, both editable live from a host's
 * plugin-configuration UI (mirrors `@deepseek-ai/dsh-web-search-deepseek`'s section/credential split) without a
 * plugin reload.
 * @module @deepseek-ai/dsh-gui-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace, SettingsSectionHooks } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { SYSTEM_PROMPT, buildUserPrompt, parseGuiAction } from './parse.ts'
import { GuiModelError } from './types.ts'
import type { GuiAction, NextActionRequest } from './types.ts'

export { GuiModelError } from './types.ts'
export type {
  GuiAction,
  GuiActionKind,
  GuiActionLogEntry,
  GuiModelErrorCode,
  NextActionRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    guiModel: GuiModelService
  }
}

const DEFAULT_API_KEY_ENV = 'GUI_MODEL_API_KEY'

/** Config for the GUI-grounding vision model seam. */
export interface Config {
  /** Credential reference resolved for each request; defaults to `GUI_MODEL_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. Configure visually before the first task. */
  baseURL?: string
  /** Vision-capable model name sent as the request's `model` field. */
  model?: string
  /** `max_tokens` cap on the response. Defaults to 512 — one action's worth of JSON. */
  maxOutputTokens?: number
}

const GUI_MODEL_DEFAULT_MAX_OUTPUT_TOKENS = 512
const GUI_MODEL_MAX_RESPONSE_BYTES = 1_048_576

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Empty defaults let a fresh plugin boot far enough to expose the visual
  // configuration card. nextAction remains fail-closed until both are set.
  baseURL: z.string().default(''),
  model: z.string().default(''),
  maxOutputTokens: z.number().step(1).min(1).default(GUI_MODEL_DEFAULT_MAX_OUTPUT_TOKENS),
})

/**
 * Reject persisted values that the service cannot safely act on. Empty endpoint/model remain a valid setup state.
 * @param config - candidate visual settings projection to validate before use or persistence.
 */
export function validateGuiModelConfig(config: Config): void {
  credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const baseURL = config.baseURL?.trim() ?? ''
  if (baseURL === '') return
  let endpoint: URL
  try {
    endpoint = new URL(`${baseURL.replace(/\/$/, '')}/chat/completions`)
  } catch {
    throw new TypeError('GUI model endpoint must be a valid URL')
  }
  if ((endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')
    || endpoint.username !== '' || endpoint.password !== ''
    || endpoint.search !== '' || endpoint.hash !== '') {
    throw new TypeError('GUI model endpoint must be HTTP(S) without embedded credentials, query, or fragment')
  }
  if (endpoint.protocol === 'http:' && !isLoopbackHostname(endpoint.hostname)) {
    throw new TypeError('GUI model endpoint must use HTTPS unless it is local loopback')
  }
}

/** Settings namespace carrying this seam's endpoint, model, and key reference. */
export const GUI_MODEL_SETTINGS_NAMESPACE = 'gui-model' as SettingsNamespace

type InstallSection = <T>(
  owner: Context,
  ns: SettingsNamespace,
  schema: z<T>,
  entry: T,
  hooks: SettingsSectionHooks<T>,
) => void

const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

function ownerIsUnloading(ctx: Context): boolean {
  const state: number = ctx.fiber.state
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED
}

/** Use alpha.5's provider-owned API when present, with the alpha.1 lifecycle as a bounded compatibility fallback. */
function installCompatibleSettingsSection<T>(
  ctx: Context,
  ns: SettingsNamespace,
  schema: z<T>,
  entry: T,
  hooks: SettingsSectionHooks<T>,
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const provider = settingsCtx.settings as typeof settingsCtx.settings & { installSection?: InstallSection }
    if (typeof provider.installSection === 'function') {
      provider.installSection(ctx, ns, schema, entry, hooks)
      return
    }
    const scope = provider.register(ns, schema, {
      base: entry,
      ...hooks.validate === undefined ? {} : { validate: hooks.validate },
    })
    hooks.setSource(() => scope.get())
    settingsCtx.effect(() => () => {
      if (ownerIsUnloading(ctx)) return
      hooks.setSource(() => entry)
      hooks.onChange()
    })
    hooks.onChange()
    scope.watch(() => {
      if (!ownerIsUnloading(ctx)) hooks.onChange()
    })
  })
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

function isIpv4Loopback(address: string): boolean {
  const octets = address.split('.')
  return octets.length === 4
    && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127
}

function isMappedIpv4Loopback(address: string): boolean {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address)
  if (mapped === null) return false
  const highWord = Number.parseInt(mapped[1] ?? '', 16)
  return (highWord & 0xff00) === 0x7f00
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase('en-US').replace(/^\[/, '').replace(/\]$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost')
    || normalized === '::1' || isMappedIpv4Loopback(normalized)
    || isIpv4Loopback(normalized)
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > GUI_MODEL_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw new GuiModelError(
      `GUI model response exceeded ${String(GUI_MODEL_MAX_RESPONSE_BYTES)} bytes`,
      'GUI_MODEL_RESPONSE_TOO_LARGE',
    )
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > GUI_MODEL_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new GuiModelError(
        `GUI model response exceeded ${String(GUI_MODEL_MAX_RESPONSE_BYTES)} bytes`,
        'GUI_MODEL_RESPONSE_TOO_LARGE',
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Fully-resolved request options for one `nextAction` call. */
interface GuiModelRequestOptions {
  apiKey: () => Promise<string>
  baseURL: string
  model: string
  maxOutputTokens: number
}

/**
 * Project the currently authoritative config into the options one request uses. Resolved per call (not cached)
 * so a settings-page edit takes effect on the very next `nextAction`, without a plugin reload.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one request.
 */
function resolveOptions(ctx: Context, config: Config): GuiModelRequestOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  return {
    apiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value ?? ''
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value ?? ''
    },
    baseURL: config.baseURL?.trim() ?? '',
    model: config.model?.trim() ?? '',
    maxOutputTokens: config.maxOutputTokens ?? GUI_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
  }
}

/**
 * GUI-grounding vision model service. Registered as `ctx.guiModel` (one instance per context). Sends the
 * screenshot as a `data:image/png;base64,...` `image_url` content part alongside the task and prior-step
 * history, and parses the single JSON action object the model is instructed to answer with.
 */
export class GuiModelService extends Service {
  static Config = Config

  private current: () => Config
  private readonly initialConfig: Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'guiModel')
    this.initialConfig = config
    this.current = () => config
  }

  /**
   * Install the live settings section once this service is fully registered. Registering from the raw
   * constructor (before cordis finishes associating this instance with its owning fiber) silently lands the
   * section in a registry the API gateway never reads; `Service.init` runs after that association completes,
   * which is what makes the section visible to `settings.describe` and to a plugin-configuration card.
   */
  protected [Service.init](): void {
    installCompatibleSettingsSection(this.ctx, GUI_MODEL_SETTINGS_NAMESPACE, Config, this.initialConfig, {
      setSource: (source) => { this.current = source },
      // resolveOptions projects fresh from `this.current()` on every call; no derived state to re-judge.
      onChange: () => {},
      validate: validateGuiModelConfig,
    })
  }

  /**
   * Ask the model for the single next action toward `request.task`, given the current screenshot.
   * @param request - screenshot, task, and prior-step history.
   * @param signal - aborts the request.
   * @returns the parsed, validated next action.
   * @throws {GuiModelError} `GUI_MODEL_REQUEST_FAILED` on a non-2xx response or network failure, or
   *   `GUI_MODEL_MALFORMED_RESPONSE` when the model's answer cannot be parsed into a valid action.
   */
  async nextAction(request: NextActionRequest, signal?: AbortSignal): Promise<GuiAction> {
    const config = this.current()
    try {
      validateGuiModelConfig(config)
    } catch (error) {
      throw new GuiModelError(
        `GUI model configuration is invalid: ${String(error)}`,
        'GUI_MODEL_NOT_CONFIGURED',
      )
    }
    const options = resolveOptions(this.ctx, config)
    const endpoint = `${options.baseURL.replace(/\/$/, '')}/chat/completions`
    if (options.baseURL === '' || options.model === '') {
      throw new GuiModelError(
        'GUI model is not configured; set its endpoint and model in Plugin Configuration before running a GUI task',
        'GUI_MODEL_NOT_CONFIGURED',
      )
    }
    let parsedEndpoint: URL
    try {
      parsedEndpoint = new URL(endpoint)
    } catch {
      throw new GuiModelError(
        'GUI model endpoint is invalid; update it in Plugin Configuration',
        'GUI_MODEL_NOT_CONFIGURED',
      )
    }
    if ((parsedEndpoint.protocol !== 'https:' && parsedEndpoint.protocol !== 'http:')
      || parsedEndpoint.username !== '' || parsedEndpoint.password !== ''
      || parsedEndpoint.search !== '' || parsedEndpoint.hash !== '') {
      throw new GuiModelError(
        'GUI model endpoint must be an HTTP(S) URL without embedded credentials, query, or fragment',
        'GUI_MODEL_NOT_CONFIGURED',
      )
    }
    const apiKey = await options.apiKey()
    if (parsedEndpoint.protocol === 'http:' && !isLoopbackHostname(parsedEndpoint.hostname)) {
      throw new GuiModelError(
        'GUI model screenshots require HTTPS unless the endpoint is local loopback',
        'GUI_MODEL_NOT_CONFIGURED',
      )
    }
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        // A redirect could send the screenshot and credential to a host that
        // was never approved on the Plugin Configuration page.
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {},
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: options.maxOutputTokens,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: buildUserPrompt(request.task, request.history) },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${request.screenshotPngBase64}` } },
              ],
            },
          ],
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      throw new GuiModelError(`GUI model request to ${endpoint} failed: ${String(error)}`, 'GUI_MODEL_REQUEST_FAILED')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new GuiModelError(`GUI model request to ${endpoint} failed with status ${response.status}`, 'GUI_MODEL_REQUEST_FAILED')
    }
    let responseBody: string
    try {
      responseBody = await readBoundedResponse(response)
    } catch (error) {
      if (error instanceof GuiModelError) throw error
      throw new GuiModelError(`failed to read GUI model response: ${String(error)}`, 'GUI_MODEL_REQUEST_FAILED')
    }
    let payload: ChatCompletionResponse
    try {
      payload = JSON.parse(responseBody) as ChatCompletionResponse
    } catch (error) {
      throw new GuiModelError(`GUI model response was not valid JSON: ${String(error)}`, 'GUI_MODEL_MALFORMED_RESPONSE')
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new GuiModelError('GUI model response carried no message content', 'GUI_MODEL_MALFORMED_RESPONSE')
    }
    return parseGuiAction(content)
  }
}

export default GuiModelService
