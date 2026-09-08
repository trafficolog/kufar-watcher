import { describe, expect, it, vi } from 'vitest'

import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import type { Watermark } from '../../shared/watermark'
import {
  traverseWatermark,
  type WatermarkTraversalConfigError,
} from '../../electron/worker/watermark-traversal'

const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

const previousWatermark: Watermark = {
  boundaryTime: '2026-09-08T10:00:00.000Z',
  boundaryIds: ['known-a'],
}

function listing(listId: string, listTime: string): Listing {
  return {
    listId,
    title: `Listing ${listId}`,
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/${listId}`,
    region: 'Минск',
    accountId: null,
    isCompany: false,
    listTime,
    description: null,
    raw: { ad_id: listId },
  }
}

function adapterFromPages(pages: readonly SourcePage[]) {
  let index = 0
  const fetchPage = vi.fn(async (_request: SourcePageRequest): Promise<SourcePage> => {
    const page = pages[index]
    if (page === undefined) throw new Error(`Unexpected page request ${index + 1}`)
    index += 1
    return page
  })
  return { fetchPage } satisfies SourceAdapter
}

function ids(listings: readonly Listing[]): string[] {
  return listings.map(({ listId }) => listId)
}

describe('watermark traversal core behavior', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxPages=%s before fetching',
    async (maxPages) => {
      const adapter = adapterFromPages([])

      await expect(
        traverseWatermark({ adapter, query, previousWatermark, maxPages }),
      ).rejects.toMatchObject({
        name: 'WatermarkTraversalConfigError',
        field: 'maxPages',
        value: maxPages,
      } satisfies Partial<WatermarkTraversalConfigError>)
      expect(adapter.fetchPage).not.toHaveBeenCalled()
    },
  )

  it('rejects an invalid previous boundary time before fetching', async () => {
    const adapter = adapterFromPages([])

    await expect(
      traverseWatermark({
        adapter,
        query,
        previousWatermark: { boundaryTime: 'not-a-time', boundaryIds: ['known-a'] },
        maxPages: 3,
      }),
    ).rejects.toMatchObject({
      name: 'WatermarkTraversalConfigError',
      field: 'previousWatermark.boundaryTime',
      value: 'not-a-time',
    } satisfies Partial<WatermarkTraversalConfigError>)
    expect(adapter.fetchPage).not.toHaveBeenCalled()
  })

  it('returns no new listings when the previous boundary is reached', async () => {
    const adapter = adapterFromPages([
      {
        listings: [
          listing('known-a', '2026-09-08T10:00:00.000Z'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])

    await expect(
      traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 }),
    ).resolves.toEqual({
      newListings: [],
      nextWatermark: previousWatermark,
      pagesRead: 1,
      possibleMiss: false,
    })
  })

  it('returns newer listings in source order and advances to the maximum time', async () => {
    const adapter = adapterFromPages([
      {
        listings: [
          listing('n2', '2026-09-08T10:02:00.000Z'),
          listing('n1', '2026-09-08T10:01:00.000Z'),
          listing('known-a', '2026-09-08T10:00:00.000Z'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])

    const result = await traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 })

    expect(ids(result.newListings)).toEqual(['n2', 'n1'])
    expect(result.nextWatermark).toEqual({
      boundaryTime: '2026-09-08T10:02:00.000Z',
      boundaryIds: ['n2'],
    })
    expect(result.pagesRead).toBe(1)
    expect(result.possibleMiss).toBe(false)
  })

  it('keeps every id observed at the new maximum instant', async () => {
    const adapter = adapterFromPages([
      {
        listings: [
          listing('n2', '2026-09-08T10:02:00.000Z'),
          listing('n3', '2026-09-08T10:02:00.000Z'),
          listing('n1', '2026-09-08T10:01:00.000Z'),
        ],
        nextCursor: null,
      },
    ])

    const result = await traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 })

    expect(ids(result.newListings)).toEqual(['n2', 'n3', 'n1'])
    expect(result.nextWatermark).toEqual({
      boundaryTime: '2026-09-08T10:02:00.000Z',
      boundaryIds: ['n2', 'n3'],
    })
    expect(result.possibleMiss).toBe(false)
  })

  it('leaves the watermark unchanged on an empty terminal source', async () => {
    const adapter = adapterFromPages([{ listings: [], nextCursor: null }])

    await expect(
      traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 }),
    ).resolves.toEqual({
      newListings: [],
      nextWatermark: previousWatermark,
      pagesRead: 1,
      possibleMiss: false,
    })
  })

  it('processes the entire equal-time boundary and unions newly observed ids', async () => {
    const boundary: Watermark = {
      boundaryTime: '2026-09-08T10:00:00.000Z',
      boundaryIds: ['known-a', 'known-b'],
    }
    const adapter = adapterFromPages([
      {
        listings: [
          listing('known-a', '2026-09-08T10:00:00.000Z'),
          listing('new-a', '2026-09-08T10:00:00.000Z'),
          listing('known-b', '2026-09-08T10:00:00.000Z'),
          listing('new-b', '2026-09-08T10:00:00.000Z'),
          listing('new-c', '2026-09-08T10:00:00.000Z'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])

    const result = await traverseWatermark({
      adapter,
      query,
      previousWatermark: boundary,
      maxPages: 3,
    })

    expect(ids(result.newListings)).toEqual(['new-a', 'new-b', 'new-c'])
    expect(result.nextWatermark).toEqual({
      boundaryTime: boundary.boundaryTime,
      boundaryIds: ['known-a', 'known-b', 'new-a', 'new-b', 'new-c'],
    })
  })

  it('does not move the watermark backward when the old boundary listing disappeared', async () => {
    const adapter = adapterFromPages([
      {
        listings: [listing('older', '2026-09-08T09:59:00.000Z')],
        nextCursor: 'must-not-matter-after-boundary-crossing',
      },
    ])

    await expect(
      traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 }),
    ).resolves.toEqual({
      newListings: [],
      nextWatermark: previousWatermark,
      pagesRead: 1,
      possibleMiss: false,
    })
  })

  it('compares equivalent ISO offset spellings as the same temporal boundary', async () => {
    const boundary: Watermark = {
      boundaryTime: '2026-09-08T10:00:00.000Z',
      boundaryIds: ['known-offset'],
    }
    const adapter = adapterFromPages([
      {
        listings: [
          listing('known-offset', '2026-09-08T12:00:00.000+02:00'),
          listing('new-offset', '2026-09-08T12:00:00.000+02:00'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])

    const result = await traverseWatermark({
      adapter,
      query,
      previousWatermark: boundary,
      maxPages: 3,
    })

    expect(ids(result.newListings)).toEqual(['new-offset'])
    expect(result.nextWatermark).toEqual({
      boundaryTime: boundary.boundaryTime,
      boundaryIds: ['known-offset', 'new-offset'],
    })
  })
})
