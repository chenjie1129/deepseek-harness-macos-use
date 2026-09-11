/**
 * Experimental Ego Lite browser backend.
 *
 * Invokes the external `ego-browser` CLI as a child process for every action. The JS sent to
 * ego-browser is always a fixed host-generated template; only string/number parameters are
 * interpolated via `JSON.stringify`, so the model never supplies raw JavaScript. A mutex forces
 * one in-flight invocation at a time (concurrency = 1). Playwright remains the secure default;
 * this backend is opt-in and experimental.
 * @module @deepseek-ai/dsh-browser-use/ego-backend
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoggerService } from '@deepseek-ai/cordis'
import { BrowserUseError } from './types.ts'
import type {
  BrowserPageState,
  BrowserPageStateRequest,
  BrowserScreenshotRequest,
  BrowserScreenshotResult,
  ClickSelectorRequest,
  ExtractTextRequest,
  FillSelectorRequest,
  NavigateRequest,
} from './types.ts'

const EGO_DEFAULT_COMMAND = 'ego-browser'
const EGO_DEFAULT_TIMEOUT_MS = 30_000
const EGO_SPACE_PREFIX = 'dsh-'
const DEFAULT_BROWSER_TEXT_CHARS = 20_000
const MAX_BROWSER_TEXT_CHARS = 100_000
const MAX_BROWSER_TITLE_CHARS = 4_096
const MAX_BROWSER_URL_CHARS = 8_192

interface OwnerEntry {
  spaceName: string
}

interface RunScriptResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

function spaceNameForOwner(ownerId: string): string {
  return EGO_SPACE_PREFIX + Buffer.from(ownerId, 'utf8').toString('hex').slice(0, 32)
}

function boundedTextLimit(value: number | undefined): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_BROWSER_TEXT_CHARS
  return Math.max(1, Math.min(MAX_BROWSER_TEXT_CHARS, numeric))
}

function abortErrorMessage(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  const detail = typeof reason === 'string' || typeof reason === 'number'
    || typeof reason === 'boolean' || typeof reason === 'bigint'
    ? String(reason)
    : undefined
  return new Error(detail === undefined ? 'ego browser action aborted' : `ego browser action aborted: ${detail}`)
}

function finishSpaceScript(spaceName: string): string {
  return `try {
  const task = await taskSpace(${JSON.stringify(spaceName)});
  await task.finish({ keep: [] });
} catch (e) {}
console.log(JSON.stringify({ ok: true }));
`
}

/**
 * Experimental optional browser backend that drives the external `ego-browser` CLI.
 * All JS sent to the child process is a fixed host template; model input never reaches the
 * script body as code. A mutex serializes invocations to concurrency = 1.
 */
export class EgoBrowserBackend {
  private disposed = false
  private mutex: Promise<void> = Promise.resolve()
  private readonly owners = new Map<string, OwnerEntry>()

  constructor(
    private readonly logger: LoggerService,
    private readonly command: string = EGO_DEFAULT_COMMAND,
    private readonly timeoutMs: number = EGO_DEFAULT_TIMEOUT_MS,
  ) {}

  private async acquireMutex(): Promise<() => void> {
    const previous = this.mutex
    let release!: () => void
    this.mutex = new Promise<void>(resolve => { release = resolve })
    await previous
    return release
  }

  private ensureOwner(ownerId: string): string {
    const existing = this.owners.get(ownerId)
    if (existing !== undefined) return existing.spaceName
    const spaceName = spaceNameForOwner(ownerId)
    this.owners.set(ownerId, { spaceName })
    return spaceName
  }

  /**
   * Run a fixed JS script through `ego-browser` on stdin and resolve the trailing `{ ok, ... }`
   * JSON result. Serialized by the concurrency mutex.
   */
  private async runScript<T>(script: string, signal?: AbortSignal): Promise<T> {
    if (this.disposed) {
      throw new BrowserUseError('ego browser backend is disposed', 'BROWSER_USE_ACTION_FAILED')
    }
    return this.executeScript<T>(script, signal)
  }

