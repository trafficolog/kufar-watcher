import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPrismaClient } from '../../electron/worker/prisma-client'
import { createPrismaTelegramOutboxDeliveryRepository } from '../../electron/worker/telegram-outbox-delivery-repository'
import type { Prisma } from '../../generated/prisma/client'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 931_313
const LISTING_ID = 'it-telegram-outbox-delivery'
const QUERY = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'telegram-outbox',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

integrationDescribe('Telegram outbox delivery repository', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.listing.deleteMany({ where: { listId: LISTING_ID } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.listing.deleteMany({ where: { listId: LISTING_ID } })

    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'telegram-outbox-delivery-integration',
        sourceUrl: 'https://fixtures.invalid/search',
        query: QUERY as Prisma.InputJsonValue,
        intervalSec: 60,
        keywords: { include: ['telegram-outbox'], exclude: [] } as Prisma.InputJsonValue,
      },
    })
    await prisma.listing.create({
      data: {
        listId: LISTING_ID,
        title: 'Telegram outbox fixture',
        priceKind: 'fixed',
        priceAmount: 100,
        currency: 'BYN',
        url: 'https://fixtures.invalid/listing/telegram-outbox',
        listTime: new Date('2026-09-13T12:00:00.000Z'),
        raw: { fixture: 'telegram-outbox' } as Prisma.InputJsonValue,
      },
    })
  })

  it('round-trips the notified timestamp and distinguishes a missing match', async () => {
    const match = await prisma.match.create({
      data: {
        monitorId: MONITOR_ID,
        listingId: LISTING_ID,
        matchedTerms: ['telegram-outbox'] as Prisma.InputJsonValue,
        matchedIn: ['title'] as Prisma.InputJsonValue,
      },
    })
    const repository = createPrismaTelegramOutboxDeliveryRepository(prisma)
    const notifiedAt = new Date('2026-09-13T12:05:00.000Z')

    await expect(repository.getNotifiedAt(match.id)).resolves.toBeNull()
    await repository.markNotified(match.id, notifiedAt)
    await expect(repository.getNotifiedAt(match.id)).resolves.toEqual(notifiedAt)
    await expect(repository.getNotifiedAt(match.id + 1_000_000)).resolves.toBeUndefined()
  })
})
