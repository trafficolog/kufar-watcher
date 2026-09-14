import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'

import type { PrismaClient } from '../../generated/prisma/client'
import type {
  MonitorScheduleQueue,
  MonitorScheduleRepository,
  MonitorScheduler,
} from '../../electron/worker/monitor-scheduler'
import { createPostgresMonitorRunLeaseAcquirer } from '../../electron/worker/monitor-run-lease'
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
const OTHER_MONITOR_ID = 916_102
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

function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for Run recovery integration')
  return value
}

function workerConfig() {
  return { ...config, databaseUrl: databaseUrl() }
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
    createRunRecoveryLeaseAcquirer: (connectionString) =>
      createPostgresMonitorRunLeaseAcquirer(connectionString),
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
  }
}

function scheduler(): MonitorScheduler {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as MonitorScheduler
}

async function waitForBlockedRunUpdate(observer: Client): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await observer.query<{ query: string }>(`
      SELECT activity.query
      FROM pg_stat_activity activity
      WHERE activity.datname = current_database()
        AND activity.pid <> pg_backend_pid()
        AND pg_backend_pid() = ANY(pg_blocking_pids(activity.pid))
      LIMIT 1
    `)
    if (result.rows[0]) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('Timed out waiting for recovery UPDATE to block on the Run row lock')
}

