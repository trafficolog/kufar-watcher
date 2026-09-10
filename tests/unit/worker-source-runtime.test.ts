import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'
import type { KufarRawResponseSnapshot } from '../../electron/worker/kufar-raw-response-journal'
import { createWorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import { parseKufarListingUrl } from '../../shared/kufar-url'

const electronicsQuery = parseKufarListingUrl(
  'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
)
const realEstateQuery = parseKufarListingUrl('https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD')
const fakeSnapshot: KufarRawResponseSnapshot = {
  version: 1,
  id: 'snapshot-1',
  endpoint: 'api.kufar.by/search-api/v2/search/rendered-paginated',
  requestUrl: 'https://api.kufar.by/search-api/v2/search/rendered-paginated',
  status: 200,
  capturedAt: '2026-09-10T00:00:00.000Z',
  bodyBase64: '',
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function fakeJournal() {
  return { record: vi.fn(async () => fakeSnapshot) }
}

describe('worker source runtime', () => {
  it('composes both source adapters around one shared HTTP client and closes it once', async () => {
    const electronicsBody = await fixtureBytes('2026-09-07-electronics-search-page-1.json')
    const realEstateBody = await fixtureBytes('2026-09-07-realestate-search-page-1.json')
    const journal = fakeJournal()
    const http = {
      get: vi.fn(async (input: string | URL): Promise<KufarHttpResult> => {
        const url = new URL(input)
        return {
          ok: true,
          status: 200,
          body: url.searchParams.get('cat') === '1010' ? realEstateBody : electronicsBody,
          headers: {},
          attempts: 1,
        }
      }),
      close: vi.fn(async () => undefined),
    }
    const createJournal = vi.fn(() => journal)
    const createHttpClient = vi.fn(() => http)
    const runtime = createWorkerSourceRuntime(
      {
        prisma: {} as PrismaClient,
        rawResponseJournalDir: '/tmp/kufar-journal',
        onDegradation: vi.fn(),
      },
      { createJournal, createHttpClient },
    )

    const electronicsPage = await runtime.adapters
      .get('electronics')
      .fetchPage({ query: electronicsQuery, cursor: null })
    const realEstatePage = await runtime.adapters
      .get('real-estate')
      .fetchPage({ query: realEstateQuery, cursor: null })

    expect(createJournal).toHaveBeenCalledOnce()
    expect(createJournal).toHaveBeenCalledWith('/tmp/kufar-journal')
    expect(createHttpClient).toHaveBeenCalledOnce()
    expect(createHttpClient).toHaveBeenCalledWith(expect.objectContaining({ journal }))
    expect(http.get).toHaveBeenCalledTimes(2)
    expect(electronicsPage.listings.length).toBeGreaterThan(0)
    expect(realEstatePage.listings.length).toBeGreaterThan(0)
    expect(runtime.descriptionLoader).toBeTruthy()

    await runtime.close()
    await runtime.close()
    expect(http.close).toHaveBeenCalledOnce()
  })

  it('awaits degradation publication before returning an HTML fallback page', async () => {
    const fallbackBody = await fixtureBytes('2026-09-08-electronics-search-page-1-embedded.html')
    const degradationGate = deferred<undefined>()
    const onDegradation = vi.fn(async () => degradationGate.promise)
    const http = {
      get: vi.fn(async (input: string | URL): Promise<KufarHttpResult> => {
        const url = new URL(input)
        if (url.host === 'api.kufar.by') {
          return {
            ok: false,
            kind: 'temporary',
            code: 'network',
            status: null,
            attempts: 3,
            message: 'network failure',
          }
        }
        return {
          ok: true,
          status: 200,
          body: fallbackBody,
          headers: {},
          attempts: 1,
        }
      }),
      close: vi.fn(async () => undefined),
    }
    const runtime = createWorkerSourceRuntime(
      {
        prisma: {} as PrismaClient,
        rawResponseJournalDir: '/tmp/kufar-journal',
        onDegradation,
      },
      {
        createJournal: fakeJournal,
        createHttpClient: () => http,
      },
    )

    let settled = false
    const pagePromise = runtime.adapters
      .get('electronics')
      .fetchPage({ query: electronicsQuery, cursor: null })
      .then((page) => {
        settled = true
        return page
      })

    await vi.waitFor(() => {
      expect(onDegradation).toHaveBeenCalledWith('Kufar source degraded to HTML fallback')
    })
    expect(settled).toBe(false)

    degradationGate.resolve(undefined)
    const page = await pagePromise

    expect(page.listings[0]?.listId).toBe('1084343116')
    expect(settled).toBe(true)
  })
})
