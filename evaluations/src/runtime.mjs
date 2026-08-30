import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const STDERR_LIMIT = 32_000

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function finalResponse(events) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const content = event?.data?.message?.content
    if (!Array.isArray(content)) continue
    return content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('')
  }
  return ''
}

function isReceipt(notification, sessionId, messageId) {
  if (notification?.method !== 'session.event' || notification?.params?.sessionId !== sessionId) return false
  const event = notification.params.event
  if (event?.type !== 'agent/inbox/spliced' || !Array.isArray(event?.data?.inserted)) return false
  return event.data.inserted.some(message => message?.id === messageId)
}

function timeoutError(label, timeoutMs, stderr) {
  const suffix = stderr.length === 0 ? '' : `\nRuntime stderr tail:\n${stderr}`
  return new Error(`${label} timed out after ${String(timeoutMs)} ms${suffix}`)
}

export class JsonRpcRuntime {
  constructor({ command, args, cwd, env, description = command }) {
    this.command = command
    this.args = args
    this.cwd = cwd
    this.env = env
    this.description = description
    this.child = undefined
    this.nextId = 1
    this.pending = new Map()
    this.notifications = []
    this.waiters = new Set()
    this.stderr = ''
    this.exit = undefined
    this.protocolError = undefined
  }

  start() {
    if (this.child !== undefined) return
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_LIMIT)
    })
    const reader = createInterface({ input: child.stdout })
    reader.on('line', line => this.receive(line))
    this.exit = new Promise(resolveExit => {
      child.once('exit', (code, signal) => {
        const detail = `${this.description} exited with code ${String(code)} signal ${String(signal)}`
        const suffix = this.stderr.length === 0 ? '' : `\nRuntime stderr tail:\n${this.stderr}`
        const error = this.protocolError ?? new Error(`${detail}${suffix}`)
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.reject(error)
        }
        this.pending.clear()
        for (const waiter of this.waiters) waiter.reject(error)
        this.waiters.clear()
        resolveExit({ code, signal })
      })
    })
  }

  receive(line) {
    if (line.trim().length === 0) return
    let frame
    try {
      frame = JSON.parse(line)
    } catch (error) {
      this.failProtocol(new Error(`invalid JSON-RPC output from ${this.description}: ${errorText(error)}`))
      return
    }
    if (frame === null || typeof frame !== 'object' || frame.jsonrpc !== '2.0') {
      this.failProtocol(new Error(`invalid JSON-RPC frame from ${this.description}`))
      return
    }
    if (frame.id !== undefined) {
      const pending = this.pending.get(String(frame.id))
      if (pending === undefined) return
      this.pending.delete(String(frame.id))
      clearTimeout(pending.timer)
      if (frame.error !== undefined) {
        pending.reject(new Error(`JSON-RPC ${pending.method} failed: ${JSON.stringify(frame.error)}`))
      } else {
        pending.resolve(frame.result)
      }
      return
    }
    if (typeof frame.method !== 'string') {
      this.failProtocol(new Error(`JSON-RPC notification from ${this.description} has no method`))
      return
    }
    this.notifications.push({ method: frame.method, params: frame.params })
    for (const waiter of [...this.waiters]) waiter.check()
  }

  failProtocol(error) {
    if (this.protocolError !== undefined) return
    this.protocolError = error
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiter of this.waiters) waiter.reject(error)
    this.waiters.clear()
    this.child?.kill('SIGTERM')
  }

  request(method, params, timeoutMs) {
    this.start()
    if (this.protocolError !== undefined) return Promise.reject(this.protocolError)
    const id = this.nextId++
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id))
        rejectRequest(timeoutError(`${this.description} ${method}`, timeoutMs, this.stderr))
      }, timeoutMs)
      this.pending.set(String(id), { method, resolve: resolveRequest, reject: rejectRequest, timer })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`, error => {
        if (error === null || error === undefined) return
        const pending = this.pending.get(String(id))
        if (pending === undefined) return
        this.pending.delete(String(id))
        clearTimeout(pending.timer)
        rejectRequest(error)
      })
    })
  }

  waitFor(predicate, timeoutMs, label) {
    const immediate = predicate(this.notifications)
    if (immediate !== undefined) return Promise.resolve(immediate)
    return new Promise((resolveWait, rejectWait) => {
      const waiter = {
        check: () => {
          const value = predicate(this.notifications)
          if (value === undefined) return
          clearTimeout(timer)
          this.waiters.delete(waiter)
          resolveWait(value)
        },
        reject: error => {
          clearTimeout(timer)
          rejectWait(error)
        },
      }
      const timer = setTimeout(() => {
        this.waiters.delete(waiter)
        rejectWait(timeoutError(label, timeoutMs, this.stderr))
      }, timeoutMs)
      this.waiters.add(waiter)
    })
  }

  async initialize({ cwd, provider, model, reasoningEffort, maxTokens }, timeoutMs = 15_000) {
    const result = await this.request('initialize', {
      cwd,
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }, timeoutMs)
    if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime' || typeof result?.serverInfo?.version !== 'string') {
      throw new Error(`invalid initialize result from ${this.description}`)
    }
    return result.serverInfo
  }

  async runPrompt(prompt, timeoutMs) {
    const startedAt = Date.now()
    const sessionId = `eval-${randomUUID().replaceAll('-', '')}`
    const startIndex = this.notifications.length
    const result = await this.request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text: prompt }],
    }, timeoutMs)
    if (typeof result?.messageId !== 'string' || result.messageId.length === 0) {
      throw new Error(`invalid session/prompt result from ${this.description}`)
    }
    const elapsed = Date.now() - startedAt
    const remaining = Math.max(1, timeoutMs - elapsed)
    const interval = await this.waitFor((notifications) => {
      const slice = notifications.slice(startIndex)
      const receiptOffset = slice.findIndex(item => isReceipt(item, sessionId, result.messageId))
      if (receiptOffset < 0) return undefined
      const idleOffset = slice.findIndex((item, index) => index >= receiptOffset
        && item?.method === 'session.status'
        && item?.params?.sessionId === sessionId
        && item?.params?.status === 'idle')
      if (idleOffset < 0) return undefined
      return slice.slice(receiptOffset, idleOffset + 1)
    }, remaining, `${this.description} prompt completion`)
    const events = interval
      .filter(item => item.method === 'session.event' && item.params?.sessionId === sessionId)
      .map(item => item.params.event)
    return {
      sessionId,
      events,
      notifications: interval,
      finalResponse: finalResponse(events),
      durationMs: Date.now() - startedAt,
    }
  }

  async close() {
    if (this.child === undefined) return
    const child = this.child
    if (child.exitCode !== null || child.signalCode !== null) {
      await this.exit
      return
    }
    try {
      await this.request('shutdown', undefined, 3_000)
    } catch {
      // Continue through the bounded process-reaping ladder.
    }
    child.stdin.end()
    const exited = await Promise.race([
      this.exit.then(() => true),
      new Promise(resolveWait => setTimeout(() => resolveWait(false), 1_000)),
    ])
    if (exited) return
    child.kill('SIGTERM')
    const terminated = await Promise.race([
      this.exit.then(() => true),
      new Promise(resolveWait => setTimeout(() => resolveWait(false), 1_000)),
    ])
    if (terminated) return
    child.kill('SIGKILL')
    await this.exit
  }
}

export function harnessRuntimeOptions({ harnessRoot, patches, dshHome, environment = process.env }) {
  const root = resolve(harnessRoot)
  const builtBin = resolve(root, 'apps/cli/lib/bin.js')
  const sourceBin = resolve(root, 'apps/cli/src/bin.ts')
  let args
  if (existsSync(builtBin)) {
    args = [builtBin]
  } else {
    const requireFromHarness = createRequire(resolve(root, 'package.json'))
    args = [
      '--import',
      requireFromHarness.resolve('tsx/esm'),
      sourceBin,
    ]
  }
  args.push('--profile', 'sdk')
  if (!existsSync(builtBin)) args.push('--patch', resolve(root, 'apps/cli/src/sdk-source.cordis.patch.yml'))
  for (const patch of patches) args.push('--patch', resolve(patch))
  return {
    command: process.execPath,
    args,
    cwd: root,
    env: { ...environment, DSH_HOME: resolve(dshHome) },
    description: `DeepSeek Harness SDK (${root})`,
  }
}
