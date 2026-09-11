import { describe, expect, it, vi } from 'vitest'
import {
  KufarHttpClient,
  type KufarLimiter,
  type KufarTransport,
  type KufarTransportResponse,
} from '../../electron/worker/kufar-http-client'

const TEST_URL = 'https://api.kufar.by/search-api/v2/search/count'
const RATE_LIMIT_NOW = Date.parse('2026-09-07T20:00:00.000Z')

const RATE_LIMIT_CASES: Array<{
  label: string
  headers: Record<string, string>
  expectedCooldownMs: number
}> = [
  { label: 'missing Retry-After', headers: {}, expectedCooldownMs: 60_000 },
  { label: 'delta seconds', headers: { 'retry-after': '120' }, expectedCooldownMs: 120_000 },
  {
    label: 'HTTP date',
    headers: { 'retry-after': new Date(RATE_LIMIT_NOW + 90_000).toUTCString() },
    expectedCooldownMs: 90_000,
  },
  { label: 'garbage value', headers: { 'retry-after': 'garbage' }, expectedCooldownMs: 60_000 },
  { label: 'zero seconds', headers: { 'retry-after': '0' }, expectedCooldownMs: 60_000 },
  {
    label: 'maximum clamp',
    headers: { 'retry-after': '3600' },
    expectedCooldownMs: 900_000,
  },
  {
    label: 'mixed-case header',
    headers: { 'Retry-After': '120' },
    expectedCooldownMs: 120_000,
  },
]

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

const createScriptedTransport = (steps: Array<KufarTransportResponse | Error>) => {
  const request = vi.fn()
  for (const step of steps) {
    if (step instanceof Error) request.mockRejectedValueOnce(step)
    else request.mockResolvedValueOnce(step)
  }
  const close = vi.fn().mockResolvedValue(undefined)

  return {
    transport: { request, close } satisfies KufarTransport,
    request,
  }
}

const transportError = (code: string): Error & { code: string } =>
  Object.assign(new Error(code), { code })

const createJournalRecord = (body = response().body) =>
  vi.fn(async () => ({
    version: 1 as const,
    id: 'snapshot-1',
    endpoint: 'api.kufar.by/search-api/v2/search/count',
    requestUrl: TEST_URL,
    status: 200,
    capturedAt: '2026-09-08T10:15:30.000Z',
    bodyBase64: Buffer.from(body).toString('base64'),
  }))

