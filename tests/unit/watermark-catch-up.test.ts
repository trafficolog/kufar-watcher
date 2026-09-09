import { describe, expect, it, vi } from 'vitest'

import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter, SourcePage } from '../../shared/source-adapter'
import type { Watermark, WatermarkCatchUpCheckpoint } from '../../shared/watermark'
import { traverseColdStartBaseline } from '../../electron/worker/cold-start-traversal'
import {
  WatermarkListingTimeError,
  WatermarkOrderingError,
  traverseWatermark,
  type WatermarkCatchUpResumeError,
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

function cursorAdapter(pages: Record<string, SourcePage>): SourceAdapter & {
  fetchPage: ReturnType<typeof vi.fn>
} {
  const fetchPage = vi.fn(async ({ cursor }: { cursor: string | null }) => {
    const key = cursor ?? '<top>'
    const page = pages[key]
    if (page === undefined) throw new Error(`Unexpected cursor: ${key}`)
    return page
  })

  return { fetchPage }
}

function ids(listings: readonly Listing[]): string[] {
  return listings.map((item) => item.listId)
}

describe('persistent watermark catch-up traversal', () => {
  it('returns an opaque resume checkpoint at the page cap and completes from it later', async () => {
    const firstAdapter = cursorAdapter({
      '<top>': {
        listings: [
          listing('n5', '2026-09-08T10:05:00.000Z'),
          listing('n4', '2026-09-08T10:04:00.000Z'),
        ],
        nextCursor: 'page-2',
      },
      'page-2': {
        listings: [
          listing('n3', '2026-09-08T10:03:00.000Z'),
          listing('n2', '2026-09-08T10:02:00.000Z'),
        ],
        nextCursor: 'page-3',
      },
    })

    const first = await traverseWatermark({
      adapter: firstAdapter,
      query,
      previousWatermark,
      maxPages: 2,
    })

    expect(first.possibleMiss).toBe(true)
    if (!first.possibleMiss) throw new Error('Expected incomplete traversal')
    expect(ids(first.newListings)).toEqual(['n5', 'n4', 'n3', 'n2'])
    expect(first.nextWatermark).toBe(previousWatermark)
    expect(first.checkpoint).toEqual({
      resumeCursor: 'page-3',
      pendingWatermark: {
        boundaryTime: '2026-09-08T10:05:00.000Z',
        boundaryIds: ['n5'],
      },
      pagesRead: 2,
      lastObservation: {
        page: 2,
        index: 1,
        listId: 'n2',
        listTime: '2026-09-08T10:02:00.000Z',
      },
    })

    const secondAdapter = cursorAdapter({
      'page-3': {
        listings: [
          listing('n1', '2026-09-08T10:01:00.000Z'),
          listing('known-a', '2026-09-08T10:00:00.000Z'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: 'unused',
      },
    })

    const second = await traverseWatermark({
      adapter: secondAdapter,
      query,
      previousWatermark,
      maxPages: 2,
      checkpoint: first.checkpoint,
    })

    expect(second.possibleMiss).toBe(false)
    expect(ids(second.newListings)).toEqual(['n1'])
    expect(second.nextWatermark).toEqual(first.checkpoint.pendingWatermark)
    expect(second.pagesRead).toBe(1)
    expect(secondAdapter.fetchPage).toHaveBeenCalledTimes(1)
    expect(secondAdapter.fetchPage.mock.calls[0]?.[0].cursor).toBe('page-3')
  })

  it('merges maximum-time ids when the top-time tie spans catch-up chunks', async () => {
    const first = await traverseWatermark({
      adapter: cursorAdapter({
        '<top>': {
          listings: [listing('top-a', '2026-09-08T10:05:00.000Z')],
          nextCursor: 'page-2',
        },
      }),
      query,
      previousWatermark,
      maxPages: 1,
    })

    expect(first.possibleMiss).toBe(true)
    if (!first.possibleMiss) throw new Error('Expected incomplete traversal')

    const second = await traverseWatermark({
      adapter: cursorAdapter({
        'page-2': {
          listings: [
            listing('top-b', '2026-09-08T10:05:00.000Z'),
            listing('n4', '2026-09-08T10:04:00.000Z'),
            listing('known-a', '2026-09-08T10:00:00.000Z'),
            listing('old', '2026-09-08T09:59:00.000Z'),
          ],
          nextCursor: null,
        },
      }),
      query,
      previousWatermark,
      maxPages: 2,
      checkpoint: first.checkpoint,
    })

    expect(second.possibleMiss).toBe(false)
    expect(second.nextWatermark).toEqual({
      boundaryTime: '2026-09-08T10:05:00.000Z',
      boundaryIds: ['top-a', 'top-b'],
    })
  })

  it('validates source ordering across a persisted checkpoint boundary', async () => {
    const checkpoint: WatermarkCatchUpCheckpoint = {
      resumeCursor: 'page-2',
      pendingWatermark: {
        boundaryTime: '2026-09-08T10:05:00.000Z',
        boundaryIds: ['top'],
      },
      pagesRead: 1,
      lastObservation: {
        page: 1,
        index: 1,
        listId: 'n2',
        listTime: '2026-09-08T10:02:00.000Z',
      },
    }

    await expect(
      traverseWatermark({
        adapter: cursorAdapter({
          'page-2': {
            listings: [listing('out-of-order', '2026-09-08T10:03:00.000Z')],
            nextCursor: null,
          },
        }),
        query,
        previousWatermark,
        maxPages: 2,
        checkpoint,
      }),
    ).rejects.toBeInstanceOf(WatermarkOrderingError)
  })

  it('rejects malformed listing timestamps before they enter watermark comparisons', async () => {
    await expect(
      traverseWatermark({
        adapter: cursorAdapter({
          '<top>': {
            listings: [listing('broken-time', 'not-a-time')],
            nextCursor: null,
          },
        }),
        query,
        previousWatermark,
        maxPages: 2,
      }),
    ).rejects.toBeInstanceOf(WatermarkListingTimeError)
  })

  it('uses the same malformed timestamp guard during cold start', async () => {
    await expect(
      traverseColdStartBaseline({
        adapter: cursorAdapter({
          '<top>': {
            listings: [listing('broken-time', 'not-a-time')],
            nextCursor: null,
          },
        }),
        query,
        maxPages: 2,
        startedAt: new Date('2026-09-08T11:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(WatermarkListingTimeError)
  })

  it('wraps a source failure while resuming so orchestration can discard the stale cursor', async () => {
    const sourceError = new Error('cursor expired')
    const adapter: SourceAdapter = {
      fetchPage: vi.fn(async () => {
        throw sourceError
      }),
    }
    const checkpoint: WatermarkCatchUpCheckpoint = {
      resumeCursor: 'expired-cursor',
      pendingWatermark: previousWatermark,
      pagesRead: 2,
      lastObservation: null,
    }

    await expect(
      traverseWatermark({
        adapter,
        query,
        previousWatermark,
        maxPages: 2,
        checkpoint,
      }),
    ).rejects.toMatchObject({
      name: 'WatermarkCatchUpResumeError',
      cause: sourceError,
    } satisfies Partial<WatermarkCatchUpResumeError>)
  })
})
