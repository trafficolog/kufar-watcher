import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { commitMonitorRun } from '../../electron/worker/monitor-run-persistence'
import type { MonitorRunPersistenceInput } from '../../electron/worker/monitor-run-persistence'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import type { Listing } from '../../shared/listing'
import type { Watermark, WatermarkCatchUpCheckpoint } from '../../shared/watermark'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 914_400
const LISTING_ID = 'it-1-4-4-catch-up-listing'
const OLD_WATERMARK: Watermark = {
  boundaryTime: '2026-09-08T10:00:00.000Z',
  boundaryIds: ['old-boundary'],
}
const NEW_WATERMARK: Watermark = {
  boundaryTime: '2026-09-08T10:05:00.000Z',
  boundaryIds: [LISTING_ID],
}
const CHECKPOINT: WatermarkCatchUpCheckpoint = {
  resumeCursor: 'page-3',
  pendingWatermark: NEW_WATERMARK,
  pagesRead: 2,
  lastObservation: {
    page: 2,
    index: 4,
    listId: 'last-seen',
    listTime: '2026-09-08T10:02:00.000Z',
  },
}

function listing(): Listing {
  return {
    listId: LISTING_ID,
    title: 'Catch-up listing',
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: 'https://fixtures.invalid/catch-up-listing',
    region: 'minsk',
    accountId: null,
    isCompany: false,
    listTime: NEW_WATERMARK.boundaryTime,
    description: null,
    raw: { source: 'catch-up-test' },
  }
}

integrationDescribe('watermark catch-up persistence', () => {
  let prisma: ReturnType<typeof createPrismaClient>
  let expectedCursorUpdatedAt = new Date(0)

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.listing.deleteMany({ where: { listId: LISTING_ID } })

    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'watermark-catch-up-persistence',
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

  function input(
    nextWatermark: Watermark,
    checkpoint: WatermarkCatchUpCheckpoint | null,
  ): MonitorRunPersistenceInput & {
    checkpoint: WatermarkCatchUpCheckpoint | null
  } {
    const candidate = listing()
    return {
      monitorId: MONITOR_ID,
      startedAt: new Date('2026-09-08T10:06:00.000Z'),
      finishedAt: new Date('2026-09-08T10:06:05.000Z'),
      expectedCursorUpdatedAt,
      candidates: [candidate],
      selected: [
        {
          listing: candidate,
          selection: { matchedTerms: [], matchedIn: [], snippet: null },
        },
      ],
      nextWatermark,
      checkpoint,
    }
  }

  async function seedCheckpoint(): Promise<void> {
    await prisma.monitorCatchUpCheckpoint.create({
      data: {
        monitorId: MONITOR_ID,
        resumeCursor: CHECKPOINT.resumeCursor,
        pendingBoundaryTime: new Date(CHECKPOINT.pendingWatermark.boundaryTime),
        pendingBoundaryIds: [...CHECKPOINT.pendingWatermark.boundaryIds],
        pagesRead: CHECKPOINT.pagesRead,
        lastPage: CHECKPOINT.lastObservation?.page ?? null,
        lastIndex: CHECKPOINT.lastObservation?.index ?? null,
        lastListId: CHECKPOINT.lastObservation?.listId ?? null,
        lastListTime:
          CHECKPOINT.lastObservation === null
            ? null
            : new Date(CHECKPOINT.lastObservation.listTime),
      },
    })
  }

  it('commits an incomplete chunk without advancing the stable watermark', async () => {
    await commitMonitorRun(prisma, input(OLD_WATERMARK, CHECKPOINT))

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(OLD_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(OLD_WATERMARK.boundaryIds)

    const checkpoint = await prisma.monitorCatchUpCheckpoint.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(checkpoint.resumeCursor).toBe('page-3')
    expect(checkpoint.pendingBoundaryTime.toISOString()).toBe(NEW_WATERMARK.boundaryTime)
    expect(checkpoint.pendingBoundaryIds).toEqual(NEW_WATERMARK.boundaryIds)
    expect(checkpoint.pagesRead).toBe(2)
    expect(checkpoint.lastPage).toBe(2)
    expect(checkpoint.lastIndex).toBe(4)
    expect(checkpoint.lastListId).toBe('last-seen')
    expect(checkpoint.lastListTime?.toISOString()).toBe('2026-09-08T10:02:00.000Z')

    const run = await prisma.run.findFirstOrThrow({ where: { monitorId: MONITOR_ID } })
    expect(run.outcome).toBe('success')
    expect(run.degradedLevel).toBe('watermark-catch-up')
  })

  it('clears the checkpoint when the catch-up completes and advances the stable watermark', async () => {
    await seedCheckpoint()

    await commitMonitorRun(prisma, input(NEW_WATERMARK, null))

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(NEW_WATERMARK.boundaryTime)
    expect(cursor.boundaryIds).toEqual(NEW_WATERMARK.boundaryIds)
    expect(
      await prisma.monitorCatchUpCheckpoint.findUnique({ where: { monitorId: MONITOR_ID } }),
    ).toBeNull()

    const run = await prisma.run.findFirstOrThrow({ where: { monitorId: MONITOR_ID } })
    expect(run.degradedLevel).toBeNull()
  })

  it('removes the checkpoint by database cascade when the owning cursor is deleted', async () => {
    await seedCheckpoint()

    await prisma.monitorCursor.delete({ where: { monitorId: MONITOR_ID } })

    expect(
      await prisma.monitorCatchUpCheckpoint.findUnique({ where: { monitorId: MONITOR_ID } }),
    ).toBeNull()
  })
})
