import type { PrismaClient } from '../../generated/prisma/client'
import type { TelegramBindingRepository } from './telegram-bot-service'

export const TELEGRAM_BOUND_CHAT_SETTING_KEY = 'telegram.bound-chat'

export function createPrismaTelegramBindingRepository(
  prisma: PrismaClient,
): TelegramBindingRepository {
  return {
    async getBoundChatId(): Promise<string | null> {
      const setting = await prisma.setting.findUnique({
        where: { key: TELEGRAM_BOUND_CHAT_SETTING_KEY },
        select: { value: true },
      })
      return typeof setting?.value === 'string' ? setting.value : null
    },

    async setBoundChatId(chatId: string): Promise<void> {
      await prisma.setting.upsert({
        where: { key: TELEGRAM_BOUND_CHAT_SETTING_KEY },
        create: { key: TELEGRAM_BOUND_CHAT_SETTING_KEY, value: chatId },
        update: { value: chatId },
      })
    },
  }
}
