import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Prisma } from '../../generated/prisma/client'
import { updateMonitorConfig } from '../../electron/worker/monitor-config-persistence'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import { commitMonitorRun, type MonitorRunPersistenceInput } from '../../electron/worker/monitor-run-persistence'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 914_202
const LISTING_ID = 'it-1-4-2-stale-config'
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
  title: 'Stale result',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://fixtures.invalid/listing/stale-result',
  region: 'minsk',
  accountId: null,
  isCompany: false,
  listTime: '2026-09-08T11:00:00.000Z',
  description: null,
  raw: { fixture: 'stale-config' },
}

function staleRunInput(): MonitorRunPersistenceInput {
  return {
    monitorId: MONITOR_ID,
    startedAt: new Date('2026-09-08T11:01:00.000Z'),
    finishedAt: new Date('2026-09-08T11:02:00.000Z'),
    candidates: [listing],
    selected: [
      {
        listing,
        selection: { matchedTerms: [], matchedIn: [], snippet: null },
      },
    ],
    nextWatermark: {
      boundaryTime: listing.listTime,
      boundaryIds: [listing.listId],
    },
  }
}

integrationDescribe('stale monitor-run commit after config reset', () => {
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
        name: 'stale-config-fixture',
        sourceUrl: SOURCE_URL,
        query: QUERY as unknown as Prisma.InputJsonValue,
        intervalSec: 60,
        keywords: [],
      },
    })
    await prisma.monitorCursor.create({
      data: {
        monitorId: MONITOR_ID,
        boundaryTime: new Date('2026-09-08T10:00:00.000Z'),
        boundaryIds: ['known'],
      },
    })
  })

  it('rejects a stale result after source edit reset instead of recreating the cursor', async () => {
    await updateMonitorConfig(prisma, MONITOR_ID, {
      sourceUrl: 'https://www.kufar.by/l/cars',
    })
    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).toBeNull()

    await expect(commitMonitorRun(prisma, staleRunInput())).rejects.toThrow(/stale|cursor/i)

    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).toBeNull()
    expect(await prisma.listing.findUnique({ where: { listId: LISTING_ID } })).toBeNull()
    expect(await prisma.match.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
    expect(await prisma.run.count({ where: { monitorId: MONITOR_ID } })).toBe(0)
  })
})
