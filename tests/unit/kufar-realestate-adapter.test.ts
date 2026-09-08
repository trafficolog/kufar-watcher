import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  KufarRealEstateAdapter,
  KufarRealEstateAdapterRequestError,
} from '../../electron/worker/kufar-realestate-adapter'
import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'
import { parseKufarListingUrl } from '../../shared/kufar-url'

const query = parseKufarListingUrl('https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD')

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

describe('KufarRealEstateAdapter', () => {
  it('uses the common classified Kufar request-error base', () => {
    expect(
      Object.getPrototypeOf(KufarRealEstateAdapterRequestError.prototype)?.constructor.name,
    ).toBe('KufarSourceRequestError')
  })

  it('builds the confirmed request from a real-estate listing URL and normalizes its body', async () => {
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-07-realestate-search-page-1.json'),
      headers: {},
      attempts: 1,
    })
    const adapter = new KufarRealEstateAdapter(http)

    const result = await adapter.fetchPage({ query, cursor: null })

    expect(http.calls).toHaveLength(1)
    const requested = http.calls[0]!
    expect(requested.origin + requested.pathname).toBe(
      'https://api.kufar.by/search-api/v2/search/rendered-paginated',
    )
    expect(requested.searchParams.get('cat')).toBe('1010')
    expect(requested.searchParams.get('cur')).toBe('USD')
    expect(requested.searchParams.get('gtsy')).toBe('country-belarus~province-minsk~locality-minsk')
    expect(requested.searchParams.get('lang')).toBe('ru')
    expect(requested.searchParams.get('sort')).toBe('lst.d')
    expect(requested.searchParams.get('typ')).toBe('sell')
    expect(requested.searchParams.get('size')).toBe('30')
    expect(requested.searchParams.has('cursor')).toBe(false)
    expect(result.listings[0]).toMatchObject({
      listId: '1079260955',
      priceAmount: '120000.00',
      currency: 'USD',
    })
  })

  it('passes an opaque cursor unchanged as transport state', async () => {
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-07-realestate-search-page-2.json'),
      headers: {},
      attempts: 1,
    })
    const adapter = new KufarRealEstateAdapter(http)

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
      body: new Uint8Array(),
      attempts: 1,
      message: 'bad request',
    },
    {
      ok: false,
      kind: 'rate-limited',
      code: 'rate-limited',
      status: 429,
      body: new Uint8Array(),
      attempts: 1,
      message: 'limited',
      retryAfterMs: 60_000,
    },
  ] satisfies Array<Extract<KufarHttpResult, { ok: false }>>)(
    'preserves classified $kind HTTP failures by identity',
    async (failure) => {
      const adapter = new KufarRealEstateAdapter(new FakeHttpGetter(failure))

      try {
        await adapter.fetchPage({ query, cursor: null })
        throw new Error('Expected real-estate adapter request to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(KufarRealEstateAdapterRequestError)
        expect((error as KufarRealEstateAdapterRequestError).result).toBe(failure)
      }
    },
  )
})
