import { describe, expect, it, vi } from 'vitest'

import {
  KufarHttpClient,
  type KufarLimiter,
  type KufarTransport,
  type KufarTransportResponse,
} from '../../electron/worker/kufar-http-client'

const TEST_URL = 'https://api.kufar.by/search-api/v2/item/1082715190/rendered?lang=ru'

function limiter(): KufarLimiter {
  return {
    schedule: async <T>(operation: () => Promise<T>) => operation(),
    imposeCooldown: vi.fn(),
  }
}

function transport(response: KufarTransportResponse): KufarTransport {
  return {
    request: vi.fn().mockResolvedValue(response),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

describe('KufarHttpClient HTTP failure bodies', () => {
  it.each([
    { label: 'redirect', status: 302 },
    { label: 'permanent 4xx', status: 404 },
    { label: 'rate limit', status: 429 },
    { label: 'exhausted 5xx', status: 503 },
  ])('preserves raw response bytes for $label', async ({ status }) => {
    const body = new TextEncoder().encode(`{"status":${status}}`)
    const client = new KufarHttpClient({
      limiter: limiter(),
      transport: transport({
        status,
        headers: {},
        body,
      }),
      maxAttempts: 1,
    })

    const result = await client.get(TEST_URL)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected HTTP failure')
    expect('body' in result ? result.body : undefined).toEqual(body)
  })

  it('keeps transport failures body-less', async () => {
    const client = new KufarHttpClient({
      limiter: limiter(),
      transport: {
        request: vi.fn().mockRejectedValue(new Error('socket reset')),
        close: vi.fn().mockResolvedValue(undefined),
      },
      maxAttempts: 1,
    })

    const result = await client.get(TEST_URL)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected transport failure')
    expect('body' in result).toBe(false)
  })
})
