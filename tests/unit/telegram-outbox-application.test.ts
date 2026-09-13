import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import type { ScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import type {
  TelegramBindingRepository,
  TelegramBotService,
} from '../../electron/worker/telegram-bot-service'
import type {
  TelegramOutboxDeliveryOptions,
  TelegramOutboxDeliveryRepository,
} from '../../electron/worker/telegram-outbox-delivery'
import type {
  TelegramOutboxHandler,
  TelegramOutboxQueue,
} from '../../electron/worker/telegram-outbox-queue'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { WorkerEvent } from '../../shared/runtime'

const config = {
  databaseUrl: 'postgresql://outbox-db',
  rawResponseJournalDir: '/tmp/kufar-journal',
  monitorMaxPages: 5,
}

describe('worker Telegram outbox composition', () => {
  it('starts durable delivery after scheduler and stops it before Telegram teardown', async () => {
    const order: string[] = []
    const publish = vi.fn<(event: WorkerEvent) => void>()
    const prisma = {
      $executeRaw: vi.fn(async () => 0),
      $disconnect: vi.fn(async () => {
        order.push('prisma')
      }),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => {
        order.push('scheduler:start')
      }),
      stop: vi.fn(async () => {
        order.push('scheduler:stop')
      }),
    } as unknown as MonitorScheduler
    const sourceRuntime = {
      createRunAdapters: vi.fn(() => ({}) as SourceAdapterRegistry),
      descriptionLoader: { ensureDescription: vi.fn() },
      close: vi.fn(async () => {
        order.push('source')
      }),
    } as WorkerSourceRuntime
    const telegram: TelegramBotService = {
      configure: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      bindCandidate: vi.fn(async () => 'bound' as const),
      sendMessage: vi.fn(async () => undefined),
      getState: vi.fn(() => 'ready' as const),
      getCandidate: vi.fn(() => null),
      getBoundChatId: vi.fn(() => '1001'),
      stop: vi.fn(async () => {
        order.push('telegram')
      }),
    }
    const deliveryRepository = {} as TelegramOutboxDeliveryRepository
    const deliveryHandler: TelegramOutboxHandler = vi.fn(async () => undefined)
    let outboxError: ((error: unknown) => void) | undefined
    const outbox: TelegramOutboxQueue = {
      start: vi.fn(async (handler) => {
        expect(handler).toBe(deliveryHandler)
        order.push('outbox:start')
      }),
      enqueue: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        order.push('outbox:stop')
      }),
    }
    const createTelegramOutboxQueue = vi.fn(
      (_databaseUrl: string, onError: (error: unknown) => void) => {
        outboxError = onError
        return outbox
      },
    )
    const createTelegramOutboxDeliveryRepository = vi.fn(() => deliveryRepository)
    const createTelegramOutboxDelivery = vi.fn(
      (_options: TelegramOutboxDeliveryOptions) => deliveryHandler,
    )

    const dependencies = {
      createPrismaClient: () => prisma,
      createQueue: () => ({}) as MonitorScheduleQueue,
      createRepository: () => ({}) as MonitorScheduleRepository,
      createSourceRuntime: () => sourceRuntime,
      createRunExecutor: () =>
        vi.fn(async () => ({ status: 'completed' })) as unknown as ScheduledMonitorRunExecutor,
      createScheduler: () => scheduler,
      createTelegramRepository: () => ({}) as TelegramBindingRepository,
      createTelegramBotFactory: () => vi.fn() as never,
      createTelegramBotService: () => telegram,
      createTelegramOutboxQueue,
      createTelegramOutboxDeliveryRepository,
      createTelegramOutboxDelivery,
    } as unknown as WorkerApplicationDependencies

    const app = createWorkerApplication(config, publish, dependencies)

    expect(createTelegramOutboxQueue).toHaveBeenCalledWith(config.databaseUrl, expect.any(Function))
    expect(createTelegramOutboxDeliveryRepository).toHaveBeenCalledWith(prisma)
    expect(createTelegramOutboxDelivery).toHaveBeenCalledWith({
      repository: deliveryRepository,
      sendMessage: expect.any(Function),
      publishJournal: expect.any(Function),
    })

    const deliveryOptions = createTelegramOutboxDelivery.mock.calls[0]?.[0]
    await deliveryOptions?.sendMessage('1001', 'hello')
    expect(telegram.sendMessage).toHaveBeenCalledWith('1001', 'hello')
    deliveryOptions?.publishJournal?.('Telegram notification permanently rejected')
    expect(publish).toHaveBeenCalledWith({
      type: 'journal',
      level: 'error',
      message: 'Telegram notification permanently rejected',
    })

    outboxError?.(new Error('SECRET_DATABASE_DETAIL'))
    expect(publish).toHaveBeenCalledWith({
      type: 'journal',
      level: 'error',
      message: 'Telegram outbox queue failed',
    })
    expect(JSON.stringify(publish.mock.calls)).not.toContain('SECRET_DATABASE_DETAIL')

    await app.start()
    expect(order).toEqual(['scheduler:start', 'outbox:start'])

    await app.stop()
    expect(order).toEqual([
      'scheduler:start',
      'outbox:start',
      'scheduler:stop',
      'outbox:stop',
      'telegram',
      'source',
      'prisma',
    ])
  })
})
