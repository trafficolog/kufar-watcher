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
  return `monitor-run:${monitorId}`
}

export function monitorIntervalCron(intervalSec: number): string {
  const cron = MONITOR_INTERVAL_CRON.get(intervalSec)
  if (cron === undefined) {
    throw new Error(`Unsupported monitor interval: ${intervalSec}`)
  }
  return cron
}
