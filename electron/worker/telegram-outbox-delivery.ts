import type { TelegramOutboxHandler } from './telegram-outbox-queue'

export type TelegramSendFailureKind = 'transient' | 'permanent'

export class TelegramSendFailure extends Error {
  constructor(
    readonly kind: TelegramSendFailureKind,
    message = 'Telegram send failed',
  ) {
    super(message)
    this.name = 'TelegramSendFailure'
  }
}

export interface TelegramOutboxDeliveryRepository {
  getNotifiedAt(matchId: number): Promise<Date | null | undefined>
  markNotified(matchId: number, notifiedAt: Date): Promise<void>
}

export interface TelegramOutboxDeliveryOptions {
  repository: TelegramOutboxDeliveryRepository
  sendMessage(chatId: string, text: string): Promise<void>
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

    const previousAttemptAt = lastAttemptAtByChat.get(payload.chatId)
    if (previousAttemptAt !== undefined) {
      const remainingDelayMs = minChatIntervalMs - (now().getTime() - previousAttemptAt)
      if (remainingDelayMs > 0) await sleep(remainingDelayMs)
    }

    lastAttemptAtByChat.set(payload.chatId, now().getTime())

    try {
      await options.sendMessage(payload.chatId, payload.text)
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
