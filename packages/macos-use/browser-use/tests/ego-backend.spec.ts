import type { LoggerService } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EgoBrowserBackend } from '../src/ego-backend.ts'

const mock = vi.hoisted(() => {
  class FakeEmitter {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    on(event: string, cb: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? []
      list.push(cb)
      this.listeners.set(event, list)
      return this
    }
    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.listeners.get(event) ?? []) cb(...args)
    }
  }
  class FakeChild extends FakeEmitter {
    readonly stdout = new FakeEmitter()
    readonly stderr = new FakeEmitter()
    readonly stdin = { written: '' as string, end(script: string): void { this.written = script } }
    killed = false
    kill(): void { this.killed = true }
  }
  const children: FakeChild[] = []
  const spawn = vi.fn((): FakeChild => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
  const mkdtemp = vi.fn(() => Promise.resolve('/tmp/ego-shot-xyz'))
  const readFile = vi.fn(() => Promise.resolve(Buffer.from('png-bytes')))
  const rm = vi.fn(() => Promise.resolve(undefined))
  return { children, FakeChild, mkdtemp, readFile, rm, spawn }
})

vi.mock('node:child_process', () => ({ spawn: mock.spawn }))
vi.mock('node:fs/promises', () => ({
  mkdtemp: mock.mkdtemp,
  readFile: mock.readFile,
  rm: mock.rm,
}))

type FakeChild = InstanceType<typeof mock.FakeChild>

const logger = { warn: vi.fn() } as unknown as LoggerService

function makeBackend(command = 'ego-browser', timeoutMs = 30_000): EgoBrowserBackend {
  return new EgoBrowserBackend(logger, command, timeoutMs)
}

function driveOk(child: FakeChild, stdout: string): void {
  child.stdout.emit('data', Buffer.from(stdout))
  child.emit('close', 0, null)
}

function driveError(child: FakeChild, error: NodeJS.ErrnoException): void {
  child.emit('error', error)
}

function driveExit(child: FakeChild, code: number, stderr: string): void {
  if (stderr.length > 0) child.stderr.emit('data', Buffer.from(stderr))
  child.emit('close', code, null)
}

let nextChildIndex = 0
async function nextChild(): Promise<FakeChild> {
  await vi.waitFor(() => { expect(mock.children.length).toBeGreaterThan(nextChildIndex) })
  const child = mock.children[mock.children.length - 1]!
  nextChildIndex = mock.children.length
  return child
}

function writtenScript(child: FakeChild): string {
  return child.stdin.written
}

function spaceNameFromScript(script: string): string {
  const match = script.match(/taskSpace\("([^"]+)"\)/)
  if (match === null || match[1] === undefined) throw new Error('no taskSpace call in script')
  return match[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.children.length = 0
  nextChildIndex = 0
  mock.mkdtemp.mockResolvedValue('/tmp/ego-shot-xyz')
  mock.readFile.mockResolvedValue(Buffer.from('png-bytes'))
  mock.rm.mockResolvedValue(undefined)
})

