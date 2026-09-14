import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { SourceDegradationEvent } from '../../electron/worker/kufar-resilient-source'
import { createLocalMonitorRunLeaseAcquirer } from '../../electron/worker/monitor-run-lease'
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
    verifyToken: vi.fn(async () => ({ username: 'kufar_watch_bot' })),
    configure: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    bindCandidate: vi.fn(async () => 'bound' as const),
    sendMessage: vi.fn(async () => undefined),
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

function createOutboxHarness(order?: string[]) {
  const outbox = {
    start: vi.fn(async () => {
      order?.push('outbox:start')
    }),
    enqueue: vi.fn(async () => undefined),
    stop: vi.fn(async () => {
      order?.push('outbox:stop')
    }),
  }
  const deliveryRepository = {
    getNotifiedAt: vi.fn(async () => null),
    markNotified: vi.fn(async () => undefined),
  }
  const deliver = vi.fn(async () => undefined)

  return {
    outbox,
    deliveryRepository,
    deliver,
    createTelegramOutboxQueue: vi.fn(() => outbox),
    createTelegramOutboxDeliveryRepository: vi.fn(() => deliveryRepository),
    createTelegramOutboxDelivery: vi.fn(() => deliver),
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
    const outbox = createOutboxHarness()

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
    const createRunRecoveryLeaseAcquirer = vi.fn(() => createLocalMonitorRunLeaseAcquirer())
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
      createRunRecoveryLeaseAcquirer,
      createTelegramRepository: telegram.createTelegramRepository,
      createTelegramBotFactory: telegram.createTelegramBotFactory,
      createTelegramBotService: telegram.createTelegramBotService,
      createTelegramOutboxQueue: outbox.createTelegramOutboxQueue,
      createTelegramOutboxDeliveryRepository: outbox.createTelegramOutboxDeliveryRepository,
      createTelegramOutboxDelivery: outbox.createTelegramOutboxDelivery,
    })

    expect(createPrismaClient).toHaveBeenCalledOnce()
    expect(createPrismaClient).toHaveBeenCalledWith(config.databaseUrl)
    expect(createQueue).toHaveBeenCalledOnce()
    expect(createQueue).toHaveBeenCalledWith(config.databaseUrl, expect.any(Function))
    expect(createRunRecoveryLeaseAcquirer).toHaveBeenCalledWith(config.databaseUrl)
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
      publishChannelState: expect.any(Function),
      publishCandidate: expect.any(Function),
      publishJournal: expect.any(Function),
    })
    expect(outbox.createTelegramOutboxQueue).toHaveBeenCalledWith({
      connectionString: config.databaseUrl,
      onError: expect.any(Function),
      deliver: expect.any(Function),
    })
    expect(outbox.createTelegramOutboxDeliveryRepository).toHaveBeenCalledWith(prisma)
    expect(outbox.createTelegramOutboxDelivery).toHaveBeenCalledWith({
      repository: outbox.deliveryRepository,
      send: expect.any(Function),
      publish: expect.any(Function),
    })
    expect(app.telegramState()).toBe('not-configured')
    expect(app.telegramCandidate()).toBeNull()
    expect(app.telegramBoundChatId()).toBeNull()

    telegramOptions?.publishState?.('waiting-for-binding', null)
    telegramOptions?.publishChannelState?.('connected')
    telegramOptions?.publishCandidate?.({
      chatId: '1001',
      chatType: 'private',
      displayName: 'Owner',
    })
    telegramOptions?.publishJournal?.('safe telegram journal')
    queueError?.(new Error('queue down'))
    sourceDegradation?.(degradationEvent)
    pauseRequired?.({
      monitorId: 11,
      runId: 22,
      status: 429,
      failureCode: 'throttled',
      message: 'Kufar throttling exhausted retry budget',
    })
    reconcileError?.(new Error('reconcile down'))

    expect(publish).toHaveBeenCalledWith({
      type: 'telegram-state',
      state: 'waiting-for-binding',
      boundChatId: null,
    })
    expect(publish).toHaveBeenCalledWith({ type: 'telegram-channel', state: 'connected' })
    expect(publish).toHaveBeenCalledWith({
      type: 'telegram-candidate',
      candidate: {
        chatId: '1001',
        chatType: 'private',
        displayName: 'Owner',
      },
    })
    expect(publish).toHaveBeenCalledWith({ type: 'journal', message: 'safe telegram journal' })
    expect(publish).toHaveBeenCalledWith({
      type: 'journal',
      message: 'PostgreSQL job queue error',
    })
    expect(publish).toHaveBeenCalledWith({
      type: 'journal',
      message: 'Kufar source degraded: html-fallback after network',
    })
    expect(publish).toHaveBeenCalledWith({
      type: 'journal',
      message: 'Monitor 11 paused after retry budget exhausted',
    })
    expect(publish).toHaveBeenCalledWith({
      type: 'journal',
      message: 'Monitor scheduler reconciliation failed',
    })
  })

  it('stops scheduler, outbox, Telegram, source runtime, queue, lease acquirer, and Prisma in order', async () => {
    const order: string[] = []
    const prisma = {
      $disconnect: vi.fn(async () => {
        order.push('prisma')
      }),
    } as unknown as PrismaClient
    const queue = {
      stop: vi.fn(async () => {
        order.push('queue')
      }),
    } as unknown as MonitorScheduleQueue
    const repository = {} as MonitorScheduleRepository
    const sourceRuntime = {
      createRunAdapters: vi.fn(),
      descriptionLoader: { ensureDescription: vi.fn() },
      close: vi.fn(async () => {
        order.push('source')
      }),
    } as WorkerSourceRuntime
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        order.push('scheduler')
      }),
    } as unknown as MonitorScheduler
    const telegram = createTelegramHarness(order)
    const outbox = createOutboxHarness(order)
    const leaseAcquirer = {
      tryAcquire: vi.fn(),
      close: vi.fn(async () => {
        order.push('lease')
      }),
    }

    const app = createWorkerApplication(config, vi.fn(), {
      createPrismaClient: vi.fn(() => prisma),
      createQueue: vi.fn(() => queue),
      createRepository: vi.fn(() => repository),
      createSourceRuntime: vi.fn(() => sourceRuntime),
      createRunExecutor: vi.fn(() => vi.fn()),
      createScheduler: vi.fn(() => scheduler),
      createRunRecoveryLeaseAcquirer: vi.fn(() => leaseAcquirer),
      createTelegramRepository: telegram.createTelegramRepository,
      createTelegramBotFactory: telegram.createTelegramBotFactory,
      createTelegramBotService: telegram.createTelegramBotService,
      createTelegramOutboxQueue: outbox.createTelegramOutboxQueue,
      createTelegramOutboxDeliveryRepository: outbox.createTelegramOutboxDeliveryRepository,
      createTelegramOutboxDelivery: outbox.createTelegramOutboxDelivery,
    })

    await app.start()
    await app.stop()

    expect(order).toEqual([
      'scheduler',
      'outbox:stop',
      'telegram',
      'source',
      'queue',
      'lease',
      'prisma',
    ])
  })
})
