import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PgBoss } from 'pg-boss'

import { createMonitorConfigAndSync } from '../../electron/worker/monitor-config-sync'
import { createPrismaMonitorScheduleRepository } from '../../electron/worker/monitor-schedule-repository'
import { MonitorScheduler, monitorQueueName } from '../../electron/worker/monitor-scheduler'
import {
  createPgBossScheduleQueue,
  type PgBossFactory,
} from '../../electron/worker/pg-boss-schedule-queue'
import { createPrismaClient } from '../../electron/worker/prisma-client'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip
const SOURCE_URL = 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~playstation'

function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for monitor quick-create integration')
  return value
}

let prisma: ReturnType<typeof createPrismaClient>

integration('monitor quick-create', () => {
  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('persists the rule and reconciles its real pg-boss schedule immediately', async () => {
    const connectionString = databaseUrl()
    const boss = new PgBoss({ connectionString, schedule: false })
    const queueErrors: unknown[] = []
    const queue = createPgBossScheduleQueue(
      connectionString,
      (error) => queueErrors.push(error),
      (() => boss as unknown as ReturnType<PgBossFactory>) as PgBossFactory,
    )
    const scheduler = new MonitorScheduler({
      repository: createPrismaMonitorScheduleRepository(prisma),
      queue,
      runMonitor: async () => undefined,
    })
    let monitorId: number | null = null

    await queue.start()

    try {
      const result = await createMonitorConfigAndSync(prisma, scheduler, {
        name: 'PS5 Minsk quick-create',
        sourceUrl: SOURCE_URL,
        intervalSec: 300,
        include: ['ps5', 'playstation*'],
        exclude: ['repair'],
      })
      const createdId = result.monitorId
      monitorId = createdId

      const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: createdId } })
      expect(monitor).toEqual(
        expect.objectContaining({
          name: 'PS5 Minsk quick-create',
          sourceUrl: SOURCE_URL,
          intervalSec: 300,
          state: 'active',
          keywords: {
            include: ['ps5', 'playstation*'],
            exclude: ['repair'],
          },
        }),
      )
      expect(monitor.query).toEqual(
        expect.objectContaining({
          host: 'www.kufar.by',
          region: 'minsk',
          query: 'playstation',
        }),
      )

      expect(
        (await boss.getSchedules()).filter(
          (schedule) => schedule.name === monitorQueueName(createdId),
        ),
      ).toEqual([
        expect.objectContaining({
          name: monitorQueueName(createdId),
          cron: '*/5 * * * *',
        }),
      ])
      expect(queueErrors).toEqual([])
    } finally {
      if (monitorId !== null) {
        const queueName = monitorQueueName(monitorId)
        await prisma.monitor.update({ where: { id: monitorId }, data: { state: 'archived' } })
        await scheduler.syncMonitor(monitorId)
        if (await boss.getQueue(queueName)) await boss.deleteQueue(queueName)
        await prisma.monitor.delete({ where: { id: monitorId } })
      }
      await scheduler.stop()
    }
  })
})
