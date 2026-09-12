import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import type { ScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
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

function dependenciesFor(
  prisma: PrismaClient,
  scheduler: MonitorScheduler,
): WorkerApplicationDependencies {
  const sourceRuntime = {
    createRunAdapters: vi.fn(() => ({}) as SourceAdapterRegistry),
    descriptionLoader: { ensureDescription: vi.fn() },
    close: vi.fn(async () => undefined),
  } as WorkerSourceRuntime

  return {
    createPrismaClient: () => prisma,
    createQueue: () => ({}) as MonitorScheduleQueue,
    createRepository: () => ({}) as MonitorScheduleRepository,
    createSourceRuntime: () => sourceRuntime,
    createRunExecutor: () =>
      vi.fn(async () => ({ status: 'completed' })) as unknown as ScheduledMonitorRunExecutor,
    createScheduler: () => scheduler,
  }
}

describe('Run lifecycle startup recovery', () => {
  it('recovers stale running rows before starting the scheduler', async () => {
    const order: string[] = []
    const prisma = {
      $executeRaw: vi.fn(async () => {
        order.push('recover')
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

    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await app.start()

    expect(order).toEqual(['recover', 'scheduler:start'])
  })

  it('does not start the scheduler when recovery fails', async () => {
    const recoveryFailure = new Error('run recovery failed')
    const prisma = {
      $executeRaw: vi.fn(async () => {
        throw recoveryFailure
      }),
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await expect(app.start()).rejects.toBe(recoveryFailure)
    expect(scheduler.start).not.toHaveBeenCalled()
  })
})
