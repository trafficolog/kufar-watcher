import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPrismaClient } from '../../electron/worker/prisma-client'
import { createTelegramOutboxDelivery } from '../../electron/worker/telegram-outbox-delivery'
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

  it('clears the durable sending marker when notification delivery is confirmed', async () => {
    const match = await prisma.match.create({
      data: {
        monitorId: MONITOR_ID,
        listingId: LISTING_ID,
        matchedTerms: ['telegram-outbox'] as Prisma.InputJsonValue,
        matchedIn: ['title'] as Prisma.InputJsonValue,
      },
    })
    const repository = createPrismaTelegramOutboxDeliveryRepository(prisma)
    const sendingAt = new Date('2026-09-13T12:05:30.000Z')
    const notifiedAt = new Date('2026-09-13T12:05:31.000Z')

    if (!repository.markSending) {
      throw new Error('Expected Prisma repository to support sending markers')
    }
    await repository.markSending(match.id, sendingAt)
    await repository.markNotified(match.id, notifiedAt)

    const persisted = await prisma.match.findUniqueOrThrow({ where: { id: match.id } })
    expect(persisted).toMatchObject({
      notifiedAt,
      notificationSendingAt: null,
    })
  })

  it('persists the sending timestamp before Telegram receives the external side effect', async () => {
    const match = await prisma.match.create({
      data: {
        monitorId: MONITOR_ID,
        listingId: LISTING_ID,
        matchedTerms: ['telegram-outbox'] as Prisma.InputJsonValue,
        matchedIn: ['title'] as Prisma.InputJsonValue,
      },
    })
    const repository = createPrismaTelegramOutboxDeliveryRepository(prisma)
    const sendingAt = new Date('2026-09-13T12:06:00.000Z')
    const observedSendingAt: Array<Date | null> = []
    const delivery = createTelegramOutboxDelivery({
      repository,
      now: () => sendingAt,
      sleep: async () => undefined,
      sendMessage: async () => {
        const columnRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Match'
              AND column_name = 'notificationSendingAt'
          ) AS "exists"
        `
        const columnExists = columnRows[0]?.exists === true
        expect(columnExists).toBe(true)
        if (!columnExists) return

        const markerRows = await prisma.$queryRaw<Array<{ notificationSendingAt: Date | null }>>`
          SELECT "notificationSendingAt"
          FROM "Match"
          WHERE "id" = ${match.id}
        `
        observedSendingAt.push(markerRows[0]?.notificationSendingAt ?? null)
      },
    })

    await delivery({
      matchId: match.id,
      chatId: '42',
      text: 'hello',
      openUrl: 'https://www.kufar.by/item/123',
    })

    expect(observedSendingAt).toEqual([sendingAt])
  })

  it('does not resend a confirmed notification after sender restart', async () => {
    const match = await prisma.match.create({
      data: {
        monitorId: MONITOR_ID,
        listingId: LISTING_ID,
        matchedTerms: ['telegram-outbox'] as Prisma.InputJsonValue,
        matchedIn: ['title'] as Prisma.InputJsonValue,
      },
    })
    const repository = createPrismaTelegramOutboxDeliveryRepository(prisma)
    const deliveredAt = new Date('2026-09-13T12:07:00.000Z')
    const firstSend = vi.fn(async () => undefined)
    const firstSender = createTelegramOutboxDelivery({
      repository,
      sendMessage: firstSend,
      now: () => deliveredAt,
      sleep: async () => undefined,
    })
    const payload = {
      matchId: match.id,
      chatId: '42',
      text: 'hello',
      openUrl: 'https://www.kufar.by/item/123',
    }

    await firstSender(payload)

    const restartedSend = vi.fn(async () => undefined)
    const restartedSender = createTelegramOutboxDelivery({
      repository,
      sendMessage: restartedSend,
      now: () => new Date('2026-09-13T12:08:00.000Z'),
      sleep: async () => undefined,
    })
    await restartedSender(payload)

    expect(firstSend).toHaveBeenCalledTimes(1)
    expect(restartedSend).not.toHaveBeenCalled()
    expect(await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
      notifiedAt: deliveredAt,
      notificationSendingAt: null,
    })
  })

  it('delivers after restart when the process dies after the durable marker but before send', async () => {
    const match = await prisma.match.create({
      data: {
        monitorId: MONITOR_ID,
        listingId: LISTING_ID,
        matchedTerms: ['telegram-outbox'] as Prisma.InputJsonValue,
        matchedIn: ['title'] as Prisma.InputJsonValue,
      },
    })
    const repository = createPrismaTelegramOutboxDeliveryRepository(prisma)
    const crashedAt = new Date('2026-09-13T12:09:00.000Z')
    const retriedAt = new Date('2026-09-13T12:10:00.000Z')

    if (!repository.markSending) {
      throw new Error('Expected Prisma repository to support sending markers')
    }
    await repository.markSending(match.id, crashedAt)

    const sendMessage = vi.fn(async () => undefined)
    const publishJournal = vi.fn()
    const restartedSender = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      publishJournal,
      now: () => retriedAt,
      sleep: async () => undefined,
    })

    await restartedSender({
      matchId: match.id,
      chatId: '42',
      text: 'hello',
      openUrl: 'https://www.kufar.by/item/123',
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(publishJournal).toHaveBeenCalledWith(
      'Telegram notification resent from uncertain state',
    )
    expect(await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
      notifiedAt: retriedAt,
      notificationSendingAt: null,
    })
  })

  it('allows one explained resend after Telegram acceptance when the final marker was not persisted', async () => {
    const match = await prisma.match.create({
      data: {
        monitorId: MONITOR_ID,
        listingId: LISTING_ID,
        matchedTerms: ['telegram-outbox'] as Prisma.InputJsonValue,
        matchedIn: ['title'] as Prisma.InputJsonValue,
      },
    })
    const repository = createPrismaTelegramOutboxDeliveryRepository(prisma)
    const acceptedAt = new Date('2026-09-13T12:11:00.000Z')
    const retriedAt = new Date('2026-09-13T12:12:00.000Z')
    const simulatedCrash = new Error('simulated crash before final notification marker')
    const acceptedSend = vi.fn(async () => undefined)
    const firstSender = createTelegramOutboxDelivery({
      repository: {
        ...repository,
        markNotified: vi.fn(async () => {
          throw simulatedCrash
        }),
      },
      sendMessage: acceptedSend,
      now: () => acceptedAt,
      sleep: async () => undefined,
    })
    const payload = {
      matchId: match.id,
      chatId: '42',
      text: 'hello',
      openUrl: 'https://www.kufar.by/item/123',
    }

    await expect(firstSender(payload)).rejects.toBe(simulatedCrash)
    expect(acceptedSend).toHaveBeenCalledTimes(1)
    expect(await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
      notifiedAt: null,
      notificationSendingAt: acceptedAt,
    })

    const retrySend = vi.fn(async () => undefined)
    const publishJournal = vi.fn()
    const restartedSender = createTelegramOutboxDelivery({
      repository,
      sendMessage: retrySend,
      publishJournal,
      now: () => retriedAt,
      sleep: async () => undefined,
    })
    await restartedSender(payload)

    expect(retrySend).toHaveBeenCalledTimes(1)
    expect(publishJournal).toHaveBeenCalledTimes(1)
    expect(publishJournal).toHaveBeenCalledWith(
      'Telegram notification resent from uncertain state',
    )
    expect(await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({
      notifiedAt: retriedAt,
      notificationSendingAt: null,
    })
  })
})
