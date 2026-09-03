/**
 * Authenticated loopback proxy that pins every browser destination to one
 * policy-checked DNS answer for the lifetime of that outbound connection.
 * @module @deepseek-ai/dsh-browser-use/pinned-proxy
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as requestHttp,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from 'node:http'
import { request as requestHttps, type RequestOptions as HttpsRequestOptions } from 'node:https'
import { BlockList, connect as connectTcp, isIP, type AddressInfo, type Socket } from 'node:net'
import { type Duplex } from 'node:stream'
import { connect as connectTls, type ConnectionOptions as TlsConnectionOptions } from 'node:tls'

const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_MAX_HEADER_BYTES = 16 * 1024
const DEFAULT_HEADERS_TIMEOUT_MS = 10_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 10
const MAX_TIMEOUT_MS = 5 * 60_000
const MAX_HEADER_BYTES = 64 * 1024
const MAX_CONNECT_HEAD_BYTES = 64 * 1024
const MAX_REQUESTS_PER_SOCKET = 100
const NON_PUBLIC_ADDRESSES = new BlockList()
const GLOBAL_IPV6_UNICAST = new BlockList()
const IPV4_MAPPED_IPV6 = new BlockList()

const NON_PUBLIC_IPV4_SUBNETS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const

const NON_PUBLIC_IPV6_SUBNETS = [
  ['::', 96],
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  // Fail closed for the IETF protocol-assignment aggregate. Its handful of
  // globally reachable anycast exceptions are too narrow to justify letting
  // an unallocated or topology-local answer bypass the private-network gate.
  ['2001::', 23],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3ffe::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const

for (const [network, prefix] of NON_PUBLIC_IPV4_SUBNETS) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of NON_PUBLIC_IPV6_SUBNETS) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv6')
}
GLOBAL_IPV6_UNICAST.addSubnet('2000::', 3, 'ipv6')
IPV4_MAPPED_IPV6.addSubnet('::ffff:0:0', 96, 'ipv6')

/** Network address returned by the proxy's single destination resolution. */
export interface PinnedProxyAddress {
  /** Numeric IPv4 or IPv6 address. */
  address: string
  /** Address family matching {@link address}. */
  family: 4 | 6
}

/** Resolve one hostname exactly once for one proxy connection. */
export type PinnedProxyResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly PinnedProxyAddress[]>

/** Request form whose destination is being pinned. */
export type PinnedProxyTargetKind = 'http' | 'connect' | 'websocket'

/** Policy-approved destination and the numeric address used by the socket. */
export interface PinnedProxyTarget {
  /** Canonical HTTP(S) URL approved by the injected browser URL policy. */
  url: URL
  /** Original policy-approved hostname retained for Host and TLS SNI. */
  hostname: string
  /** Numeric address selected from the one DNS result set. */
  address: string
  /** Address family matching {@link address}. */
  family: 4 | 6
  /** Validated outbound TCP port. */
  port: number
  /** Whether a direct HTTP/WebSocket upstream requires TLS. */
  secure: boolean
}

/** Inputs for resolving and pinning one proxy destination. */
export interface ResolvePinnedProxyTargetOptions {
  /** Absolute-form target, CONNECT authority, or origin-form path. */
  rawTarget: string
  /** Protocol form supplied by the HTTP proxy server. */
  kind: PinnedProxyTargetKind
  /** Host header required when {@link rawTarget} is origin-form. */
  hostHeader?: string
  /** URL policy without DNS work; this proxy owns the destination's sole resolution. */
  validateUrl: (rawUrl: string) => URL | Promise<URL>
  /** Whether the current visual settings allow private-network answers. */
  allowPrivateNetwork: boolean
  /** One-shot resolver; defaults to `dns.lookup({ all: true })`. */
  resolve?: PinnedProxyResolver
  /** Lifecycle cancellation propagated into policy and DNS work. */
  signal?: AbortSignal
  /** Per-stage upper bound applied to policy and DNS resolution. */
  timeoutMs?: number
}

/** Playwright-compatible authenticated proxy settings. */
export interface PinnedProxyCredentials {
  /** Loopback HTTP proxy URL. */
  server: string
  /** Per-lifecycle random Basic-auth username. */
  username: string
  /** Per-lifecycle random Basic-auth password. */
  password: string
}

