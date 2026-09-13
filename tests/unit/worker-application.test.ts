import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { SourceDegradationEvent } from '../../electron/worker/kufar-resilient-source'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
  MonitorSchedulerOptions,
} from '../../electron/worker/monitor-scheduler'
import type {
  ScheduledMonitorRunExecutor,
  ScheduledMonitorRunExecutorOptions,
} from '../../electron/worker/scheduled-monitor-run'
import type {
  TelegramBindingRepository,
  TelegramBotFactory,
  TelegramBotService,
  TelegramBotServiceOptions,
} from '../../electron/worker/telegram-bot-service'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import { createWorkerApplication } from '../../electron/worker/worker-application'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { WorkerEvent } from '../../shared/runtime'

const config = {
  databaseUrl: 'postgresql://scheduler-db',
  rawResponseJournalDir: '/tmp/kufar-journal',
  monitorMaxPages: 17,
}

const degradationEvent: SourceDegradationEvent = {
  kind: 'source-degraded',
  channel: 'html-fallback',
  primaryFailureCode: 'network',
  primaryStatus: null,
}

function createTelegramHarness(order?: string[]) {
  const telegramRepository = {} as TelegramBindingRepository
  const telegramBotFactory = vi.fn() as unknown as TelegramBotFactory
  const telegramService: TelegramBotService = {
    configure: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    bindCandidate: vi.fn(async () => 'bound' as const),
    getState: vi.fn(() => 'not-configured' as const),
    getCandidate: vi.fn(() => null),
    getBoundChatId: vi.fn(() => null),
    stop: vi.fn(async () => {
      order?.push('telegram')
    }),
  }
  const createTelegramRepository = vi.fn(() => telegramRepository)
  const createTelegramBotFactory = vi.fn(() => telegramBotFactory)
  const createTelegramBotService = vi.fn((_options: TelegramBotServiceOptions) => telegramService)

  return {
    telegramRepository,
    telegramBotFactory,
    telegramService,
    createTelegramRepository,
    createTelegramBotFactory,
    createTelegramBotService,
  }
}

