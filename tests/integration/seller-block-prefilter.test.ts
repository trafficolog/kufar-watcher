import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { runMonitorCycle } from '../../electron/worker/monitor-cycle'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import type { Prisma } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'

const dependencyMocks = vi.hoisted(() => ({
  runIncrementalMonitor: vi.fn(),
}))

vi.mock('../../electron/worker/incremental-monitor-run', () => ({
  runIncrementalMonitor: dependencyMocks.runIncrementalMonitor,
}))

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 914_302
const BLOCKED_FIRST = 'seller-block-integration-first'
const BLOCKED_SECOND = 'seller-block-integration-second'
const QUERY = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones', 'smartphones'],
  extraParams: {},
}
const adapter = { fetchPage: vi.fn() } as SourceAdapter

function listing(accountId: string): Listing {
  return {
    listId: `listing-${accountId}`,
    title: 'Seller blacklist integration candidate',
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/${accountId}`,
    region: 'minsk',
    accountId,
    isCompany: false,
    listTime: '2026-09-12T08:00:00.000Z',
    description: null,
    raw: { source: 'integration' },
  }
}

integrationDescribe('seller block prefilter', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    dependencyMocks.runIncrementalMonitor.mockReset().mockResolvedValue({
      kind: 'complete',
      newListings: [],
      nextWatermark: {
        boundaryTime: '2026-09-12T08:00:00.000Z',
        boundaryIds: ['integration'],
      },
      pagesRead: 1,
      possibleMiss: false,
      checkpoint: null,
    })

    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.sellerBlock.deleteMany({
      where: { accountId: { in: [BLOCKED_FIRST, BLOCKED_SECOND] } },
    })
    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'seller-blacklist-integration',
        sourceUrl: 'https://www.kufar.by/l/electronics?query=phone',
        query: QUERY as unknown as Prisma.InputJsonValue,
        intervalSec: 60,
        keywords: ['phone'],
        searchInDescription: false,
        state: 'active',
      },
    })
    await prisma.monitorCursor.create({
      data: {
        monitorId: MONITOR_ID,
        boundaryTime: new Date('2026-09-12T07:59:00.000Z'),
        boundaryIds: ['known'],
      },
    })
  })

  it('uses current SellerBlock rows on the next cycle without restarting the runtime', async () => {
    await prisma.sellerBlock.create({ data: { accountId: BLOCKED_FIRST } })

    await runMonitorCycle({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    await prisma.sellerBlock.delete({ where: { accountId: BLOCKED_FIRST } })
    await prisma.sellerBlock.create({ data: { accountId: BLOCKED_SECOND } })

    await runMonitorCycle({ prisma, monitorId: MONITOR_ID, adapter, maxPages: 3 })

    expect(dependencyMocks.runIncrementalMonitor).toHaveBeenCalledTimes(2)
    const firstPrefilter = dependencyMocks.runIncrementalMonitor.mock.calls[0]?.[0]?.prefilter as
      | { accept(listing: Listing): Promise<boolean> }
      | undefined
    const secondPrefilter = dependencyMocks.runIncrementalMonitor.mock.calls[1]?.[0]?.prefilter as
      | { accept(listing: Listing): Promise<boolean> }
      | undefined
    expect(firstPrefilter).toBeDefined()
    expect(secondPrefilter).toBeDefined()

    await expect(firstPrefilter?.accept(listing(BLOCKED_FIRST))).resolves.toBe(false)
    await expect(firstPrefilter?.accept(listing(BLOCKED_SECOND))).resolves.toBe(true)
    await expect(secondPrefilter?.accept(listing(BLOCKED_FIRST))).resolves.toBe(true)
    await expect(secondPrefilter?.accept(listing(BLOCKED_SECOND))).resolves.toBe(false)
  })
})
