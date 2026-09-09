import { describe, expect, it } from 'vitest'

import {
  listingCreateData,
  listingSearchUpdateData,
} from '../../electron/worker/listing-persistence-data'
import type { Listing } from '../../shared/listing'

const LISTING: Listing = {
  listId: 'listing-cache-owner',
  title: 'Search title',
  priceKind: 'fixed',
  priceAmount: '125.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/listing-cache-owner',
  region: 'minsk',
  accountId: 'account-search',
  isCompany: false,
  listTime: '2026-09-09T05:00:00.000Z',
  description: 'Short search snippet',
  raw: { source: 'search' },
}

describe('Listing search persistence ownership', () => {
  it('allows search data to initialize description when a Listing is created', () => {
    expect(listingCreateData(LISTING)).toMatchObject({
      listId: LISTING.listId,
      description: 'Short search snippet',
    })
  })

  it('does not let a later search update overwrite cache-owned fields', () => {
    const update = listingSearchUpdateData(LISTING)

    expect(Object.hasOwn(update, 'description')).toBe(false)
    expect(Object.hasOwn(update, 'descriptionLoadedAt')).toBe(false)
    expect(Object.hasOwn(update, 'availability')).toBe(false)
  })

  it('still refreshes ordinary search-owned fields', () => {
    expect(listingSearchUpdateData(LISTING)).toMatchObject({
      title: LISTING.title,
      priceKind: LISTING.priceKind,
      priceAmount: LISTING.priceAmount,
      accountId: LISTING.accountId,
      listTime: new Date(LISTING.listTime),
    })
  })
})
