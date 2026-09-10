import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import { runIncrementalMonitor } from '../../electron/worker/incremental-monitor-run'

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

interface RequestBudget {
  consume(): void
}

const MONITOR_ID = 1_503
const BOUNDARY_TIME = new Date('2026-09-10T18:00:00.000Z')
const UPDATED_AT = new Date('2026-09-10T18:05:00.000Z')

function listing(index: number): Listing {
  return {
    listId: `budget-run-${index}`,
    title: `Candidate ${index}`,
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/budget-run-${index}`,
    region: 'minsk',
    accountId: `seller-${index}`,
    isCompany: false,
    listTime: new Date(Date.UTC(2026, 8, 10, 19, 0, 20 - index)).toISOString(),
    description: 'short',
    raw: { source: 'test' },
  }
}

function makePrisma(): PrismaClient {
  return {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        query: {
          host: 'www.kufar.by',
          category: 'igry-i-pristavki',
          query: null,
          region: 'minsk',
          sellerType: null,
          sort: 'lst.d',
          operation: null,
          pathFilters: [],
          extraParams: {},
        },
        keywords: undefined,
        searchInDescription: true,
        cursor: {
          boundaryTime: BOUNDARY_TIME,
          boundaryIds: ['known'],
          catchupCursor: null,
          catchupBoundaryTime: null,
          catchupBoundaryIds: [],
          catchupLastListTime: null,
          catchupLastListId: null,
          updatedAt: UPDATED_AT,
        },
      }),
    },
  } as unknown as PrismaClient
}

beforeEach(() => {
  const newListings = Array.from({ length: 11 }, (_, index) => listing(index))
  dependencyMocks.traverseWatermark.mockReset().mockResolvedValue({
    kind: 'complete',
    newListings,
    nextWatermark: {
      boundaryTime: newListings[0]?.listTime,
      boundaryIds: [newListings[0]?.listId],
    },
    pagesRead: 1,
    possibleMiss: false,
    checkpoint: null,
  })
  dependencyMocks.commitMonitorRun.mockReset().mockResolvedValue(undefined)
})

describe('incremental description request budget', () => {
  it('shares one ten-request budget across description loads and stops before commit', async () => {
    const budgets: RequestBudget[] = []
    const ensureDescription = vi.fn(async (_listing: Listing, budget?: RequestBudget) => {
      expect(budget).toBeDefined()
      budgets.push(budget as RequestBudget)
      budget?.consume()
      return {
        kind: 'available' as const,
        description: 'full description',
        source: 'network' as const,
      }
    })

    await expect(
      runIncrementalMonitor({
        prisma: makePrisma(),
        monitorId: MONITOR_ID,
        adapter: { fetchPage: vi.fn() } as unknown as SourceAdapter,
        maxPages: 3,
        descriptionLoader: { ensureDescription },
      }),
    ).rejects.toMatchObject({
      name: 'DescriptionRequestBudgetExceededError',
      limit: 10,
    })

    expect(ensureDescription).toHaveBeenCalledTimes(11)
    expect(new Set(budgets.slice(0, 10)).size).toBe(1)
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
  })
})
