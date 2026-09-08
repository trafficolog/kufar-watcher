import { describe, expect, it } from 'vitest'

import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'

const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: null,
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

const listing: Listing = {
  listId: '123',
  title: 'PlayStation 5',
  priceKind: 'fixed',
  priceAmount: '1299.90',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/123',
  region: 'Минск',
  accountId: null,
  isCompany: null,
  listTime: '2026-09-08T10:15:30.000Z',
  description: null,
  raw: { ad_id: 123, flags: ['featured'] },
}

function adapterFor(nextCursor: string | null): SourceAdapter {
  return {
    async fetchPage(request) {
      expect(request.query).toBe(query)
      return { listings: [listing], nextCursor }
    },
  }
}

describe('SourceAdapter shared contract', () => {
  it('allows electronics and real-estate stubs to implement the same contract', async () => {
    const electronics = adapterFor('opaque-next')
    const realEstate = adapterFor(null)

    await expect(electronics.fetchPage({ query, cursor: null })).resolves.toEqual({
      listings: [listing],
      nextCursor: 'opaque-next',
    })
    await expect(realEstate.fetchPage({ query, cursor: 'opaque-input' })).resolves.toEqual({
      listings: [listing],
      nextCursor: null,
    })
  })

  it('keeps exact decimal price and JSON-safe raw data in Listing', () => {
    expect(listing.priceAmount).toBe('1299.90')
    expect(listing.listTime).toBe('2026-09-08T10:15:30.000Z')
    expect(listing.raw).toEqual({ ad_id: 123, flags: ['featured'] })
  })
})
