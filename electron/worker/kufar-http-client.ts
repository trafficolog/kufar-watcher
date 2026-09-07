import { Agent, request as undiciRequest } from 'undici'

import { kufarRateLimiter } from './kufar-rate-limiter'

export const KUFAR_HTTP_DEFAULTS = {
  connectTimeoutMs: 10_000,
  headersTimeoutMs: 15_000,
  bodyTimeoutMs: 30_000,
  maxAttempts: 3,
  retryBaseDelayMs: 500,
  defaultRateLimitCooldownMs: 60_000,
  maxRateLimitCooldownMs: 900_000,
} as const

export type KufarHeaders = Record<string, string | string[]>

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

  constructor(options: KufarHttpClientOptions = {}) {
    this.transport =
      options.transport ??
      new UndiciKufarTransport({
        connectTimeoutMs: options.connectTimeoutMs ?? KUFAR_HTTP_DEFAULTS.connectTimeoutMs,
        headersTimeoutMs: options.headersTimeoutMs ?? KUFAR_HTTP_DEFAULTS.headersTimeoutMs,
        bodyTimeoutMs: options.bodyTimeoutMs ?? KUFAR_HTTP_DEFAULTS.bodyTimeoutMs,
      })
    this.limiter = options.limiter ?? kufarRateLimiter
  }

  async get(url: string | URL, headers?: Record<string, string>): Promise<KufarHttpResult> {
    const request = {
      url: typeof url === 'string' ? new URL(url) : url,
      method: 'GET' as const,
      headers,
    }

    const response = await this.limiter.schedule(() => this.transport.request(request))

    if (response.status >= 200 && response.status < 300) {
      return {
        ok: true,
        status: response.status,
        body: response.body,
        headers: response.headers,
        attempts: 1,
      }
    }

    return {
      ok: false,
      kind: 'permanent',
      code: 'unexpected-http',
      status: response.status,
      attempts: 1,
      message: `Unexpected HTTP status ${response.status}`,
    }
  }

  async close(): Promise<void> {
    await this.transport.close()
  }
}
