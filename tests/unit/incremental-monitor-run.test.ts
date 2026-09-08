import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { WatermarkTraversalResult } from '../../shared/watermark'
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

interface ColdStartError extends Error {
  readonly monitorId: number
}

interface IncrementalMonitorRunModule {
  ColdStartRequiredError: new (monitorId: number) => ColdStartError
  acceptAllCandidateSelector: CandidateSelector
  runIncrementalMonitor(input: {
    prisma: PrismaClient
    monitorId: number
    adapter: SourceAdapter
    maxPages: number
    selector?: CandidateSelector
    now?: () => Date
  }): Promise<WatermarkTraversalResult>
}

const MONITOR_ID = 1_402
const BOUNDARY_TIME = new Date('2026-09-08T10:00:00.000Z')
const BOUNDARY_IDS = ['known-at-boundary']
const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones', 'smartphones'],
  extraParams: {
    condition: ['used', 'new'],
  },
}

const LISTING_A: Listing = {
  listId: 'candidate-a',
  title: 'Candidate A',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/candidate-a',
  region: 'minsk',
  accountId: null,
  isCompany: false,
  listTime: '2026-09-08T11:00:00.000Z',
  description: 'first candidate',
  raw: { source: 'test' },
}

const LISTING_B: Listing = {
  ...LISTING_A,
  listId: 'candidate-b',
  title: 'Candidate B',
  url: 'https://www.kufar.by/item/candidate-b',
  listTime: '2026-09-08T10:30:00.000Z',
  description: 'second candidate',
}

async function loadModule(): Promise<IncrementalMonitorRunModule> {
  let loaded: unknown
  try {
    loaded = await vi.importActual('../../electron/worker/incremental-monitor-run')
  } catch {
    loaded = undefined
  }

  expect(loaded, 'incremental monitor run module must exist').toBeTruthy()
  return loaded as IncrementalMonitorRunModule
}

function makeAdapter() {
  const fetchPage = vi.fn()
  return {
    adapter: { fetchPage } as SourceAdapter,
    fetchPage,
  }
}

function makePrisma(monitor: unknown) {
  const findUniqueOrThrow = vi.fn().mockResolvedValue(monitor)
  const transaction = vi.fn()
  const prisma = {
    monitor: { findUniqueOrThrow },
    $transaction: transaction,
  } as unknown as PrismaClient

  return { prisma, findUniqueOrThrow, transaction }
}

function existingMonitor(overrides: Record<string, unknown> = {}) {
  return {
    query: QUERY,
    cursor: {
      boundaryTime: BOUNDARY_TIME,
      boundaryIds: BOUNDARY_IDS,
    },
    ...overrides,
  }
}

function traversalResult(
  overrides: Partial<WatermarkTraversalResult> = {},
): WatermarkTraversalResult {
  return {
    newListings: [LISTING_A, LISTING_B],
    nextWatermark: {
      boundaryTime: LISTING_A.listTime,
      boundaryIds: [LISTING_A.listId],
    },
    pagesRead: 2,
    possibleMiss: false,
    ...overrides,
  }
}

beforeEach(() => {
  dependencyMocks.traverseWatermark.mockReset()
  dependencyMocks.commitMonitorRun.mockReset()
  dependencyMocks.commitMonitorRun.mockResolvedValue(undefined)
})

