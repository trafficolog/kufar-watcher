import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPrismaClient } from '../../electron/worker/prisma-client'
import {
  commitMonitorRun,
  persistListingsAndMatches,
  persistMonitorCursor,
  persistSuccessfulRun,
  type MonitorRunPersistenceInput,
} from '../../electron/worker/monitor-run-persistence'
import type { Listing } from '../../shared/listing'
import type { Watermark, WatermarkTraversalResult } from '../../shared/watermark'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 914_200
const LISTING_PREFIX = 'it-1-4-2-run-'
const OLD_WATERMARK: Watermark = {
  boundaryTime: '2026-09-08T10:00:00.000Z',
  boundaryIds: ['old-boundary'],
}
const NEW_WATERMARK: Watermark = {
  boundaryTime: '2026-09-08T11:00:00.000Z',
  boundaryIds: [`${LISTING_PREFIX}a`],
}
let expectedCursorUpdatedAt = new Date(0)

function listing(id: string, title = `Listing ${id}`): Listing {
  return {
    listId: `${LISTING_PREFIX}${id}`,
    title,
    priceKind: 'fixed',
    priceAmount: '123.45',
    currency: 'BYN',
    url: `https://fixtures.invalid/listing/${id}`,
    region: 'minsk',
    accountId: `account-${id}`,
    isCompany: false,
    listTime: '2026-09-08T11:00:00.000Z',
    description: `Description ${id}`,
    raw: { fixture: id },
  }
}

function completeTraversal(nextWatermark: Watermark = NEW_WATERMARK): WatermarkTraversalResult {
  return {
    kind: 'complete',
    newListings: [listing('a'), listing('b')],
    nextWatermark,
    pagesRead: 2,
    possibleMiss: false,
    checkpoint: null,
  }
}

function incompleteTraversal(): WatermarkTraversalResult {
  return {
    kind: 'incomplete',
    newListings: [listing('a'), listing('b')],
    nextWatermark: OLD_WATERMARK,
    pagesRead: 1,
    possibleMiss: true,
    checkpoint: {
      resumeCursor: 'page-2',
      pendingWatermark: NEW_WATERMARK,
      lastObservation: {
        listId: `${LISTING_PREFIX}b`,
        listTime: '2026-09-08T10:30:00.000Z',
      },
    },
  }
}

function input(
  traversal: WatermarkTraversalResult = completeTraversal(),
): MonitorRunPersistenceInput {
  const first = listing('a')
  const second = listing('b')
  return {
    monitorId: MONITOR_ID,
    startedAt: new Date('2026-09-08T11:01:00.000Z'),
    finishedAt: new Date('2026-09-08T11:02:00.000Z'),
    expectedCursorUpdatedAt,
    candidates: [first, second],
    selected: [
      {
        listing: first,
        selection: { matchedTerms: [], matchedIn: [], snippet: null },
      },
    ],
    traversal,
  }
}

