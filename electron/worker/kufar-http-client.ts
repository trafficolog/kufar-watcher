import { Agent, request as undiciRequest } from 'undici'

import { kufarRateLimiter } from './kufar-rate-limiter'
import type { KufarRawResponseJournal } from './kufar-raw-response-journal'

export const KUFAR_HTTP_DEFAULTS = {
  connectTimeoutMs: 10_000,
  headersTimeoutMs: 15_000,
  bodyTimeoutMs: 30_000,
  maxAttempts: 3,
  retryBaseDelayMs: 500,
  defaultRateLimitCooldownMs: 60_000,
  maxRateLimitCooldownMs: 900_000,
} as const

const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

const getErrorCode = (error: unknown): string | null => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }

  return null
}

const isTimeoutError = (error: unknown): boolean => {
  const code = getErrorCode(error)
  return code !== null && TIMEOUT_CODES.has(code)
}

export type KufarHeaders = Record<string, string | string[]>

const getHeader = (headers: KufarHeaders, name: string): string | undefined => {
  const wanted = name.toLowerCase()

  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== wanted) continue
    return Array.isArray(value) ? value[0] : value
  }

  return undefined
}

const parseRetryAfterMs = (
  rawValue: string | undefined,
  nowMs: number,
  defaultCooldownMs: number,
  maxCooldownMs: number,
): number => {
  let candidateMs = defaultCooldownMs

  if (rawValue !== undefined) {
    if (/^\d+$/.test(rawValue)) {
      const parsedMs = Number(rawValue) * 1000
      if (Number.isFinite(parsedMs) && parsedMs > 0) candidateMs = parsedMs
    } else {
      const parsedMs = Date.parse(rawValue) - nowMs
      if (Number.isFinite(parsedMs) && parsedMs > 0) candidateMs = parsedMs
    }
  }

  return Math.min(candidateMs, maxCooldownMs)
}

export interface KufarTransportRequest {
  url: URL
  method: 'GET'
  headers?: Record<string, string>
}

export interface KufarTransportResponse {
  status: number
  headers: KufarHeaders
  body: Uint8Array
}

export interface KufarTransport {
  request(input: KufarTransportRequest): Promise<KufarTransportResponse>
  close(): Promise<void>
}

export interface KufarLimiter {
  schedule<T>(operation: () => Promise<T>): Promise<T>
  imposeCooldown(delayMs: number): void
}

export type KufarHttpResult =
  | {
      ok: true
      status: number
      body: Uint8Array
      headers: KufarHeaders
      attempts: number
    }
  | {
      ok: false
      kind: 'temporary' | 'permanent' | 'rate-limited'
      code: 'network' | 'timeout' | 'http-4xx' | 'http-5xx' | 'unexpected-http' | 'rate-limited'
      status: number | null
      attempts: number
      message: string
      retryAfterMs?: number
    }

export interface KufarHttpClientOptions {
  transport?: KufarTransport
  limiter?: KufarLimiter
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  connectTimeoutMs?: number
  headersTimeoutMs?: number
  bodyTimeoutMs?: number
  maxAttempts?: number
  retryBaseDelayMs?: number
  defaultRateLimitCooldownMs?: number
  maxRateLimitCooldownMs?: number
  journal?: Pick<KufarRawResponseJournal, 'record'>
  onJournalWarning?: (message: string) => void
}

interface UndiciKufarTransportOptions {
  connectTimeoutMs: number
  headersTimeoutMs: number
  bodyTimeoutMs: number
}

class UndiciKufarTransport implements KufarTransport {
  private readonly agent: Agent

  constructor(options: UndiciKufarTransportOptions) {
    this.agent = new Agent({
      connectTimeout: options.connectTimeoutMs,
      headersTimeout: options.headersTimeoutMs,
      bodyTimeout: options.bodyTimeoutMs,
    })
  }

  async request(input: KufarTransportRequest): Promise<KufarTransportResponse> {
    // Undici 7.29.1 core request() returns 3xx directly unless a redirect interceptor is composed.
    const result = await undiciRequest(input.url, {
      method: input.method,
      headers: input.headers,
      dispatcher: this.agent,
    })

    const headers: KufarHeaders = {}

    for (const [name, value] of Object.entries(result.headers)) {
      if (value !== undefined) {
        headers[name] = value
      }
    }

    return {
      status: result.statusCode,
      headers,
      body: new Uint8Array(await result.body.arrayBuffer()),
    }
  }

  async close(): Promise<void> {
    await this.agent.close()
  }
}

