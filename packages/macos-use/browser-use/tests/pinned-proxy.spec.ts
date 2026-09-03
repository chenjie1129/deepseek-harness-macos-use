import { EventEmitter } from 'node:events'
import type { IncomingHttpHeaders, IncomingMessage, RequestListener, RequestOptions, Server, ServerResponse } from 'node:http'
import type { AddressInfo, ListenOptions } from 'node:net'
import { Duplex, Readable, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  PinnedProxyError,
  resolvePinnedProxyTarget,
  startPinnedBrowserProxy,
  type PinnedBrowserProxy,
  type PinnedProxyResolver,
} from '../src/pinned-proxy.ts'

class FakeProxyServer extends EventEmitter {
  readonly listenCalls: ListenOptions[] = []
  headersTimeout = 0
  requestTimeout = 0
  keepAliveTimeout = 0
  maxRequestsPerSocket = 0
  listening = false
  closeCalls = 0
  closeAllConnectionsCalls = 0

  listen(options: ListenOptions): this {
    this.listenCalls.push(options)
    this.listening = true
    queueMicrotask(() => this.emit('listening'))
    return this
  }

  address(): AddressInfo {
    return { address: '127.0.0.1', family: 'IPv4', port: 32_123 }
  }

  close(callback?: (error?: Error) => void): this {
    this.closeCalls += 1
    this.listening = false
    queueMicrotask(() => callback?.())
    return this
  }

  closeAllConnections(): void {
    this.closeAllConnectionsCalls += 1
  }
}

class FakeIncomingMessage extends Readable {
  constructor(
    readonly url: string,
    readonly method: string,
    readonly headers: IncomingHttpHeaders,
  ) {
    super()
  }

  override _read(): void {
    this.push(null)
  }
}

class FakeServerResponse extends Writable {
  statusCodeWritten: number | undefined
  headersWritten: IncomingHttpHeaders | undefined
  headersSent = false

  writeHead(statusCode: number, headers?: IncomingHttpHeaders): this {
    this.statusCodeWritten = statusCode
    this.headersWritten = headers
    this.headersSent = true
    return this
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback()
  }
}

class FakeDuplex extends Duplex {
  readonly writes: Buffer[] = []

  override _read(): void {}

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, encoding))
    callback()
  }

  writtenText(): string {
    return Buffer.concat(this.writes).toString('latin1')
  }
}

class FakeClientRequest extends Writable {
  timeoutMs: number | undefined

  constructor() {
    super({ autoDestroy: false })
  }

  setTimeout(timeoutMs: number, _callback?: () => void): this {
    this.timeoutMs = timeoutMs
    return this
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback()
  }
}

interface ProxyHarness {
  readonly server: FakeProxyServer
  readonly proxy: PinnedBrowserProxy
  readonly requestListener: RequestListener
  readonly requestHttp: ReturnType<typeof vi.fn>
  readonly requestHttps: ReturnType<typeof vi.fn>
  readonly connectTcp: ReturnType<typeof vi.fn>
  readonly connectTls: ReturnType<typeof vi.fn>
  readonly forwardedHttpOptions: () => RequestOptions | undefined
  readonly forwardedHttpsOptions: () => RequestOptions | undefined
}

