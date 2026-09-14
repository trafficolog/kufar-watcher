import { describe, expect, it, vi } from 'vitest'

import {
  createGrammyTelegramBotFactory,
  type GrammyBotLike,
  type GrammyRunLike,
} from '../../electron/worker/grammy-telegram-bot'
import type { TelegramBotHandlers } from '../../electron/worker/telegram-bot-service'

interface TelegramVerifyingTransport {
  getMe(): Promise<{ username: string }>
}

describe('grammY Telegram token verification', () => {
  it('gets the bot identity without starting polling', async () => {
    const getMe = vi.fn(async () => ({ id: 42, is_bot: true, first_name: 'Kufar', username: 'kufar_watch_bot' }))
    const bot = {
      on: vi.fn(),
      catch: vi.fn(),
      api: {
        sendMessage: vi.fn(async () => undefined),
        getMe,
      },
    } as unknown as GrammyBotLike
    const runBot: GrammyRunLike = vi.fn(() => {
      throw new Error('polling must not start during token verification')
    })
    const handlers: TelegramBotHandlers = {
      onMessage: vi.fn(async () => undefined),
      onCallbackQuery: vi.fn(async () => undefined),
    }
    const transport = createGrammyTelegramBotFactory(() => bot, runBot)(
      'SECRET_SENTINEL_5_0_2_VERIFY',
      handlers,
      vi.fn(),
    ) as unknown as TelegramVerifyingTransport

    await expect(transport.getMe()).resolves.toEqual({ username: 'kufar_watch_bot' })
    expect(getMe).toHaveBeenCalledOnce()
    expect(runBot).not.toHaveBeenCalled()
  })
})
