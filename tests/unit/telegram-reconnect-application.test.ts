import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { MonitorScheduler } from '../../electron/worker/monitor-scheduler'
import type {
  TelegramBotService,
  TelegramBotServiceOptions,
} from '../../electron/worker/telegram-bot-service'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'
import type { WorkerEvent } from '../../shared/runtime'

describe('Telegram reconnect application wiring', () => {
  it('publishes channel state and delegates resume to the Telegram service', async () => {
    const publish = vi.fn<(event: WorkerEvent) => void>()
    const resume = vi.fn(async () => undefined)
    const telegramService: TelegramBotService = {
      configure: vi.fn(async () => undefined),
      resume,
      bindCandidate: vi.fn(async () => 'no-candidate' as const),
      sendMessage: vi.fn(async () => undefined),
      getState: vi.fn(() => 'not-configured' as const),
      getCandidate: vi.fn(() => null),
      getBoundChatId: vi.fn(() => null),
      stop: vi.fn(async () => undefined),
    }
    let telegramOptions: TelegramBotServiceOptions | undefined
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const prisma = {
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const dependencies = {
      createPrismaClient: () => prisma,
      createQueue: () => ({}),
      createRepository: () => ({}),
      createSourceRuntime: () => ({
        createRunAdapters: vi.fn(),
        descriptionLoader: { ensureDescription: vi.fn() },
        close: vi.fn(async () => undefined),
      }),
      createRunExecutor: () => vi.fn(),
      createScheduler: () => scheduler,
      createTelegramRepository: () => ({}),
      createTelegramBotFactory: () => vi.fn(),
      createTelegramBotService: (options: TelegramBotServiceOptions) => {
        telegramOptions = options
        return telegramService
      },
      createTelegramOutboxQueue: () => ({
        start: vi.fn(async () => undefined),
        enqueue: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      }),
      createTelegramOutboxDeliveryRepository: () => ({
        getNotifiedAt: vi.fn(async () => null),
        markNotified: vi.fn(async () => undefined),
      }),
      createTelegramOutboxDelivery: () => vi.fn(async () => undefined),
    } as unknown as WorkerApplicationDependencies

    const app = createWorkerApplication(
      {
        databaseUrl: 'postgresql://telegram-reconnect',
        rawResponseJournalDir: '/tmp/telegram-reconnect',
        monitorMaxPages: 5,
      },
      publish,
      dependencies,
    ) as ReturnType<typeof createWorkerApplication> & { resumeTelegram(): Promise<void> }

    expect(telegramOptions?.publishChannelState).toBeTypeOf('function')
    telegramOptions?.publishChannelState?.('reconnecting')
    expect(publish).toHaveBeenCalledWith({
      type: 'telegram-channel-state',
      state: 'reconnecting',
    })

    await app.resumeTelegram()
    expect(resume).toHaveBeenCalledOnce()
  })
})
