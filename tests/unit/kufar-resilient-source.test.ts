import { describe, expect, it, vi } from 'vitest'

import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import { parseKufarListingUrl } from '../../shared/kufar-url'
import { KufarAdapterRequestError } from '../../electron/worker/kufar-electronics-adapter'
import { KufarEmbeddedStateError } from '../../electron/worker/kufar-embedded-search-state'
import { KufarHtmlFallbackRequestError } from '../../electron/worker/kufar-html-fallback-adapter'
import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'
import { KufarNormalizationError } from '../../electron/worker/kufar-search-normalizer'

interface SourceDegradationEvent {
  kind: 'source-degraded'
  channel: 'html-fallback'
  primaryFailureCode: 'network' | 'timeout' | 'http-5xx'
  primaryStatus: number | null
}

interface ResilientError extends Error {
  action: 'fail-run' | 'pause-required'
  stage: 'primary' | 'html-fallback' | 'degradation-event'
  primaryCause: unknown
  fallbackCause?: unknown
}

interface ResilientSourceModule {
  KufarResilientSource: new (
    primary: SourceAdapter,
    fallback: SourceAdapter,
    onDegradation: (event: SourceDegradationEvent) => void | Promise<void>,
  ) => {
    fetchPage(request: SourcePageRequest): Promise<{
      page: SourcePage
      channel: 'primary' | 'html-fallback'
    }>
  }
  KufarResilientSourceError: new (...args: never[]) => ResilientError
}

const request: SourcePageRequest = {
  query: parseKufarListingUrl('https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5'),
  cursor: 'opaque-cursor',
}

const primaryPage: SourcePage = { listings: [], nextCursor: 'primary-next' }
const fallbackPage: SourcePage = { listings: [], nextCursor: 'fallback-next' }

type AdapterOperation = (request: SourcePageRequest) => SourcePage | Promise<SourcePage>

class FakeAdapter implements SourceAdapter {
  readonly calls: SourcePageRequest[] = []

  constructor(private readonly operation: AdapterOperation) {}

  async fetchPage(sourceRequest: SourcePageRequest): Promise<SourcePage> {
    this.calls.push(sourceRequest)
    return await this.operation(sourceRequest)
  }
}

async function loadModule(): Promise<ResilientSourceModule> {
  let loaded: unknown
  try {
    loaded = await vi.importActual('../../electron/worker/kufar-resilient-source')
  } catch {
    loaded = undefined
  }

  expect(loaded, 'resilient source module must exist').toBeTruthy()
  return loaded as ResilientSourceModule
}

function temporaryFailure(
  code: 'network' | 'timeout' | 'http-5xx',
): Extract<KufarHttpResult, { ok: false }> {
  return {
    ok: false,
    kind: 'temporary',
    code,
    status: code === 'http-5xx' ? 503 : null,
    attempts: 3,
    message: code,
  }
}

