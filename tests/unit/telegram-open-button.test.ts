import { describe, expect, it, vi } from 'vitest'

import {
  createGrammyTelegramBotFactory,
  type GrammyBotLike,
  type GrammyRunnerHandleLike,
  type GrammyRunLike,
} from '../../electron/worker/grammy-telegram-bot'
import {
  createTelegramBotService,
  type TelegramBotFactory,
  type TelegramBotTransport,
} from '../../electron/worker/telegram-bot-service'
import { createTelegramOutboxDelivery } from '../../electron/worker/telegram-outbox-delivery'
import { createPgBossTelegramOutboxQueue } from '../../electron/worker/telegram-outbox-queue'

const OPEN_URL = 'https://www.kufar.by/item/123'

interface FakeJob {
  data: unknown
}

class FakePgBoss {
  queue: object | null = { name: 'telegram-outbox' }
  readonly sent: object[] = []
  private workHandler: ((jobs: FakeJob[]) => Promise<void>) | undefined

  on(_event: 'error', _handler: (error: unknown) => void): this {
    return this
  }

  async start(): Promise<this> {
    return this
  }

  async stop(): Promise<void> {}

  async getQueue(_name: string): Promise<object | null> {
    return this.queue
  }

  async createQueue(_name: string, _options: object): Promise<void> {}

  async send(_name: string, data: object): Promise<string> {
    this.sent.push(data)
    return 'job-1'
  }

  async work(
    _name: string,
    _options: { batchSize: number },
    handler: (jobs: FakeJob[]) => Promise<void>,
  ): Promise<string> {
    this.workHandler = handler
    return 'worker-1'
  }

  async offWork(_name: string, _options: { id: string; wait: boolean }): Promise<void> {}

  async dispatch(data: unknown): Promise<void> {
    if (!this.workHandler) throw new Error('Expected Telegram outbox worker')
    await this.workHandler([{ data }])
  }
}

function openPayload(openUrl = OPEN_URL) {
  return { matchId: 17, chatId: '1001', text: '<b>notification</b>', openUrl }
}

function createServiceHarness(boundChatId = '1001') {
  const sendMessage = vi.fn(async () => undefined)
  const transport: TelegramBotTransport = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    sendMessage,
  }
  const createBot = vi.fn<TelegramBotFactory>(() => transport)
  const service = createTelegramBotService({
    repository: {
      getBoundChatId: vi.fn(async () => boundChatId),
      setBoundChatId: vi.fn(async () => undefined),
    },
    createBot,
  })

  return { service, sendMessage }
}

describe('Telegram open button', () => {
  it('preserves the human listing URL through the durable outbox payload', async () => {
    const boss = new FakePgBoss()
    const handler = vi.fn(async () => undefined)
    const queue = createPgBossTelegramOutboxQueue('postgresql://outbox', vi.fn(), () => boss)
    await queue.start(handler)

    await queue.enqueue(openPayload())
    await boss.dispatch(openPayload())

    expect(boss.sent).toEqual([openPayload()])
    expect(handler).toHaveBeenCalledWith(openPayload())
  })

  it.each([
    'https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040',
    'https://kufar.by.evil.example/item/123',
    'javascript:alert(1)',
  ])('rejects a non-human open URL before it can enter the outbox: %s', async (openUrl) => {
    const boss = new FakePgBoss()
    const queue = createPgBossTelegramOutboxQueue('postgresql://outbox', vi.fn(), () => boss)
    await queue.start(async () => undefined)

    await expect(queue.enqueue(openPayload(openUrl))).rejects.toThrow(
      /invalid telegram outbox payload/i,
    )
    expect(boss.sent).toEqual([])
  })

  it('forwards openUrl from delivery to the bound Telegram send', async () => {
    const sendMessage = vi.fn(async () => undefined)
    const delivery = createTelegramOutboxDelivery({
      repository: {
        getNotifiedAt: vi.fn(async () => null),
        getSendingAt: vi.fn(async () => null),
        markSending: vi.fn(async () => undefined),
        markNotified: vi.fn(async () => undefined),
      },
      sendMessage,
      sleep: async () => undefined,
    })

    await delivery(openPayload())

    expect(sendMessage).toHaveBeenCalledWith('1001', '<b>notification</b>', {
      openUrl: OPEN_URL,
    })
  })

  it('sends Telegram HTML with one URL button to the listing page', async () => {
    const apiSendMessage = vi.fn(async () => undefined)
    const bot: GrammyBotLike = {
      on: vi.fn(),
      catch: vi.fn(),
      api: { sendMessage: apiSendMessage },
    }
    const runner: GrammyRunnerHandleLike = {
      task: vi.fn(() => undefined),
      isRunning: vi.fn(() => false),
      stop: vi.fn(async () => undefined),
    }
    const runBot: GrammyRunLike = vi.fn(() => runner)
    const transport = createGrammyTelegramBotFactory(() => bot, runBot)(
      'token',
      {
        onMessage: vi.fn(async () => undefined),
        onCallbackQuery: vi.fn(async () => undefined),
      },
      vi.fn(),
    )

    await transport.sendMessage('1001', '<b>notification</b>', { openUrl: OPEN_URL })

    expect(apiSendMessage).toHaveBeenCalledWith('1001', '<b>notification</b>', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть', url: OPEN_URL }]],
      },
    })
  })

  it('keeps the bound-chat guard and rejects stale notification targets', async () => {
    const { service, sendMessage } = createServiceHarness('1001')
    await service.configure('token')

    await service.sendMessage('1001', '<b>notification</b>', { openUrl: OPEN_URL })
    expect(sendMessage).toHaveBeenCalledWith('1001', '<b>notification</b>', {
      openUrl: OPEN_URL,
    })

    const failure = await service
      .sendMessage('2002', '<b>notification</b>', { openUrl: OPEN_URL })
      .catch((error) => error)

    expect(failure).toMatchObject({ kind: 'permanent', message: 'Telegram send failed' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
