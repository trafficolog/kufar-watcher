import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import { createPrismaClient } from '../../electron/worker/prisma-client'
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
  const telegramRepository: TelegramBindingRepository = {
    getBoundChatId: vi.fn(async () => null),
    setBoundChatId: vi.fn(async () => undefined),
  }
  const telegramBotFactory = vi.fn() as unknown as TelegramBotFactory
  const telegramService: TelegramBotService = {
    configure: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    bindCandidate: vi.fn(async () => 'no-candidate' as const),
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

  it('converts stale running rows to interrupted before scheduling resumes', async () => {
    const startedAt = new Date(Date.now() - 1_000)
    await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt,
        outcome: 'running',
      },
    })
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await app.start()

    const recovered = await prisma.run.findFirstOrThrow({
      where: { monitorId: MONITOR_ID },
      orderBy: { id: 'desc' },
    })
    expect(recovered.outcome).toBe('interrupted')
    expect(recovered.finishedAt).not.toBeNull()
    expect(recovered.durationMs).not.toBeNull()
    expect(recovered.errorCategory).toBe('internal')
    expect(recovered.errorCode).toBe('worker-interrupted')
    expect(scheduler.start).toHaveBeenCalledOnce()
  })

  it('does not rewrite already-finished rows during startup recovery', async () => {
    const startedAt = new Date(Date.now() - 2_000)
    const finishedAt = new Date(Date.now() - 1_000)
    const row = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt,
        finishedAt,
        durationMs: 1_000,
        outcome: 'completed',
      },
    })
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await app.start()

    const unchanged = await prisma.run.findUniqueOrThrow({ where: { id: row.id } })
    expect(unchanged.outcome).toBe('completed')
    expect(unchanged.finishedAt).toEqual(finishedAt)
    expect(unchanged.error).toBeNull()
  })

  it('recovers every stale running row in one startup pass', async () => {
    await prisma.run.createMany({
      data: [
        { monitorId: MONITOR_ID, startedAt: new Date(Date.now() - 3_000), outcome: 'running' },
        { monitorId: MONITOR_ID, startedAt: new Date(Date.now() - 2_000), outcome: 'running' },
      ],
    })
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const app = createWorkerApplication(config, vi.fn(), dependenciesFor(prisma, scheduler))

    await app.start()

    const recovered = await prisma.run.findMany({
      where: { monitorId: MONITOR_ID, outcome: 'interrupted' },
    })
    expect(recovered).toHaveLength(2)
    expect(recovered.every((row) => row.finishedAt !== null)).toBe(true)
  })
})
