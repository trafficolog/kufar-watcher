import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import { createLocalMonitorRunLeaseAcquirer } from '../../electron/worker/monitor-run-lease'
import type {
  MonitorScheduler,
  MonitorSchedulerOptions,
} from '../../electron/worker/monitor-scheduler'
import type { ScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import type { TelegramBotService } from '../../electron/worker/telegram-bot-service'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'

describe('monitor traversal change event', () => {
  it('publishes monitor changed after a scheduled traversal completes', async () => {
    const prisma = {
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const sourceRuntime = {
      createRunAdapters: vi.fn(() => ({})),
      descriptionLoader: { ensureDescription: vi.fn() },
      close: vi.fn(async () => undefined),
    } as unknown as WorkerSourceRuntime
    const runMonitor = vi.fn(async () => ({
      status: 'completed',
    })) as unknown as ScheduledMonitorRunExecutor
    let scheduledRunMonitor: MonitorSchedulerOptions['runMonitor'] | undefined
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const telegram = {
      configure: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      bindCandidate: vi.fn(async () => 'bound' as const),
      sendTestMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      getState: vi.fn(() => 'not-configured' as const),
      getCandidate: vi.fn(() => null),
      getBoundChatId: vi.fn(() => null),
      stop: vi.fn(async () => undefined),
    } as TelegramBotService
    const outbox = {
      start: vi.fn(async () => undefined),
      enqueue: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const dependencies = {
      createPrismaClient: () => prisma,
      createQueue: () => ({}),
      createRepository: () => ({}),
      createSourceRuntime: () => sourceRuntime,
      createRunExecutor: () => runMonitor,
      createScheduler: (options: MonitorSchedulerOptions) => {
        scheduledRunMonitor = options.runMonitor
        return scheduler
      },
      createRunRecoveryLeaseAcquirer: () => createLocalMonitorRunLeaseAcquirer(),
      createTelegramRepository: () => ({}),
      createTelegramBotFactory: () => ({}),
      createTelegramBotService: () => telegram,
      createTelegramOutboxQueue: () => outbox,
      createTelegramOutboxDeliveryRepository: () => ({}),
      createTelegramOutboxDelivery: () => vi.fn(async () => undefined),
    } as unknown as WorkerApplicationDependencies
    const publish = vi.fn()

    createWorkerApplication(
      {
        databaseUrl: 'postgresql://fixture',
        rawResponseJournalDir: '/tmp/kufar-journal',
        monitorMaxPages: 5,
      },
      publish,
      dependencies,
    )

    expect(scheduledRunMonitor).toBeTypeOf('function')
    await scheduledRunMonitor!(7)

    expect(runMonitor).toHaveBeenCalledOnce()
    expect(runMonitor).toHaveBeenCalledWith(7)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith({ type: 'monitor-changed', monitorId: 7 })
  })
})
