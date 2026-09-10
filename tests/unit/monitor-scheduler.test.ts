import { describe, expect, it } from 'vitest'

import {
  MonitorScheduler,
  monitorIntervalCron,
  monitorQueueName,
  type MonitorScheduleQueue,
  type MonitorScheduleRepository,
  type ScheduledJobEnvelope,
  type SchedulerMonitor,
} from '../../electron/worker/monitor-scheduler'

class FakeMonitorRepository implements MonitorScheduleRepository {
  private readonly monitors = new Map<number, SchedulerMonitor>()

  constructor(monitors: readonly SchedulerMonitor[] = []) {
    for (const monitor of monitors) this.set(monitor)
  }

  async list(): Promise<readonly SchedulerMonitor[]> {
    return [...this.monitors.values()]
  }

  async find(monitorId: number): Promise<SchedulerMonitor | null> {
    return this.monitors.get(monitorId) ?? null
  }

  set(monitor: SchedulerMonitor): void {
    this.monitors.set(monitor.id, monitor)
  }

  delete(monitorId: number): void {
    this.monitors.delete(monitorId)
  }
}

class FakeScheduleQueue implements MonitorScheduleQueue {
  readonly queues = new Set<string>()
  readonly createCalls: string[] = []
  readonly schedules = new Map<string, { cron: string; data: { monitorId: number } }>()
  readonly events: string[] = []
  private readonly workers = new Map<
    string,
    Map<string, (job: ScheduledJobEnvelope) => Promise<void>>
  >()
  private workerSequence = 0

  async start(): Promise<void> {
    this.events.push('start')
  }

  async stop(): Promise<void> {
    this.events.push('stop')
  }

  async hasQueue(name: string): Promise<boolean> {
    return this.queues.has(name)
  }

  async createQueue(name: string): Promise<void> {
    this.createCalls.push(name)
    this.queues.add(name)
  }

  async upsertSchedule(
    name: string,
    cron: string,
    data: { monitorId: number },
  ): Promise<void> {
    this.schedules.set(name, { cron, data })
  }

  async removeSchedule(name: string): Promise<void> {
    this.schedules.delete(name)
  }

  async work(
    name: string,
    handler: (job: ScheduledJobEnvelope) => Promise<void>,
  ): Promise<string> {
    this.workerSequence += 1
    const workerId = `worker-${this.workerSequence}`
    const queueWorkers = this.workers.get(name) ?? new Map()
    queueWorkers.set(workerId, handler)
    this.workers.set(name, queueWorkers)
    this.events.push(`work:${name}`)
    return workerId
  }

  async offWork(name: string, workerId: string): Promise<void> {
    const queueWorkers = this.workers.get(name)
    queueWorkers?.delete(workerId)
    if (queueWorkers?.size === 0) this.workers.delete(name)
    this.events.push(`offWork:${name}`)
  }

  workersFor(name: string): readonly string[] {
    return [...(this.workers.get(name)?.keys() ?? [])]
  }

  handlerFor(name: string): (job: ScheduledJobEnvelope) => Promise<void> {
    const handlers = [...(this.workers.get(name)?.values() ?? [])]
    if (handlers.length !== 1) throw new Error(`Expected one worker for ${name}`)
    return handlers[0] as (job: ScheduledJobEnvelope) => Promise<void>
  }

  scheduleNames(): string[] {
    return [...this.schedules.keys()].sort()
  }
}

describe('monitor scheduler contract', () => {
  it('derives a stable queue name from monitor id', () => {
    expect(monitorQueueName(42)).toBe('monitor-run:42')
  })

  it.each([
    [60, '* * * * *'],
    [120, '*/2 * * * *'],
    [300, '*/5 * * * *'],
    [600, '*/10 * * * *'],
    [900, '*/15 * * * *'],
    [3600, '0 * * * *'],
  ])('maps %i seconds to %s', (intervalSec, cron) => {
    expect(monitorIntervalCron(intervalSec)).toBe(cron)
  })

  it('rejects unsupported persisted intervals instead of rounding', () => {
    expect(() => monitorIntervalCron(180)).toThrow(/unsupported monitor interval/i)
  })
})