export class KufarHttpClient {
  private readonly transport: KufarTransport
  private readonly limiter: KufarLimiter
  private readonly retrySleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly maxAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly defaultRateLimitCooldownMs: number
  private readonly maxRateLimitCooldownMs: number
  private readonly journal?: Pick<KufarRawResponseJournal, 'record'>
  private readonly onJournalWarning: (message: string) => void

  constructor(options: KufarHttpClientOptions = {}) {
    this.transport =
      options.transport ??
      new UndiciKufarTransport({
        connectTimeoutMs: options.connectTimeoutMs ?? KUFAR_HTTP_DEFAULTS.connectTimeoutMs,
        headersTimeoutMs: options.headersTimeoutMs ?? KUFAR_HTTP_DEFAULTS.headersTimeoutMs,
        bodyTimeoutMs: options.bodyTimeoutMs ?? KUFAR_HTTP_DEFAULTS.bodyTimeoutMs,
      })
    this.limiter = options.limiter ?? kufarRateLimiter
    this.retrySleep = options.sleep ?? sleep
    this.now = options.now ?? Date.now
    this.maxAttempts = options.maxAttempts ?? KUFAR_HTTP_DEFAULTS.maxAttempts
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? KUFAR_HTTP_DEFAULTS.retryBaseDelayMs
    this.defaultRateLimitCooldownMs =
      options.defaultRateLimitCooldownMs ?? KUFAR_HTTP_DEFAULTS.defaultRateLimitCooldownMs
    this.maxRateLimitCooldownMs =
      options.maxRateLimitCooldownMs ?? KUFAR_HTTP_DEFAULTS.maxRateLimitCooldownMs
    this.journal = options.journal
    this.onJournalWarning = options.onJournalWarning ?? (() => undefined)
  }

  async get(url: string | URL, headers?: Record<string, string>): Promise<KufarHttpResult> {
    const request = {
      url: typeof url === 'string' ? new URL(url) : url,
      method: 'GET' as const,
      headers,
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: KufarTransportResponse

      try {
        response = await this.limiter.schedule(() => this.transport.request(request))
      } catch (error) {
        const timeout = isTimeoutError(error)

        if (attempt < this.maxAttempts) {
          await this.retrySleep(this.retryDelayMs(attempt))
          continue
        }

        return {
          ok: false,
          kind: 'temporary',
          code: timeout ? 'timeout' : 'network',
          status: null,
          attempts: attempt,
          message: timeout
            ? 'Kufar request timed out after bounded retries'
            : 'Kufar request failed due to a temporary network error',
        }
      }

      if (response.status >= 200 && response.status < 300) {
        if (this.journal) {
          try {
            await this.journal.record({
              requestUrl: request.url,
              status: response.status,
              body: response.body,
            })
          } catch {
            this.onJournalWarning('Raw response snapshot could not be stored')
          }
        }

        return {
          ok: true,
          status: response.status,
          body: response.body,
          headers: response.headers,
          attempts: attempt,
        }
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(
          getHeader(response.headers, 'retry-after'),
          this.now(),
          this.defaultRateLimitCooldownMs,
          this.maxRateLimitCooldownMs,
        )

        this.limiter.imposeCooldown(retryAfterMs)

        return {
          ok: false,
          kind: 'rate-limited',
          code: 'rate-limited',
          status: 429,
          attempts: attempt,
          message: 'Kufar rate limit received; global request pace reduced',
          retryAfterMs,
        }
      }

      if (response.status >= 500 && response.status < 600) {
        if (attempt < this.maxAttempts) {
          await this.retrySleep(this.retryDelayMs(attempt))
          continue
        }

        return {
          ok: false,
          kind: 'temporary',
          code: 'http-5xx',
          status: response.status,
          attempts: attempt,
          message: `Kufar returned HTTP ${response.status} after bounded retries`,
        }
      }

      if (response.status >= 400 && response.status < 500) {
        return {
          ok: false,
          kind: 'permanent',
          code: 'http-4xx',
          status: response.status,
          attempts: attempt,
          message: `Kufar returned permanent HTTP ${response.status}`,
        }
      }

      return {
        ok: false,
        kind: 'permanent',
        code: 'unexpected-http',
        status: response.status,
        attempts: attempt,
        message: `Unexpected HTTP status ${response.status}`,
      }
    }

    throw new Error('Kufar HTTP attempt loop exhausted unexpectedly')
  }

  async close(): Promise<void> {
    await this.transport.close()
  }

  private retryDelayMs(attempt: number): number {
    return this.retryBaseDelayMs * 2 ** (attempt - 1)
  }
}
