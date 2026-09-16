import type { PrismaClient } from '../../generated/prisma/client'
import type { MonitorListItem } from '../../shared/ipc'
import type { WorkerEvent } from '../../shared/runtime'
import type { WorkerConfig } from './config'
import { createGrammyTelegramBotFactory } from './grammy-telegram-bot'
import { createMonitorConfigAndSync, setMonitorStateAndSync } from './monitor-config-sync'
import {
  createPostgresMonitorRunLeaseAcquirer,
  type AcquireMonitorRunLease,
} from './monitor-run-lease'
import { recoverInterruptedMonitorRuns } from './monitor-run-recovery'
import {
  MonitorScheduler,
  type MonitorScheduleQueue,
  type MonitorScheduleRepository,
  type MonitorSchedulerOptions,
} from './monitor-scheduler'
import { createPrismaMonitorScheduleRepository } from './monitor-schedule-repository'
import { createPgBossScheduleQueue } from './pg-boss-schedule-queue'
import { createPrismaClient } from './prisma-client'
import type { WorkerRuntimeServices } from './runtime'
import {
  createScheduledMonitorRunExecutor,
  type ScheduledMonitorRunExecutor,
  type ScheduledMonitorRunExecutorOptions,
} from './scheduled-monitor-run'
import { createPrismaTelegramBindingRepository } from './telegram-binding-repository'
import {
  createTelegramBotService,
  type TelegramBindingRepository,
  type TelegramBotFactory,
  type TelegramBotService,
  type TelegramBotServiceOptions,
} from './telegram-bot-service'
import {
  createTelegramOutboxDelivery,
  type TelegramOutboxDeliveryOptions,
  type TelegramOutboxDeliveryRepository,
} from './telegram-outbox-delivery'
import { createPrismaTelegramOutboxDeliveryRepository } from './telegram-outbox-delivery-repository'
import { createPgBossTelegramOutboxQueue, type TelegramOutboxQueue } from './telegram-outbox-queue'
import {
  createWorkerSourceRuntime,
  type WorkerSourceRuntime,
  type WorkerSourceRuntimeOptions,
} from './worker-source-runtime'

export interface WorkerApplication extends WorkerRuntimeServices {
  scheduler: MonitorScheduler
  listMonitors(archived?: boolean): Promise<MonitorListItem[]>
  setMonitorState(monitorId: number, state: 'active' | 'paused' | 'archived'): Promise<void>
}

export interface WorkerApplicationDependencies {
  createPrismaClient(databaseUrl: string): PrismaClient
  createQueue(databaseUrl: string, onError: (error: unknown) => void): MonitorScheduleQueue
  createRepository(prisma: PrismaClient): MonitorScheduleRepository
  createSourceRuntime(options: WorkerSourceRuntimeOptions): WorkerSourceRuntime
  createRunExecutor(options: ScheduledMonitorRunExecutorOptions): ScheduledMonitorRunExecutor
  createScheduler(options: MonitorSchedulerOptions): MonitorScheduler
  createRunRecoveryLeaseAcquirer(databaseUrl: string): AcquireMonitorRunLease
  createTelegramRepository(prisma: PrismaClient): TelegramBindingRepository
  createTelegramBotFactory(): TelegramBotFactory
  createTelegramBotService(options: TelegramBotServiceOptions): TelegramBotService
  createTelegramOutboxQueue(
    databaseUrl: string,
    onError: (error: unknown) => void,
  ): TelegramOutboxQueue
  createTelegramOutboxDeliveryRepository(prisma: PrismaClient): TelegramOutboxDeliveryRepository
  createTelegramOutboxDelivery(
    options: TelegramOutboxDeliveryOptions,
  ): ReturnType<typeof createTelegramOutboxDelivery>
}

const defaultDependencies: WorkerApplicationDependencies = {
  createPrismaClient,
  createQueue: createPgBossScheduleQueue,
  createRepository: createPrismaMonitorScheduleRepository,
  createSourceRuntime: createWorkerSourceRuntime,
  createRunExecutor: createScheduledMonitorRunExecutor,
  createScheduler(options) {
    return new MonitorScheduler(options)
  },
  createRunRecoveryLeaseAcquirer: createPostgresMonitorRunLeaseAcquirer,
  createTelegramRepository: createPrismaTelegramBindingRepository,
  createTelegramBotFactory: createGrammyTelegramBotFactory,
  createTelegramBotService,
  createTelegramOutboxQueue: createPgBossTelegramOutboxQueue,
  createTelegramOutboxDeliveryRepository: createPrismaTelegramOutboxDeliveryRepository,
  createTelegramOutboxDelivery,
}

