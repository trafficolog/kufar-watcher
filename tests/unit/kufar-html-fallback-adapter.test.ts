import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import type { SourceAdapter, SourcePage } from '../../shared/source-adapter'
import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'
import { normalizeElectronicsSearchPage } from '../../electron/worker/kufar-electronics-normalizer'
import { normalizeRealEstateSearchPage } from '../../electron/worker/kufar-realestate-normalizer'
import { parseKufarListingUrl } from '../../shared/kufar-url'

interface HtmlFallbackRequestError extends Error {
  result: Extract<KufarHttpResult, { ok: false }>
}

interface HtmlFallbackModule {
  KufarHtmlFallbackRequestError: new (...args: never[]) => HtmlFallbackRequestError
  KufarHtmlFallbackAdapter: new (
    httpClient: FakeHttpGetter,
    normalizePage: (body: Uint8Array) => SourcePage,
  ) => SourceAdapter
}

const electronicsQuery = parseKufarListingUrl(
  'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
)
const realEstateQuery = parseKufarListingUrl('https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD')

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

async function loadModule(): Promise<HtmlFallbackModule> {
  let loaded: unknown
  try {
    loaded = await vi.importActual('../../electron/worker/kufar-html-fallback-adapter')
  } catch {
    loaded = undefined
  }

  expect(loaded, 'HTML fallback adapter module must exist').toBeTruthy()
  return loaded as HtmlFallbackModule
}

class FakeHttpGetter {
  readonly calls: URL[] = []

  constructor(private readonly result: KufarHttpResult) {}

  async get(url: string | URL): Promise<KufarHttpResult> {
    this.calls.push(new URL(url))
    return this.result
  }
}

describe('KufarHtmlFallbackAdapter', () => {
  it('uses the user-facing Electronics listing URL and normalizes saved HTML', async () => {
    const module = await loadModule()
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-08-electronics-search-page-1-embedded.html'),
      headers: {},
      attempts: 1,
    })
    const adapter = new module.KufarHtmlFallbackAdapter(http, normalizeElectronicsSearchPage)

    const page = await adapter.fetchPage({ query: electronicsQuery, cursor: null })

    expect(http.calls).toHaveLength(1)
    const requested = http.calls[0]!
    expect(requested.origin + requested.pathname).toBe(
      'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
    )
    expect(requested.searchParams.get('size')).toBe('30')
    expect(requested.searchParams.has('cursor')).toBe(false)
    expect(page.listings[0]?.listId).toBe('1084343116')
    expect(page.nextCursor).toBe(
      'eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjYifQ==',
    )
  })

  it('preserves the Real Estate listing route and semantic query params', async () => {
    const module = await loadModule()
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-08-realestate-search-page-1-embedded.html'),
      headers: {},
      attempts: 1,
    })
    const adapter = new module.KufarHtmlFallbackAdapter(http, normalizeRealEstateSearchPage)

    const page = await adapter.fetchPage({ query: realEstateQuery, cursor: null })

    const requested = http.calls[0]!
    expect(requested.origin + requested.pathname).toBe('https://re.kufar.by/l/minsk/kupit/kvartiru')
    expect(requested.searchParams.get('cur')).toBe('USD')
    expect(requested.searchParams.get('size')).toBe('30')
    expect(requested.searchParams.has('cursor')).toBe(false)
    expect(page.listings[0]?.listId).toBe('1075499901')
    expect(page.nextCursor).not.toBeNull()
  })

  it('passes the opaque HTML cursor unchanged without decoding it', async () => {
    const module = await loadModule()
    const http = new FakeHttpGetter({
      ok: true,
      status: 200,
      body: await fixtureBytes('2026-09-08-electronics-search-page-2-embedded.html'),
      headers: {},
      attempts: 1,
    })
    const adapter = new module.KufarHtmlFallbackAdapter(http, normalizeElectronicsSearchPage)

    await adapter.fetchPage({ query: electronicsQuery, cursor: 'opaque+/=token' })

    expect(http.calls[0]?.searchParams.get('cursor')).toBe('opaque+/=token')
    expect(http.calls[0]?.searchParams.get('size')).toBe('30')
  })

  it('preserves classified HTTP failures by exact result identity', async () => {
    const module = await loadModule()
    const failure = {
      ok: false,
      kind: 'temporary',
      code: 'http-5xx',
      status: 503,
      attempts: 3,
      message: 'upstream unavailable',
    } satisfies Extract<KufarHttpResult, { ok: false }>
    const adapter = new module.KufarHtmlFallbackAdapter(
      new FakeHttpGetter(failure),
      normalizeElectronicsSearchPage,
    )

    try {
      await adapter.fetchPage({ query: electronicsQuery, cursor: null })
      throw new Error('Expected HTML fallback request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(module.KufarHtmlFallbackRequestError)
      expect((error as HtmlFallbackRequestError).result).toBe(failure)
    }
  })
})