integration('Run lifecycle recovery', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: { in: [MONITOR_ID, OTHER_MONITOR_ID] } } })
    for (const [id, name] of [
      [MONITOR_ID, 'run-lifecycle-recovery'],
      [OTHER_MONITOR_ID, 'run-lifecycle-recovery-other'],
    ] as const) {
      await prisma.monitor.create({
        data: {
          id,
          name,
          sourceUrl: `https://fixtures.invalid/${name}`,
          query: QUERY,
          intervalSec: 60,
          keywords: [],
        },
      })
    }
  })

  afterAll(async () => {
    await prisma.monitor.deleteMany({ where: { id: { in: [MONITOR_ID, OTHER_MONITOR_ID] } } })
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
    const currentScheduler = {
      start: vi.fn(async () => {
        const current = await prisma.run.create({
          data: { monitorId: MONITOR_ID, outcome: 'running' },
        })
        currentRunId = current.id
      }),
      stop: vi.fn(async () => undefined),
    } as unknown as MonitorScheduler
    const app = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, currentScheduler),
    )

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

  it('does not interrupt a running row owned by another live PostgreSQL session', async () => {
    const acquireLease = createPostgresMonitorRunLeaseAcquirer(databaseUrl())
    const ownerLease = await acquireLease(MONITOR_ID)
    expect(ownerLease).not.toBeNull()
    if (!ownerLease) throw new Error('Expected owner lease to be acquired')

    const liveRun = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt: new Date(Date.now() - 5_000),
        outcome: 'running',
      },
    })
    const currentScheduler = scheduler()
    const appWhileOwned = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, currentScheduler),
    )

    try {
      await appWhileOwned.start()
      expect(await prisma.run.findUniqueOrThrow({ where: { id: liveRun.id } })).toMatchObject({
        outcome: 'running',
        finishedAt: null,
      })
      expect(currentScheduler.start).toHaveBeenCalledTimes(1)
    } finally {
      await ownerLease.release()
    }

    const recoveryApp = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, currentScheduler),
    )
    await recoveryApp.start()

    const recovered = await prisma.run.findUniqueOrThrow({ where: { id: liveRun.id } })
    expect(recovered).toMatchObject({
      outcome: 'interrupted',
      error: 'Worker process interrupted before Run completion',
      errorCategory: 'internal',
      errorCode: 'worker-interrupted',
    })
    expect(recovered.finishedAt).not.toBeNull()
    expect(recovered.durationMs ?? -1).toBeGreaterThanOrEqual(0)
  })

  it('holds the advisory lease through the blocked terminal update without blocking other monitors', async () => {
    const staleRun = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt: new Date(Date.now() - 5_000),
        outcome: 'running',
      },
    })
    const blocker = new Client({ connectionString: databaseUrl() })
    await blocker.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT "id" FROM "Run" WHERE "id" = $1 FOR UPDATE', [staleRun.id])

    const recoveryScheduler = scheduler()
    const app = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, recoveryScheduler),
    )
    const startPromise = app.start()
    let transactionOpen = true

    try {
      await waitForBlockedRunUpdate(blocker)
      const thirdAcquire = createPostgresMonitorRunLeaseAcquirer(databaseUrl())

      expect(await thirdAcquire(MONITOR_ID)).toBeNull()

      const otherLease = await thirdAcquire(OTHER_MONITOR_ID)
      expect(otherLease).not.toBeNull()
      await otherLease?.release()

      await blocker.query('ROLLBACK')
      transactionOpen = false
      await startPromise

      const leaseAfter = await thirdAcquire(MONITOR_ID)
      expect(leaseAfter).not.toBeNull()
      await leaseAfter?.release()

      expect(await prisma.run.findUniqueOrThrow({ where: { id: staleRun.id } })).toMatchObject({
        outcome: 'interrupted',
        errorCategory: 'internal',
        errorCode: 'worker-interrupted',
      })
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined)
      await blocker.end()
      await startPromise.catch(() => undefined)
    }
  })

  it('recovers every stale running row for one monitor under the same ownership window', async () => {
    const first = await prisma.run.create({
      data: { monitorId: MONITOR_ID, outcome: 'running' },
    })
    const second = await prisma.run.create({
      data: { monitorId: MONITOR_ID, outcome: 'running' },
    })
    const app = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, scheduler()),
    )

    await app.start()

    const rows = await prisma.run.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { id: 'asc' },
    })
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({
        outcome: 'interrupted',
        error: 'Worker process interrupted before Run completion',
        errorCategory: 'internal',
        errorCode: 'worker-interrupted',
      })
      expect(row.finishedAt).not.toBeNull()
    }
  })

  it('serializes concurrent recovery contexts through the canonical monitor advisory lease', async () => {
    const staleRun = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt: new Date(Date.now() - 5_000),
        outcome: 'running',
      },
    })
    const blocker = new Client({ connectionString: databaseUrl() })
    await blocker.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT "id" FROM "Run" WHERE "id" = $1 FOR UPDATE', [staleRun.id])

    const firstScheduler = scheduler()
    const secondScheduler = scheduler()
    const firstApp = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, firstScheduler),
    )
    const secondApp = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, secondScheduler),
    )
    const firstStart = firstApp.start()
    let transactionOpen = true

    try {
      await waitForBlockedRunUpdate(blocker)
      await secondApp.start()

      expect(secondScheduler.start).toHaveBeenCalledTimes(1)
      expect(await prisma.run.findUniqueOrThrow({ where: { id: staleRun.id } })).toMatchObject({
        outcome: 'running',
        finishedAt: null,
      })

      await blocker.query('ROLLBACK')
      transactionOpen = false
      await firstStart

      expect(firstScheduler.start).toHaveBeenCalledTimes(1)
      expect(await prisma.run.findUniqueOrThrow({ where: { id: staleRun.id } })).toMatchObject({
        outcome: 'interrupted',
        errorCategory: 'internal',
        errorCode: 'worker-interrupted',
      })
    } finally {
      if (transactionOpen) await blocker.query('ROLLBACK').catch(() => undefined)
      await blocker.end()
      await firstStart.catch(() => undefined)
    }
  })

  it('is idempotent when startup recovery runs again', async () => {
    const orphan = await prisma.run.create({
      data: {
        monitorId: MONITOR_ID,
        startedAt: new Date(Date.now() - 5_000),
        outcome: 'running',
      },
    })
    const currentScheduler = scheduler()

    const firstApp = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, currentScheduler),
    )
    await firstApp.start()
    const first = await prisma.run.findUniqueOrThrow({ where: { id: orphan.id } })

    const secondApp = createWorkerApplication(
      workerConfig(),
      vi.fn(),
      dependenciesFor(prisma, currentScheduler),
    )
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