/** Lifecycle configuration for {@link startPinnedBrowserProxy}. */
export interface PinnedBrowserProxyOptions {
  /** Per-connection URL policy that must not resolve DNS; this proxy resolves once. */
  validateUrl: (rawUrl: string) => URL | Promise<URL>
  /** Read the current private-network setting for each new connection. */
  allowPrivateNetwork: () => boolean
  /** Optional deterministic or platform-specific one-shot DNS resolver. */
  resolve?: PinnedProxyResolver
  /** Maximum accepted request-header bytes. */
  maxHeaderBytes?: number
  /** Maximum time allowed to receive complete request headers. */
  headersTimeoutMs?: number
  /** Maximum lifetime for receiving one HTTP request. */
  requestTimeoutMs?: number
  /** Maximum time for each policy, DNS, or TCP/TLS connection-setup stage. */
  connectTimeoutMs?: number
  /** Maximum idle time for accepted and outbound sockets. */
  idleTimeoutMs?: number
}

/** Running proxy handle owned by one BrowserUseService lifecycle. */
export interface PinnedBrowserProxy {
  /** Credentials passed directly to Playwright's `proxy` launch option. */
  playwrightProxy: Readonly<PinnedProxyCredentials>
  /** Stop accepting work and destroy every accepted or outbound socket. */
  close: () => Promise<void>
}

/** Stable error vocabulary for proxy policy and transport failures. */
export type PinnedProxyErrorCode =
  | 'PROXY_AUTH_REQUIRED'
  | 'PROXY_TARGET_INVALID'
  | 'PROXY_TARGET_BLOCKED'
  | 'PROXY_RESOLUTION_FAILED'
  | 'PROXY_TIMEOUT'
  | 'PROXY_CLOSED'
  | 'PROXY_TRANSPORT_FAILED'

/** Error raised at the proxy's authenticated policy/pinning boundary. */
export class PinnedProxyError extends Error {
  /**
   * Create one typed proxy failure.
   * @param message - safe diagnostic intended for trusted Harness logs.
   * @param code - stable failure category.
   * @param statusCode - HTTP status returned to the local proxy client.
   * @param options - optional causal error.
   */
  constructor(
    message: string,
    readonly code: PinnedProxyErrorCode,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PinnedProxyError'
  }
}

interface PinnedProxyDependencies {
  createServer: typeof createServer
  requestHttp: typeof requestHttp
  requestHttps: typeof requestHttps
  connectTcp: typeof connectTcp
  connectTls: typeof connectTls
}

const DEFAULT_DEPENDENCIES: PinnedProxyDependencies = {
  createServer,
  requestHttp,
  requestHttps,
  connectTcp,
  connectTls,
}

interface ProxyLimits {
  maxHeaderBytes: number
  headersTimeoutMs: number
  requestTimeoutMs: number
  connectTimeoutMs: number
  idleTimeoutMs: number
}

interface ProxyRuntime {
  readonly options: PinnedBrowserProxyOptions
  readonly limits: ProxyLimits
  readonly dependencies: PinnedProxyDependencies
  readonly lifecycle: AbortController
  readonly requests: Set<ClientRequest>
  readonly sockets: Set<Duplex>
  readonly expectedAuthorization: string
  closed: boolean
}

/**
 * Normalize, authorize, resolve once, and pin one outbound proxy target.
 * @param options - target form, injected policy, resolver, and private-network rule.
 * @returns one numeric destination while retaining the approved Host/SNI name.
 */
