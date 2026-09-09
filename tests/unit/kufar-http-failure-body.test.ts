import { describe, expect, it, vi } from 'vitest'

import {
  KufarHttpClient,
  type KufarLimiter,
  type KufarTransport,
  type KufarTransportResponse,
} from '../../electron/worker/kufar-http-client'

const TEST_URL = 'https://api.kufar.by/search-api/v2/item/123/rendered?lang=ru'

function limiter(): KufarLimiter {
  return {
    schedule: <T>(operation: () => Promise<T>) => operation(),
    imposeCooldown: vi.fn(),
  }
}

function transport(step: KufarTransportResponse | Error): KufarTransport {
  return {
    request: vi.fn(async () => {
      if (step instanceof Error) throw step
      return step
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function response(status: number, body: Uint8Array): KufarTransportResponse {
  return { status, headers: {}, body }
}

describe('KufarHttpClient HTTP failure bodies', () => {
  it.each([
    { label: '4xx', status: 404 },
    { label: '5xx', status: 503 },
    { label: '429', status: 429 },
    { label: 'unexpected status', status: 302 },
  ])('preserves raw body on $label response', async ({ status }) => {
    const body = new TextEncoder().encode(`failure-${status}`)
    const client = new KufarHttpClient({
      limiter: limiter(),
      transport: transport(response(status, body)),
      maxAttempts: 1,
    })

    const result = await client.get(TEST_URL)

    expect(result).toMatchObject({ ok: false, status, body })
  })

  it('does not invent a body for transport failures without an HTTP response', async () => {
    const client = new KufarHttpClient({
      limiter: limiter(),
      transport: transport(new Error('socket reset')),
      maxAttempts: 1,
    })

    const result = await client.get(TEST_URL)

    expect(result).toMatchObject({ ok: false, status: null, code: 'network' })
    expect(result).not.toHaveProperty('body')
  })
})