export function formatWorkerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createWorkerApplication(
  config: WorkerConfig,
  publish: (event: WorkerEvent) => void,
  dependencies: WorkerApplicationDependencies = defaultDependencies,
): WorkerApplication {
  const prisma = dependencies.createPrismaClient(config.databaseUrl)
  const acquireRunRecoveryLease = dependencies.createRunRecoveryLeaseAcquirer(config.databaseUrl)
  const queue = dependencies.createQueue(config.databaseUrl, (error) => {
    publish({
      type: 'journal',
      level: 'error',
      message: formatWorkerError(error),
    })
  })
  const repository = dependencies.createRepository(prisma)
  const sourceRuntime = dependencies.createSourceRuntime({
    prisma,
    rawResponseJournalDir: config.rawResponseJournalDir,
  })
  const runMonitor = dependencies.createRunExecutor({
    prisma,
    createRunAdapters: sourceRuntime.createRunAdapters,
    maxPages: config.monitorMaxPages,
    descriptionLoader: sourceRuntime.descriptionLoader,
    onSourceDegradation() {
      publish({
        type: 'journal',
        level: 'warning',
        message: 'Kufar source degraded to HTML fallback',
      })
    },
    onPauseRequired(monitorId, stage) {
      publish({ type: 'monitor-pause-required', monitorId, stage })
    },
  })
  const scheduledRunMonitor: ScheduledMonitorRunExecutor = async (monitorId) => {
    try {
      return await runMonitor(monitorId)
    } finally {
      publish({ type: 'monitor-changed', monitorId })
    }
  }
  const scheduler = dependencies.createScheduler({
    repository,
    queue,
    runMonitor: scheduledRunMonitor,
    onReconcileError(monitorId, error) {
      publish({
        type: 'journal',
        level: 'error',
        message: `Monitor ${monitorId} schedule reconciliation failed: ${formatWorkerError(error)}`,
      })
    },
  })
  const telegramRepository = dependencies.createTelegramRepository(prisma)
  const telegram = dependencies.createTelegramBotService({
    repository: telegramRepository,
    createBot: dependencies.createTelegramBotFactory(),
    publishState(state, boundChatId) {
      publish({ type: 'telegram-state', state, boundChatId })
    },
    publishChannelState(state) {
      publish({ type: 'telegram-channel-state', state })
    },
    publishCandidate(candidate) {
      publish({ type: 'telegram-candidate', candidate })
    },
    publishJournal(message) {
      publish({ type: 'journal', level: 'error', message })
    },
  })
  const telegramOutbox = dependencies.createTelegramOutboxQueue(config.databaseUrl, () => {
    publish({
      type: 'journal',
      level: 'error',
      message: 'Telegram outbox queue failed',
    })
  })
  const telegramOutboxRepository = dependencies.createTelegramOutboxDeliveryRepository(prisma)
  const deliverTelegramOutbox = dependencies.createTelegramOutboxDelivery({
    repository: telegramOutboxRepository,
    sendMessage(chatId, text, sendOptions) {
      return sendOptions
        ? telegram.sendMessage(chatId, text, sendOptions)
        : telegram.sendMessage(chatId, text)
    },
    publishJournal(message) {
      publish({ type: 'journal', level: 'error', message })
    },
  })

  return {
    scheduler,
    async start() {
      await recoverInterruptedMonitorRuns({
        prisma,
        acquireMonitorRunLease: acquireRunRecoveryLease,
      })
      await scheduler.start()
      await telegramOutbox.start(deliverTelegramOutbox)
    },
    async configureTelegram(token) {
      await telegram.configure(token)
    },
    async resumeTelegram() {
      await telegram.resume()
    },
    async verifyTelegramToken(token) {
      if (!telegram.verifyToken) throw new Error('Telegram token verification failed')
      return telegram.verifyToken(token)
    },
    async bindTelegramCandidate(chatId) {
      return telegram.bindCandidate(chatId)
    },
    async sendTelegramTestMessage() {
      await telegram.sendTestMessage()
    },
    async createMonitor(input) {
      const result = await createMonitorConfigAndSync(prisma, scheduler, input)
      publish({ type: 'monitor-changed', monitorId: result.monitorId })
      return result
    },
    async setMonitorState(monitorId, state) {
      await setMonitorStateAndSync(prisma, scheduler, acquireRunRecoveryLease, monitorId, state)
      publish({ type: 'monitor-changed', monitorId })
    },
    async listMonitors(archived = false) {
      const monitors = await prisma.monitor.findMany({
        where: archived ? { state: 'archived' } : { state: { not: 'archived' } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          intervalSec: true,
          state: true,
          runs: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              startedAt: true,
              finishedAt: true,
              outcome: true,
              errorCategory: true,
              errorCode: true,
            },
          },
        },
      })

      return monitors.map((monitor) => {
        const latestRun = monitor.runs[0]
        return {
          id: monitor.id,
          name: monitor.name,
          intervalSec: monitor.intervalSec,
          state: monitor.state,
          lastRun: latestRun
            ? {
                startedAt: latestRun.startedAt.toISOString(),
                finishedAt: latestRun.finishedAt?.toISOString() ?? null,
                outcome: latestRun.outcome,
                errorCategory: latestRun.errorCategory,
                errorCode: latestRun.errorCode,
              }
            : null,
        }
      })
    },
    async stop() {
      await scheduler.stop()
      await telegramOutbox.stop()
      await telegram.stop()
      await sourceRuntime.close()
      await prisma.$disconnect()
    },
  }
}
