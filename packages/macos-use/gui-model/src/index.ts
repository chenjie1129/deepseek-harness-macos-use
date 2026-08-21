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
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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
  /** Literal API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each request; defaults to `GUI_MODEL_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. No default — every provider's base URL differs. */
  baseURL: string
  /** Vision-capable model name sent as the request's `model` field. */
  model: string
  /** `max_tokens` cap on the response. Defaults to 512 — one action's worth of JSON. */
  maxOutputTokens?: number
}

const GUI_MODEL_DEFAULT_MAX_OUTPUT_TOKENS = 512

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().required(),
  model: z.string().required(),
  maxOutputTokens: z.number().step(1).min(1).default(GUI_MODEL_DEFAULT_MAX_OUTPUT_TOKENS),
})

/** Settings namespace carrying this seam's endpoint, model, and key reference. */
export const GUI_MODEL_SETTINGS_NAMESPACE = settingsNamespace('gui-model')

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
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
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    apiKey: async () => {
      if (literalApiKey !== undefined) return literalApiKey
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value ?? ''
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value ?? ''
    },
    baseURL: config.baseURL,
    model: config.model,
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

  constructor(ctx: Context, config: Config) {
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
    installSettingsSection(this.ctx, GUI_MODEL_SETTINGS_NAMESPACE, Config, this.initialConfig, {
      setSource: (source) => { this.current = source },
      // resolveOptions projects fresh from `this.current()` on every call; no derived state to re-judge.
      onChange: () => {},
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
    const options = resolveOptions(this.ctx, this.current())
    const endpoint = `${options.baseURL.replace(/\/$/, '')}/chat/completions`
    const apiKey = await options.apiKey()
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
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
      const body = await response.text().catch(() => '')
      throw new GuiModelError(`GUI model request to ${endpoint} failed with status ${response.status}: ${body}`, 'GUI_MODEL_REQUEST_FAILED')
    }
    const payload = await response.json() as ChatCompletionResponse
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new GuiModelError('GUI model response carried no message content', 'GUI_MODEL_MALFORMED_RESPONSE')
    }
    return parseGuiAction(content)
  }
}

export default GuiModelService
