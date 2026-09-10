export type SchedulerMonitorState = 'active' | 'paused' | 'archived'

export interface SchedulerMonitor {
  id: number
  intervalSec: number
  state: SchedulerMonitorState
}

export interface MonitorScheduleRepository {
  list(): Promise<readonly SchedulerMonitor[]>
  find(monitorId: number): Promise<SchedulerMonitor | null>
}

export interface ScheduledJobEnvelope {
  data: unknown
}

export interface MonitorScheduleQueue {
  start(): Promise<void>
  stop(): Promise<void>
  hasQueue(name: string): Promise<boolean>
  createQueue(name: string): Promise<void>
  upsertSchedule(name: string, cron: string, data: { monitorId: number }): Promise<void>
  removeSchedule(name: string): Promise<void>
  work(name: string, handler: (job: ScheduledJobEnvelope) => Promise<void>): Promise<string>
  offWork(name: string, workerId: string): Promise<void>
}

export interface MonitorSchedulerOptions {
  repository: MonitorScheduleRepository
  queue: MonitorScheduleQueue
  runMonitor(monitorId: number): Promise<unknown>
}

const MONITOR_INTERVAL_CRON = new Map<number, string>([
  [60, '* * * * *'],
  [120, '*/2 * * * *'],
  [300, '*/5 * * * *'],
  [600, '*/10 * * * *'],
  [900, '*/15 * * * *'],
  [3600, '0 * * * *'],
])

export function monitorQueueName(monitorId: number): string {
  if (!Number.isInteger(monitorId) || monitorId < 1) {
    throw new Error(`Invalid monitor id: ${monitorId}`)
  }
  return `monitor-run/${monitorId}`
}

export function monitorIntervalCron(intervalSec: number): string {
  const cron = MONITOR_INTERVAL_CRON.get(intervalSec)
  if (cron === undefined) {
    throw new Error(`Unsupported monitor interval: ${intervalSec}`)
  }
  return cron
}

function assertScheduledMonitorId(data: unknown, expectedMonitorId: number): void {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('monitorId' in data) ||
    !Number.isInteger(Reflect.get(data, 'monitorId')) ||
    Reflect.get(data, 'monitorId') !== expectedMonitorId
  ) {
    throw new Error(`Invalid monitor id for ${monitorQueueName(expectedMonitorId)}`)
  }
}

export class MonitorScheduler {
  private readonly repository: MonitorScheduleRepository
  private readonly queue: MonitorScheduleQueue
  private readonly runMonitor: (monitorId: number) => Promise<unknown>
  private readonly workerIds = new Map<string, string>()

  constructor({ repository, queue, runMonitor }: MonitorSchedulerOptions) {
    this.repository = repository
    this.queue = queue
    this.runMonitor = runMonitor
  }

  async start(): Promise<void> {
    await this.queue.start()

    for (const monitor of await this.repository.list()) {
      await this.reconcile(monitor.id, monitor)
    }
  }

  async syncMonitor(monitorId: number): Promise<void> {
    const monitor = await this.repository.find(monitorId)
    await this.reconcile(monitorId, monitor)
  }

  async stop(): Promise<void> {
    for (const [name, workerId] of [...this.workerIds.entries()]) {
      await this.queue.offWork(name, workerId)
      this.workerIds.delete(name)
    }

    await this.queue.stop()
  }

  private async reconcile(monitorId: number, monitor: SchedulerMonitor | null): Promise<void> {
    const name = monitorQueueName(monitorId)

    if (monitor === null || monitor.state !== 'active') {
      await this.queue.removeSchedule(name)

      const workerId = this.workerIds.get(name)
      if (workerId !== undefined) {
        await this.queue.offWork(name, workerId)
        this.workerIds.delete(name)
      }
      return
    }

    if (!(await this.queue.hasQueue(name))) {
      await this.queue.createQueue(name)
    }

    await this.queue.upsertSchedule(name, monitorIntervalCron(monitor.intervalSec), {
      monitorId: monitor.id,
    })

    if (!this.workerIds.has(name)) {
      const workerId = await this.queue.work(name, async (job) => {
        assertScheduledMonitorId(job.data, monitorId)
        await this.runMonitor(monitorId)
      })
      this.workerIds.set(name, workerId)
    }
  }
}
