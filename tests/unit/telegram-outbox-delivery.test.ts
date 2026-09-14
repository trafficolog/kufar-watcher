import { describe, expect, it, vi } from 'vitest'

import {
  TelegramSendFailure,
  createTelegramOutboxDelivery,
} from '../../electron/worker/telegram-outbox-delivery'

const OPEN_URL = 'https://www.kufar.by/item/123'

function createRepository(notifiedAt: Date | null = null) {
  return {
    getNotifiedAt: vi.fn(async (): Promise<Date | null | undefined> => notifiedAt),
    markSending: vi.fn(async () => undefined),
    markNotified: vi.fn(async () => undefined),
  }
}

describe('Telegram outbox delivery', () => {
  it('marks Match sending before Telegram receives the external side effect', async () => {
    const calls: string[] = []
    const repository = createRepository()
    repository.markSending.mockImplementation(async () => {
      calls.push('sending')
    })
    repository.markNotified.mockImplementation(async () => {
      calls.push('mark')
    })
    const sendMessage = vi.fn(async () => {
      calls.push('send')
    })
    const deliveredAt = new Date('2026-09-13T12:00:00.000Z')
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      now: () => deliveredAt,
      sleep: async () => undefined,
    })

    await delivery({ matchId: 11, chatId: '42', text: 'hello', openUrl: OPEN_URL })

    expect(calls).toEqual(['sending', 'send', 'mark'])
    expect(repository.markSending).toHaveBeenCalledWith(11, deliveredAt)
    expect(repository.markNotified).toHaveBeenCalledWith(11, deliveredAt)
  })

  it('does not resend a Match that is already notified', async () => {
    const repository = createRepository(new Date('2026-09-13T11:00:00.000Z'))
    const sendMessage = vi.fn(async () => undefined)
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      sleep: async () => undefined,
    })

    await delivery({ matchId: 11, chatId: '42', text: 'hello', openUrl: OPEN_URL })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(repository.markNotified).not.toHaveBeenCalled()
  })

  it('treats a deleted Match as an idempotent no-op', async () => {
    const repository = createRepository()
    repository.getNotifiedAt.mockResolvedValue(undefined)
    const sendMessage = vi.fn(async () => undefined)
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      sleep: async () => undefined,
    })

    await delivery({ matchId: 404, chatId: '42', text: 'stale job', openUrl: OPEN_URL })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('rethrows transient send failures for pg-boss retry without marking notified', async () => {
    const repository = createRepository()
    const failure = new TelegramSendFailure('transient')
    const sendMessage = vi.fn(async () => {
      throw failure
    })
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      sleep: async () => undefined,
    })

    await expect(
      delivery({ matchId: 11, chatId: '42', text: 'hello', openUrl: OPEN_URL }),
    ).rejects.toBe(failure)
    expect(repository.markNotified).not.toHaveBeenCalled()
  })

  it('consumes permanent send failures without retry and emits only a fixed journal message', async () => {
    const repository = createRepository()
    const sendMessage = vi.fn(async () => {
      throw new TelegramSendFailure('permanent')
    })
    const publishJournal = vi.fn()
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      publishJournal,
      sleep: async () => undefined,
    })

    await delivery({ matchId: 11, chatId: '42', text: 'hello', openUrl: OPEN_URL })

    expect(repository.markNotified).not.toHaveBeenCalled()
    expect(publishJournal).toHaveBeenCalledWith('Telegram notification permanently rejected')
  })

  it('spaces twenty attempts to the same chat by at least 3.1 seconds', async () => {
    let nowMs = Date.parse('2026-09-13T12:00:00.000Z')
    const repository = createRepository()
    const attempts: number[] = []
    const sleeps: number[] = []
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage: async () => {
        attempts.push(nowMs)
      },
      now: () => new Date(nowMs),
      sleep: async (delayMs) => {
        sleeps.push(delayMs)
        nowMs += delayMs
      },
    })

    for (let index = 1; index <= 20; index += 1) {
      await delivery({
        matchId: index,
        chatId: '42',
        text: `message-${index}`,
        openUrl: OPEN_URL,
      })
    }

    expect(attempts).toHaveLength(20)
    for (let index = 1; index < attempts.length; index += 1) {
      expect((attempts[index] as number) - (attempts[index - 1] as number)).toBeGreaterThanOrEqual(
        3_100,
      )
    }
    expect(sleeps).toEqual(Array.from({ length: 19 }, () => 3_100))
  })
})
