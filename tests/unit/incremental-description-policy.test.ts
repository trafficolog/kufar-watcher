import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { MatchSelection } from '../../electron/worker/monitor-run-persistence'

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

interface CandidateSelector {
  select(listing: Listing): Promise<MatchSelection | null>
}

interface CandidatePrefilter {
  accept(listing: Listing): Promise<boolean>
}

type DescriptionResult =
  | { kind: 'available'; description: string | null; source: 'cache' | 'network' }
  | { kind: 'unavailable'; source: 'cache' | 'network' }

interface DescriptionLoader {
  ensureDescription(listing: Listing): Promise<DescriptionResult>
}

interface IncrementalMonitorRunModule {
  runIncrementalMonitor(input: {
    prisma: PrismaClient
    monitorId: number
    adapter: SourceAdapter
    maxPages: number
    selector?: CandidateSelector
    prefilter?: CandidatePrefilter
    descriptionLoader?: DescriptionLoader
    now?: () => Date
  }): Promise<unknown>
}

const MONITOR_ID = 1_502
const BOUNDARY_TIME = new Date('2026-09-08T10:00:00.000Z')
const UPDATED_AT = new Date('2026-09-08T10:05:00.000Z')
const QUERY: CanonicalQuery = {
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

const LISTING_A: Listing = {
  listId: 'policy-a',
  title: 'Phone already matches title',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/policy-a',
  region: 'minsk',
  accountId: 'seller-a',
  isCompany: false,
  listTime: '2026-09-08T11:00:00.000Z',
  description: 'short a',
  raw: { source: 'test' },
}

const LISTING_B: Listing = {
  ...LISTING_A,
  listId: 'policy-b',
  title: 'Second candidate',
  url: 'https://www.kufar.by/item/policy-b',
  accountId: 'seller-b',
  listTime: '2026-09-08T10:30:00.000Z',
  description: 'short b',
}

async function loadModule(): Promise<IncrementalMonitorRunModule> {
  return (await vi.importActual(
    '../../electron/worker/incremental-monitor-run',
  )) as IncrementalMonitorRunModule
}

function makePrisma(searchInDescription: boolean): PrismaClient {
  return {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        query: QUERY,
        searchInDescription,
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

function makeSelector(): CandidateSelector & { select: ReturnType<typeof vi.fn> } {
  const select = vi.fn(async () => ({
    matchedTerms: ['phone'],
    matchedIn: ['title'],
    snippet: null,
  }))
  return { select }
}

function makeLoader(
  implementation: (listing: Listing) => Promise<DescriptionResult> = async (listing) => ({
    kind: 'available',
    description: `full ${listing.listId}`,
    source: 'network',
  }),
): DescriptionLoader & { ensureDescription: ReturnType<typeof vi.fn> } {
  const ensureDescription = vi.fn(implementation)
  return { ensureDescription }
}

function completeTraversal() {
  return {
    kind: 'complete' as const,
    newListings: [LISTING_A, LISTING_B],
    nextWatermark: {
      boundaryTime: LISTING_A.listTime,
      boundaryIds: [LISTING_A.listId],
    },
    pagesRead: 1,
    possibleMiss: false as const,
    checkpoint: null,
  }
}

beforeEach(() => {
  dependencyMocks.traverseWatermark.mockReset().mockResolvedValue(completeTraversal())
  dependencyMocks.commitMonitorRun.mockReset().mockResolvedValue(undefined)
})

describe('incremental description loading policy', () => {
  it('does not touch the description loader when search in description is disabled', async () => {
    const module = await loadModule()
    const selector = makeSelector()
    const descriptionLoader = makeLoader()

    await module.runIncrementalMonitor({
      prisma: makePrisma(false),
      monitorId: MONITOR_ID,
      adapter: { fetchPage: vi.fn() },
      maxPages: 3,
      selector,
      descriptionLoader,
    })

    expect(descriptionLoader.ensureDescription).not.toHaveBeenCalled()
    expect(selector.select).toHaveBeenNthCalledWith(1, LISTING_A)
    expect(selector.select).toHaveBeenNthCalledWith(2, LISTING_B)
  })

  it('loads every candidate before selection when search in description is enabled', async () => {
    const module = await loadModule()
    const selector = makeSelector()
    const order: string[] = []
    selector.select.mockImplementation(async (listing: Listing) => {
      order.push(`select:${listing.listId}`)
      return {
        matchedTerms: ['phone'],
        matchedIn: ['title'],
        snippet: null,
      }
    })
    const descriptionLoader = makeLoader(async (listing) => {
      order.push(`load:${listing.listId}`)
      return {
        kind: 'available',
        description: `full ${listing.listId}`,
        source: 'network',
      }
    })

    await module.runIncrementalMonitor({
      prisma: makePrisma(true),
      monitorId: MONITOR_ID,
      adapter: { fetchPage: vi.fn() },
      maxPages: 3,
      selector,
      descriptionLoader,
    })

    expect(descriptionLoader.ensureDescription).toHaveBeenCalledTimes(2)
    expect(order).toEqual(['load:policy-a', 'select:policy-a', 'load:policy-b', 'select:policy-b'])
    expect(selector.select).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ listId: LISTING_A.listId, description: 'full policy-a' }),
    )
    expect(selector.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ listId: LISTING_B.listId, description: 'full policy-b' }),
    )
  })

  it('runs the cheap prefilter before description loading', async () => {
    const module = await loadModule()
    const selector = makeSelector()
    const descriptionLoader = makeLoader()
    const prefilter: CandidatePrefilter = {
      accept: vi.fn(async (listing) => listing.listId !== LISTING_A.listId),
    }

    await module.runIncrementalMonitor({
      prisma: makePrisma(true),
      monitorId: MONITOR_ID,
      adapter: { fetchPage: vi.fn() },
      maxPages: 3,
      selector,
      prefilter,
      descriptionLoader,
    })

    expect(prefilter.accept).toHaveBeenCalledTimes(2)
    expect(descriptionLoader.ensureDescription).toHaveBeenCalledTimes(1)
    expect(descriptionLoader.ensureDescription).toHaveBeenCalledWith(LISTING_B)
    expect(selector.select).toHaveBeenCalledTimes(1)
    expect(selector.select).toHaveBeenCalledWith(
      expect.objectContaining({ listId: LISTING_B.listId, description: 'full policy-b' }),
    )
  })

  it('keeps prefilter description and selector order for an incomplete catch-up chunk', async () => {
    const module = await loadModule()
    const traversal = {
      kind: 'incomplete' as const,
      newListings: [LISTING_A, LISTING_B],
      nextWatermark: {
        boundaryTime: BOUNDARY_TIME.toISOString(),
        boundaryIds: ['known'],
      },
      pagesRead: 1,
      possibleMiss: true as const,
      checkpoint: {
        resumeCursor: 'page-2',
        pendingWatermark: {
          boundaryTime: LISTING_A.listTime,
          boundaryIds: [LISTING_A.listId],
        },
        lastObservation: {
          listId: LISTING_B.listId,
          listTime: LISTING_B.listTime,
        },
      },
    }
    dependencyMocks.traverseWatermark.mockResolvedValue(traversal)

    const order: string[] = []
    const prefilter: CandidatePrefilter = {
      accept: vi.fn(async (listing) => {
        order.push(`prefilter:${listing.listId}`)
        return true
      }),
    }
    const descriptionLoader = makeLoader(async (listing) => {
      order.push(`load:${listing.listId}`)
      return {
        kind: 'available',
        description: `full ${listing.listId}`,
        source: 'network',
      }
    })
    const selector = makeSelector()
    selector.select.mockImplementation(async (listing: Listing) => {
      order.push(`select:${listing.listId}`)
      return { matchedTerms: ['phone'], matchedIn: ['title'], snippet: null }
    })

    await module.runIncrementalMonitor({
      prisma: makePrisma(true),
      monitorId: MONITOR_ID,
      adapter: { fetchPage: vi.fn() },
      maxPages: 1,
      prefilter,
      descriptionLoader,
      selector,
    })

    expect(order).toEqual([
      'prefilter:policy-a',
      'load:policy-a',
      'select:policy-a',
      'prefilter:policy-b',
      'load:policy-b',
      'select:policy-b',
    ])
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates: [LISTING_A, LISTING_B],
        traversal,
      }),
    )
  })

  it('skips selection for a listing confirmed unavailable by the description cache', async () => {
    const module = await loadModule()
    const selector = makeSelector()
    const descriptionLoader = makeLoader(async (listing) =>
      listing.listId === LISTING_A.listId
        ? { kind: 'unavailable', source: 'network' }
        : { kind: 'available', description: 'full b', source: 'network' },
    )

    await module.runIncrementalMonitor({
      prisma: makePrisma(true),
      monitorId: MONITOR_ID,
      adapter: { fetchPage: vi.fn() },
      maxPages: 3,
      selector,
      descriptionLoader,
    })

    expect(selector.select).toHaveBeenCalledTimes(1)
    expect(selector.select).toHaveBeenCalledWith(
      expect.objectContaining({ listId: LISTING_B.listId, description: 'full b' }),
    )
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidates: [LISTING_A, LISTING_B],
        selected: [
          expect.objectContaining({
            listing: expect.objectContaining({ listId: LISTING_B.listId }),
          }),
        ],
      }),
    )
  })

  it('does not commit cursor progress when description loading fails', async () => {
    const module = await loadModule()
    const selector = makeSelector()
    const sentinel = new Error('detail-failed')
    const descriptionLoader = makeLoader(async () => {
      throw sentinel
    })

    await expect(
      module.runIncrementalMonitor({
        prisma: makePrisma(true),
        monitorId: MONITOR_ID,
        adapter: { fetchPage: vi.fn() },
        maxPages: 3,
        selector,
        descriptionLoader,
      }),
    ).rejects.toBe(sentinel)

    expect(selector.select).not.toHaveBeenCalled()
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
  })
})