export async function resolvePinnedProxyTarget(
  options: ResolvePinnedProxyTargetOptions,
): Promise<PinnedProxyTarget> {
  const signal = options.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const candidate = proxyCandidateUrl(options.rawTarget, options.kind, options.hostHeader)
  let approved: URL
  try {
    approved = await withDeadline(
      Promise.resolve(options.validateUrl(candidate.href)),
      boundedTimeout(options.timeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
      signal,
    )
  } catch (error) {
    if (error instanceof PinnedProxyError) throw error
    throw new PinnedProxyError(
      `proxy target rejected by browser URL policy: ${candidate.hostname}`,
      'PROXY_TARGET_BLOCKED',
      403,
      { cause: error },
    )
  }
  const normalized = validateApprovedUrl(approved, candidate)
  const hostname = normalizeIpLiteralHost(normalized.hostname)
  const resolver = options.resolve ?? defaultResolver
  let addresses: readonly PinnedProxyAddress[]
  try {
    // This is deliberately the only resolver invocation. All later sockets use
    // the selected numeric address, closing DNS-rebinding validation/use gaps.
    addresses = await withDeadline(
      resolver(hostname, signal),
      boundedTimeout(options.timeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
      signal,
    )
  } catch (error) {
    if (error instanceof PinnedProxyError) throw error
    throw new PinnedProxyError(
      `proxy destination could not be resolved safely: ${hostname}`,
      'PROXY_RESOLUTION_FAILED',
      502,
      { cause: error },
    )
  }
  signal.throwIfAborted()
  const checked = validateAddresses(addresses)
  if (!options.allowPrivateNetwork && checked.some(answer => isPrivateIp(answer.address))) {
    throw new PinnedProxyError(
      `proxy destination resolved to a private address: ${hostname}`,
      'PROXY_TARGET_BLOCKED',
      403,
    )
  }
  const selected = checked[0]
  if (selected === undefined) {
    throw new PinnedProxyError(
      `proxy destination returned no usable address: ${hostname}`,
      'PROXY_RESOLUTION_FAILED',
      502,
    )
  }
  const secure = normalized.protocol === 'https:'
  const port = normalized.port === '' ? secure ? 443 : 80 : Number(normalized.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new PinnedProxyError('proxy target port is invalid', 'PROXY_TARGET_INVALID', 400)
  }
  return {
    url: normalized,
    hostname,
    address: selected.address,
    family: selected.family,
    port,
    secure,
  }
}

/**
 * Start an authenticated, ephemeral IPv4-loopback proxy.
 * @param options - live URL policy, DNS resolver, and resource bounds.
 * @param dependencyOverrides - transport seams used only by focused tests.
 * @returns Playwright credentials and an idempotent lifecycle close operation.
 */
export async function startPinnedBrowserProxy(
  options: PinnedBrowserProxyOptions,
  dependencyOverrides: Partial<PinnedProxyDependencies> = {},
): Promise<PinnedBrowserProxy> {
  const username = `dsh-${randomBytes(12).toString('base64url')}`
  const password = randomBytes(24).toString('base64url')
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
  const limits = resolveLimits(options)
  const runtime: ProxyRuntime = {
    options,
    limits,
    dependencies: { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides },
    lifecycle: new AbortController(),
    requests: new Set(),
    sockets: new Set(),
    expectedAuthorization: authorization,
    closed: false,
  }
  const server = runtime.dependencies.createServer(
    { maxHeaderSize: limits.maxHeaderBytes },
    (request, response) => { void handleHttpRequest(runtime, request, response) },
  )
  configureServer(runtime, server)
  try {
    await listenLoopback(server)
  } catch (error) {
    runtime.closed = true
    runtime.lifecycle.abort(error)
    destroySockets(runtime)
    throw new PinnedProxyError(
      'failed to start authenticated browser proxy on loopback',
      'PROXY_TRANSPORT_FAILED',
      502,
      { cause: error },
    )
  }
  const address = server.address()
  if (!isAddressInfo(address) || address.address !== LOOPBACK_HOST) {
    runtime.closed = true
    runtime.lifecycle.abort()
    destroySockets(runtime)
    await closeServer(server)
    throw new PinnedProxyError('browser proxy did not bind exact loopback', 'PROXY_TRANSPORT_FAILED', 502)
  }
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing
    runtime.closed = true
    runtime.lifecycle.abort(new PinnedProxyError('browser proxy closed', 'PROXY_CLOSED', 503))
    destroySockets(runtime)
    server.closeAllConnections()
    closing = closeServer(server)
    return closing
  }
  return {
    playwrightProxy: Object.freeze({
      server: `http://${LOOPBACK_HOST}:${String(address.port)}`,
      username,
      password,
    }),
    close,
  }
}

function configureServer(runtime: ProxyRuntime, server: Server): void {
  server.headersTimeout = runtime.limits.headersTimeoutMs
  server.requestTimeout = runtime.limits.requestTimeoutMs
  server.keepAliveTimeout = Math.min(runtime.limits.idleTimeoutMs, runtime.limits.requestTimeoutMs)
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET
  server.on('connection', (socket) => {
    trackSocket(runtime, socket)
  })
  server.on('connect', (request, socket, head) => {
    void handleConnect(runtime, request, socket, head)
  })
  server.on('upgrade', (request, socket, head) => {
    void handleWebSocket(runtime, request, socket, head)
  })
  server.on('clientError', (error, socket) => {
    const status = 'code' in error && error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
    endSocketResponse(socket, status)
  })
}

async function handleHttpRequest(
  runtime: ProxyRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!authenticate(runtime, request.headers)) {
    response.writeHead(407, { 'proxy-authenticate': 'Basic realm="dsh-browser-use"', connection: 'close' })
    response.end()
    return
  }
  try {
    const target = await pinIncomingTarget(runtime, request, 'http')
    assertRuntimeOpen(runtime)
    const headers = outboundHeaders(request.headers, target.url.host, false)
    const requestOptions: RequestOptions = {
      hostname: target.address,
      family: target.family,
      port: target.port,
      method: request.method ?? 'GET',
      path: `${target.url.pathname}${target.url.search}`,
      headers,
      agent: false,
      maxHeaderSize: runtime.limits.maxHeaderBytes,
    }
    const complete = (upstreamResponse: IncomingMessage): void => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        outboundHeaders(upstreamResponse.headers, undefined, false),
      )
      upstreamResponse.once('error', () => response.destroy())
      upstreamResponse.pipe(response)
    }
    const upstream = target.secure
      ? runtime.dependencies.requestHttps(tlsRequestOptions(requestOptions, target), complete)
      : runtime.dependencies.requestHttp(requestOptions, complete)
    manageClientRequest(runtime, upstream, response, target.secure)
    request.once('aborted', () => upstream.destroy())
    request.once('error', error => upstream.destroy(error))
    request.pipe(upstream)
  } catch (error) {
    failHttpResponse(response, error)
  }
}