async function createHarness(options: {
  validateUrl?: (rawUrl: string) => URL | Promise<URL>
  allowPrivateNetwork?: () => boolean
  resolve?: PinnedProxyResolver
  maxHeaderBytes?: number
  headersTimeoutMs?: number
  requestTimeoutMs?: number
  connectTimeoutMs?: number
  idleTimeoutMs?: number
  stallHttp?: boolean
} = {}): Promise<ProxyHarness> {
  const server = new FakeProxyServer()
  let requestListener: RequestListener | undefined
  let latestHttpOptions: RequestOptions | undefined
  let latestHttpsOptions: RequestOptions | undefined
  const requestHttp = vi.fn((requestOptions: RequestOptions, callback: (response: IncomingMessage) => void) => {
    latestHttpOptions = requestOptions
    const request = new FakeClientRequest()
    const response = new FakeIncomingMessage('', 'GET', {})
    Object.assign(response, { statusCode: 204 })
    if (options.stallHttp !== true) {
      const socket = new FakeDuplex()
      queueMicrotask(() => {
        request.emit('socket', socket)
        socket.emit('connect')
        request.emit('response', response)
        callback(response as unknown as IncomingMessage)
      })
    }
    return request
  })
  const requestHttps = vi.fn((requestOptions: RequestOptions, callback: (response: IncomingMessage) => void) => {
    latestHttpsOptions = requestOptions
    const request = new FakeClientRequest()
    const response = new FakeIncomingMessage('', 'GET', {})
    Object.assign(response, { statusCode: 204 })
    queueMicrotask(() => {
      const socket = new FakeDuplex()
      request.emit('socket', socket)
      socket.emit('secureConnect')
      request.emit('response', response)
      callback(response as unknown as IncomingMessage)
    })
    return request
  })
  const connectTcp = vi.fn((_options: { host: string; family: number; port: number }) => {
    const socket = new FakeDuplex()
    queueMicrotask(() => socket.emit('connect'))
    return socket
  })
  const connectTls = vi.fn((_options: { host: string; family: number; port: number; servername?: string }) => {
    const socket = new FakeDuplex()
    queueMicrotask(() => socket.emit('secureConnect'))
    return socket
  })
  const createServer = vi.fn((_serverOptions: unknown, listener: RequestListener) => {
    requestListener = listener
    return server as unknown as Server
  })
  const proxy = await startPinnedBrowserProxy({
    validateUrl: options.validateUrl ?? (rawUrl => new URL(rawUrl)),
    allowPrivateNetwork: options.allowPrivateNetwork ?? (() => false),
    resolve: options.resolve ?? (async () => [{ address: '93.184.216.34', family: 4 }]),
    ...(options.maxHeaderBytes === undefined ? {} : { maxHeaderBytes: options.maxHeaderBytes }),
    ...(options.headersTimeoutMs === undefined ? {} : { headersTimeoutMs: options.headersTimeoutMs }),
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
  }, {
    createServer: createServer as unknown as typeof import('node:http').createServer,
    requestHttp: requestHttp as unknown as typeof import('node:http').request,
    requestHttps: requestHttps as unknown as typeof import('node:https').request,
    connectTcp: connectTcp as unknown as typeof import('node:net').connect,
    connectTls: connectTls as unknown as typeof import('node:tls').connect,
  })
  if (requestListener === undefined) throw new Error('fake server did not capture the request listener')
  return {
    server,
    proxy,
    requestListener,
    requestHttp,
    requestHttps,
    connectTcp,
    connectTls,
    forwardedHttpOptions: () => latestHttpOptions,
    forwardedHttpsOptions: () => latestHttpsOptions,
  }
}

