import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  commitColdStartBaseline,
  type ColdStartPersistenceInput,
} from '../../electron/worker/cold-start-persistence'
import { updateMonitorConfig } from '../../electron/worker/monitor-config-persistence'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import type { Prisma } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 914_203
const LISTING_ID = 'it-1-4-3-cold-start'
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
  extraParams: { condition: ['used'] },
}

const listing: Listing = {
  listId: LISTING_ID,
  title: 'Cold-start baseline',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://fixtures.invalid/listing/cold-start',
  region: 'minsk',
  accountId: null,
  isCompany: false,
  listTime: '2026-09-08T11:59:00.000Z',
  description: null,
  raw: { fixture: 'cold-start' },
}

function baselineInput(): ColdStartPersistenceInput {
  return {
    monitorId: MONITOR_ID,
    startedAt: new Date('2026-09-08T12:00:00.000Z'),
    finishedAt: new Date('2026-09-08T12:00:02.000Z'),
    source: { sourceUrl: SOURCE_URL, query: QUERY, state: 'active' },
    expectedCursor: { kind: 'missing' },
    listings: [listing],
    nextWatermark: {
      boundaryTime: listing.listTime,
      boundaryIds: [listing.listId],
    },
  }
}

integrationDescribe('cold-start persistence preconditions', () => {
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
    await prisma.listing.deleteMany({ where: { listId: LISTING_ID } })

    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'cold-start-fixture',
        sourceUrl: SOURCE_URL,
        query: QUERY as unknown as Prisma.InputJsonValue,
        intervalSec: 60,
        keywords: [],
      },
    })
  })

  async function expectNoBaselineWrites(): Promise<void> {
    expect(await prisma.listing.findUnique({ where: { listId: LISTING_ID } })).toBeNull()
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
  }

  it('commits listing, initialized cursor, and success run without matches', async () => {
    await commitColdStartBaseline(prisma, baselineInput())

    expect(await prisma.listing.findUnique({ where: { listId: LISTING_ID } })).not.toBeNull()
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(listing.listTime)
    expect(cursor.boundaryIds).toEqual([LISTING_ID])

    const run = await prisma.run.findFirstOrThrow({ where: { monitorId: MONITOR_ID } })
    expect(run.outcome).toBe('success')
    expect(run.seen).toBe(1)
    expect(run.matched).toBe(0)
  })

  it('rejects a stale baseline after a source edit before any writes', async () => {
    await updateMonitorConfig(prisma, MONITOR_ID, {
      sourceUrl: 'https://www.kufar.by/l/cars',
    })

    await expect(commitColdStartBaseline(prisma, baselineInput())).rejects.toThrow(/stale/i)

    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).toBeNull()
    await expectNoBaselineWrites()
  })

  it('rejects a stale baseline after a competing cold start initializes the cursor', async () => {
    await prisma.monitorCursor.create({
      data: {
        monitorId: MONITOR_ID,
        boundaryTime: new Date('2026-09-08T11:58:00.000Z'),
        boundaryIds: ['winner'],
      },
    })

    await expect(commitColdStartBaseline(prisma, baselineInput())).rejects.toThrow(/stale/i)

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryIds).toEqual(['winner'])
    await expectNoBaselineWrites()
  })
})