async function handleConnect(
  runtime: ProxyRuntime,
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
): Promise<void> {
  if (!authenticate(runtime, request.headers)) {
    endSocketResponse(client, 407, ['Proxy-Authenticate: Basic realm="dsh-browser-use"'])
    return
  }
  if (head.byteLength > MAX_CONNECT_HEAD_BYTES) {
    endSocketResponse(client, 413)
    return
  }
  try {
    const target = await pinIncomingTarget(runtime, request, 'connect')
    assertRuntimeOpen(runtime)
    const upstream = await openPinnedSocket(runtime, target, false)
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: dsh-browser-use\r\n\r\n')
    if (head.byteLength > 0) upstream.write(head)
    coupleSockets(client, upstream)
  } catch (error) {
    endSocketResponse(client, errorStatus(error))
  }
}

async function handleWebSocket(
  runtime: ProxyRuntime,
  request: IncomingMessage,
  client: Duplex,
  head: Buffer,
): Promise<void> {
  if (!authenticate(runtime, request.headers)) {
    endSocketResponse(client, 407, ['Proxy-Authenticate: Basic realm="dsh-browser-use"'])
    return
  }
  if (request.method !== 'GET' || head.byteLength > MAX_CONNECT_HEAD_BYTES) {
    endSocketResponse(client, 400)
    return
  }
  try {
    const target = await pinIncomingTarget(runtime, request, 'websocket')
    assertRuntimeOpen(runtime)
    const handshake = serializeUpgradeRequest(request, target, runtime.limits.maxHeaderBytes)
    const upstream = await openPinnedSocket(runtime, target, target.secure)
    upstream.write(handshake)
    if (head.byteLength > 0) upstream.write(head)
    coupleSockets(client, upstream)
  } catch (error) {
    endSocketResponse(client, errorStatus(error))
  }
}

function pinIncomingTarget(
  runtime: ProxyRuntime,
  request: IncomingMessage,
  kind: PinnedProxyTargetKind,
): Promise<PinnedProxyTarget> {
  const hostHeader = firstHeader(request.headers.host)
  return resolvePinnedProxyTarget({
    rawTarget: request.url ?? '',
    kind,
    validateUrl: runtime.options.validateUrl,
    allowPrivateNetwork: runtime.options.allowPrivateNetwork(),
    signal: runtime.lifecycle.signal,
    timeoutMs: runtime.limits.connectTimeoutMs,
    ...(hostHeader === undefined ? {} : { hostHeader }),
    ...(runtime.options.resolve === undefined ? {} : { resolve: runtime.options.resolve }),
  })
}

