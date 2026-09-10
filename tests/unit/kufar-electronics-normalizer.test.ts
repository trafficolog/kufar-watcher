import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  KufarNormalizationError,
  normalizeElectronicsSearchPage,
} from '../../electron/worker/kufar-electronics-normalizer'

type MutableRecord = Record<string, unknown>

interface MutablePage {
  ads: MutableRecord[]
  pagination: {
    pages: MutableRecord[]
  }
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

async function fixturePage(name = '2026-09-07-electronics-search-page-1.json') {
  return JSON.parse(new TextDecoder().decode(await fixtureBytes(name))) as MutablePage
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function expectNormalizationError(
  body: Uint8Array,
  code: KufarNormalizationError['code'],
  path: string,
): void {
  try {
    normalizeElectronicsSearchPage(body)
    throw new Error('Expected normalizeElectronicsSearchPage to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(KufarNormalizationError)
    expect(error).toMatchObject({ code, path })
  }
}

describe('normalizeElectronicsSearchPage', () => {
  it('normalizes the confirmed page-1 fixture into Listing values', async () => {
    const page = normalizeElectronicsSearchPage(
      await fixtureBytes('2026-09-07-electronics-search-page-1.json'),
    )

    expect(page.listings).toHaveLength(2)
    expect(page.listings[0]).toMatchObject({
      listId: '1084212880',
      title: '007 First Light PS5 Игра',
      priceKind: 'fixed',
      priceAmount: '180.00',
      currency: 'BYN',
      url: 'https://www.kufar.by/item/1084212880',
      region: 'Минск',
      accountId: 'O7rIEl9s3ROIilr9xxUsVlI',
      isCompany: false,
      listTime: '2026-09-07T08:08:34Z',
      description: null,
    })
    expect(page.listings[0]?.raw).toMatchObject({ ad_id: 1084212880 })
    expect(page.nextCursor).toBe('eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTI4MTQifQ==')
  })

  it('normalizes zero electronics price as negotiable without a numeric amount', async () => {
    const page = normalizeElectronicsSearchPage(
      await fixtureBytes('2026-09-07-electronics-negotiable.json'),
    )

    expect(page.listings[0]).toMatchObject({
      listId: '1082715190',
      priceKind: 'negotiable',
      priceAmount: null,
      currency: null,
    })
  })

  it('extracts page-2 cursor by label and keeps page IDs non-overlapping', async () => {
    const page1 = normalizeElectronicsSearchPage(
      await fixtureBytes('2026-09-07-electronics-search-page-1.json'),
    )
    const page2 = normalizeElectronicsSearchPage(
      await fixtureBytes('2026-09-07-electronics-search-page-2.json'),
    )
    const firstIds = new Set(page1.listings.map(({ listId }) => listId))

    expect(page2.listings.every(({ listId }) => !firstIds.has(listId))).toBe(true)
    expect(page2.nextCursor).toBe('eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTI4MTQifQ==')
  })

  it('returns null cursor when pagination has no next entry', async () => {
    const payload = await fixturePage()
    payload.pagination.pages = payload.pagination.pages.filter((page) => page.label !== 'next')

    expect(normalizeElectronicsSearchPage(encodeJson(payload)).nextCursor).toBeNull()
  })

  it('returns null cursor when the next pagination token is explicitly null', async () => {
    const payload = await fixturePage()
    const next = payload.pagination.pages.find((page) => page.label === 'next')
    if (next) next.token = null

    expect(normalizeElectronicsSearchPage(encodeJson(payload)).nextCursor).toBeNull()
  })

  it('falls back to the canonical item URL when ad_link is absent', async () => {
    const payload = await fixturePage()
    delete payload.ads[0]?.ad_link

    expect(normalizeElectronicsSearchPage(encodeJson(payload)).listings[0]?.url).toBe(
      'https://www.kufar.by/item/1084212880',
    )
  })

  it('reports invalid JSON at the root path', () => {
    expectNormalizationError(new TextEncoder().encode('{not-json'), 'invalid-json', '$')
  })

  it('reports an invalid root page shape', () => {
    expectNormalizationError(encodeJson([]), 'invalid-page', '$')
  })

  it('reports missing and invalid page collections precisely', () => {
    expectNormalizationError(encodeJson({ pagination: { pages: [] } }), 'missing-field', 'ads')
    expectNormalizationError(
      encodeJson({ ads: {}, pagination: { pages: [] } }),
      'invalid-field',
      'ads',
    )
    expectNormalizationError(encodeJson({ ads: [] }), 'missing-field', 'pagination.pages')
    expectNormalizationError(
      encodeJson({ ads: [], pagination: { pages: {} } }),
      'invalid-field',
      'pagination.pages',
    )
  })

  it('reports missing required ad fields with their exact path', async () => {
    const cases = [
      ['ad_id', 'ads[0].ad_id'],
      ['account_id', 'ads[0].account_id'],
    ] as const

    for (const [field, path] of cases) {
      const payload = await fixturePage()
      delete payload.ads[0]?.[field]
      expectNormalizationError(encodeJson(payload), 'missing-field', path)
    }
  })

  it('reports invalid required ad field values with their exact path', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['subject', '', 'ads[0].subject'],
      ['list_time', 'not-a-date', 'ads[0].list_time'],
      ['price_byn', '12.5', 'ads[0].price_byn'],
      ['currency', 'USD', 'ads[0].currency'],
      ['company_ad', 'false', 'ads[0].company_ad'],
    ]

    for (const [field, value, path] of cases) {
      const payload = await fixturePage()
      if (payload.ads[0]) payload.ads[0][field] = value
      expectNormalizationError(encodeJson(payload), 'invalid-field', path)
    }
  })

  it('rejects a foreign ad_link instead of trusting it', async () => {
    const payload = await fixturePage()
    if (payload.ads[0]) payload.ads[0].ad_link = 'https://example.com/item/1084212880'

    expectNormalizationError(encodeJson(payload), 'invalid-field', 'ads[0].ad_link')
  })

  it('requires a string token when a next pagination entry exists', async () => {
    const payload = await fixturePage()
    const next = payload.pagination.pages.find((page) => page.label === 'next')
    if (next) next.token = 2

    expectNormalizationError(encodeJson(payload), 'invalid-field', 'pagination.pages[next].token')
  })
})