function proxyAuthorization(proxy: PinnedBrowserProxy): string {
  const { username, password } = proxy.playwrightProxy
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

function incoming(
  target: string,
  authorization: string | undefined,
  headers: IncomingHttpHeaders = {},
): IncomingMessage {
  return new FakeIncomingMessage(target, 'GET', {
    ...headers,
    ...(authorization === undefined ? {} : { 'proxy-authorization': authorization }),
  }) as unknown as IncomingMessage
}

describe('pinned browser proxy target resolution', () => {
  it('runs policy and DNS once, pins a public numeric answer, and preserves the approved hostname', async () => {
    const validateUrl = vi.fn((rawUrl: string) => new URL(rawUrl))
    const resolve = vi.fn(async (_hostname: string) => [{ address: '93.184.216.34', family: 4 }] as const)

    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://allowed.example:8443/path?q=1',
      kind: 'http',
      validateUrl,
      allowPrivateNetwork: false,
      resolve,
    })).resolves.toMatchObject({
      hostname: 'allowed.example',
      address: '93.184.216.34',
      family: 4,
      port: 8443,
      secure: true,
    })
    expect(validateUrl).toHaveBeenCalledOnce()
    expect(validateUrl).toHaveBeenCalledWith('https://allowed.example:8443/path?q=1')
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve.mock.calls[0]?.[0]).toBe('allowed.example')
  })

  it('rejects the entire one-shot DNS result when any answer is private', async () => {
    const resolve = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as const)

    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://mixed.example/',
      kind: 'http',
      validateUrl: rawUrl => new URL(rawUrl),
      allowPrivateNetwork: false,
      resolve,
    })).rejects.toMatchObject({
      code: 'PROXY_TARGET_BLOCKED',
      statusCode: 403,
    } satisfies Partial<PinnedProxyError>)
    expect(resolve).toHaveBeenCalledOnce()
  })

  it.each([
    ['IPv4 loopback', '127.0.0.1', 4],
    ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1', 6],
    ['IPv6 unique-local', 'fd00::1', 6],
    ['deprecated IPv6 site-local', 'fec0::1', 6],
    ['IPv6 link-local', 'fe80::1', 6],
    ['IPv4-compatible IPv6 loopback', '::7f00:1', 6],
    ['NAT64 special-use', '64:ff9b::7f00:1', 6],
    ['IETF protocol-assignment IPv6', '2001:100::1', 6],
    ['returned 6bone IPv6', '3ffe::1', 6],
    ['reserved IPv6', '4000::1', 6],
    ['segment-routing SID IPv6', '5f00::1', 6],
  ] as const)('rejects a %s resolver answer when private networking is disabled', async (_label, address, family) => {
    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://non-public.example/',
      kind: 'http',
      validateUrl: rawUrl => new URL(rawUrl),
      allowPrivateNetwork: false,
      resolve: async () => [{ address, family }],
    })).rejects.toMatchObject({
      code: 'PROXY_TARGET_BLOCKED',
      statusCode: 403,
    } satisfies Partial<PinnedProxyError>)
  })

  it('retains the explicit private-network opt-in for a pinned answer', async () => {
    await expect(resolvePinnedProxyTarget({
      rawTarget: 'http://private.example/',
      kind: 'http',
      validateUrl: rawUrl => new URL(rawUrl),
      allowPrivateNetwork: true,
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    })).resolves.toMatchObject({
      address: '127.0.0.1',
      family: 4,
      port: 80,
    })
  })

  it.each([
    ['ordinary global IPv6', '2606:4700:4700::1111'],
    ['public IPv4-mapped IPv6', '::ffff:93.184.216.34'],
  ] as const)('accepts a %s resolver answer', async (_label, address) => {
    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://public.example/',
      kind: 'http',
      validateUrl: rawUrl => new URL(rawUrl),
      allowPrivateNetwork: false,
      resolve: async () => [{ address, family: 6 }],
    })).resolves.toMatchObject({ address, family: 6 })
  })

  it('fails closed when policy rewrites the target and does not resolve it', async () => {
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }] as const)

    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://allowed.example/',
      kind: 'http',
      validateUrl: () => new URL('https://different.example/'),
      allowPrivateNetwork: false,
      resolve,
    })).rejects.toMatchObject({
      code: 'PROXY_TARGET_BLOCKED',
      statusCode: 403,
    } satisfies Partial<PinnedProxyError>)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('fails closed on a malformed resolver answer', async () => {
    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://malformed-answer.example/',
      kind: 'http',
      validateUrl: rawUrl => new URL(rawUrl),
      allowPrivateNetwork: false,
      resolve: async () => [{ address: 'not-an-ip', family: 4 }],
    })).rejects.toMatchObject({
      code: 'PROXY_RESOLUTION_FAILED',
      statusCode: 502,
    } satisfies Partial<PinnedProxyError>)
  })

  it('bounds a stalled resolver with a typed timeout', async () => {
    await expect(resolvePinnedProxyTarget({
      rawTarget: 'https://slow.example/',
      kind: 'http',
      validateUrl: rawUrl => new URL(rawUrl),
      allowPrivateNetwork: false,
      resolve: () => new Promise(() => {}),
      timeoutMs: 10,
    })).rejects.toMatchObject({
      code: 'PROXY_TIMEOUT',
      statusCode: 504,
    } satisfies Partial<PinnedProxyError>)
  })
})