function proxyCandidateUrl(rawTarget: string, kind: PinnedProxyTargetKind, hostHeader?: string): URL {
  let candidate: URL
  try {
    if (kind === 'connect') {
      if (rawTarget.trim() !== rawTarget || rawTarget.includes('/')) throw new Error('invalid CONNECT authority')
      candidate = new URL(`https://${rawTarget}/`)
    } else if (rawTarget.startsWith('/')) {
      if (hostHeader === undefined || hostHeader === '') throw new Error('origin-form request omitted Host')
      candidate = new URL(`http://${hostHeader}${rawTarget}`)
    } else {
      candidate = new URL(rawTarget)
      if (candidate.protocol === 'ws:') candidate.protocol = 'http:'
      if (candidate.protocol === 'wss:') candidate.protocol = 'https:'
    }
  } catch (error) {
    throw new PinnedProxyError('proxy target is not a valid absolute destination', 'PROXY_TARGET_INVALID', 400, {
      cause: error,
    })
  }
  if ((candidate.protocol !== 'http:' && candidate.protocol !== 'https:')
    || candidate.hostname === '' || candidate.username !== '' || candidate.password !== '' || candidate.hash !== '') {
    throw new PinnedProxyError('proxy target URL is not permitted', 'PROXY_TARGET_INVALID', 400)
  }
  return candidate
}

function validateApprovedUrl(approved: URL, candidate: URL): URL {
  const normalized = new URL(approved.href)
  if ((normalized.protocol !== 'http:' && normalized.protocol !== 'https:')
    || normalized.hostname === '' || normalized.username !== '' || normalized.password !== ''
    || normalized.hash !== '' || normalized.href !== candidate.href) {
    throw new PinnedProxyError(
      'browser URL policy returned a different or invalid proxy target',
      'PROXY_TARGET_BLOCKED',
      403,
    )
  }
  return normalized
}

async function defaultResolver(hostname: string, signal: AbortSignal): Promise<readonly PinnedProxyAddress[]> {
  signal.throwIfAborted()
  const answers = await lookup(hostname, { all: true, order: 'verbatim' })
  signal.throwIfAborted()
  return answers.map(answer => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }))
}

function validateAddresses(addresses: readonly PinnedProxyAddress[]): readonly PinnedProxyAddress[] {
  if (addresses.length === 0) return []
  for (const answer of addresses) {
    const family: number = answer.family
    if ((family !== 4 && family !== 6) || isIP(normalizeIpLiteralHost(answer.address)) !== family) {
      throw new PinnedProxyError('proxy resolver returned an invalid address', 'PROXY_RESOLUTION_FAILED', 502)
    }
  }
  return addresses.map(answer => ({
    address: normalizeIpLiteralHost(answer.address),
    family: answer.family,
  }))
}

function normalizeIpLiteralHost(address: string): string {
  return (address.toLocaleLowerCase('en-US').split('%')[0] ?? address)
    .replace(/^\[/, '')
    .replace(/\]$/, '')
}

function isPrivateIp(address: string): boolean {
  const normalized = normalizeIpLiteralHost(address)
  const family = isIP(normalized)
  if (family === 4) return NON_PUBLIC_ADDRESSES.check(normalized, 'ipv4')
  if (family === 6) {
    if (IPV4_MAPPED_IPV6.check(normalized, 'ipv6')) {
      return NON_PUBLIC_ADDRESSES.check(normalized, 'ipv6')
    }
    return !GLOBAL_IPV6_UNICAST.check(normalized, 'ipv6')
      || NON_PUBLIC_ADDRESSES.check(normalized, 'ipv6')
  }
  return true
}

function outboundHeaders(
  source: IncomingHttpHeaders,
  host: string | undefined,
  preserveUpgrade: boolean,
): IncomingHttpHeaders {
  const connectionTokens = new Set(
    firstHeader(source.connection)?.split(',').map(value => value.trim().toLocaleLowerCase('en-US')).filter(Boolean),
  )
  const blocked = new Set([
    'proxy-authorization',
    'proxy-authenticate',
    'proxy-connection',
    'keep-alive',
    'te',
    'trailer',
    'transfer-encoding',
    ...connectionTokens,
  ])
  if (!preserveUpgrade) {
    blocked.add('connection')
    blocked.add('upgrade')
  }
  const entries = Object.entries(source).filter(([name, value]) =>
    value !== undefined && name !== 'host' && !blocked.has(name.toLocaleLowerCase('en-US')))
  if (host !== undefined) entries.push(['host', host])
  return Object.fromEntries(entries)
}

