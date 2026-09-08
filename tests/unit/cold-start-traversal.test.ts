import { describe, expect, it, vi } from 'vitest'

import {
  IncompleteColdStartBaselineError,
  traverseColdStartBaseline,
} from '../../electron/worker/cold-start-traversal'
import {
  WatermarkOrderingError,
  WatermarkTraversalConfigError,
} from '../../electron/worker/watermark-traversal'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'

const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones'],
  extraParams: {},
}

const STARTED_AT = new Date('2026-09-08T12:00:00.000Z')

function listing(listId: string, listTime: string): Listing {
  return {
    listId,
    title: listId,
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/${listId}`,
    region: 'minsk',
    accountId: null,
    isCompany: false,
    listTime,
    description: null,
    raw: { fixture: listId },
  }
}

function adapterForPages(pages: Array<{ listings: Listing[]; nextCursor: string | null }>): {
  adapter: SourceAdapter
  fetchPage: ReturnType<typeof vi.fn>
} {
  const fetchPage = vi.fn()
  pages.forEach((page) => fetchPage.mockResolvedValueOnce(page))
  return { adapter: { fetchPage } as SourceAdapter, fetchPage }
}

describe('traverseColdStartBaseline', () => {
  it('completes on the first page once an item is older than the top timestamp', async () => {
    const topTime = '2026-09-08T11:59:00.000Z'
    const topA = listing('top-a', topTime)
    const topB = listing('top-b', topTime)
    const older = listing('older', '2026-09-08T11:58:00.000Z')
    const { adapter, fetchPage } = adapterForPages([
      { listings: [topA, topB, older], nextCursor: 'page-2' },
    ])

    const result = await traverseColdStartBaseline({
      adapter,
      query: QUERY,
      maxPages: 3,
      startedAt: STARTED_AT,
    })

    expect(result).toEqual({
      listings: [topA, topB, older],
      baselineCount: 3,
      pagesRead: 1,
      nextWatermark: {
        boundaryTime: topTime,
        boundaryIds: ['top-a', 'top-b'],
      },
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith({ query: QUERY, cursor: null })
  })

  it('reads only enough pages to close a top-time tie and keeps the whole closing page', async () => {
    const topTime = '2026-09-08T11:59:00.000Z'
    const topA = listing('top-a', topTime)
    const topB = listing('top-b', topTime)
    const topC = listing('top-c', topTime)
    const olderA = listing('older-a', '2026-09-08T11:58:00.000Z')
    const olderB = listing('older-b', '2026-09-08T11:57:00.000Z')
    const { adapter, fetchPage } = adapterForPages([
      { listings: [topA, topB], nextCursor: 'page-2' },
      { listings: [topC, olderA, olderB], nextCursor: 'page-3' },
    ])

    const result = await traverseColdStartBaseline({
      adapter,
      query: QUERY,
      maxPages: 5,
      startedAt: STARTED_AT,
    })

    expect(result.listings).toEqual([topA, topB, topC, olderA, olderB])
    expect(result.baselineCount).toBe(5)
    expect(result.pagesRead).toBe(2)
    expect(result.nextWatermark).toEqual({
      boundaryTime: topTime,
      boundaryIds: ['top-a', 'top-b', 'top-c'],
    })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual([null, 'page-2'])
  })

  it('deduplicates listings across baseline pages', async () => {
    const topTime = '2026-09-08T11:59:00.000Z'
    const topA = listing('top-a', topTime)
    const topB = listing('top-b', topTime)
    const older = listing('older', '2026-09-08T11:58:00.000Z')
    const { adapter } = adapterForPages([
      { listings: [topA], nextCursor: 'page-2' },
      { listings: [topA, topB, older], nextCursor: null },
    ])

    const result = await traverseColdStartBaseline({
      adapter,
      query: QUERY,
      maxPages: 3,
      startedAt: STARTED_AT,
    })

    expect(result.listings).toEqual([topA, topB, older])
    expect(result.baselineCount).toBe(3)
    expect(result.nextWatermark.boundaryIds).toEqual(['top-a', 'top-b'])
  })

  it('uses the cold-start start time as the watermark for an empty first page', async () => {
    const { adapter, fetchPage } = adapterForPages([
      { listings: [], nextCursor: 'unexpected-next-page' },
    ])

    const result = await traverseColdStartBaseline({
      adapter,
      query: QUERY,
      maxPages: 3,
      startedAt: STARTED_AT,
    })

    expect(result).toEqual({
      listings: [],
      baselineCount: 0,
      pagesRead: 1,
      nextWatermark: {
        boundaryTime: STARTED_AT.toISOString(),
        boundaryIds: [],
      },
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('completes a still-tied baseline when the source has no next page', async () => {
    const topTime = '2026-09-08T11:59:00.000Z'
    const topA = listing('top-a', topTime)
    const topB = listing('top-b', topTime)
    const { adapter } = adapterForPages([{ listings: [topA, topB], nextCursor: null }])

    const result = await traverseColdStartBaseline({
      adapter,
      query: QUERY,
      maxPages: 1,
      startedAt: STARTED_AT,
    })

    expect(result.nextWatermark).toEqual({
      boundaryTime: topTime,
      boundaryIds: ['top-a', 'top-b'],
    })
    expect(result.baselineCount).toBe(2)
  })

  it('rejects an incomplete top-time tie at maxPages instead of returning a watermark', async () => {
    const topTime = '2026-09-08T11:59:00.000Z'
    const { adapter } = adapterForPages([
      { listings: [listing('top-a', topTime)], nextCursor: 'page-2' },
      { listings: [listing('top-b', topTime)], nextCursor: 'page-3' },
    ])

    await expect(
      traverseColdStartBaseline({
        adapter,
        query: QUERY,
        maxPages: 2,
        startedAt: STARTED_AT,
      }),
    ).rejects.toBeInstanceOf(IncompleteColdStartBaselineError)
  })

  it('rejects source ordering that becomes newer after an older observation', async () => {
    const { adapter } = adapterForPages([
      {
        listings: [
          listing('newer-first', '2026-09-08T11:59:00.000Z'),
          listing('older', '2026-09-08T11:58:00.000Z'),
          listing('newer-again', '2026-09-08T11:58:30.000Z'),
        ],
        nextCursor: null,
      },
    ])

    await expect(
      traverseColdStartBaseline({
        adapter,
        query: QUERY,
        maxPages: 2,
        startedAt: STARTED_AT,
      }),
    ).rejects.toBeInstanceOf(WatermarkOrderingError)
  })

  it.each([0, -1, 1.5])(
    'rejects invalid maxPages=%s before reading the source',
    async (maxPages) => {
      const { adapter, fetchPage } = adapterForPages([])

      await expect(
        traverseColdStartBaseline({
          adapter,
          query: QUERY,
          maxPages,
          startedAt: STARTED_AT,
        }),
      ).rejects.toBeInstanceOf(WatermarkTraversalConfigError)

      expect(fetchPage).not.toHaveBeenCalled()
    },
  )
})
