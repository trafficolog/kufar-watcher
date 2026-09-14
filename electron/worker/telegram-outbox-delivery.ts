import type { TelegramNotificationSendOptions } from './telegram-bot-service'
import type { TelegramOutboxHandler } from './telegram-outbox-queue'
import { TelegramSendFailure } from './telegram-send-failure'

export { TelegramSendFailure } from './telegram-send-failure'
export type { TelegramSendFailureKind } from './telegram-send-failure'

export interface TelegramOutboxDeliveryRepository {
  getNotifiedAt(matchId: number): Promise<Date | null | undefined>
  getSendingAt(matchId: number): Promise<Date | null | undefined>
  markSending(matchId: number, sendingAt: Date): Promise<void>
  markNotified(matchId: number, notifiedAt: Date): Promise<void>
}

export interface TelegramOutboxDeliveryOptions {
  repository: TelegramOutboxDeliveryRepository
  sendMessage(
    chatId: string,
    text: string,
    options?: TelegramNotificationSendOptions,
  ): Promise<void>
  publishJournal?(message: string): void
  now?: () => Date
  sleep?: (delayMs: number) => Promise<void>
  minChatIntervalMs?: number
}

const DEFAULT_MIN_CHAT_INTERVAL_MS = 3_100

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function createTelegramOutboxDelivery(
  options: TelegramOutboxDeliveryOptions,
): TelegramOutboxHandler {
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? defaultSleep
  const minChatIntervalMs = options.minChatIntervalMs ?? DEFAULT_MIN_CHAT_INTERVAL_MS
  const lastAttemptAtByChat = new Map<string, number>()

  return async (payload) => {
    const notifiedAt = await options.repository.getNotifiedAt(payload.matchId)
    if (notifiedAt === undefined || notifiedAt !== null) return

    const sendingAt = await options.repository.getSendingAt(payload.matchId)
    if (sendingAt === undefined) return
    if (sendingAt !== null) {
      options.publishJournal?.('Telegram notification resent from uncertain state')
    }

    const previousAttemptAt = lastAttemptAtByChat.get(payload.chatId)
    if (previousAttemptAt !== undefined) {
      const remainingDelayMs = minChatIntervalMs - (now().getTime() - previousAttemptAt)
      if (remainingDelayMs > 0) await sleep(remainingDelayMs)
    }

    lastAttemptAtByChat.set(payload.chatId, now().getTime())
    await options.repository.markSending(payload.matchId, now())

    try {
      await options.sendMessage(payload.chatId, payload.text, { openUrl: payload.openUrl })
    } catch (error) {
      if (error instanceof TelegramSendFailure && error.kind === 'permanent') {
        options.publishJournal?.('Telegram notification permanently rejected')
        return
      }
      throw error
    }

    await options.repository.markNotified(payload.matchId, now())
  }
}
