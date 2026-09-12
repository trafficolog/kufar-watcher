import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import type { ScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import type { SourceAdapterRegistry } from '../../shared/source-adapter-registry'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip
const MONITOR_ID = 916_101
const QUERY = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: null,
  region: null,
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}
const config = {
  databaseUrl: 'postgresql://run-lifecycle-integration',
  rawResponseJournalDir: '/tmp/kufar-run-lifecycle-integration',
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

integration('Run lifecycle recovery', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'run-lifecycle-recovery',
        sourceUrl: 'https://fixtures.invalid/run-lifecycle-recovery',
        query: QUERY,
        intervalSec: 60,
        keywords: [],
      },
    })
  })

  afterAll(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.$disconnect()
  })

  it('recovers only rows left running by the previous process before scheduler work begins', async () => {
    const orphanStartedAt = new Date(Date.now() - 5_000)
    const orphan = await prisma.run.create({
      data: { monitorId: MONITOR_ID, startedAt: orphanStartedAt, outcome: 'running' },
    })
    const terminal = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt: new Date(Date.now() - 4_000),
        finishedAt: new Date(Date.now() - 3_000),
        durationMs: 1_000,
        outcome: 'success',
      },
    })
    let currentRunId: number | undefined
    const scheduler = {
      start: vi.fn(async () => {
        const current = await prisma.run.create({
          data: { monitorId: MONITOR_ID, outcome: 'running' },
        })
        currentRunId = current.id
      }),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await app.start()

    const recovered = await prisma.run.findUniqueOrThrow({ where: { id: orphan.id } })
    expect(recovered.outcome).toBe('interrupted')
    expect(recovered.finishedAt).not.toBeNull()
    expect(recovered.durationMs ?? -1).toBeGreaterThanOrEqual(0)
    expect(recovered.error).toBe('Worker process interrupted before Run completion')
    expect(recovered.errorCategory).toBe('internal')
    expect(recovered.errorCode).toBe('worker-interrupted')

    expect(await prisma.run.findUniqueOrThrow({ where: { id: terminal.id } })).toMatchObject({
      outcome: 'success',
      durationMs: 1_000,
      error: null,
      errorCategory: null,
      errorCode: null,
    })

    expect(currentRunId).toBeDefined()
    expect(await prisma.run.findUniqueOrThrow({ where: { id: currentRunId } })).toMatchObject({
      outcome: 'running',
      finishedAt: null,
    })
  })

  it('is idempotent when startup recovery runs again', async () => {
    const orphan = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt: new Date(Date.now() - 5_000),
        outcome: 'running',
      },
    })
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler

    const firstApp = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))
    await firstApp.start()
    const first = await prisma.run.findUniqueOrThrow({ where: { id: orphan.id } })

    const secondApp = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))
    await secondApp.start()
    const second = await prisma.run.findUniqueOrThrow({ where: { id: orphan.id } })

    expect(first.outcome).toBe('interrupted')
    expect(second).toMatchObject({
      outcome: first.outcome,
      finishedAt: first.finishedAt,
      durationMs: first.durationMs,
      error: first.error,
      errorCategory: first.errorCategory,
      errorCode: first.errorCode,
    })
  })

  it('rejects arbitrary Run outcomes at the database boundary', async () => {
    await expect(
      prisma.run.create({
        data: { monitorId: MONITOR_ID, outcome: 'made-up-outcome' },
      }),
    ).rejects.toThrow()
  })
})