async function expectTerminalError(
  operation: () => Promise<unknown>,
  module: ResilientSourceModule,
  expected: Partial<ResilientError>,
): Promise<ResilientError> {
  try {
    await operation()
    throw new Error('Expected resilient source to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(module.KufarResilientSourceError)
    expect(error).toMatchObject(expected)
    return error as ResilientError
  }
}

describe('KufarResilientSource', () => {
  it('returns the primary channel without touching fallback or degradation sink', async () => {
    const module = await loadModule()
    const primary = new FakeAdapter(() => primaryPage)
    const fallback = new FakeAdapter(() => fallbackPage)
    const events: SourceDegradationEvent[] = []
    const source = new module.KufarResilientSource(primary, fallback, (event) => {
      events.push(event)
    })

    const result = await source.fetchPage(request)

    expect(result).toEqual({ page: primaryPage, channel: 'primary' })
    expect(primary.calls).toEqual([request])
    expect(fallback.calls).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it.each(['network', 'timeout', 'http-5xx'] as const)(
    'falls back once after temporary primary %s and publishes degradation before success',
    async (code) => {
      const module = await loadModule()
      const failure = temporaryFailure(code)
      const primaryError = new KufarAdapterRequestError(failure)
      const order: string[] = []
      const primary = new FakeAdapter(() => {
        throw primaryError
      })
      const fallback = new FakeAdapter(() => {
        order.push('fallback-success')
        return fallbackPage
      })
      const events: SourceDegradationEvent[] = []
      const source = new module.KufarResilientSource(primary, fallback, async (event) => {
        order.push('event')
        events.push(event)
      })

      const result = await source.fetchPage(request)

      expect(result).toEqual({ page: fallbackPage, channel: 'html-fallback' })
      expect(fallback.calls).toEqual([request])
      expect(order).toEqual(['fallback-success', 'event'])
      expect(events).toEqual([
        {
          kind: 'source-degraded',
          channel: 'html-fallback',
          primaryFailureCode: code,
          primaryStatus: failure.status,
        },
      ])
      expect(Object.keys(events[0]!).sort()).toEqual([
        'channel',
        'kind',
        'primaryFailureCode',
        'primaryStatus',
      ])
    },
  )

  it('does not fall back after primary rate limiting and propagates the original error', async () => {
    const module = await loadModule()
    const failure = {
      ok: false,
      kind: 'rate-limited',
      code: 'rate-limited',
      status: 429,
      attempts: 1,
      message: 'limited',
      retryAfterMs: 60_000,
    } satisfies Extract<KufarHttpResult, { ok: false }>
    const primaryError = new KufarAdapterRequestError(failure)
    const primary = new FakeAdapter(() => {
      throw primaryError
    })
    const fallback = new FakeAdapter(() => fallbackPage)
    const source = new module.KufarResilientSource(primary, fallback, () => undefined)

    await expect(source.fetchPage(request)).rejects.toBe(primaryError)
    expect(fallback.calls).toHaveLength(0)
  })

  it.each([
    { code: 'http-4xx', status: 403 },
    { code: 'unexpected-http', status: 304 },
  ] as const)(
    'does not fall back after permanent primary $code failure',
    async ({ code, status }) => {
      const module = await loadModule()
      const failure = {
        ok: false,
        kind: 'permanent',
        code,
        status,
        attempts: 1,
        message: code,
      } satisfies Extract<KufarHttpResult, { ok: false }>
      const primaryError = new KufarAdapterRequestError(failure)
      const primary = new FakeAdapter(() => {
        throw primaryError
      })
      const fallback = new FakeAdapter(() => fallbackPage)
      const source = new module.KufarResilientSource(primary, fallback, () => undefined)

      await expect(source.fetchPage(request)).rejects.toBe(primaryError)
      expect(fallback.calls).toHaveLength(0)
    },
  )

  it('classifies primary normalization drift as pause-required without fallback', async () => {
    const module = await loadModule()
    const primaryError = new KufarNormalizationError(
      'missing-field',
      'ads[0].subject',
      'missing subject',
    )
    const primary = new FakeAdapter(() => {
      throw primaryError
    })
    const fallback = new FakeAdapter(() => fallbackPage)
    const source = new module.KufarResilientSource(primary, fallback, () => undefined)

    await expectTerminalError(() => source.fetchPage(request), module, {
      action: 'pause-required',
      stage: 'primary',
      primaryCause: primaryError,
    })
    expect(fallback.calls).toHaveLength(0)
  })

  it.each([
    new KufarEmbeddedStateError('invalid-search-state', 'props.initialState.listing', 'drift'),
    new KufarNormalizationError('invalid-field', 'ads[0].currency', 'drift'),
  ])('classifies fallback schema failure as pause-required', async (fallbackError) => {
    const module = await loadModule()
    const primaryError = new KufarAdapterRequestError(temporaryFailure('network'))
    const primary = new FakeAdapter(() => {
      throw primaryError
    })
    const fallback = new FakeAdapter(() => {
      throw fallbackError
    })
    const source = new module.KufarResilientSource(primary, fallback, () => undefined)

    await expectTerminalError(() => source.fetchPage(request), module, {
      action: 'pause-required',
      stage: 'html-fallback',
      primaryCause: primaryError,
      fallbackCause: fallbackError,
    })
  })

  it('classifies fallback HTTP failure as fail-run and preserves both causes', async () => {
    const module = await loadModule()
    const primaryError = new KufarAdapterRequestError(temporaryFailure('timeout'))
    const fallbackFailure = temporaryFailure('http-5xx')
    const fallbackError = new KufarHtmlFallbackRequestError(fallbackFailure)
    const primary = new FakeAdapter(() => {
      throw primaryError
    })
    const fallback = new FakeAdapter(() => {
      throw fallbackError
    })
    const source = new module.KufarResilientSource(primary, fallback, () => undefined)

    await expectTerminalError(() => source.fetchPage(request), module, {
      action: 'fail-run',
      stage: 'html-fallback',
      primaryCause: primaryError,
      fallbackCause: fallbackError,
    })
  })

  it('fails the run when degradation publication rejects instead of returning silent success', async () => {
    const module = await loadModule()
    const primaryError = new KufarAdapterRequestError(temporaryFailure('network'))
    const sinkError = new Error('journal unavailable')
    const primary = new FakeAdapter(() => {
      throw primaryError
    })
    const fallback = new FakeAdapter(() => fallbackPage)
    const source = new module.KufarResilientSource(primary, fallback, async () => {
      throw sinkError
    })

    await expectTerminalError(() => source.fetchPage(request), module, {
      action: 'fail-run',
      stage: 'degradation-event',
      primaryCause: primaryError,
      fallbackCause: sinkError,
    })
  })
})