describe('worker application', () => {
  it('composes scheduler and Telegram stacks from one Prisma client and publishes safe events', async () => {
    const publish = vi.fn<(event: WorkerEvent) => void>()
    const prisma = { $disconnect: vi.fn(async () => undefined) } as unknown as PrismaClient
    const queue = {} as MonitorScheduleQueue
    const repository = {} as MonitorScheduleRepository
    const adapters = {} as SourceAdapterRegistry
    const createRunAdapters = vi.fn(() => adapters)
    const descriptionLoader = { ensureDescription: vi.fn() }
    const sourceRuntime = {
      createRunAdapters,
      descriptionLoader,
      close: vi.fn(async () => undefined),
    } as WorkerSourceRuntime
    const runMonitor = vi.fn(async () => ({
      status: 'completed',
    })) as unknown as ScheduledMonitorRunExecutor
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const telegram = createTelegramHarness()

    let queueError: ((error: unknown) => void) | undefined
    let sourceDegradation: ScheduledMonitorRunExecutorOptions['onSourceDegradation']
    let pauseRequired: ScheduledMonitorRunExecutorOptions['onPauseRequired']
    let reconcileError: MonitorSchedulerOptions['onReconcileError']
    let telegramOptions: TelegramBotServiceOptions | undefined
    const createPrismaClient = vi.fn(() => prisma)
    const createQueue = vi.fn((databaseUrl: string, onError: (error: unknown) => void) => {
      void databaseUrl
      queueError = onError
      return queue
    })
    const createRepository = vi.fn(() => repository)
    const createSourceRuntime = vi.fn(() => sourceRuntime)
    const createRunExecutor = vi.fn((options: ScheduledMonitorRunExecutorOptions) => {
      sourceDegradation = options.onSourceDegradation
      pauseRequired = options.onPauseRequired
      return runMonitor
    })
    const createScheduler = vi.fn((options: MonitorSchedulerOptions) => {
      reconcileError = options.onReconcileError
      return scheduler
    })
    telegram.createTelegramBotService.mockImplementation((options) => {
      telegramOptions = options
      return telegram.telegramService
    })

    const app = createWorkerApplication(config, publish, {
      createPrismaClient,
      createQueue,
      createRepository,
      createSourceRuntime,
      createRunExecutor,
      createScheduler,
      createTelegramRepository: telegram.createTelegramRepository,
      createTelegramBotFactory: telegram.createTelegramBotFactory,
      createTelegramBotService: telegram.createTelegramBotService,
    })

    expect(createPrismaClient).toHaveBeenCalledOnce()
    expect(createPrismaClient).toHaveBeenCalledWith(config.databaseUrl)
    expect(createQueue).toHaveBeenCalledOnce()
    expect(createQueue).toHaveBeenCalledWith(config.databaseUrl, expect.any(Function))
    expect(createRepository).toHaveBeenCalledWith(prisma)
    expect(createSourceRuntime).toHaveBeenCalledWith({
      prisma,
      rawResponseJournalDir: config.rawResponseJournalDir,
    })
    expect(createRunExecutor).toHaveBeenCalledWith({
      prisma,
      createRunAdapters,
      maxPages: config.monitorMaxPages,
      descriptionLoader,
      onSourceDegradation: expect.any(Function),
      onPauseRequired: expect.any(Function),
    })
    expect(createScheduler).toHaveBeenCalledWith({
      repository,
      queue,
      runMonitor,
      onReconcileError: expect.any(Function),
    })
    expect(telegram.createTelegramRepository).toHaveBeenCalledWith(prisma)
    expect(telegram.createTelegramBotFactory).toHaveBeenCalledOnce()
    expect(telegram.createTelegramBotService).toHaveBeenCalledWith({
      repository: telegram.telegramRepository,
      createBot: telegram.telegramBotFactory,
      publishState: expect.any(Function),
      publishCandidate: expect.any(Function),
      publishJournal: expect.any(Function),
    })
    expect(app.scheduler).toBe(scheduler)

    queueError?.(new Error('pg-boss failed'))
    await sourceDegradation?.(17, degradationEvent)
    await pauseRequired?.(17, 'primary')
    reconcileError?.(23, new Error('unsupported interval'))
    telegramOptions?.publishState?.('waiting-for-binding', null)
    telegramOptions?.publishCandidate?.({
      chatId: '1001',
      chatType: 'private',
      displayName: 'Ada',
    })
    telegramOptions?.publishJournal?.('Telegram polling failed')

    expect(publish).toHaveBeenNthCalledWith(1, {
      type: 'journal',
      level: 'error',
      message: 'pg-boss failed',
    })
    expect(publish).toHaveBeenNthCalledWith(2, {
      type: 'journal',
      level: 'warning',
      message: 'Kufar source degraded to HTML fallback',
    })
    expect(publish).toHaveBeenNthCalledWith(3, {
      type: 'monitor-pause-required',
      monitorId: 17,
      stage: 'primary',
    })
    expect(publish).toHaveBeenNthCalledWith(4, {
      type: 'journal',
      level: 'error',
      message: 'Monitor 23 schedule reconciliation failed: unsupported interval',
    })
    expect(publish).toHaveBeenNthCalledWith(5, {
      type: 'telegram-state',
      state: 'waiting-for-binding',
      boundChatId: null,
    })
    expect(publish).toHaveBeenNthCalledWith(6, {
      type: 'telegram-candidate',
      candidate: {
        chatId: '1001',
        chatType: 'private',
        displayName: 'Ada',
      },
    })
    expect(publish).toHaveBeenNthCalledWith(7, {
      type: 'journal',
      level: 'error',
      message: 'Telegram polling failed',
    })

    await app.configureTelegram?.('SECRET_SENTINEL_3_1_1')
    expect(telegram.telegramService.configure).toHaveBeenCalledWith('SECRET_SENTINEL_3_1_1')
    await expect(app.bindTelegramCandidate?.('1001')).resolves.toBe('bound')
  })

  it('starts through the scheduler and stops Telegram before source and Prisma resources', async () => {
    const order: string[] = []
    const prisma = {
      $executeRaw: vi.fn(async () => 1),
      $disconnect: vi.fn(async () => {
        order.push('prisma')
      }),
    } as unknown as PrismaClient
    const sourceRuntime = {
      createRunAdapters: vi.fn(() => ({}) as SourceAdapterRegistry),
      descriptionLoader: { ensureDescription: vi.fn() },
      close: vi.fn(async () => {
        order.push('source')
      }),
    } as WorkerSourceRuntime
    const scheduler = {
      start: vi.fn(async () => {
        order.push('scheduler:start')
      }),
      stop: vi.fn(async () => {
        order.push('scheduler:stop')
      }),
    } as unknown as MonitorScheduler
    const telegram = createTelegramHarness(order)

    const app = createWorkerApplication(config, vi.fn(), {
      createPrismaClient: () => prisma,
      createQueue: () => ({}) as MonitorScheduleQueue,
      createRepository: () => ({}) as MonitorScheduleRepository,
      createSourceRuntime: () => sourceRuntime,
      createRunExecutor: () =>
        vi.fn(async () => ({ status: 'completed' })) as unknown as ScheduledMonitorRunExecutor,
      createScheduler: () => scheduler,
      createTelegramRepository: telegram.createTelegramRepository,
      createTelegramBotFactory: telegram.createTelegramBotFactory,
      createTelegramBotService: telegram.createTelegramBotService,
    })

    await app.start()
    expect(order).toEqual(['scheduler:start'])

    await app.stop()
    expect(order).toEqual(['scheduler:start', 'scheduler:stop', 'telegram', 'source', 'prisma'])
  })
})