  private async executeScript<T>(script: string, signal?: AbortSignal): Promise<T> {
    const release = await this.acquireMutex()
    if (signal?.aborted) {
      release()
      signal.throwIfAborted()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | undefined
    try {
      return await new Promise<T>((resolve, reject) => {
        const child = spawn(this.command, { stdio: ['pipe', 'pipe', 'pipe'] })
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        let settled = false
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          fn()
        }
        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        child.on('error', (error: NodeJS.ErrnoException) => {
          finish(() => {
            if (error.code === 'ENOENT') {
              reject(new BrowserUseError(
                "ego-browser CLI not found. Install ego lite from https://github.com/citrolabs/ego-lite and ensure 'ego-browser' is on PATH. The Ego backend is experimental and does not auto-download.",
                'BROWSER_USE_LAUNCH_FAILED',
              ))
            } else {
              reject(new BrowserUseError(`ego-browser failed to spawn: ${String(error)}`, 'BROWSER_USE_ACTION_FAILED'))
            }
          })
        })
        child.on('close', (code, signalCode) => {
          finish(() => {
            if (signalCode !== null) {
              reject(new BrowserUseError(
                `ego-browser was terminated by signal ${signalCode}`,
                'BROWSER_USE_ACTION_FAILED',
              ))
              return
            }
            if (code !== 0) {
              const stderr = Buffer.concat(stderrChunks).toString('utf8')
              const tail = stderr.length > 512 ? stderr.slice(-512) : stderr
              reject(new BrowserUseError(
                `ego-browser exited with code ${code}${tail.trim().length > 0 ? `: ${tail.trim()}` : ''}`,
                'BROWSER_USE_ACTION_FAILED',
              ))
              return
            }
            const stdout = Buffer.concat(stdoutChunks).toString('utf8')
            const parsed = parseResultLine(stdout)
            if (parsed === undefined) {
              reject(new BrowserUseError(
                'ego-browser produced no parsable JSON result',
                'BROWSER_USE_ACTION_FAILED',
              ))
              return
            }
            if (parsed.ok === false) {
              reject(new BrowserUseError(
                `ego-browser reported failure: ${String(parsed.error ?? 'unknown error')}`,
                'BROWSER_USE_ACTION_FAILED',
              ))
              return
            }
            resolve(parsed as unknown as T)
          })
        })
        timer = setTimeout(() => {
          finish(() => {
            child.kill()
            reject(new BrowserUseError(
              `ego-browser timed out after ${this.timeoutMs}ms`,
              'BROWSER_USE_ACTION_FAILED',
            ))
          })
        }, this.timeoutMs)
        if (signal !== undefined) {
          if (signal.aborted) {
            finish(() => {
              child.kill()
              reject(abortErrorMessage(signal))
            })
            return
          }
          abortListener = () => {
            finish(() => {
              child.kill()
              reject(abortErrorMessage(signal))
            })
          }
          signal.addEventListener('abort', abortListener, { once: true })
        }
        child.stdin?.end(script)
      })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (signal !== undefined && abortListener !== undefined) {
        signal.removeEventListener('abort', abortListener)
      }
      release()
    }
  }

  /** Navigate the owner's page to an absolute URL. URL policy is enforced by the caller. */
  async navigate(request: NavigateRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const spaceName = this.ensureOwner(request.ownerId)
    const script = `const task = await taskSpace(${JSON.stringify(spaceName)});
const page = task.page('p1');
await page.goto(${JSON.stringify(request.url)}, { waitUntil: 'domcontentloaded' });
console.log(JSON.stringify({ ok: true, url: await page.url() }));
`
    await this.runScript(script, signal)
  }

  /** Click the first element matching the selector. */
  async clickSelector(request: ClickSelectorRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const spaceName = this.ensureOwner(request.ownerId)
    const script = `const task = await taskSpace(${JSON.stringify(spaceName)});
const page = task.page('p1');
await page.click(${JSON.stringify(request.selector)});
console.log(JSON.stringify({ ok: true }));
`
    await this.runScript(script, signal)
  }

  /** Fill the first matching input, replacing its current value. */
  async fillSelector(request: FillSelectorRequest, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const spaceName = this.ensureOwner(request.ownerId)
    const script = `const task = await taskSpace(${JSON.stringify(spaceName)});
const page = task.page('p1');
await page.fill(${JSON.stringify(request.selector)}, ${JSON.stringify(request.text)});
console.log(JSON.stringify({ ok: true }));
`
    await this.runScript(script, signal)
  }

