import type { PrismaClient } from '../../generated/prisma/client'
import type { TelegramOutboxDeliveryRepository } from './telegram-outbox-delivery'

export function createPrismaTelegramOutboxDeliveryRepository(
  prisma: PrismaClient,
): TelegramOutboxDeliveryRepository {
  return {
    async getNotifiedAt(matchId): Promise<Date | null | undefined> {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: { notifiedAt: true },
      })
      return match?.notifiedAt
    },

    async getSendingAt(matchId): Promise<Date | null | undefined> {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: { notificationSendingAt: true },
      })
      return match?.notificationSendingAt
    },

    async markSending(matchId, sendingAt): Promise<void> {
      await prisma.match.updateMany({
        where: { id: matchId, notifiedAt: null },
        data: { notificationSendingAt: sendingAt },
      })
    },

    async markNotified(matchId, notifiedAt): Promise<void> {
      await prisma.match.updateMany({
        where: { id: matchId, notifiedAt: null },
        data: { notifiedAt, notificationSendingAt: null },
      })
    },
  }
}
