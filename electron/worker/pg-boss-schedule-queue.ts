import { PgBoss } from 'pg-boss'

import type { MonitorScheduleQueue, ScheduledJobEnvelope } from './monitor-scheduler'

interface PgBossRetryOptions {
  retryLimit: number
  retryDelay: number
  retryBackoff: boolean
  retryDelayMax: number
}

interface PgBossScheduleClient {
  on(event: 'error', listener: (error: unknown) => void): unknown
  start(): Promise<unknown>
  stop(): Promise<void>
  getQueue(name: string): Promise<unknown | null>
  createQueue(name: string): Promise<unknown>
  schedule(name: string, cron: string, data: object, options: PgBossRetryOptions): Promise<void>
  unschedule(name: string): Promise<void>
  work(
    name: string,
    options: { batchSize: number },
    handler: (jobs: ScheduledJobEnvelope[]) => Promise<void>,
  ): Promise<string>
  offWork(name: string, options: { id: string; wait: boolean }): Promise<void>
}

export type PgBossFactory = (connectionString: string) => PgBossScheduleClient

const MONITOR_RETRY_OPTIONS = {
  retryLimit: 2,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 60,
} as const satisfies PgBossRetryOptions

const defaultPgBossFactory: PgBossFactory = (connectionString) =>
  new PgBoss({ connectionString }) as unknown as PgBossScheduleClient

export function createPgBossScheduleQueue(
  databaseUrl: string,
  onError: (error: unknown) => void,
  factory: PgBossFactory = defaultPgBossFactory,
): MonitorScheduleQueue {
  const boss = factory(databaseUrl)
  boss.on('error', onError)

  return {
    async start() {
      await boss.start()
    },
    async stop() {
      await boss.stop()
    },
    async hasQueue(name) {
      return (await boss.getQueue(name)) !== null
    },
    async createQueue(name) {
      await boss.createQueue(name)
    },
    async upsertSchedule(name, cron, data) {
      await boss.schedule(name, cron, data, MONITOR_RETRY_OPTIONS)
    },
    async removeSchedule(name) {
      await boss.unschedule(name)
    },
    async work(name, handler) {
      return boss.work(name, { batchSize: 1 }, async (jobs) => {
        const job = jobs[0]
        if (!job) throw new Error(`Empty pg-boss batch for ${name}`)
        await handler(job)
      })
    },
    async offWork(name, workerId) {
      await boss.offWork(name, { id: workerId, wait: true })
    },
  }
}
