import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  KufarNormalizationError,
  normalizeRealEstateSearchPage,
} from '../../electron/worker/kufar-realestate-normalizer'

type MutableRecord = Record<string, unknown>

interface MutablePage {
  ads: MutableRecord[]
  pagination: {
    pages: MutableRecord[]
  }
}

interface EmbeddedFixture {
  props: {
    initialState: {
      listing: {
        ads: MutableRecord[]
        pagination: MutableRecord[]
      }
    }
  }
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url)))
}

async function fixturePage(name = '2026-09-07-realestate-search-page-1.json') {
  return JSON.parse(new TextDecoder().decode(await fixtureBytes(name))) as MutablePage
}

async function embeddedFixturePage(
  name = '2026-09-08-realestate-search-page-2-embedded.html',
): Promise<MutablePage> {
  const html = new TextDecoder().decode(await fixtureBytes(name))
  const prefix = '<script id="__NEXT_DATA__" type="application/json">'
  const suffix = '</script>'
  const start = html.indexOf(prefix)
  const end = html.lastIndexOf(suffix)

  if (start < 0 || end < start) throw new Error('Expected __NEXT_DATA__ fixture script')

  const embedded = JSON.parse(html.slice(start + prefix.length, end)) as EmbeddedFixture
  const listing = embedded.props.initialState.listing

  return {
    ads: listing.ads,
    pagination: { pages: listing.pagination },
  }
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
    normalizeRealEstateSearchPage(body)
    throw new Error('Expected normalizeRealEstateSearchPage to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(KufarNormalizationError)
    expect(error).toMatchObject({ code, path })
  }
}

function eurCalculator(payload: MutablePage): MutableRecord {
  const calculator = payload.ads[0]?.calculator
  if (!Array.isArray(calculator)) throw new Error('Expected calculator array')

  const entry = calculator.find(
    (value) =>
      typeof value === 'object' && value !== null && (value as MutableRecord).currency === 'EUR',
  )
  if (typeof entry !== 'object' || entry === null) {
    throw new Error('Expected EUR calculator entry')
  }

  return entry as MutableRecord
}

describe('normalizeRealEstateSearchPage', () => {
  it('normalizes a USD real-estate listing from the confirmed page-1 fixture', async () => {
    const page = normalizeRealEstateSearchPage(
      await fixtureBytes('2026-09-07-realestate-search-page-1.json'),
    )

    expect(page.listings).toHaveLength(1)
    expect(page.listings[0]).toMatchObject({
      listId: '1079260955',
      title: 'Продаётся 2х комнатная квартира',
      priceKind: 'fixed',
      priceAmount: '120000.00',
      currency: 'USD',
      url: 'https://re.kufar.by/vi/1079260955',
      region: 'Минск',
      accountId: 'O-hFprVM71APwSdlXuP7sBY',
      isCompany: false,
      listTime: '2026-09-07T11:21:31Z',
      description:
        'Продается двухкомнатная квартира в самом сердце Минска! Квартира площадью 41 кв.м., расположена в кирпичном доме на 4-м этаже. Дом после капитального ',
    })
    expect(page.listings[0]?.raw).toMatchObject({
      ad_id: 1079260955,
      currency: 'USD',
      type: 'sell',
    })
    expect(page.nextCursor).toBe('eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTMwMDYifQ==')
  })

  it('normalizes BYR as domain BYN using price_byn on the confirmed page-2 fixture', async () => {
    const page = normalizeRealEstateSearchPage(
      await fixtureBytes('2026-09-07-realestate-search-page-2.json'),
    )

    expect(page.listings[0]).toMatchObject({
      listId: '1083434940',
      priceKind: 'fixed',
      priceAmount: '382850.00',
      currency: 'BYN',
      isCompany: true,
      region: 'Минск',
    })
    expect(page.nextCursor).toBe('eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTMwMDYifQ==')
  })

  it('normalizes live EUR real-estate price from the matching calculator entry', async () => {
    const page = normalizeRealEstateSearchPage(encodeJson(await embeddedFixturePage()))

    expect(page.listings[0]).toMatchObject({
      listId: '1083591450',
      priceKind: 'fixed',
      priceAmount: '117080.00',
      currency: 'EUR',
      isCompany: true,
      region: 'Минск',
    })
  })

  it('keeps the confirmed page-1 and page-2 listing IDs non-overlapping', async () => {
    const page1 = normalizeRealEstateSearchPage(
      await fixtureBytes('2026-09-07-realestate-search-page-1.json'),
    )
    const page2 = normalizeRealEstateSearchPage(
      await fixtureBytes('2026-09-07-realestate-search-page-2.json'),
    )
    const firstIds = new Set(page1.listings.map(({ listId }) => listId))

    expect(page2.listings.every(({ listId }) => !firstIds.has(listId))).toBe(true)
  })

  it('uses the response currency to select the matching real-estate price field', async () => {
    const payload = await fixturePage()
    if (payload.ads[0]) {
      payload.ads[0].currency = 'BYR'
      payload.ads[0].price_byn = '12345'
      payload.ads[0].price_usd = '999999'
    }

    expect(normalizeRealEstateSearchPage(encodeJson(payload)).listings[0]).toMatchObject({
      priceAmount: '123.45',
      currency: 'BYN',
    })
  })

  it('rejects an unconfirmed response currency instead of guessing a price source', async () => {
    const payload = await fixturePage()
    if (payload.ads[0]) payload.ads[0].currency = 'GBP'

    expectNormalizationError(encodeJson(payload), 'invalid-field', 'ads[0].currency')
  })

  it('requires calculator when EUR is the response currency', async () => {
    const payload = await embeddedFixturePage()
    delete payload.ads[0]?.calculator

    expectNormalizationError(encodeJson(payload), 'missing-field', 'ads[0].calculator')
  })

  it('requires a matching EUR calculator entry', async () => {
    const payload = await embeddedFixturePage()
    const calculator = payload.ads[0]?.calculator
    if (Array.isArray(calculator)) {
      payload.ads[0]!.calculator = calculator.filter(
        (value) =>
          !(
            typeof value === 'object' &&
            value !== null &&
            (value as MutableRecord).currency === 'EUR'
          ),
      )
    }

    expectNormalizationError(encodeJson(payload), 'missing-field', 'ads[0].calculator[EUR]')
  })

  it('requires a digit-only EUR calculator price', async () => {
    const payload = await embeddedFixturePage()
    eurCalculator(payload).price = 'not-a-price'

    expectNormalizationError(encodeJson(payload), 'invalid-field', 'ads[0].calculator[EUR].price')
  })

  it('requires the currency-selected price field with its exact path', async () => {
    const payload = await fixturePage()
    delete payload.ads[0]?.price_usd

    expectNormalizationError(encodeJson(payload), 'missing-field', 'ads[0].price_usd')
  })
})
