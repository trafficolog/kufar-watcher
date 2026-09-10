import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import type { SourceDegradationEvent } from '../../electron/worker/kufar-resilient-source'
import type {
  ScheduledMonitorRunExecutor,
  ScheduledMonitorRunExecutorOptions,
} from '../../electron/worker/scheduled-monitor-run'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import { createWorkerApplication } from '../../electron/worker/worker-application'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'
import type { WorkerEvent } from '../../shared/runtime'

const config = {
  databaseUrl: 'postgresql://scheduler-db',
  rawResponseJournalDir: '/tmp/kufar-journal',
  monitorMaxPages: 5,
}

const degradationEvent: SourceDegradationEvent = {
  kind: 'source-degraded',
  channel: 'html-fallback',
  primaryFailureCode: 'network',
  primaryStatus: null,
}

describe('worker application', () => {
  it('composes one scheduler stack from the worker config and publishes dependency events', async () => {
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

    let queueError: ((error: unknown) => void) | undefined
    let sourceDegradation: ScheduledMonitorRunExecutorOptions['onSourceDegradation']
    let pauseRequired: ScheduledMonitorRunExecutorOptions['onPauseRequired']
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
    const createScheduler = vi.fn(() => scheduler)

    const app = createWorkerApplication(config, publish, {
      createPrismaClient,
      createQueue,
      createRepository,
      createSourceRuntime,
      createRunExecutor,
      createScheduler,
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
    expect(createScheduler).toHaveBeenCalledWith({ repository, queue, runMonitor })
    expect(app.scheduler).toBe(scheduler)

    queueError?.(new Error('pg-boss failed'))
    await sourceDegradation?.(17, degradationEvent)
    await pauseRequired?.(17, 'primary')

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
  })

  it('starts through the scheduler and stops scheduler before source and Prisma resources', async () => {
    const order: string[] = []
    const prisma = {
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

    const app = createWorkerApplication(config, vi.fn(), {
      createPrismaClient: () => prisma,
      createQueue: () => ({}) as MonitorScheduleQueue,
      createRepository: () => ({}) as MonitorScheduleRepository,
      createSourceRuntime: () => sourceRuntime,
      createRunExecutor: () =>
        vi.fn(async () => ({ status: 'completed' })) as unknown as ScheduledMonitorRunExecutor,
      createScheduler: () => scheduler,
    })

    await app.start()
    expect(order).toEqual(['scheduler:start'])

    await app.stop()
    expect(order).toEqual(['scheduler:start', 'scheduler:stop', 'source', 'prisma'])
  })
})