integrationDescribe('monitor run persistence', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.listing.deleteMany({ where: { listId: { startsWith: LISTING_PREFIX } } })

    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'integration-monitor-run-persistence',
        sourceUrl: 'https://fixtures.invalid/search',
        query: {},
        intervalSec: 60,
        keywords: [],
      },
    })

    const cursor = await prisma.monitorCursor.create({
      data: {
        monitorId: MONITOR_ID,
        boundaryTime: new Date(OLD_WATERMARK.boundaryTime),
        boundaryIds: [...OLD_WATERMARK.boundaryIds],
      },
    })
    expectedCursorUpdatedAt = cursor.updatedAt
  })

  async function refreshCursorRevision(): Promise<void> {
    expectedCursorUpdatedAt = (
      await prisma.monitorCursor.findUniqueOrThrow({ where: { monitorId: MONITOR_ID } })
    ).updatedAt
  }

  it('commits Listing Match Cursor and Run together', async () => {
    await commitMonitorRun(prisma, input())

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      2,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(1)

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(NEW_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(NEW_WATERMARK.boundaryIds)
    expect(cursor.catchupCursor).toBeNull()
    expect(cursor.catchupBoundaryTime).toBeNull()
    expect(cursor.catchupBoundaryIds).toEqual([])
    expect(cursor.catchupLastListTime).toBeNull()
    expect(cursor.catchupLastListId).toBeNull()
    expect(cursor.lastRunAt?.toISOString()).toBe('2026-09-08T11:02:00.000Z')

    const run = await prisma.run.findFirstOrThrow({ where: { monitorId: MONITOR_ID } })
    expect(run.outcome).toBe('success')
    expect(run.seen).toBe(2)
    expect(run.matched).toBe(1)
    expect(run.error).toBeNull()
    expect(run.httpStatus).toBeNull()
    expect(run.degradedLevel).toBeNull()
  })

  it('persists an incomplete catch-up chunk without advancing the confirmed watermark', async () => {
    await commitMonitorRun(prisma, input(incompleteTraversal()))

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      2,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(1)

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(OLD_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(OLD_WATERMARK.boundaryIds)
    expect(cursor.catchupCursor).toBe('page-2')
    expect(cursor.catchupBoundaryTime?.toISOString()).toBe(NEW_WATERMARK.boundaryTime)
    expect(cursor.catchupBoundaryIds).toEqual(NEW_WATERMARK.boundaryIds)
    expect(cursor.catchupLastListTime?.toISOString()).toBe('2026-09-08T10:30:00.000Z')
    expect(cursor.catchupLastListId).toBe(`${LISTING_PREFIX}b`)
    expect(cursor.lastRunAt?.toISOString()).toBe('2026-09-08T11:02:00.000Z')

    const run = await prisma.run.findFirstOrThrow({ where: { monitorId: MONITOR_ID } })
    expect(run.outcome).toBe('catchup')
    expect(run.seen).toBe(2)
    expect(run.matched).toBe(1)
    expect(run.degradedLevel).toBe('watermark-catchup')
  })

  it('promotes the pending watermark and clears checkpoint state on completion', async () => {
    await commitMonitorRun(prisma, input(incompleteTraversal()))
    await refreshCursorRevision()

    await commitMonitorRun(prisma, input(completeTraversal(NEW_WATERMARK)))

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(NEW_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(NEW_WATERMARK.boundaryIds)
    expect(cursor.catchupCursor).toBeNull()
    expect(cursor.catchupBoundaryTime).toBeNull()
    expect(cursor.catchupBoundaryIds).toEqual([])
    expect(cursor.catchupLastListTime).toBeNull()
    expect(cursor.catchupLastListId).toBeNull()
  })

  it('repeating the same result creates no second Match', async () => {
    await commitMonitorRun(prisma, input())
    await refreshCursorRevision()
    await commitMonitorRun(prisma, input())

    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(1)
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(2)
  })

  it('preserves Listing.firstSeenAt across upserts', async () => {
    await commitMonitorRun(prisma, input())
    const before = await prisma.listing.findUniqueOrThrow({
      where: { listId: `${LISTING_PREFIX}a` },
    })

    await refreshCursorRevision()
    const retry = input()
    retry.candidates = [listing('a', 'Updated title'), listing('b')]
    retry.selected = [
      {
        listing: retry.candidates[0]!,
        selection: { matchedTerms: ['future-term'], matchedIn: ['title'], snippet: 'future' },
      },
    ]
    await commitMonitorRun(prisma, retry)

    const after = await prisma.listing.findUniqueOrThrow({
      where: { listId: `${LISTING_PREFIX}a` },
    })
    expect(after.title).toBe('Updated title')
    expect(after.firstSeenAt.toISOString()).toBe(before.firstSeenAt.toISOString())

    const match = await prisma.match.findUniqueOrThrow({
      where: {
        monitorId_listingId: {
          monitorId: MONITOR_ID,
          listingId: `${LISTING_PREFIX}a`,
        },
      },
    })
    expect(match.matchedTerms).toEqual([])
    expect(match.matchedIn).toEqual([])
    expect(match.snippet).toBeNull()
  })

  it('rolls back when the callback throws before any persistence step', async () => {
    const sentinel = new Error('rollback-before-persistence')

    await expect(
      prisma.$transaction(async () => {
        throw sentinel
      }),
    ).rejects.toBe(sentinel)

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      0,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
  })

  it('rolls back Listing and Match when the callback throws before cursor write', async () => {
    const sentinel = new Error('rollback-before-cursor')
    const persistenceInput = input()

    await expect(
      prisma.$transaction(async (tx) => {
        await persistListingsAndMatches(tx, persistenceInput)
        throw sentinel
      }),
    ).rejects.toBe(sentinel)

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      0,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(OLD_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(OLD_WATERMARK.boundaryIds)
  })

  it('rolls back confirmed watermark and checkpoint together when the callback throws after cursor write', async () => {
    const sentinel = new Error('rollback-after-cursor')
    const persistenceInput = input(incompleteTraversal())

    await expect(
      prisma.$transaction(async (tx) => {
        await persistListingsAndMatches(tx, persistenceInput)
        await persistMonitorCursor(tx, persistenceInput)
        throw sentinel
      }),
    ).rejects.toBe(sentinel)

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      0,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(OLD_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(OLD_WATERMARK.boundaryIds)
    expect(cursor.catchupCursor).toBeNull()
    expect(cursor.catchupBoundaryTime).toBeNull()
    expect(cursor.catchupBoundaryIds).toEqual([])
    expect(cursor.catchupLastListTime).toBeNull()
    expect(cursor.catchupLastListId).toBeNull()
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
  })

  it('rolls back Listing Match Cursor and Run when callback throws after run write', async () => {
    const sentinel = new Error('rollback-after-run')
    const persistenceInput = input()

    await expect(
      prisma.$transaction(async (tx) => {
        await persistListingsAndMatches(tx, persistenceInput)
        await persistMonitorCursor(tx, persistenceInput)
        await persistSuccessfulRun(tx, persistenceInput)
        throw sentinel
      }),
    ).rejects.toBe(sentinel)

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      0,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(0)

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(OLD_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(OLD_WATERMARK.boundaryIds)
  })

  it('retries successfully after rollback', async () => {
    const persistenceInput = input()

    await expect(
      prisma.$transaction(async (tx) => {
        await persistListingsAndMatches(tx, persistenceInput)
        await persistMonitorCursor(tx, persistenceInput)
        throw new Error('simulate-process-interruption')
      }),
    ).rejects.toThrow('simulate-process-interruption')

    await commitMonitorRun(prisma, persistenceInput)

    expect(await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } })).toBe(
      2,
    )
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(1)
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(1)
  })
})
