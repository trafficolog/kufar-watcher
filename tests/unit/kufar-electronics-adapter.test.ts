import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { CanonicalQuery } from '../../shared/canonical-query'
import {
  KufarAdapterRequestError,
  KufarElectronicsAdapter,
} from '../../electron/worker/kufar-electronics-adapter'
import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'

const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: 'minsk',
  sellerType: null,
  sort: null,
  operation: null,
  pathFilters: [],
  extraParams: {},
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

class FakeHttpGetter {
  readonly calls: URL[] = []

  constructor(private readonly result: KufarHttpResult) {}

  async get(url: string | URL): Promise<KufarHttpResult> {
    this.calls.push(new URL(url))
    return this.result
  }
}

describe('KufarElectronicsAdapter', () => {
  it('builds the confirmed first-page electronics request and normalizes its body', async () => {
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-07-electronics-search-page-1.json'),
      headers: {},
      attempts: 1,
    })
    const adapter = new KufarElectronicsAdapter(http)

    const result = await adapter.fetchPage({ query, cursor: null })

    expect(http.calls).toHaveLength(1)
    const requested = http.calls[0]!
    expect(requested.origin + requested.pathname).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated',
    )
    expect(requested.searchParams.get('cat')).toBe('5040')
    expect(requested.searchParams.get('rgn')).toBe('7')
    expect(requested.searchParams.get('query')).toBe('ps5')
    expect(requested.searchParams.get('sort')).toBe('lst.d')
    expect(requested.searchParams.get('lang')).toBe('ru')
    expect(requested.searchParams.get('size')).toBe('30')
    expect(requested.searchParams.has('cursor')).toBe(false)
    expect(result.listings.length).toBeGreaterThan(0)
  })

  it('passes an opaque cursor unchanged as transport state', async () => {
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-07-electronics-search-page-2.json'),
      headers: {},
      attempts: 1,
    })
    const adapter = new KufarElectronicsAdapter(http)

    await adapter.fetchPage({ query, cursor: 'opaque+/=token' })

    expect(http.calls[0]?.searchParams.get('cursor')).toBe('opaque+/=token')
  })

  it.each([
    {
      ok: false,
      kind: 'temporary',
      code: 'network',
      status: null,
      attempts: 3,
      message: 'network',
    },
    {
      ok: false,
      kind: 'permanent',
      code: 'http-4xx',
      status: 400,
      attempts: 1,
      message: 'bad request',
    },
    {
      ok: false,
      kind: 'rate-limited',
      code: 'rate-limited',
      status: 429,
      attempts: 1,
      message: 'limited',
      retryAfterMs: 60_000,
    },
  ] satisfies Array<Extract<KufarHttpResult, { ok: false }>>)(
    'preserves classified $kind HTTP failures by identity',
    async (failure) => {
      const adapter = new KufarElectronicsAdapter(new FakeHttpGetter(failure))

      try {
        await adapter.fetchPage({ query, cursor: null })
        throw new Error('Expected electronics adapter request to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(KufarAdapterRequestError)
        expect((error as KufarAdapterRequestError).result).toBe(failure)
      }
    },
  )
})
