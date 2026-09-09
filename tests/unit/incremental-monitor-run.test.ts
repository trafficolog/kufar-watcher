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
const UPDATED_AT = new Date('2026-09-08T10:05:00.000Z')
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

type CompleteTraversalResult = Extract<WatermarkTraversalResult, { kind: 'complete' }>
type IncompleteTraversalResult = Extract<WatermarkTraversalResult, { kind: 'incomplete' }>

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

function baseCursor() {
  return {
    boundaryTime: BOUNDARY_TIME,
    boundaryIds: BOUNDARY_IDS,
    updatedAt: UPDATED_AT,
    catchupCursor: null,
    catchupBoundaryTime: null,
    catchupBoundaryIds: [],
    catchupLastListTime: null,
    catchupLastListId: null,
  }
}

function existingMonitor(overrides: Record<string, unknown> = {}) {
  return {
    query: QUERY,
    searchInDescription: false,
    cursor: baseCursor(),
    ...overrides,
  }
}

function persistedCheckpointMonitor(overrides: Record<string, unknown> = {}) {
  return existingMonitor({
    cursor: {
      ...baseCursor(),
      catchupCursor: 'opaque-page-2',
      catchupBoundaryTime: new Date(LISTING_A.listTime),
      catchupBoundaryIds: [LISTING_A.listId],
      catchupLastListTime: new Date(LISTING_B.listTime),
      catchupLastListId: LISTING_B.listId,
      ...overrides,
    },
  })
}

function traversalResult(
  overrides: Partial<CompleteTraversalResult> = {},
): CompleteTraversalResult {
  return {
    kind: 'complete',
    newListings: [LISTING_A, LISTING_B],
    nextWatermark: {
      boundaryTime: LISTING_A.listTime,
      boundaryIds: [LISTING_A.listId],
    },
    pagesRead: 2,
    possibleMiss: false,
    checkpoint: null,
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
        cursor: { ...baseCursor(), boundaryTime: null },
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

  it('forwards a persisted catch-up checkpoint with restored ISO timestamps', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(persistedCheckpointMonitor())
    const result = traversalResult()
    dependencyMocks.traverseWatermark.mockResolvedValue(result)

    await module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    expect(dependencyMocks.traverseWatermark).toHaveBeenCalledWith({
      adapter,
      query: QUERY,
      previousWatermark: {
        boundaryTime: BOUNDARY_TIME.toISOString(),
        boundaryIds: BOUNDARY_IDS,
      },
      maxPages: 3,
      checkpoint: {
        resumeCursor: 'opaque-page-2',
        pendingWatermark: {
          boundaryTime: LISTING_A.listTime,
          boundaryIds: [LISTING_A.listId],
        },
        lastObservation: {
          listId: LISTING_B.listId,
          listTime: LISTING_B.listTime,
        },
      },
    })
  })

  it('falls back once to a fresh traversal when persisted resume fails', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(persistedCheckpointMonitor())
    const resumedError = new Error('resume-cursor-expired')
    const result = traversalResult()
    dependencyMocks.traverseWatermark
      .mockRejectedValueOnce(resumedError)
      .mockResolvedValueOnce(result)

    const actual = await module.runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
    })

    expect(actual).toBe(result)
    expect(dependencyMocks.traverseWatermark).toHaveBeenCalledTimes(2)
    expect(dependencyMocks.traverseWatermark.mock.calls[0]?.[0]).toMatchObject({
      checkpoint: { resumeCursor: 'opaque-page-2' },
    })
    expect(dependencyMocks.traverseWatermark.mock.calls[1]?.[0]).not.toHaveProperty('checkpoint')
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledTimes(1)
  })

  it('propagates the fresh traversal failure and never commits after resume and fallback both fail', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(persistedCheckpointMonitor())
    const resumedError = new Error('resume-failed')
    const freshError = new Error('fresh-failed')
    dependencyMocks.traverseWatermark
      .mockRejectedValueOnce(resumedError)
      .mockRejectedValueOnce(freshError)

    await expect(
      module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toBe(freshError)

    expect(dependencyMocks.traverseWatermark).toHaveBeenCalledTimes(2)
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
  })

  it('rejects malformed persisted checkpoint state before network work', async () => {
    const module = await loadModule()
    const { adapter, fetchPage } = makeAdapter()
    const { prisma } = makePrisma(
      persistedCheckpointMonitor({
        catchupBoundaryTime: null,
      }),
    )

    await expect(
      module.runIncrementalMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toThrow(/persisted cursor|checkpoint/i)

    expect(fetchPage).not.toHaveBeenCalled()
    expect(dependencyMocks.traverseWatermark).not.toHaveBeenCalled()
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
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
        traversal: result,
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

  it('passes an incomplete traversal result and unchanged watermark through untouched', async () => {
    const module = await loadModule()
    const { adapter } = makeAdapter()
    const { prisma } = makePrisma(existingMonitor())
    const unchangedWatermark = {
      boundaryTime: BOUNDARY_TIME.toISOString(),
      boundaryIds: BOUNDARY_IDS,
    }
    const result: IncompleteTraversalResult = {
      kind: 'incomplete',
      newListings: [LISTING_A, LISTING_B],
      nextWatermark: unchangedWatermark,
      pagesRead: 1,
      possibleMiss: true,
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
    dependencyMocks.traverseWatermark.mockResolvedValue(result)

    const actual = await module.runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 1,
    })

    expect(actual).toBe(result)
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledTimes(1)
    expect(dependencyMocks.commitMonitorRun.mock.calls[0]?.[1].traversal).toBe(result)
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
        cursor: { ...baseCursor(), boundaryIds: ['known', 42] },
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