describe('KufarHttpClient', () => {
  it('routes a successful GET through the limiter with a stable User-Agent and preserves raw data', async () => {
    const { limiter, schedule } = createLimiter()
    const raw = response()
    const { transport, request } = createTransport(raw)
    const client = new KufarHttpClient({ limiter, transport })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
      url: new URL(TEST_URL),
      method: 'GET',
      headers: { 'user-agent': 'kufar-watcher' },
    })
    expect(result).toEqual({
      ok: true,
      status: 200,
      headers: raw.headers,
      body: raw.body,
      attempts: 1,
    })
  })

  it('forwards headers alongside the stable User-Agent and delegates close to the transport', async () => {
    const { limiter } = createLimiter()
    const { transport, request, close } = createTransport(response())
    const client = new KufarHttpClient({ limiter, transport })

    await client.get(TEST_URL, { accept: 'application/json' })
    await client.close()

    expect(request).toHaveBeenCalledWith({
      url: new URL(TEST_URL),
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'kufar-watcher' },
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('preserves an explicit User-Agent without adding a duplicate default', async () => {
    const { limiter } = createLimiter()
    const { transport, request } = createTransport(response())
    const client = new KufarHttpClient({ limiter, transport })

    await client.get(TEST_URL, { 'User-Agent': 'custom-kufar-client' })

    expect(request).toHaveBeenCalledWith({
      url: new URL(TEST_URL),
      method: 'GET',
      headers: { 'User-Agent': 'custom-kufar-client' },
    })
  })

  it('journals a successful response exactly once', async () => {
    const { limiter } = createLimiter()
    const raw = response()
    const { transport } = createTransport(raw)
    const journalRecord = createJournalRecord(raw.body)
    const client = new KufarHttpClient({
      limiter,
      transport,
      journal: { record: journalRecord },
    })

    const result = await client.get(TEST_URL)

    expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 })
    expect(journalRecord).toHaveBeenCalledTimes(1)
    expect(journalRecord).toHaveBeenCalledWith({
      requestUrl: new URL(TEST_URL),
      status: 200,
      body: raw.body,
    })
  })

  it.each([
    { label: 'redirect', status: 302 },
    { label: 'permanent 4xx', status: 404 },
    { label: 'rate limit', status: 429 },
    { label: 'temporary 5xx', status: 503 },
  ])('does not journal a $label response', async ({ status }) => {
    const { limiter } = createLimiter()
    const { transport } = createTransport(response({ status }))
    const journalRecord = createJournalRecord()
    const client = new KufarHttpClient({
      limiter,
      transport,
      journal: { record: journalRecord },
      maxAttempts: 1,
    })

    await client.get(TEST_URL)

    expect(journalRecord).not.toHaveBeenCalled()
  })

  it('does not journal a transport failure', async () => {
    const { limiter } = createLimiter()
    const scripted = createScriptedTransport([new Error('socket reset')])
    const journalRecord = createJournalRecord()
    const client = new KufarHttpClient({
      limiter,
      transport: scripted.transport,
      journal: { record: journalRecord },
      maxAttempts: 1,
    })

    await client.get(TEST_URL)

    expect(journalRecord).not.toHaveBeenCalled()
  })

  it('keeps a successful HTTP result when journaling fails', async () => {
    const { limiter } = createLimiter()
    const { transport } = createTransport(response())
    const retrySleep = vi.fn().mockResolvedValue(undefined)
    const warnings: string[] = []
    const journal = {
      record: vi.fn(async () => {
        throw new Error('disk full: raw payload must not leak')
      }),
    }
    const client = new KufarHttpClient({
      limiter,
      transport,
      sleep: retrySleep,
      journal,
      onJournalWarning: (message) => warnings.push(message),
    })

    const result = await client.get(TEST_URL)

    expect(result).toMatchObject({ ok: true, status: 200, attempts: 1 })
    expect(warnings).toEqual(['Raw response snapshot could not be stored'])
    expect(retrySleep).not.toHaveBeenCalled()
  })

  it('retries a network failure through the limiter and succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const scripted = createScriptedTransport([new Error('socket reset'), response()])
    const { limiter, schedule } = createLimiter()
    const client = new KufarHttpClient({ limiter, transport: scripted.transport, sleep })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(2)
    expect(scripted.request).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
    expect(result).toMatchObject({ ok: true, attempts: 2 })
  })

  it('retries a 5xx response and succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const scripted = createScriptedTransport([response({ status: 503 }), response()])
    const { limiter, schedule } = createLimiter()
    const client = new KufarHttpClient({ limiter, transport: scripted.transport, sleep })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
    expect(result).toMatchObject({ ok: true, attempts: 2 })
  })

  it('returns the last 5xx as temporary after bounded retries', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const scripted = createScriptedTransport([
      response({ status: 503 }),
      response({ status: 502 }),
      response({ status: 500 }),
    ])
    const { limiter, schedule } = createLimiter()
    const client = new KufarHttpClient({ limiter, transport: scripted.transport, sleep })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[500], [1_000]])
    expect(result).toMatchObject({
      ok: false,
      kind: 'temporary',
      code: 'http-5xx',
      status: 500,
      attempts: 3,
    })
  })

  it('classifies all Undici timeout stages as temporary and bounded', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const scripted = createScriptedTransport([
      transportError('UND_ERR_CONNECT_TIMEOUT'),
      transportError('UND_ERR_HEADERS_TIMEOUT'),
      transportError('UND_ERR_BODY_TIMEOUT'),
    ])
    const { limiter, schedule } = createLimiter()
    const client = new KufarHttpClient({ limiter, transport: scripted.transport, sleep })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[500], [1_000]])
    expect(result).toMatchObject({
      ok: false,
      kind: 'temporary',
      code: 'timeout',
      status: null,
      attempts: 3,
    })
  })

  it('returns a non-429 4xx immediately as permanent', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const scripted = createScriptedTransport([response({ status: 404 })])
    const { limiter, schedule } = createLimiter()
    const client = new KufarHttpClient({ limiter, transport: scripted.transport, sleep })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(scripted.request).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      kind: 'permanent',
      code: 'http-4xx',
      status: 404,
      attempts: 1,
    })
  })

  it('returns a redirect immediately as an unexpected permanent response', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const scripted = createScriptedTransport([response({ status: 302 })])
    const { limiter, schedule } = createLimiter()
    const client = new KufarHttpClient({ limiter, transport: scripted.transport, sleep })

    const result = await client.get(TEST_URL)

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(scripted.request).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      kind: 'permanent',
      code: 'unexpected-http',
      status: 302,
      attempts: 1,
    })
  })

  it.each(RATE_LIMIT_CASES)(
    'handles 429 with $label without retrying',
    async ({ headers, expectedCooldownMs }) => {
      const sleep = vi.fn().mockResolvedValue(undefined)
      const scripted = createScriptedTransport([response({ status: 429, headers })])
      const { limiter, schedule, imposeCooldown } = createLimiter()
      const client = new KufarHttpClient({
        limiter,
        transport: scripted.transport,
        sleep,
        now: () => RATE_LIMIT_NOW,
      })

      const result = await client.get(TEST_URL)

      expect(result).toMatchObject({
        ok: false,
        kind: 'rate-limited',
        code: 'rate-limited',
        status: 429,
        attempts: 1,
        retryAfterMs: expectedCooldownMs,
      })
      expect(scripted.request).toHaveBeenCalledTimes(1)
      expect(schedule).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
      expect(imposeCooldown).toHaveBeenCalledTimes(1)
      expect(imposeCooldown).toHaveBeenCalledWith(expectedCooldownMs)
    },
  )
})
