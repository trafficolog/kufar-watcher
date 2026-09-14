import { describe, expect, it, vi } from 'vitest'

import {
  createTelegramBotService,
  type TelegramBindingRepository,
  type TelegramBotFactory,
  type TelegramBotTransport,
} from '../../electron/worker/telegram-bot-service'

interface TelegramTokenVerifier {
  verifyToken(token: string): Promise<{ username: string }>
}

describe('Telegram token verification service', () => {
  it('probes bot identity without starting polling or changing the binding', async () => {
    const repository: TelegramBindingRepository = {
      getBoundChatId: vi.fn(async () => '1001'),
      setBoundChatId: vi.fn(async () => undefined),
    }
    const start = vi.fn(async () => undefined)
    const stop = vi.fn(async () => undefined)
    const getMe = vi.fn(async () => ({ username: 'kufar_watch_bot' }))
    const createBot = vi.fn<TelegramBotFactory>(
      () =>
        ({
          start,
          stop,
          sendMessage: vi.fn(async () => undefined),
          getMe,
        }) as TelegramBotTransport & { getMe(): Promise<{ username: string }> },
    )
    const service = createTelegramBotService({
      repository,
      createBot,
      publishState: vi.fn(),
      publishChannelState: vi.fn(),
      publishCandidate: vi.fn(),
      publishJournal: vi.fn(),
    }) as unknown as TelegramTokenVerifier

    await expect(service.verifyToken('SECRET_SENTINEL_5_0_2_VERIFY')).resolves.toEqual({
      username: 'kufar_watch_bot',
    })

    expect(createBot).toHaveBeenCalledWith(
      'SECRET_SENTINEL_5_0_2_VERIFY',
      expect.any(Object),
      expect.any(Function),
    )
    expect(getMe).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    expect(repository.getBoundChatId).not.toHaveBeenCalled()
    expect(repository.setBoundChatId).not.toHaveBeenCalled()
  })
})
