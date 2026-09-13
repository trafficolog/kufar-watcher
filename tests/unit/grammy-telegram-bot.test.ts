import { describe, expect, it, vi } from 'vitest'

import {
  createGrammyTelegramBotFactory,
  type GrammyBotLike,
  type GrammyContextLike,
} from '../../electron/worker/grammy-telegram-bot'
import type { TelegramBotHandlers } from '../../electron/worker/telegram-bot-service'

function createHarness(startError?: Error) {
  const listeners = new Map<string, (context: GrammyContextLike) => Promise<void>>()
  let errorHandler: (() => void) | undefined
  const bot: GrammyBotLike = {
    on: vi.fn((filter, handler) => {
      listeners.set(filter, handler)
    }),
    catch: vi.fn((handler) => {
      errorHandler = handler
    }),
    start: vi.fn(async () => {
      if (startError) throw startError
    }),
    stop: vi.fn(async () => undefined),
    api: {
      sendMessage: vi.fn(async () => undefined),
    },
  }
  const createBot = vi.fn(() => bot)
  const handlers: TelegramBotHandlers = {
    onMessage: vi.fn(async () => undefined),
    onCallbackQuery: vi.fn(async () => undefined),
  }
  const onError = vi.fn()
  const factory = createGrammyTelegramBotFactory(createBot)
  const transport = factory('SECRET_SENTINEL_3_1_1', handlers, onError)

  return { bot, createBot, handlers, onError, transport, listeners, errorHandler: () => errorHandler }
}

describe('grammY Telegram adapter', () => {
  it('normalizes private message metadata before handing it to the domain service', async () => {
    const harness = createHarness()

    await harness.listeners.get('message')?.({
      chat: {
        id: 1001,
        type: 'private',
        first_name: 'Ada',
        last_name: 'Lovelace',
        username: 'ada',
      },
    })

    expect(harness.handlers.onMessage).toHaveBeenCalledWith({
      chatId: '1001',
      chatType: 'private',
      displayName: 'Ada Lovelace',
      username: 'ada',
    })
  })

  it('uses a group title as the candidate display name', async () => {
    const harness = createHarness()

    await harness.listeners.get('message')?.({
      chat: { id: -2002, type: 'supergroup', title: 'Deals' },
    })

    expect(harness.handlers.onMessage).toHaveBeenCalledWith({
      chatId: '-2002',
      chatType: 'supergroup',
      displayName: 'Deals',
    })
  })

  it('forwards callback-query chat identity without performing product actions', async () => {
    const harness = createHarness()

    await harness.listeners.get('callback_query')?.({
      chat: { id: 1001, type: 'private', first_name: 'Ada' },
    })
    await harness.listeners.get('callback_query')?.({})

    expect(harness.handlers.onCallbackQuery).toHaveBeenNthCalledWith(1, '1001')
    expect(harness.handlers.onCallbackQuery).toHaveBeenNthCalledWith(2, null)
  })

  it('maps grammY handler and polling failures to redacted error kinds', async () => {
    const harness = createHarness(new Error('SECRET_SENTINEL_3_1_1'))

    harness.errorHandler()?.()
    harness.transport.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.onError).toHaveBeenCalledWith('handler')
    expect(harness.onError).toHaveBeenCalledWith('polling')
    expect(JSON.stringify(harness.onError.mock.calls)).not.toContain('SECRET_SENTINEL_3_1_1')
  })

  it('delegates send and graceful stop to grammY', async () => {
    const harness = createHarness()

    await harness.transport.sendMessage('1001', 'hello')
    await harness.transport.stop()

    expect(harness.bot.api.sendMessage).toHaveBeenCalledWith('1001', 'hello')
    expect(harness.bot.stop).toHaveBeenCalledOnce()
  })
})