describe('ego-browser backend', () => {
  it('surfaces a missing CLI as a diagnosable launch error', async () => {
    const backend = makeBackend()
    const pending = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })
    const child = await nextChild()
    const err: NodeJS.ErrnoException = new Error('spawn ego-browser ENOENT')
    err.code = 'ENOENT'
    driveError(child, err)
    await expect(pending).rejects.toMatchObject({
      name: 'BrowserUseError',
      code: 'BROWSER_USE_LAUNCH_FAILED',
    })
    await expect(pending).rejects.toThrow(/ego-browser/)
    await expect(pending).rejects.toThrow(/install/i)
  })

  it('navigate sends a fixed taskSpace/goto script and parses the JSON result', async () => {
    const backend = makeBackend()
    const pending = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })
    const child = await nextChild()
    const script = writtenScript(child)
    expect(script).toContain('taskSpace(')
    expect(script).toContain('page.goto(')
    expect(script).toContain('"https://example.com/"')
    driveOk(child, '{"ok":true,"url":"https://example.com/"}')
    await expect(pending).resolves.toBeUndefined()
  })

  it('clickSelector delegates to page.click', async () => {
    const backend = makeBackend()
    const pending = backend.clickSelector({ ownerId: 'agent-1', selector: '#submit' })
    const child = await nextChild()
    const script = writtenScript(child)
    expect(script).toContain('taskSpace(')
    expect(script).toContain('page.click(')
    expect(script).toContain('"#submit"')
    driveOk(child, '{"ok":true}')
    await expect(pending).resolves.toBeUndefined()
  })

  it('fillSelector delegates to page.fill with the text value', async () => {
    const backend = makeBackend()
    const pending = backend.fillSelector({ ownerId: 'agent-1', selector: '#name', text: 'Ada Lovelace' })
    const child = await nextChild()
    const script = writtenScript(child)
    expect(script).toContain('taskSpace(')
    expect(script).toContain('page.fill(')
    expect(script).toContain('"Ada Lovelace"')
    driveOk(child, '{"ok":true}')
    await expect(pending).resolves.toBeUndefined()
  })

  it('extractText returns text and applies a host-side bound', async () => {
    const backend = makeBackend()
    const pending = backend.extractText({ ownerId: 'agent-1' })
    const child = await nextChild()
    driveOk(child, '{"ok":true,"text":"hello"}')
    await expect(pending).resolves.toBe('hello')

    const long = 'x'.repeat(50_000)
    const pending2 = backend.extractText({ ownerId: 'agent-1', maxTextChars: 1_000 })
    const child2 = await nextChild()
    driveOk(child2, JSON.stringify({ ok: true, text: long }))
    await expect(pending2).resolves.toHaveLength(1_000)
  })

  it('screenshot reads the temp PNG file, returns base64 and a UUID, and cleans up', async () => {
    const backend = makeBackend()
    const pending = backend.screenshot({ ownerId: 'agent-1' })
    const child = await nextChild()
    const script = writtenScript(child)
    expect(script).toContain('taskSpace(')
    expect(script).toContain('page.screenshot(')
    expect(script).toContain('path:')
    driveOk(child, '{"ok":true,"url":"https://example.com/shot"}')
    const result = await pending
    expect(result.pngBase64).toBe(Buffer.from('png-bytes').toString('base64'))
    expect(result.url).toBe('https://example.com/shot')
    expect(typeof result.observationId).toBe('string')
    expect(result.observationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(mock.readFile).toHaveBeenCalledWith('/tmp/ego-shot-xyz/page.png')
    expect(mock.rm).toHaveBeenCalledWith('/tmp/ego-shot-xyz', { recursive: true, force: true })
  })

  it('pageState returns url/title/text with host-side bounds', async () => {
    const backend = makeBackend()
    const longUrl = 'https://example.com/' + 'u'.repeat(20_000)
    const longTitle = 't'.repeat(10_000)
    const longText = 'w'.repeat(200_000)
    const pending = backend.pageState({ ownerId: 'agent-1', maxTextChars: 5_000 })
    const child = await nextChild()
    driveOk(child, JSON.stringify({ ok: true, url: longUrl, title: longTitle, text: longText }))
    const result = await pending
    expect(result.url.length).toBe(8_192)
    expect(result.title.length).toBe(4_096)
    expect(result.text.length).toBe(5_000)
  })

  it('releaseOwner sends a task.finish script and clears the mapping', async () => {
    const backend = makeBackend()
    // Register the owner through navigate.
    const nav = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })
    const navChild = await nextChild()
    driveOk(navChild, '{"ok":true,"url":"https://example.com/"}')
    await nav

    const releasePromise = backend.releaseOwner('agent-1')
    const releaseChild = await nextChild()
    const script = writtenScript(releaseChild)
    expect(script).toContain('taskSpace(')
    expect(script).toContain('task.finish(')
    driveOk(releaseChild, '{"ok":true}')
    await releasePromise
  })

  it('forces concurrency to 1: a second invocation waits for the first', async () => {
    const backend = makeBackend()
    const first = backend.navigate({ ownerId: 'agent-1', url: 'https://a.example/' })
    const firstChild = await nextChild()

    const second = backend.navigate({ ownerId: 'agent-1', url: 'https://b.example/' })
    // Flush microtasks; the second call should still be waiting on the mutex.
    await Promise.resolve()
    await Promise.resolve()
    expect(mock.children.length).toBe(1)

    driveOk(firstChild, '{"ok":true,"url":"https://a.example/"}')
    await expect(first).resolves.toBeUndefined()

    const secondChild = await nextChild()
    expect(writtenScript(secondChild)).toContain('https://b.example/')
    driveOk(secondChild, '{"ok":true,"url":"https://b.example/"}')
    await expect(second).resolves.toBeUndefined()
  })

  it('throws ACTION_FAILED on a non-zero exit with stderr', async () => {
    const backend = makeBackend()
    const pending = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })
    const child = await nextChild()
    driveExit(child, 1, 'something broke')
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_USE_ACTION_FAILED' })
    await expect(pending).rejects.toThrow(/something broke/)
  })

  it('throws ACTION_FAILED when stdout has no parsable JSON result', async () => {
    const backend = makeBackend()
    const pending = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })
    const child = await nextChild()
    driveOk(child, 'just some log lines\nno json here')
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_USE_ACTION_FAILED' })
  })

  it('throws ACTION_FAILED when the result reports ok:false', async () => {
    const backend = makeBackend()
    const pending = backend.clickSelector({ ownerId: 'agent-1', selector: '#submit' })
    const child = await nextChild()
    driveOk(child, '{"ok":false,"error":"element not found"}')
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_USE_ACTION_FAILED' })
    await expect(pending).rejects.toThrow(/element not found/)
  })

  it('keeps one space name per owner and separates distinct owners', async () => {
    const backend = makeBackend()
    const a1 = backend.navigate({ ownerId: 'agent-1', url: 'https://a.example/' })
    const aChild = await nextChild()
    const aSpace = spaceNameFromScript(writtenScript(aChild))
    driveOk(aChild, '{"ok":true,"url":"https://a.example/"}')
    await a1

    const a2 = backend.navigate({ ownerId: 'agent-1', url: 'https://b.example/' })
    const a2Child = await nextChild()
    expect(spaceNameFromScript(writtenScript(a2Child))).toBe(aSpace)
    driveOk(a2Child, '{"ok":true,"url":"https://b.example/"}')
    await a2

    const b = backend.navigate({ ownerId: 'agent-2', url: 'https://c.example/' })
    const bChild = await nextChild()
    const bSpace = spaceNameFromScript(writtenScript(bChild))
    expect(bSpace).not.toBe(aSpace)
    driveOk(bChild, '{"ok":true,"url":"https://c.example/"}')
    await b
  })

  it('refuses new actions after dispose and cleans up owners', async () => {
    const backend = makeBackend()
    const nav = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })
    const navChild = await nextChild()
    driveOk(navChild, '{"ok":true,"url":"https://example.com/"}')
    await nav

    const disposePromise = backend.dispose()
    const finishChild = await nextChild()
    driveOk(finishChild, '{"ok":true}')
    await disposePromise

    await expect(backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' })).rejects
      .toMatchObject({ code: 'BROWSER_USE_ACTION_FAILED' })
  })

  it('does not throw when releaseOwner has no tracked owner', async () => {
    const backend = makeBackend()
    await expect(backend.releaseOwner('nobody')).resolves.toBeUndefined()
    expect(mock.spawn).not.toHaveBeenCalled()
  })

  it('aborts an in-flight process when the signal fires', async () => {
    const backend = makeBackend()
    const controller = new AbortController()
    const pending = backend.navigate({ ownerId: 'agent-1', url: 'https://example.com/' }, controller.signal)
    const child = await nextChild()
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    expect(child.killed).toBe(true)
  })
})