describe('pinned browser proxy transport boundary', () => {
  it('binds exact loopback with bounded server resources and closes idempotently', async () => {
    const harness = await createHarness({
      maxHeaderBytes: Number.MAX_SAFE_INTEGER,
      headersTimeoutMs: Number.MAX_SAFE_INTEGER,
      requestTimeoutMs: Number.MAX_SAFE_INTEGER,
      idleTimeoutMs: Number.MAX_SAFE_INTEGER,
    })
    const accepted = new FakeDuplex()
    harness.server.emit('connection', accepted)

    expect(harness.proxy.playwrightProxy.server).toBe('http://127.0.0.1:32123')
    expect(harness.proxy.playwrightProxy.username).toMatch(/^dsh-[A-Za-z0-9_-]{16}$/)
    expect(harness.proxy.playwrightProxy.password).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(harness.server.listenCalls).toEqual([{ host: '127.0.0.1', port: 0, exclusive: true }])
    expect(harness.server).toMatchObject({
      headersTimeout: 300_000,
      requestTimeout: 300_000,
      keepAliveTimeout: 300_000,
      maxRequestsPerSocket: 100,
    })

    await Promise.all([harness.proxy.close(), harness.proxy.close()])
    expect(harness.server.closeCalls).toBe(1)
    expect(harness.server.closeAllConnectionsCalls).toBe(1)
    expect(accepted.destroyed).toBe(true)
  })

  it('requires proxy authentication before policy or DNS for HTTP', async () => {
    const validateUrl = vi.fn((rawUrl: string) => new URL(rawUrl))
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }] as const)
    const harness = await createHarness({ validateUrl, resolve })
    const response = new FakeServerResponse()

    harness.requestListener(incoming('http://allowed.example/', undefined), response as unknown as ServerResponse)
    await vi.waitFor(() => {
      expect(response.statusCodeWritten).toBe(407)
    })
    expect(validateUrl).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(harness.requestHttp).not.toHaveBeenCalled()
    await harness.proxy.close()
  })

  it.each(['connect', 'upgrade'] as const)(
    'requires proxy authentication before policy or DNS for the %s transport',
    async (event) => {
      const validateUrl = vi.fn((rawUrl: string) => new URL(rawUrl))
      const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }] as const)
      const harness = await createHarness({ validateUrl, resolve })
      const client = new FakeDuplex()

      harness.server.emit(
        event,
        incoming(event === 'connect' ? 'allowed.example:443' : 'ws://allowed.example/socket', undefined),
        client,
        Buffer.alloc(0),
      )
      await vi.waitFor(() => {
        expect(client.writtenText()).toContain('407 Proxy Authentication Required')
      })
      expect(validateUrl).not.toHaveBeenCalled()
      expect(resolve).not.toHaveBeenCalled()
      expect(harness.connectTcp).not.toHaveBeenCalled()
      expect(harness.connectTls).not.toHaveBeenCalled()
      await harness.proxy.close()
    },
  )

  it('pins authenticated HTTP to the validated IP and retains Host without proxy credentials', async () => {
    const validateUrl = vi.fn((rawUrl: string) => new URL(rawUrl))
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }] as const)
    const harness = await createHarness({ validateUrl, resolve })
    const response = new FakeServerResponse()

    harness.requestListener(incoming(
      'http://allowed.example:8080/path?q=1',
      proxyAuthorization(harness.proxy),
      { host: 'ignored.example', 'x-fixture': 'retained' },
    ), response as unknown as ServerResponse)
    await vi.waitFor(() => {
      expect(harness.requestHttp).toHaveBeenCalledOnce()
    })
    expect(validateUrl).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledOnce()
    expect(harness.forwardedHttpOptions()).toMatchObject({
      hostname: '93.184.216.34',
      family: 4,
      port: 8080,
      path: '/path?q=1',
      headers: {
        host: 'allowed.example:8080',
        'x-fixture': 'retained',
      },
    })
    expect(harness.forwardedHttpOptions()?.headers).not.toHaveProperty('proxy-authorization')
    await vi.waitFor(() => {
      expect(response.statusCodeWritten).toBe(204)
    })
    await harness.proxy.close()
  })

  it('pins direct HTTPS to the validated IP while preserving Host and TLS SNI', async () => {
    const harness = await createHarness()
    const response = new FakeServerResponse()

    harness.requestListener(incoming(
      'https://allowed.example/secure',
      proxyAuthorization(harness.proxy),
      { host: 'ignored.example' },
    ), response as unknown as ServerResponse)
    await vi.waitFor(() => {
      expect(harness.requestHttps).toHaveBeenCalledOnce()
    })
    expect(harness.forwardedHttpsOptions()).toMatchObject({
      hostname: '93.184.216.34',
      family: 4,
      port: 443,
      path: '/secure',
      servername: 'allowed.example',
      headers: { host: 'allowed.example' },
    })
    expect(harness.requestHttp).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(response.statusCodeWritten).toBe(204)
    })
    await harness.proxy.close()
  })

  it('bounds an authenticated HTTP connection that never becomes ready', async () => {
    const harness = await createHarness({ connectTimeoutMs: 10, stallHttp: true })
    const response = new FakeServerResponse()

    harness.requestListener(incoming(
      'http://allowed.example/path',
      proxyAuthorization(harness.proxy),
    ), response as unknown as ServerResponse)
    await vi.waitFor(() => {
      expect(response.statusCodeWritten).toBe(504)
    })
    await harness.proxy.close()
  })

  it('aborts an in-flight HTTP connection during lifecycle close', async () => {
    const harness = await createHarness({ connectTimeoutMs: 300_000, stallHttp: true })
    const response = new FakeServerResponse()

    harness.requestListener(incoming(
      'http://allowed.example/path',
      proxyAuthorization(harness.proxy),
    ), response as unknown as ServerResponse)
    await vi.waitFor(() => {
      expect(harness.requestHttp).toHaveBeenCalledOnce()
    })
    await harness.proxy.close()
    await vi.waitFor(() => {
      expect(response.statusCodeWritten).toBe(503)
    })
  })

  it('pins CONNECT to the validated IP and forwards the browser TLS preface unchanged', async () => {
    const validateUrl = vi.fn((rawUrl: string) => new URL(rawUrl))
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }] as const)
    const harness = await createHarness({ validateUrl, resolve })
    const client = new FakeDuplex()
    const tlsPreface = Buffer.from('fixture-client-hello-with-original-sni')

    harness.server.emit('connection', client)
    harness.server.emit(
      'connect',
      incoming('allowed.example:443', proxyAuthorization(harness.proxy)),
      client,
      tlsPreface,
    )
    await vi.waitFor(() => {
      expect(harness.connectTcp).toHaveBeenCalledOnce()
    })
    expect(validateUrl).toHaveBeenCalledWith('https://allowed.example/')
    expect(validateUrl).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledOnce()
    expect(harness.connectTcp).toHaveBeenCalledWith({
      host: '93.184.216.34',
      family: 4,
      port: 443,
    })
    const upstream = harness.connectTcp.mock.results[0]?.value as FakeDuplex
    await vi.waitFor(() => {
      expect(upstream.writes).toHaveLength(1)
    })
    expect(upstream.writes[0]).toEqual(tlsPreface)
    expect(client.writtenText()).toContain('200 Connection Established')
    await harness.proxy.close()
    expect(upstream.destroyed).toBe(true)
    await vi.waitFor(() => {
      expect(client.destroyed).toBe(true)
    })
  })

  it('pins WebSocket to the validated IP while retaining the approved Host handshake', async () => {
    const validateUrl = vi.fn((rawUrl: string) => new URL(rawUrl))
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }] as const)
    const harness = await createHarness({ validateUrl, resolve })
    const client = new FakeDuplex()

    harness.server.emit(
      'upgrade',
      incoming(
        'ws://allowed.example:8080/chat?q=1',
        proxyAuthorization(harness.proxy),
        { host: 'ignored.example', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'fixture' },
      ),
      client,
      Buffer.from('early-websocket-bytes'),
    )
    await vi.waitFor(() => {
      expect(harness.connectTcp).toHaveBeenCalledOnce()
    })
    expect(validateUrl).toHaveBeenCalledWith('http://allowed.example:8080/chat?q=1')
    expect(validateUrl).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledOnce()
    expect(harness.connectTcp).toHaveBeenCalledWith({
      host: '93.184.216.34',
      family: 4,
      port: 8080,
    })
    const upstream = harness.connectTcp.mock.results[0]?.value as FakeDuplex
    await vi.waitFor(() => {
      expect(upstream.writes.length).toBe(2)
    })
    expect(upstream.writtenText()).toContain('GET /chat?q=1 HTTP/1.1\r\n')
    expect(upstream.writtenText()).toContain('host: allowed.example:8080\r\n')
    expect(upstream.writtenText()).toContain('connection: Upgrade\r\n')
    expect(upstream.writtenText()).not.toContain('proxy-authorization')
    expect(upstream.writes[1]).toEqual(Buffer.from('early-websocket-bytes'))
    await harness.proxy.close()
  })

  it('uses the original hostname as SNI when a direct secure WebSocket is pinned', async () => {
    const harness = await createHarness()
    const client = new FakeDuplex()

    harness.server.emit(
      'upgrade',
      incoming(
        'wss://allowed.example/socket',
        proxyAuthorization(harness.proxy),
        { connection: 'Upgrade', upgrade: 'websocket' },
      ),
      client,
      Buffer.alloc(0),
    )
    await vi.waitFor(() => {
      expect(harness.connectTls).toHaveBeenCalledOnce()
    })
    expect(harness.connectTls).toHaveBeenCalledWith({
      host: '93.184.216.34',
      family: 4,
      port: 443,
      servername: 'allowed.example',
      rejectUnauthorized: true,
      ALPNProtocols: ['http/1.1'],
    })
    expect(harness.connectTcp).not.toHaveBeenCalled()
    await harness.proxy.close()
  })
})
