import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runIncrementalMonitor } from '../../electron/worker/incremental-monitor-run'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import type { Prisma } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter } from '../../shared/source-adapter'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 922_203
const LISTING_PREFIX = 'it-2-2-3-'
const OLD_BOUNDARY_TIME = '2026-09-09T17:00:00.000Z'
const QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'candidate',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones'],
  extraParams: {},
}

function listing(id: string, title: string, listTime: string): Listing {
  return {
    listId: `${LISTING_PREFIX}${id}`,
    title,
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://fixtures.invalid/listing/${id}`,
    region: 'minsk',
    accountId: null,
    isCompany: false,
    listTime,
    description: null,
    raw: { fixture: id },
  }
}

const MATCHED_LISTING = listing(
  'matched',
  'Продам почти новый смартфон в полном комплекте с коробкой, документами и гарантией. ' +
    'Модель Candidate находится в середине длинного заголовка, после чего идут дополнительные характеристики, состояние корпуса, комплект поставки и условия продажи.',
  '2026-09-09T18:00:00.000Z',
)
const REJECTED_LISTING = listing(
  'rejected',
  'Candidate blocked — объявление должно сохраниться без Match',
  '2026-09-09T17:59:00.000Z',
)
const BOUNDARY_LISTING = listing('known-old', 'Known boundary', OLD_BOUNDARY_TIME)

integrationDescribe('matcher pipeline persistence', () => {
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
    await prisma.listing.deleteMany({
      where: { listId: { startsWith: LISTING_PREFIX } },
    })

    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'matcher-pipeline-integration',
        sourceUrl: 'https://fixtures.invalid/search',
        query: QUERY as unknown as Prisma.InputJsonValue,
        intervalSec: 60,
        keywords: {
          include: ['candidate'],
          exclude: ['blocked'],
        } as Prisma.InputJsonValue,
        searchInDescription: false,
      },
    })
    await prisma.monitorCursor.create({
      data: {
        monitorId: MONITOR_ID,
        boundaryTime: new Date(OLD_BOUNDARY_TIME),
        boundaryIds: [BOUNDARY_LISTING.listId],
      },
    })
  })

  it('persists every candidate but creates Match only for the accepted listing', async () => {
    const adapter: SourceAdapter = {
      async fetchPage() {
        return {
          listings: [MATCHED_LISTING, REJECTED_LISTING, BOUNDARY_LISTING],
          nextCursor: null,
        }
      },
    }
    const timestamps = [
      new Date('2026-09-09T18:01:00.000Z'),
      new Date('2026-09-09T18:01:05.000Z'),
    ]

    await runIncrementalMonitor({
      prisma,
      monitorId: MONITOR_ID,
      adapter,
      maxPages: 1,
      now: () => timestamps.shift()!,
    })

    expect(
      await prisma.listing.count({ where: { listId: { startsWith: LISTING_PREFIX } } }),
    ).toBe(2)
    expect(
      await prisma.listing.findUnique({ where: { listId: REJECTED_LISTING.listId } }),
    ).not.toBeNull()

    const matches = await prisma.match.findMany({
      where: { monitorId: MONITOR_ID },
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.listingId).toBe(MATCHED_LISTING.listId)
    expect(matches[0]?.matchedTerms).toEqual(['candidate'])
    expect(matches[0]?.matchedIn).toEqual(['title'])
    expect(matches[0]?.snippet).toContain('Candidate')
    expect(matches[0]?.snippet?.length).toBeLessThanOrEqual(160)

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(MATCHED_LISTING.listTime)
    expect(cursor.boundaryIds).toEqual([MATCHED_LISTING.listId])

    const run = await prisma.run.findFirstOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(run.seen).toBe(2)
    expect(run.matched).toBe(1)
  })
})
