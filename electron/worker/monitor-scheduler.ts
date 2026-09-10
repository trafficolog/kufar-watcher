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

export function monitorQueueName(_monitorId: number): string {
  return ''
}

export function monitorIntervalCron(_intervalSec: number): string {
  return ''
}