  /** Read the element's inner text (or the body when no selector is given). */
  async extractText(request: ExtractTextRequest, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const spaceName = this.ensureOwner(request.ownerId)
    const limit = boundedTextLimit(request.maxTextChars)
    const selector = JSON.stringify(request.selector ?? null)
    const script = `const task = await taskSpace(${JSON.stringify(spaceName)});
const page = task.page('p1');
const text = await page.evaluate(([selector, limit]) => {
  const el = selector ? document.querySelector(selector) : document.body;
  const value = el ? el.innerText : '';
  if (typeof value !== 'string') return '';
  return value.slice(0, limit);
}, [${selector}, ${limit}]);
console.log(JSON.stringify({ ok: true, text }));
`
    const result = await this.runScript<{ text: unknown }>(script, signal)
    return (typeof result.text === 'string' ? result.text : '').slice(0, limit)
  }

  /** Capture a viewport screenshot to a temp file, return it as base64. */
  async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshotResult> {
    signal?.throwIfAborted()
    const spaceName = this.ensureOwner(request.ownerId)
    const tempDir = await mkdtemp(join(tmpdir(), 'ego-shot-'))
    try {
      const tempPath = join(tempDir, 'page.png')
      const script = `const task = await taskSpace(${JSON.stringify(spaceName)});
const page = task.page('p1');
await page.screenshot({ path: ${JSON.stringify(tempPath)} });
console.log(JSON.stringify({ ok: true, url: await page.url() }));
`
      const result = await this.runScript<{ url: unknown }>(script, signal)
      const bytes = await readFile(tempPath)
      const url = typeof result.url === 'string' ? result.url : ''
      return {
        pngBase64: bytes.toString('base64'),
        observationId: randomUUID(),
        url: url.slice(0, MAX_BROWSER_URL_CHARS),
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Return a bounded, fresh semantic snapshot of the owner's page. */
  async pageState(request: BrowserPageStateRequest, signal?: AbortSignal): Promise<BrowserPageState> {
    signal?.throwIfAborted()
    const spaceName = this.ensureOwner(request.ownerId)
    const limit = boundedTextLimit(request.maxTextChars)
    const selector = JSON.stringify(request.selector ?? null)
    const script = `const task = await taskSpace(${JSON.stringify(spaceName)});
const page = task.page('p1');
const result = await page.evaluate(([selector, limits]) => {
  const el = selector ? document.querySelector(selector) : document.body;
  const doc = el ? el.ownerDocument : document;
  const bound = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  return {
    url: bound(doc.defaultView ? doc.defaultView.location.href : '', limits.url),
    title: bound(doc.title, limits.title),
    text: bound(el ? el.innerText : '', limits.text),
  };
}, [${selector}, { text: ${limit}, title: 4096, url: 8192 }]);
console.log(JSON.stringify({ ok: true, ...result }));
`
    const result = await this.runScript<{ url: unknown; title: unknown; text: unknown }>(script, signal)
    return {
      url: (typeof result.url === 'string' ? result.url : '').slice(0, MAX_BROWSER_URL_CHARS),
      title: (typeof result.title === 'string' ? result.title : '').slice(0, MAX_BROWSER_TITLE_CHARS),
      text: (typeof result.text === 'string' ? result.text : '').slice(0, limit),
    }
  }

  /** Best-effort cleanup for one owner. Never throws. */
  async releaseOwner(ownerId: string): Promise<void> {
    const entry = this.owners.get(ownerId)
    if (entry === undefined) return
    this.owners.delete(ownerId)
    if (this.disposed) return
    try {
      await this.executeScript(finishSpaceScript(entry.spaceName))
    } catch (error) {
      this.logger.warn(`ego-browser: releaseOwner cleanup failed for ${entry.spaceName}: ${String(error)}`)
    }
  }

  /** Shut the backend down and release every tracked owner best-effort. */
  async dispose(): Promise<void> {
    this.disposed = true
    const entries = [...this.owners.values()]
    this.owners.clear()
    for (const entry of entries) {
      try {
        await this.executeScript(finishSpaceScript(entry.spaceName))
      } catch {
        // Best-effort teardown; ignore per-space failures.
      }
    }
  }
}

function parseResultLine(stdout: string): RunScriptResult | undefined {
  const lines = stdout.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? ''
    if (line === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
        return parsed as RunScriptResult
      }
    } catch {
      // Skip non-JSON log lines; the CLI may print diagnostics before the result.
    }
  }
  return undefined
}

export default EgoBrowserBackend
