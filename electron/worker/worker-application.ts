import type { PrismaClient } from '../../generated/prisma/client'
import type { WorkerEvent } from '../../shared/runtime'
import type { WorkerConfig } from './config'
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
import {
  createWorkerSourceRuntime,
  type WorkerSourceRuntime,
  type WorkerSourceRuntimeOptions,
} from './worker-source-runtime'

export interface WorkerApplication extends WorkerRuntimeServices {
  scheduler: MonitorScheduler
}

export interface WorkerApplicationDependencies {
  createPrismaClient(databaseUrl: string): PrismaClient
  createQueue(databaseUrl: string, onError: (error: unknown) => void): MonitorScheduleQueue
  createRepository(prisma: PrismaClient): MonitorScheduleRepository
  createSourceRuntime(options: WorkerSourceRuntimeOptions): WorkerSourceRuntime
  createRunExecutor(options: ScheduledMonitorRunExecutorOptions): ScheduledMonitorRunExecutor
  createScheduler(options: MonitorSchedulerOptions): MonitorScheduler
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
}

export function formatWorkerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function recoverInterruptedRuns(prisma: PrismaClient): Promise<void> {
  const recoveredAt = new Date()
  await prisma.$executeRaw`
    UPDATE "Run"
    SET
      "finishedAt" = ${recoveredAt}::timestamp,
      "durationMs" = LEAST(
        2147483647,
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (${recoveredAt}::timestamp - "startedAt")) * 1000)
        )
      )::integer,
      "outcome" = 'interrupted',
      "error" = 'Worker process interrupted before Run completion',
      "errorCategory" = 'internal',
      "errorCode" = 'worker-interrupted'
    WHERE "outcome" = 'running'
      AND "finishedAt" IS NULL
  `
}

export function createWorkerApplication(
  config: WorkerConfig,
  publish: (event: WorkerEvent) => void,
  dependencies: WorkerApplicationDependencies = defaultDependencies,
): WorkerApplication {
  const prisma = dependencies.createPrismaClient(config.databaseUrl)
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
  const scheduler = dependencies.createScheduler({
    repository,
    queue,
    runMonitor,
    onReconcileError(monitorId, error) {
      publish({
        type: 'journal',
        level: 'error',
        message: `Monitor ${monitorId} schedule reconciliation failed: ${formatWorkerError(error)}`,
      })
    },
  })

  return {
    scheduler,
    async start() {
      await recoverInterruptedRuns(prisma)
      await scheduler.start()
    },
    async stop() {
      await scheduler.stop()
      await sourceRuntime.close()
      await prisma.$disconnect()
    },
  }
}
