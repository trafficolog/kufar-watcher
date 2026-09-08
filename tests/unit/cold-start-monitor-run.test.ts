import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'

const dependencyMocks = vi.hoisted(() => ({
  traverseColdStartBaseline: vi.fn(),
  commitColdStartBaseline: vi.fn(),
}))

vi.mock('../../electron/worker/cold-start-traversal', () => ({
  traverseColdStartBaseline: dependencyMocks.traverseColdStartBaseline,
}))

vi.mock('../../electron/worker/cold-start-persistence', () => ({
  commitColdStartBaseline: dependencyMocks.commitColdStartBaseline,
}))

import {
  ColdStartNotRequiredError,
  runColdStartMonitor,
} from '../../electron/worker/cold-start-monitor-run'

const MONITOR_ID = 1_403
const SOURCE_URL = 'https://www.kufar.by/l/electronics?query=phone'
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
const LISTING: Listing = {
  listId: 'baseline-a',
  title: 'Baseline A',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/baseline-a',
  region: 'minsk',
  accountId: null,
  isCompany: false,
  listTime: '2026-09-08T11:59:00.000Z',
  description: null,
  raw: { fixture: 'baseline-a' },
}

function makePrisma(cursor: unknown) {
  const findUniqueOrThrow = vi.fn().mockResolvedValue({
    sourceUrl: SOURCE_URL,
    query: QUERY,
    cursor,
  })
  return {
    prisma: { monitor: { findUniqueOrThrow } } as unknown as PrismaClient,
    findUniqueOrThrow,
  }
}

function makeAdapter(): SourceAdapter {
  return { fetchPage: vi.fn() }
}

beforeEach(() => {
  dependencyMocks.traverseColdStartBaseline.mockReset()
  dependencyMocks.commitColdStartBaseline.mockReset().mockResolvedValue(undefined)
})

describe('runColdStartMonitor', () => {
  it('snapshots a missing cursor and source identity before traversal, then commits baseline', async () => {
    const { prisma } = makePrisma(null)
    const adapter = makeAdapter()
    const startedAt = new Date('2026-09-08T12:00:00.000Z')
    const finishedAt = new Date('2026-09-08T12:00:03.000Z')
    const now = vi.fn().mockReturnValueOnce(startedAt).mockReturnValueOnce(finishedAt)
    dependencyMocks.traverseColdStartBaseline.mockResolvedValue({
      listings: [LISTING],
      baselineCount: 1,
      pagesRead: 2,
      nextWatermark: {
        boundaryTime: LISTING.listTime,
        boundaryIds: [LISTING.listId],
      },
    })

    const result = await runColdStartMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 3,
      now,
    })

    expect(dependencyMocks.traverseColdStartBaseline).toHaveBeenCalledWith({
      adapter,
      query: QUERY,
      maxPages: 3,
      startedAt,
    })
    expect(dependencyMocks.commitColdStartBaseline).toHaveBeenCalledWith(prisma, {
      monitorId: MONITOR_ID,
      startedAt,
      finishedAt,
      source: { sourceUrl: SOURCE_URL, query: QUERY },
      expectedCursor: { kind: 'missing' },
      listings: [LISTING],
      nextWatermark: {
        boundaryTime: LISTING.listTime,
        boundaryIds: [LISTING.listId],
      },
    })
    expect(result).toEqual({
      baselineCount: 1,
      pagesRead: 2,
      nextWatermark: {
        boundaryTime: LISTING.listTime,
        boundaryIds: [LISTING.listId],
      },
    })
  })

  it('snapshots an existing uninitialized cursor revision', async () => {
    const updatedAt = new Date('2026-09-08T11:50:00.000Z')
    const { prisma } = makePrisma({ boundaryTime: null, updatedAt })
    const adapter = makeAdapter()
    dependencyMocks.traverseColdStartBaseline.mockResolvedValue({
      listings: [],
      baselineCount: 0,
      pagesRead: 1,
      nextWatermark: {
        boundaryTime: '2026-09-08T12:00:00.000Z',
        boundaryIds: [],
      },
    })

    await runColdStartMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    expect(dependencyMocks.commitColdStartBaseline).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        expectedCursor: { kind: 'uninitialized', updatedAt },
      }),
    )
  })

  it('rejects an initialized cursor before source traversal', async () => {
    const { prisma } = makePrisma({
      boundaryTime: new Date('2026-09-08T11:59:00.000Z'),
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    })
    const adapter = makeAdapter()

    await expect(
      runColdStartMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 }),
    ).rejects.toBeInstanceOf(ColdStartNotRequiredError)

    expect(dependencyMocks.traverseColdStartBaseline).not.toHaveBeenCalled()
    expect(dependencyMocks.commitColdStartBaseline).not.toHaveBeenCalled()
  })

  it('does not enter persistence when baseline traversal is incomplete or fails', async () => {
    const { prisma } = makePrisma(null)
    const adapter = makeAdapter()
    const sentinel = new Error('incomplete-baseline')
    dependencyMocks.traverseColdStartBaseline.mockRejectedValue(sentinel)

    await expect(
      runColdStartMonitor({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 2 }),
    ).rejects.toBe(sentinel)

    expect(dependencyMocks.commitColdStartBaseline).not.toHaveBeenCalled()
  })
})