function tlsRequestOptions(options: RequestOptions, target: PinnedProxyTarget): HttpsRequestOptions {
  if (isIP(target.hostname) !== 0) return options
  return { ...options, servername: target.hostname }
}

function manageClientRequest(
  runtime: ProxyRuntime,
  request: ClientRequest,
  response: ServerResponse,
  secure: boolean,
): void {
  runtime.requests.add(request)
  let ready = false
  const connectTimer = setTimeout(() => {
    request.destroy(new PinnedProxyError('proxy upstream connection timed out', 'PROXY_TIMEOUT', 504))
  }, runtime.limits.connectTimeoutMs)
  const markReady = (): void => {
    if (ready) return
    ready = true
    clearTimeout(connectTimer)
    request.setTimeout(runtime.limits.idleTimeoutMs, () => {
      request.destroy(new PinnedProxyError('proxy upstream request timed out', 'PROXY_TIMEOUT', 504))
    })
  }
  request.on('socket', (socket) => {
    trackSocket(runtime, socket)
    const readyEvent = secure ? 'secureConnect' : 'connect'
    socket.once(readyEvent, markReady)
    const connectionState = socket as Socket & { secureConnecting?: boolean }
    if (!socket.connecting && (!secure || connectionState.secureConnecting === false)) markReady()
  })
  request.once('response', () => {
    markReady()
  })
  request.once('error', (error) => {
    clearTimeout(connectTimer)
    failHttpResponse(response, error)
  })
  request.once('close', () => {
    clearTimeout(connectTimer)
    runtime.requests.delete(request)
  })
  if (runtime.closed) request.destroy(new PinnedProxyError('browser proxy is closed', 'PROXY_CLOSED', 503))
}

async function openPinnedSocket(
  runtime: ProxyRuntime,
  target: PinnedProxyTarget,
  secure: boolean,
): Promise<Duplex> {
  assertRuntimeOpen(runtime)
  const options = { host: target.address, family: target.family, port: target.port }
  let socket: Socket
  let readyEvent: 'connect' | 'secureConnect'
  if (secure) {
    const tlsOptions: TlsConnectionOptions = isIP(target.hostname) === 0
      ? { ...options, servername: target.hostname, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] }
      : { ...options, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] }
    socket = runtime.dependencies.connectTls(tlsOptions)
    readyEvent = 'secureConnect'
  } else {
    socket = runtime.dependencies.connectTcp(options)
    readyEvent = 'connect'
  }
  trackSocket(runtime, socket)
  try {
    await socketReady(socket, readyEvent, runtime.lifecycle.signal, runtime.limits.connectTimeoutMs)
  } catch (error) {
    socket.destroy()
    throw error
  }
  assertRuntimeOpen(runtime)
  return socket
}

function socketReady(
  socket: Socket,
  readyEvent: 'connect' | 'secureConnect',
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      socket.removeListener(readyEvent, onReady)
      socket.removeListener('error', onError)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onReady = (): void => {
      finish()
    }
    const onError = (error: Error): void => {
      finish(new PinnedProxyError(
        'proxy failed to connect to pinned destination',
        'PROXY_TRANSPORT_FAILED',
        502,
        { cause: error },
      ))
    }
    const onAbort = (): void => {
      finish(new PinnedProxyError('browser proxy closed', 'PROXY_CLOSED', 503))
    }
    const timer = setTimeout(() => {
      finish(new PinnedProxyError(
        'proxy connection timed out',
        'PROXY_TIMEOUT',
        504,
      ))
    }, timeoutMs)
    socket.once(readyEvent, onReady)
    socket.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function serializeUpgradeRequest(
  request: IncomingMessage,
  target: PinnedProxyTarget,
  maxHeaderBytes: number,
): Buffer {
  const headers = outboundHeaders(request.headers, target.url.host, true)
  headers.connection = firstHeader(request.headers.connection) ?? 'Upgrade'
  headers.upgrade = firstHeader(request.headers.upgrade) ?? 'websocket'
  const lines = [`GET ${target.url.pathname}${target.url.search} HTTP/1.1`]
  for (const [name, rawValue] of Object.entries(headers)) {
    if (rawValue === undefined) continue
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    for (const value of values) {
      const rendered = value
      if (/\r|\n/.test(name) || /\r|\n/.test(rendered)) {
        throw new PinnedProxyError('WebSocket proxy header is invalid', 'PROXY_TARGET_INVALID', 400)
      }
      lines.push(`${name}: ${rendered}`)
    }
  }
  const payload = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1')
  if (payload.byteLength > maxHeaderBytes) {
    throw new PinnedProxyError('WebSocket proxy headers exceed the configured bound', 'PROXY_TARGET_INVALID', 431)
  }
  return payload
}

function authenticate(runtime: ProxyRuntime, headers: IncomingHttpHeaders): boolean {
  const supplied = firstHeader(headers['proxy-authorization'])
  if (supplied === undefined) return false
  const actual = Buffer.from(supplied, 'utf8')
  const expected = Buffer.from(runtime.expectedAuthorization, 'utf8')
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0]
}

