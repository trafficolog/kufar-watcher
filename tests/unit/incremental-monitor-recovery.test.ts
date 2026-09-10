import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter, SourcePage } from '../../shared/source-adapter'
import { runIncrementalMonitor } from '../../electron/worker/incremental-monitor-run'
import type { KufarHttpResult } from '../../electron/worker/kufar-http-client'
import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'

const dependencyMocks = vi.hoisted(() => ({
  commitMonitorRun: vi.fn(),
}))

vi.mock('../../electron/worker/monitor-run-persistence', () => ({
  commitMonitorRun: dependencyMocks.commitMonitorRun,
}))

const MONITOR_ID = 1_405
const BOUNDARY_TIME = new Date('2026-09-10T10:00:00.000Z')
const CHECKPOINT_TIME = new Date('2026-09-10T10:30:00.000Z')
const UPDATED_AT = new Date('2026-09-10T10:35:00.000Z')

const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: null,
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
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
    raw: { source: 'test' },
  }
}

function page(listings: Listing[], nextCursor: string | null = null): SourcePage {
  return { listings, nextCursor }
}

function persistedCheckpointMonitor() {
  return {
    query: QUERY,
    keywords: undefined,
    searchInDescription: false,
    cursor: {
      boundaryTime: BOUNDARY_TIME,
      boundaryIds: ['known-boundary'],
      updatedAt: UPDATED_AT,
      catchupCursor: 'opaque-page-2',
      catchupBoundaryTime: new Date('2026-09-10T11:00:00.000Z'),
      catchupBoundaryIds: ['pending-maximum'],
      catchupLastListTime: CHECKPOINT_TIME,
      catchupLastListId: 'checkpoint-last',
    },
  }
}

function makePrisma(): PrismaClient {
  return {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(persistedCheckpointMonitor()),
    },
  } as unknown as PrismaClient
}

function makeAdapter(fetchPage: ReturnType<typeof vi.fn>): SourceAdapter {
  return { fetchPage } as SourceAdapter
}

function sourceError(
  code: Extract<KufarHttpResult, { ok: false }>['code'],
): KufarSourceRequestError {
  const rateLimited = code === 'rate-limited'
  const http = code === 'http-5xx'
  return new KufarSourceRequestError(`source failed: ${code}`, {
    ok: false,
    kind: rateLimited ? 'rate-limited' : 'temporary',
    code,
    status: rateLimited ? 429 : http ? 503 : null,
    attempts: 3,
    message: `safe ${code}`,
    ...(rateLimited ? { retryAfterMs: 60_000 } : {}),
  })
}

beforeEach(() => {
  dependencyMocks.commitMonitorRun.mockReset()
  dependencyMocks.commitMonitorRun.mockResolvedValue(undefined)
})

describe('incremental catch-up checkpoint recovery', () => {
  it('restarts exactly once from the top when the persisted checkpoint ordering is stale', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([listing('newer-than-checkpoint', '2026-09-10T10:40:00.000Z')]))
      .mockResolvedValueOnce(page([]))

    await runIncrementalMonitor({
      prisma: makePrisma(),
      monitorId: MONITOR_ID,
      adapter: makeAdapter(fetchPage),
      maxPages: 5,
    })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({ cursor: 'opaque-page-2' })
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({ cursor: null })
    expect(dependencyMocks.commitMonitorRun).toHaveBeenCalledTimes(1)
  })

  it.each(['rate-limited', 'network', 'timeout', 'http-5xx'] as const)(
    'propagates %s source failures without restarting from the top',
    async (code) => {
      const error = sourceError(code)
      const fetchPage = vi.fn().mockRejectedValue(error)

      await expect(
        runIncrementalMonitor({
          prisma: makePrisma(),
          monitorId: MONITOR_ID,
          adapter: makeAdapter(fetchPage),
          maxPages: 5,
        }),
      ).rejects.toBe(error)

      expect(fetchPage).toHaveBeenCalledTimes(1)
      expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
    },
  )

  it('propagates invalid listing time without restarting from the top', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([listing('invalid-time', 'not-a-date')]))

    await expect(
      runIncrementalMonitor({
        prisma: makePrisma(),
        monitorId: MONITOR_ID,
        adapter: makeAdapter(fetchPage),
        maxPages: 5,
      }),
    ).rejects.toMatchObject({ name: 'WatermarkListingTimeError' })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
  })

  it('propagates ordering drift inside a real page without restarting from the top', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      page([
        listing('older-first', '2026-09-10T10:20:00.000Z'),
        listing('newer-second', '2026-09-10T10:25:00.000Z'),
      ]),
    )

    await expect(
      runIncrementalMonitor({
        prisma: makePrisma(),
        monitorId: MONITOR_ID,
        adapter: makeAdapter(fetchPage),
        maxPages: 5,
      }),
    ).rejects.toMatchObject({
      name: 'WatermarkOrderingError',
      previous: { page: 1, index: 0 },
      current: { page: 1, index: 1 },
    })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(dependencyMocks.commitMonitorRun).not.toHaveBeenCalled()
  })
})