describe('MonitorScheduler', () => {
  it('reconciles active monitors and removes persisted schedules for inactive monitors', async () => {
    const repository = new FakeMonitorRepository([
      { id: 1, intervalSec: 60, state: 'active' },
      { id: 2, intervalSec: 300, state: 'paused' },
      { id: 3, intervalSec: 900, state: 'archived' },
    ])
    const queue = new FakeScheduleQueue()
    queue.schedules.set('monitor-run:2', { cron: '*/5 * * * *', data: { monitorId: 2 } })
    queue.schedules.set('monitor-run:3', { cron: '*/15 * * * *', data: { monitorId: 3 } })
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })

    await scheduler.start()

    expect(queue.schedules).toEqual(
      new Map([['monitor-run:1', { cron: '* * * * *', data: { monitorId: 1 } }]]),
    )
    expect(queue.workersFor('monitor-run:1')).toHaveLength(1)
    expect(queue.workersFor('monitor-run:2')).toHaveLength(0)
    expect(queue.workersFor('monitor-run:3')).toHaveLength(0)
  })

  it('reuses an existing durable queue instead of recreating it', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    queue.queues.add('monitor-run:1')
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })

    await scheduler.start()

    expect(queue.createCalls).toEqual([])
    expect(queue.schedules.get('monitor-run:1')).toEqual({
      cron: '* * * * *',
      data: { monitorId: 1 },
    })
    expect(queue.workersFor('monitor-run:1')).toHaveLength(1)
  })

  it('does not duplicate local workers on repeated reconciliation', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })
    await scheduler.start()

    await scheduler.syncMonitor(1)
    await scheduler.syncMonitor(1)

    expect(queue.workersFor('monitor-run:1')).toHaveLength(1)
  })

  it('updates interval on the same schedule identity', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })
    await scheduler.start()

    repository.set({ id: 1, intervalSec: 300, state: 'active' })
    await scheduler.syncMonitor(1)

    expect(queue.schedules.get('monitor-run:1')?.cron).toBe('*/5 * * * *')
    expect(queue.scheduleNames()).toEqual(['monitor-run:1'])
    expect(queue.workersFor('monitor-run:1')).toHaveLength(1)
  })

  it('removes paused or archived monitors and reactivates with one local worker', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })
    await scheduler.start()

    repository.set({ id: 1, intervalSec: 300, state: 'paused' })
    await scheduler.syncMonitor(1)
    expect(queue.schedules.has('monitor-run:1')).toBe(false)
    expect(queue.workersFor('monitor-run:1')).toHaveLength(0)

    repository.set({ id: 1, intervalSec: 300, state: 'archived' })
    await scheduler.syncMonitor(1)
    expect(queue.schedules.has('monitor-run:1')).toBe(false)

    repository.set({ id: 1, intervalSec: 300, state: 'active' })
    await scheduler.syncMonitor(1)
    expect(queue.schedules.get('monitor-run:1')?.cron).toBe('*/5 * * * *')
    expect(queue.workersFor('monitor-run:1')).toHaveLength(1)
  })

  it('removes the schedule and local worker when a monitor no longer exists', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })
    await scheduler.start()
    expect(queue.schedules.has('monitor-run:1')).toBe(true)
    expect(queue.workersFor('monitor-run:1')).toHaveLength(1)

    repository.delete(1)
    await scheduler.syncMonitor(1)

    expect(queue.schedules.has('monitor-run:1')).toBe(false)
    expect(queue.workersFor('monitor-run:1')).toHaveLength(0)
  })

  it('dispatches one valid job and rejects malformed or mismatched monitor ids', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const runs: number[] = []
    const scheduler = new MonitorScheduler({
      repository,
      queue,
      runMonitor: async (monitorId) => {
        runs.push(monitorId)
      },
    })
    await scheduler.start()
    const handler = queue.handlerFor('monitor-run:1')

    await handler({ data: { monitorId: 1 } })
    await expect(handler({ data: { monitorId: 2 } })).rejects.toThrow(/monitor id/i)
    await expect(handler({ data: null })).rejects.toThrow(/monitor id/i)

    expect(runs).toEqual([1])
  })

  it('stops local workers before stopping the queue client', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 60, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const scheduler = new MonitorScheduler({ repository, queue, runMonitor: async () => undefined })
    await scheduler.start()

    await scheduler.stop()

    expect(queue.events.slice(-2)).toEqual(['offWork:monitor-run:1', 'stop'])
    expect(queue.workersFor('monitor-run:1')).toHaveLength(0)
  })
})
