import { describe, expect, it, vi } from 'vitest'
import {
  KufarHttpClient,
  type KufarLimiter,
  type KufarTransport,
  type KufarTransportResponse,
} from '../../electron/worker/kufar-http-client'

const response = (overrides: Partial<KufarTransportResponse> = {}): KufarTransportResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: new Uint8Array([1, 2, 3]),
  ...overrides,
})

const createLimiter = () => {
  const schedule = vi.fn()
  const imposeCooldown = vi.fn()
  const limiter: KufarLimiter = {
    schedule: async <T>(operation: () => Promise<T>): Promise<T> => {
      schedule()
      return operation()
    },
    imposeCooldown,
  }

  return { limiter, schedule, imposeCooldown }
}

const createTransport = (...results: KufarTransportResponse[]) => {
  const request = vi.fn()
  for (const result of results) request.mockResolvedValueOnce(result)
  const close = vi.fn().mockResolvedValue(undefined)

  return {
    transport: { request, close } satisfies KufarTransport,
    request,
    close,
  }
}

describe('KufarHttpClient', () => {
  it('routes a successful GET through the limiter and preserves raw data', async () => {
    const { limiter, schedule } = createLimiter()
    const raw = response()
    const { transport, request } = createTransport(raw)
    const client = new KufarHttpClient({ limiter, transport })

    const result = await client.get('https://api.kufar.by/search-api/v2/search/count')

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
      url: new URL('https://api.kufar.by/search-api/v2/search/count'),
      method: 'GET',
      headers: undefined,
    })
    expect(result).toEqual({
      ok: true,
      status: 200,
      headers: raw.headers,
      body: raw.body,
      attempts: 1,
    })
  })

  it('forwards headers and delegates close to the transport', async () => {
    const { limiter } = createLimiter()
    const { transport, request, close } = createTransport(response())
    const client = new KufarHttpClient({ limiter, transport })

    await client.get('https://api.kufar.by/search-api/v2/search/count', {
      accept: 'application/json',
    })
    await client.close()

    expect(request).toHaveBeenCalledWith({
      url: new URL('https://api.kufar.by/search-api/v2/search/count'),
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
