import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { AcquireMonitorRunLease } from '../../electron/worker/monitor-run-lease'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import type { ScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import type {
  TelegramBindingRepository,
  TelegramBotFactory,
  TelegramBotService,
} from '../../electron/worker/telegram-bot-service'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'

const config = {
  databaseUrl: 'postgresql://run-lifecycle',
  rawResponseJournalDir: '/tmp/kufar-run-lifecycle',
  monitorMaxPages: 5,
}

type RecoveryAwareDependencies = WorkerApplicationDependencies & {
  createRunRecoveryLeaseAcquirer(databaseUrl: string): AcquireMonitorRunLease
}

function dependenciesFor(
  prisma: PrismaClient,
  scheduler: MonitorScheduler,
  createRunRecoveryLeaseAcquirer: RecoveryAwareDependencies['createRunRecoveryLeaseAcquirer'] = () =>
    async () => ({ release: async () => undefined }),
): RecoveryAwareDependencies {
  const sourceRuntime = {
    createRunAdapters: vi.fn(() => ({}) as SourceAdapterRegistry),
    descriptionLoader: { ensureDescription: vi.fn() },
    close: vi.fn(async () => undefined),
  } as WorkerSourceRuntime
  const telegramRepository: TelegramBindingRepository = {
    getBoundChatId: vi.fn(async () => null),
    setBoundChatId: vi.fn(async () => undefined),
  }
  const telegramBotFactory = vi.fn() as unknown as TelegramBotFactory
  const telegramService: TelegramBotService = {
    configure: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    bindCandidate: vi.fn(async () => 'no-candidate' as const),
    sendMessage: vi.fn(async () => undefined),
    getState: vi.fn(() => 'not-configured' as const),
    getCandidate: vi.fn(() => null),
    getBoundChatId: vi.fn(() => null),
    stop: vi.fn(async () => undefined),
  }

  return {
    createPrismaClient: () => prisma,
    createQueue: () => ({}) as MonitorScheduleQueue,
    createRepository: () => ({}) as MonitorScheduleRepository,
    createSourceRuntime: () => sourceRuntime,
    createRunExecutor: () =>
      vi.fn(async () => ({ status: 'completed' })) as unknown as ScheduledMonitorRunExecutor,
    createScheduler: () => scheduler,
    createTelegramRepository: () => telegramRepository,
    createTelegramBotFactory: () => telegramBotFactory,
    createTelegramBotService: () => telegramService,
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
    createRunRecoveryLeaseAcquirer,
  }
}

describe('Run lifecycle startup recovery', () => {
  it('reads candidates, holds the monitor lease through recovery, and releases before scheduler start', async () => {
    const order: string[] = []
    const release = vi.fn(async () => {
      order.push('lease:release')
    })
    const acquireMonitorRunLease: AcquireMonitorRunLease = vi.fn(async () => {
      order.push('lease:acquire')
      return { release }
    })
    const prisma = {
      run: {
        findMany: vi.fn(async () => {
          order.push('recovery:read')
          return [{ monitorId: 101 }]
        }),
      },
      $executeRaw: vi.fn(async () => {
        order.push('recovery:update')
        return 1
      }),
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => {
        order.push('scheduler:start')
      }),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(
      config,
      vi.fn(),
      dependenciesFor(prisma, scheduler, () => acquireMonitorRunLease),
    )

    await app.start()

    expect(order).toEqual([
      'recovery:read',
      'lease:acquire',
      'recovery:update',
      'lease:release',
      'scheduler:start',
    ])
    expect(acquireMonitorRunLease).toHaveBeenCalledWith(101)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('treats a busy monitor lease as a live-owner signal and still starts the scheduler', async () => {
    const executeRaw = vi.fn(async () => 1)
    const acquireMonitorRunLease: AcquireMonitorRunLease = vi.fn(async () => null)
    const prisma = {
      run: { findMany: vi.fn(async () => [{ monitorId: 101 }]) },
      $executeRaw: executeRaw,
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(
      config,
      vi.fn(),
      dependenciesFor(prisma, scheduler, () => acquireMonitorRunLease),
    )

    await expect(app.start()).resolves.toBeUndefined()
    expect(executeRaw).not.toHaveBeenCalled()
    expect(scheduler.start).toHaveBeenCalledTimes(1)
  })

  it('does not start the scheduler when candidate discovery fails', async () => {
    const recoveryFailure = new Error('run recovery read failed')
    const executeRaw = vi.fn(async () => 1)
    const prisma = {
      run: {
        findMany: vi.fn(async () => {
          throw recoveryFailure
        }),
      },
      $executeRaw: executeRaw,
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await expect(app.start()).rejects.toBe(recoveryFailure)
    expect(executeRaw).not.toHaveBeenCalled()
    expect(scheduler.start).not.toHaveBeenCalled()
  })

  it('does not start the scheduler when lease acquisition fails', async () => {
    const leaseFailure = new Error('run recovery lease failed')
    const executeRaw = vi.fn(async () => 1)
    const acquireMonitorRunLease: AcquireMonitorRunLease = vi.fn(async () => {
      throw leaseFailure
    })
    const prisma = {
      run: { findMany: vi.fn(async () => [{ monitorId: 101 }]) },
      $executeRaw: executeRaw,
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(
      config,
      vi.fn(),
      dependenciesFor(prisma, scheduler, () => acquireMonitorRunLease),
    )

    await expect(app.start()).rejects.toBe(leaseFailure)
    expect(executeRaw).not.toHaveBeenCalled()
    expect(scheduler.start).not.toHaveBeenCalled()
  })

  it('releases the monitor lease when the recovery mutation fails and preserves the mutation error', async () => {
    const mutationFailure = new Error('run recovery mutation failed')
    const releaseFailure = new Error('run recovery release failed')
    const release = vi.fn(async () => {
      throw releaseFailure
    })
    const acquireMonitorRunLease: AcquireMonitorRunLease = vi.fn(async () => ({ release }))
    const prisma = {
      run: { findMany: vi.fn(async () => [{ monitorId: 101 }]) },
      $executeRaw: vi.fn(async () => {
        throw mutationFailure
      }),
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(
      config,
      vi.fn(),
      dependenciesFor(prisma, scheduler, () => acquireMonitorRunLease),
    )

    await expect(app.start()).rejects.toBe(mutationFailure)
    expect(release).toHaveBeenCalledTimes(1)
    expect(scheduler.start).not.toHaveBeenCalled()
  })

  it('fails startup when lease release fails after a successful recovery mutation', async () => {
    const releaseFailure = new Error('run recovery release failed')
    const release = vi.fn(async () => {
      throw releaseFailure
    })
    const acquireMonitorRunLease: AcquireMonitorRunLease = vi.fn(async () => ({ release }))
    const prisma = {
      run: { findMany: vi.fn(async () => [{ monitorId: 101 }]) },
      $executeRaw: vi.fn(async () => 1),
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(
      config,
      vi.fn(),
      dependenciesFor(prisma, scheduler, () => acquireMonitorRunLease),
    )

    await expect(app.start()).rejects.toBe(releaseFailure)
    expect(release).toHaveBeenCalledTimes(1)
    expect(scheduler.start).not.toHaveBeenCalled()
  })
})