function trackSocket(runtime: ProxyRuntime, socket: Duplex): void {
  runtime.sockets.add(socket)
  socket.once('close', () => runtime.sockets.delete(socket))
  socket.once('error', () => {})
  const timed = socket as Duplex & { setTimeout?: (timeout: number, callback: () => void) => unknown }
  timed.setTimeout?.(runtime.limits.idleTimeoutMs, () => socket.destroy())
  if (runtime.closed) socket.destroy()
}

function coupleSockets(left: Duplex, right: Duplex): void {
  left.once('error', () => right.destroy())
  right.once('error', () => left.destroy())
  left.once('close', () => right.destroy())
  right.once('close', () => left.destroy())
  left.pipe(right)
  right.pipe(left)
}

function destroySockets(runtime: ProxyRuntime): void {
  for (const request of runtime.requests) {
    request.destroy(new PinnedProxyError('browser proxy is closed', 'PROXY_CLOSED', 503))
  }
  runtime.requests.clear()
  for (const socket of runtime.sockets) socket.destroy()
  runtime.sockets.clear()
}

function assertRuntimeOpen(runtime: ProxyRuntime): void {
  if (runtime.closed) throw new PinnedProxyError('browser proxy is closed', 'PROXY_CLOSED', 503)
}

function failHttpResponse(response: ServerResponse, error: unknown): void {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined)
    return
  }
  response.writeHead(errorStatus(error), { connection: 'close', 'content-length': '0' })
  response.end()
}

function errorStatus(error: unknown): number {
  return error instanceof PinnedProxyError ? error.statusCode : 502
}

function endSocketResponse(socket: Duplex, status: number, extraHeaders: readonly string[] = []): void {
  if (socket.destroyed || !socket.writable) return
  const reason = status === 400 ? 'Bad Request'
    : status === 407 ? 'Proxy Authentication Required'
      : status === 413 ? 'Payload Too Large'
        : status === 431 ? 'Request Header Fields Too Large'
          : status === 403 ? 'Forbidden'
            : status === 504 ? 'Gateway Timeout'
              : status === 503 ? 'Service Unavailable'
                : 'Bad Gateway'
  socket.end([
    `HTTP/1.1 ${String(status)} ${reason}`,
    ...extraHeaders,
    'Connection: close',
    'Content-Length: 0',
    '',
    '',
  ].join('\r\n'))
}

function listenLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => {
      resolve()
    })
  })
}

function isAddressInfo(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address === 'object' && typeof address.port === 'number'
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort!: () => void
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new PinnedProxyError(
        'proxy policy or resolution timed out',
        'PROXY_TIMEOUT',
        504,
      ))
    }, timeoutMs)
  })
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new PinnedProxyError('browser proxy closed', 'PROXY_CLOSED', 503))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  if (signal.aborted) onAbort()
  try {
    return await Promise.race([promise, timeout, aborted])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function resolveLimits(options: PinnedBrowserProxyOptions): ProxyLimits {
  const requestTimeoutMs = boundedTimeout(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  return {
    maxHeaderBytes: boundedInteger(options.maxHeaderBytes, DEFAULT_MAX_HEADER_BYTES, 1024, MAX_HEADER_BYTES),
    headersTimeoutMs: Math.min(
      boundedTimeout(options.headersTimeoutMs, DEFAULT_HEADERS_TIMEOUT_MS),
      requestTimeoutMs,
    ),
    requestTimeoutMs,
    connectTimeoutMs: boundedTimeout(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
    idleTimeoutMs: boundedTimeout(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
  }
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  return boundedInteger(value, fallback, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}