describe('runIncrementalMonitor', () => {
  it('rejects a missing cursor as cold start before traversal or persistence', async () => {
    const module = await loadModule()
    const { adapter, fetchPage } = makeAdapter()
    const { prisma, transaction } = makePrisma({ query: QUERY, cursor: null })

    await expect(
      module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toMatchObject({
      name: 'ColdStartRequiredError',
      monitorId: MONITOR_ID,
    })

    expect(fetchPage).not.toHaveBeenCalled()
    expect(dependencyMocks.traverseWatermark).not.toHaveBeenCalled()
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a null boundary time as cold start before traversal or persistence', async () => {
    const module = await loadModule()
    const { adapter, fetchPage } = makeAdapter()
    const { prisma, transaction } = makePrisma(
      existingMonitor({
        cursor: { boundaryTime: null, boundaryIds: BOUNDARY_IDS },
      }),
    )

    await expect(
      module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toBeInstanceOf(module.ColdStartRequiredError)

    expect(fetchPage).not.toHaveBeenCalled()
    expect(dependencyMocks.traverseWatermark).not.toHaveBeenCalled()
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('passes persisted canonical query and watermark to traversal', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(existingMonitor())
    const result = traversalResult()
    dependencyMocks.traverseWatermark.mockResolvedValue(result)

    const actual = await module.runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 7,
    })

    expect(dependencyMocks.traverseWatermark).toHaveBeenCalledWith({
      adapter,
      query: QUERY,
      previousWatermark: {
        boundaryTime: BOUNDARY_TIME.toISOString(),
        boundaryIds: BOUNDARY_IDS,
      },
      maxPages: 7,
    })
    expect(actual).toBe(result)
  })

  it('accepts every candidate by default with empty match metadata', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(existingMonitor())
    const result = traversalResult()
    dependencyMocks.traverseWatermark.mockResolvedValue(result)

    await module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledTimes(1)
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        candidates: result.newListings,
        selected: [
          {
            listing: LISTING_A,
            selection: { matchedTerms: [], matchedIn: [], snippet: null },
          },
          {
            listing: LISTING_B,
            selection: { matchedTerms: [], matchedIn: [], snippet: null },
          },
        ],
      }),
    )
  })

  it('allows a custom selector to reject a candidate', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(existingMonitor())
    const result = traversalResult()
    dependencyMocks.traverseWatermark.mockResolvedValue(result)
    const selector: CandidateSelector = {
      select: vi.fn(async (listing) =>
        listing.listId === LISTING_A.listId
          ? { matchedTerms: ['phone'], matchedIn: ['title'], snippet: 'Candidate A' }
          : null,
      ),
    }

    await module.runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
      selector,
    })

    expect(selector.select).toHaveBeenCalledTimes(2)
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        selected: [
          {
            listing: LISTING_A,
            selection: {
              matchedTerms: ['phone'],
              matchedIn: ['title'],
              snippet: 'Candidate A',
            },
          },
        ],
      }),
    )
  })

  it('does not persist when selector evaluation fails', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma, transaction } = makePrisma(existingMonitor())
    const result = traversalResult()
    const sentinel = new Error('selector-failed')
    dependencyMocks.traverseWatermark.mockResolvedValue(result)
    const selector: CandidateSelector = {
      select: vi.fn().mockRejectedValue(sentinel),
    }

    await expect(
      module.runIncrementalMonitor({
        prisma,
        monitorId: MONITOR_ID,
        adapter,
        maxPages: 3,
        selector,
      }),
    ).rejects.toBe(sentinel)

    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('does not persist when traversal fails', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma, transaction } = makePrisma(existingMonitor())
    const sentinel = new Error('source-failed')
    dependencyMocks.traverseWatermark.mockRejectedValue(sentinel)

    await expect(
      module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toBe(sentinel)

    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('uses one start and one finish timestamp for persistence', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(existingMonitor())
    const result = traversalResult()
    const startedAt = new Date('2026-09-08T12:00:00.000Z')
    const finishedAt = new Date('2026-09-08T12:00:05.000Z')
    const now = vi.fn().mockReturnValueOnce(startedAt).mockReturnValueOnce(finishedAt)
    dependencyMocks.traverseWatermark.mockResolvedValue(result)

    await module.runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
      now,
    })

    expect(now).toHaveBeenCalledTimes(2)
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ startedAt, finishedAt }),
    )
  })

  it('passes a possible-miss traversal result and unchanged watermark through untouched', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(existingMonitor())
    const unchangedWatermark = {
      boundaryTime: BOUNDARY_TIME.toISOString(),
      boundaryIds: BOUNDARY_IDS,
    }
    const result = traversalResult({
      nextWatermark: unchangedWatermark,
      possibleMiss: true,
    })
    dependencyMocks.traverseWatermark.mockResolvedValue(result)

    const actual = await module.runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 1,
    })

    expect(actual).toBe(result)
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledTimes(1)
    expect(dependencyMocks.commitMonitorRun.mock.calls[0]?.[1].nextWatermark).toBe(
      unchangedWatermark,
    )
  })

  it.each([
    {
      name: 'malformed persisted canonical query',
      monitor: existingMonitor({ query: { host: 'www.kufar.by' } }),
      message: /canonical query/i,
    },
    {
      name: 'non-string boundary ids',
      monitor: existingMonitor({
        cursor: { boundaryTime: BOUNDARY_TIME, boundaryIds: ['known', 42] },
      }),
      message: /boundaryIds/i,
    },
  ])('rejects $name before traversal', async ({ monitor, message }) => {
    const module = await loadModule()
    const { adapter, fetchPage } = makeAdapter()
    const { prisma, transaction } = makePrisma(monitor)

    await expect(
      module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toThrow(message)

    expect(fetchPage).not.toHaveBeenCalled()
    expect(dependencyMocks.traverseWatermark).not.toHaveBeenCalled()
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
