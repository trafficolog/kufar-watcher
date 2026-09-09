import { describe, expect, it, vi } from 'vitest'

import { traverseColdStartBaseline } from '../../electron/worker/cold-start-traversal'
import { traverseWatermark } from '../../electron/worker/watermark-traversal'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import type { Watermark } from '../../shared/watermark'

const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
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

function adapterFromPages(pages: readonly SourcePage[]) {
  let index = 0
  const fetchPage = vi.fn(async (_request: SourcePageRequest): Promise<SourcePage> => {
    const page = pages[index]
    if (page === undefined) throw new Error(`Unexpected page request ${index + 1}`)
    index += 1
    return page
  })
  return { adapter: { fetchPage } satisfies SourceAdapter, fetchPage }
}

function checkpointFrom(result: unknown): {
  resumeCursor: string
  pendingWatermark: Watermark
  lastObservation: { listId: string; listTime: string } | null
} {
  const value = result as { checkpoint?: unknown }
  expect(value.checkpoint).toBeTruthy()
  return value.checkpoint as {
    resumeCursor: string
    pendingWatermark: Watermark
    lastObservation: { listId: string; listTime: string } | null
  }
}

describe('persistent watermark catch-up checkpoint', () => {
  it('returns an incomplete checkpoint at the page cap without advancing the confirmed watermark', async () => {
    const { adapter } = adapterFromPages([
      {
        listings: [listing('n3', '2026-09-08T10:03:00.000Z')],
        nextCursor: 'page-2',
      },
    ])

    const result = await traverseWatermark({ adapter, query, previousWatermark, maxPages: 1 })

    expect(result).toMatchObject({
      kind: 'incomplete',
      nextWatermark: previousWatermark,
      pagesRead: 1,
      possibleMiss: true,
      checkpoint: {
        resumeCursor: 'page-2',
        pendingWatermark: {
          boundaryTime: '2026-09-08T10:03:00.000Z',
          boundaryIds: ['n3'],
        },
        lastObservation: {
          listId: 'n3',
          listTime: '2026-09-08T10:03:00.000Z',
        },
      },
    })
  })

  it('resumes from the opaque cursor and promotes the pending watermark only after the old boundary is reached', async () => {
    const firstSource = adapterFromPages([
      {
        listings: [listing('n3', '2026-09-08T10:03:00.000Z')],
        nextCursor: 'opaque-page-2',
      },
    ])
    const first = await traverseWatermark({
      adapter: firstSource.adapter,
      query,
      previousWatermark,
      maxPages: 1,
    })
    const checkpoint = checkpointFrom(first)

    const resumedSource = adapterFromPages([
      {
        listings: [
          listing('n2', '2026-09-08T10:02:00.000Z'),
          listing('known-a', previousWatermark.boundaryTime),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])

    const resumed = await traverseWatermark({
      adapter: resumedSource.adapter,
      query,
      previousWatermark,
      maxPages: 2,
      checkpoint,
    } as Parameters<typeof traverseWatermark>[0] & { checkpoint: typeof checkpoint })

    expect(resumedSource.fetchPage).toHaveBeenCalledWith({
      query,
      cursor: 'opaque-page-2',
    })
    expect(resumed).toMatchObject({
      kind: 'complete',
      nextWatermark: {
        boundaryTime: '2026-09-08T10:03:00.000Z',
        boundaryIds: ['n3'],
      },
      possibleMiss: false,
      checkpoint: null,
    })
  })

  it('makes monotonic progress across three capped chunks instead of rereading page one', async () => {
    const firstSource = adapterFromPages([
      { listings: [listing('n4', '2026-09-08T10:04:00.000Z')], nextCursor: 'page-2' },
    ])
    const first = await traverseWatermark({
      adapter: firstSource.adapter,
      query,
      previousWatermark,
      maxPages: 1,
    })

    const secondSource = adapterFromPages([
      { listings: [listing('n3', '2026-09-08T10:03:00.000Z')], nextCursor: 'page-3' },
    ])
    const second = await traverseWatermark({
      adapter: secondSource.adapter,
      query,
      previousWatermark,
      maxPages: 1,
      checkpoint: checkpointFrom(first),
    } as Parameters<typeof traverseWatermark>[0] & {
      checkpoint: ReturnType<typeof checkpointFrom>
    })

    const thirdSource = adapterFromPages([
      {
        listings: [
          listing('n2', '2026-09-08T10:02:00.000Z'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])
    const third = await traverseWatermark({
      adapter: thirdSource.adapter,
      query,
      previousWatermark,
      maxPages: 1,
      checkpoint: checkpointFrom(second),
    } as Parameters<typeof traverseWatermark>[0] & {
      checkpoint: ReturnType<typeof checkpointFrom>
    })

    expect(firstSource.fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual([null])
    expect(secondSource.fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual(['page-2'])
    expect(thirdSource.fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual(['page-3'])
    expect(third).toMatchObject({
      kind: 'complete',
      nextWatermark: {
        boundaryTime: '2026-09-08T10:04:00.000Z',
        boundaryIds: ['n4'],
      },
    })
  })

  it('accumulates maximum-time ids across a chunk boundary', async () => {
    const firstSource = adapterFromPages([
      {
        listings: [listing('top-a', '2026-09-08T10:05:00.000Z')],
        nextCursor: 'page-2',
      },
    ])
    const first = await traverseWatermark({
      adapter: firstSource.adapter,
      query,
      previousWatermark,
      maxPages: 1,
    })

    const resumedSource = adapterFromPages([
      {
        listings: [
          listing('top-b', '2026-09-08T10:05:00.000Z'),
          listing('n4', '2026-09-08T10:04:00.000Z'),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])
    const result = await traverseWatermark({
      adapter: resumedSource.adapter,
      query,
      previousWatermark,
      maxPages: 2,
      checkpoint: checkpointFrom(first),
    } as Parameters<typeof traverseWatermark>[0] & {
      checkpoint: ReturnType<typeof checkpointFrom>
    })

    expect(result).toMatchObject({
      kind: 'complete',
      nextWatermark: {
        boundaryTime: '2026-09-08T10:05:00.000Z',
        boundaryIds: ['top-a', 'top-b'],
      },
    })
  })

  it('accumulates unseen ids on the confirmed boundary across chunks when there is no newer timestamp', async () => {
    const firstSource = adapterFromPages([
      {
        listings: [listing('new-at-boundary-a', previousWatermark.boundaryTime)],
        nextCursor: 'page-2',
      },
    ])
    const first = await traverseWatermark({
      adapter: firstSource.adapter,
      query,
      previousWatermark,
      maxPages: 1,
    })

    const resumedSource = adapterFromPages([
      {
        listings: [
          listing('known-a', previousWatermark.boundaryTime),
          listing('new-at-boundary-b', previousWatermark.boundaryTime),
          listing('old', '2026-09-08T09:59:00.000Z'),
        ],
        nextCursor: null,
      },
    ])
    const result = await traverseWatermark({
      adapter: resumedSource.adapter,
      query,
      previousWatermark,
      maxPages: 2,
      checkpoint: checkpointFrom(first),
    } as Parameters<typeof traverseWatermark>[0] & {
      checkpoint: ReturnType<typeof checkpointFrom>
    })

    expect(result).toMatchObject({
      kind: 'complete',
      nextWatermark: {
        boundaryTime: previousWatermark.boundaryTime,
        boundaryIds: ['known-a', 'new-at-boundary-a', 'new-at-boundary-b'],
      },
    })
  })

  it('validates ordering continuity against the persisted last observation', async () => {
    const source = adapterFromPages([
      {
        listings: [listing('unexpected-newer', '2026-09-08T10:04:00.000Z')],
        nextCursor: null,
      },
    ])
    const checkpoint = {
      resumeCursor: 'page-2',
      pendingWatermark: {
        boundaryTime: '2026-09-08T10:05:00.000Z',
        boundaryIds: ['top'],
      },
      lastObservation: {
        listId: 'previous-last',
        listTime: '2026-09-08T10:03:00.000Z',
      },
    }

    await expect(
      traverseWatermark({
        adapter: source.adapter,
        query,
        previousWatermark,
        maxPages: 1,
        checkpoint,
      } as Parameters<typeof traverseWatermark>[0] & { checkpoint: typeof checkpoint }),
    ).rejects.toMatchObject({ name: 'WatermarkOrderingError' })
    expect(source.fetchPage).toHaveBeenCalledWith({ query, cursor: 'page-2' })
  })
})

describe('listing time validation', () => {
  it('rejects invalid listTime during incremental traversal with a typed observation error', async () => {
    const source = adapterFromPages([
      { listings: [listing('bad-time', 'not-a-time')], nextCursor: null },
    ])

    await expect(
      traverseWatermark({ adapter: source.adapter, query, previousWatermark, maxPages: 1 }),
    ).rejects.toMatchObject({
      name: 'WatermarkListingTimeError',
      observation: expect.objectContaining({
        page: 1,
        index: 0,
        listId: 'bad-time',
        listTime: 'not-a-time',
      }),
    })
  })

  it('rejects invalid listTime during cold start with the same typed observation error', async () => {
    const source = adapterFromPages([
      { listings: [listing('bad-cold-time', 'not-a-time')], nextCursor: null },
    ])

    await expect(
      traverseColdStartBaseline({
        adapter: source.adapter,
        query,
        maxPages: 1,
        startedAt: new Date('2026-09-08T12:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      name: 'WatermarkListingTimeError',
      observation: expect.objectContaining({
        page: 1,
        index: 0,
        listId: 'bad-cold-time',
        listTime: 'not-a-time',
      }),
    })
  })
})
