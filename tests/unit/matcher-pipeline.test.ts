import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runIncrementalMonitor } from '../../electron/worker/incremental-monitor-run'
import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { WatermarkTraversalResult } from '../../shared/watermark'

const dependencyMocks = vi.hoisted(() => ({
  traverseWatermark: vi.fn(),
  commitMonitorRun: vi.fn(),
}))

vi.mock('../../electron/worker/watermark-traversal', () => ({
  traverseWatermark: dependencyMocks.traverseWatermark,
}))

vi.mock('../../electron/worker/monitor-run-persistence', () => ({
  commitMonitorRun: dependencyMocks.commitMonitorRun,
}))

const MONITOR_ID = 2_203
const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'candidate',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones'],
  extraParams: {},
}

function listing(id: string, title: string): Listing {
  return {
    listId: `pipeline-${id}`,
    title,
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/pipeline-${id}`,
    region: 'minsk',
    accountId: null,
    isCompany: false,
    listTime: '2026-09-09T18:00:00.000Z',
    description: null,
    raw: { source: 'test' },
  }
}

const LISTING_A = listing('a', 'Candidate A')
const LISTING_B = listing('b', 'Candidate B')

function traversalResult(): WatermarkTraversalResult {
  return {
    kind: 'complete',
    newListings: [LISTING_A, LISTING_B],
    nextWatermark: {
      boundaryTime: LISTING_A.listTime,
      boundaryIds: [LISTING_A.listId, LISTING_B.listId],
    },
    pagesRead: 1,
    possibleMiss: false,
    checkpoint: null,
  }
}

function prismaWithKeywordRule(
  keywords: unknown = {
    include: ['candidate'],
    exclude: ['b'],
  },
): PrismaClient {
  return {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        query: QUERY,
        keywords,
        searchInDescription: false,
        cursor: {
          boundaryTime: new Date('2026-09-09T17:00:00.000Z'),
          boundaryIds: ['older'],
          catchupCursor: null,
          catchupBoundaryTime: null,
          catchupBoundaryIds: [],
          catchupLastListTime: null,
          catchupLastListId: null,
          updatedAt: new Date('2026-09-09T17:05:00.000Z'),
        },
      }),
    },
  } as unknown as PrismaClient
}

beforeEach(() => {
  dependencyMocks.traverseWatermark.mockReset()
  dependencyMocks.commitMonitorRun.mockReset()
  dependencyMocks.commitMonitorRun.mockResolvedValue(undefined)
})

describe('incremental matcher pipeline', () => {
  it('uses the persisted include/exclude rule for the default candidate selector', async () => {
    const prisma = prismaWithKeywordRule()
    const adapter = {} as SourceAdapter
    const traversal = traversalResult()
    dependencyMocks.traverseWatermark.mockResolvedValue(traversal)

    await runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 1 })

    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        candidates: [LISTING_A, LISTING_B],
        selected: [
          {
            listing: LISTING_A,
            selection: {
              matchedTerms: ['candidate'],
              matchedIn: ['title'],
              snippet: null,
            },
          },
        ],
      }),
    )
  })

  it('treats a legacy string array as an include-only keyword rule', async () => {
    const prisma = prismaWithKeywordRule(['candidate'])
    const adapter = {} as SourceAdapter
    const traversal = traversalResult()
    dependencyMocks.traverseWatermark.mockResolvedValue(traversal)

    await runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 1 })

    expect(dependencyMocks.commitMonitorRun.mock.calls[0]?.[1].selected).toEqual([
      {
        listing: LISTING_A,
        selection: { matchedTerms: ['candidate'], matchedIn: ['title'], snippet: null },
      },
      {
        listing: LISTING_B,
        selection: { matchedTerms: ['candidate'], matchedIn: ['title'], snippet: null },
      },
    ])
  })

  it('rejects a malformed persisted keyword rule before traversal', async () => {
    const prisma = prismaWithKeywordRule({ include: ['candidate'], exclude: [42] })
    const adapter = {} as SourceAdapter

    await expect(
      runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 1 }),
    ).rejects.toThrow(/keyword rule/i)

    expect(dependencyMocks.traverseWatermark).not.toHaveBeenCalled()
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
  })
})
