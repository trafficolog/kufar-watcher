import { describe, expect, it, vi } from 'vitest'

import {
  createTelegramBotService,
  type TelegramBotFactory,
  type TelegramBotTransport,
} from '../../electron/worker/telegram-bot-service'

const TEST_MESSAGE = 'Kufar Monitor: тестовое сообщение.'

describe('Telegram test-message service', () => {
  it('sends the fixed test message to the internally restored bound chat', async () => {
    const sendMessage = vi.fn(async () => undefined)
    const transport: TelegramBotTransport = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      sendMessage,
    }
    const createBot = vi.fn<TelegramBotFactory>(() => transport)
    const service = createTelegramBotService({
      repository: {
        getBoundChatId: vi.fn(async () => '1001'),
        setBoundChatId: vi.fn(async () => undefined),
      },
      createBot,
    })

    await service.configure('telegram-token')
    await service.sendTestMessage()

    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith('1001', TEST_MESSAGE)
  })
})
