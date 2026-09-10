import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PgBoss } from 'pg-boss'

import { createPrismaMonitorScheduleRepository } from '../../electron/worker/monitor-schedule-repository'
import { MonitorScheduler, monitorQueueName } from '../../electron/worker/monitor-scheduler'
import {
  createPgBossScheduleQueue,
  type PgBossFactory,
} from '../../electron/worker/pg-boss-schedule-queue'
import { createPrismaClient } from '../../electron/worker/prisma-client'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITORS = [
  { id: 915_001, intervalSec: 60, cron: '* * * * *' },
  { id: 915_002, intervalSec: 120, cron: '*/2 * * * *' },
  { id: 915_003, intervalSec: 300, cron: '*/5 * * * *' },
  { id: 915_004, intervalSec: 600, cron: '*/10 * * * *' },
  { id: 915_005, intervalSec: 900, cron: '*/15 * * * *' },
] as const
const MONITOR_IDS = MONITORS.map(({ id }) => id)
const QUEUE_NAMES = MONITORS.map(({ id }) => monitorQueueName(id))

interface SchedulerStack {
  boss: PgBoss
  scheduler: MonitorScheduler
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for monitor scheduler integration')
  return value
}

function createSchedulerStack(
  runMonitor: (monitorId: number) => Promise<unknown>,
  onError: (error: unknown) => void,
): SchedulerStack {
  const connectionString = databaseUrl()
  const boss = new PgBoss({ connectionString, schedule: false })
  const queue = createPgBossScheduleQueue(
    connectionString,
    onError,
    (() => boss as unknown as ReturnType<PgBossFactory>) as PgBossFactory,
  )
  const repository = createPrismaMonitorScheduleRepository(prisma)
  const scheduler = new MonitorScheduler({ repository, queue, runMonitor })

  return { boss, scheduler }
}

async function schedulesFor(boss: PgBoss, name: string) {
  return (await boss.getSchedules()).filter((schedule) => schedule.name === name)
}

async function waitForDispatch(dispatchedIds: number[]): Promise<void> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    if (dispatchedIds.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error('Timed out waiting for pg-boss monitor dispatch')
}

async function stopStack(stack: SchedulerStack | null): Promise<void> {
  if (!stack) return
  await stack.scheduler.stop()
}

async function cleanupQueues(): Promise<void> {
  const boss = new PgBoss({ connectionString: databaseUrl(), schedule: false })
  await boss.start()

  try {
    for (const name of QUEUE_NAMES) {
      await boss.unschedule(name)
      if (await boss.getQueue(name)) {
        await boss.deleteQueue(name)
      }
    }
  } finally {
    await boss.stop()
  }
}

let prisma: ReturnType<typeof createPrismaClient>

integration('PostgreSQL pg-boss monitor scheduler', () => {
  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('persists, reconciles, restarts, and dispatches monitor schedules', async () => {
    const existingMonitors = await prisma.monitor.findMany({
      select: { id: true, state: true },
    })
    const queueErrors: unknown[] = []
    const dispatchedIds: number[] = []
    let first: SchedulerStack | null = null
    let second: SchedulerStack | null = null

    try {
      await prisma.monitor.updateMany({ data: { state: 'archived' } })
      await prisma.monitor.deleteMany({ where: { id: { in: MONITOR_IDS } } })
      await prisma.monitor.createMany({
        data: MONITORS.map(({ id, intervalSec }) => ({
          id,
          name: `scheduler-integration-${id}`,
          sourceUrl: `https://fixtures.invalid/scheduler/${id}`,
          query: {},
          intervalSec,
          keywords: [],
          state: 'active' as const,
        })),
      })

      first = createSchedulerStack(
        async () => undefined,
        (error) => queueErrors.push(error),
      )
      await first.scheduler.start()

      const initialSchedules = (await first.boss.getSchedules()).filter((schedule) =>
        schedule.name.startsWith('monitor-run/'),
      )
      expect(initialSchedules).toHaveLength(5)
      for (const monitor of MONITORS) {
        expect(await schedulesFor(first.boss, monitorQueueName(monitor.id))).toEqual([
          expect.objectContaining({
            name: monitorQueueName(monitor.id),
            cron: monitor.cron,
          }),
        ])
      }

      await prisma.monitor.update({
        where: { id: MONITORS[0].id },
        data: { intervalSec: 300 },
      })
      await first.scheduler.syncMonitor(MONITORS[0].id)
      expect(await schedulesFor(first.boss, monitorQueueName(MONITORS[0].id))).toEqual([
        expect.objectContaining({ cron: '*/5 * * * *' }),
      ])

      await prisma.monitor.update({
        where: { id: MONITORS[1].id },
        data: { state: 'paused' },
      })
      await prisma.monitor.update({
        where: { id: MONITORS[2].id },
        data: { state: 'archived' },
      })
      await first.scheduler.syncMonitor(MONITORS[1].id)
      await first.scheduler.syncMonitor(MONITORS[2].id)
      expect(await schedulesFor(first.boss, monitorQueueName(MONITORS[1].id))).toEqual([])
      expect(await schedulesFor(first.boss, monitorQueueName(MONITORS[2].id))).toEqual([])

      await stopStack(first)
      first = null

      second = createSchedulerStack(
        async (monitorId) => {
          dispatchedIds.push(monitorId)
        },
        (error) => queueErrors.push(error),
      )
      await second.scheduler.start()

      const restartedSchedules = (await second.boss.getSchedules()).filter((schedule) =>
        QUEUE_NAMES.includes(schedule.name as (typeof QUEUE_NAMES)[number]),
      )
      expect(restartedSchedules).toHaveLength(3)
      for (const monitor of [MONITORS[0], MONITORS[3], MONITORS[4]]) {
        expect(await schedulesFor(second.boss, monitorQueueName(monitor.id))).toHaveLength(1)
      }
      expect(await schedulesFor(second.boss, monitorQueueName(MONITORS[1].id))).toEqual([])
      expect(await schedulesFor(second.boss, monitorQueueName(MONITORS[2].id))).toEqual([])

      const dispatchedMonitorId = MONITORS[4].id
      const jobId = await second.boss.send(monitorQueueName(dispatchedMonitorId), {
        monitorId: dispatchedMonitorId,
      })
      expect(jobId).not.toBeNull()
      await waitForDispatch(dispatchedIds)

      expect(dispatchedIds).toEqual([dispatchedMonitorId])
      expect(queueErrors).toEqual([])
    } finally {
      await stopStack(second)
      await stopStack(first)
      await cleanupQueues()
      await prisma.monitor.deleteMany({ where: { id: { in: MONITOR_IDS } } })
      for (const monitor of existingMonitors) {
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { state: monitor.state },
        })
      }
    }
  })
})
