import { describe, expect, it, vi } from 'vitest'

import type { Prisma } from '../../generated/prisma/client'
import { updateMonitorConfigTransaction } from '../../electron/worker/monitor-config-persistence'
import {
  MonitorScheduler,
  type MonitorScheduleQueue,
  type MonitorScheduleRepository,
  type ScheduledJobEnvelope,
  type SchedulerMonitor,
} from '../../electron/worker/monitor-scheduler'
import type { CanonicalQuery } from '../../shared/canonical-query'

const VALID_QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

class FakeMonitorRepository implements MonitorScheduleRepository {
  constructor(private readonly monitors: readonly SchedulerMonitor[]) {}

  async list(): Promise<readonly SchedulerMonitor[]> {
    return this.monitors
  }

  async find(monitorId: number): Promise<SchedulerMonitor | null> {
    return this.monitors.find((monitor) => monitor.id === monitorId) ?? null
  }
}

class FakeScheduleQueue implements MonitorScheduleQueue {
  readonly queues = new Set<string>()
  readonly createCalls: string[] = []
  readonly schedules = new Map<string, { cron: string; data: { monitorId: number } }>()
  private workerSequence = 0

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async hasQueue(name: string): Promise<boolean> {
    return this.queues.has(name)
  }

  async createQueue(name: string): Promise<void> {
    this.createCalls.push(name)
    this.queues.add(name)
  }

  async upsertSchedule(name: string, cron: string, data: { monitorId: number }): Promise<void> {
    this.schedules.set(name, { cron, data })
  }

  async removeSchedule(name: string): Promise<void> {
    this.schedules.delete(name)
  }

  async work(
    _name: string,
    _handler: (job: ScheduledJobEnvelope) => Promise<void>,
  ): Promise<string> {
    this.workerSequence += 1
    return `worker-${this.workerSequence}`
  }

  async offWork(_name: string, _workerId: string): Promise<void> {}
}

describe('scheduler interval remediation', () => {
  it('isolates one malformed active monitor during startup and reconciles valid siblings', async () => {
    const repository = new FakeMonitorRepository([
      { id: 1, intervalSec: 180, state: 'active' },
      { id: 2, intervalSec: 60, state: 'active' },
    ])
    const queue = new FakeScheduleQueue()
    const reconcileErrors: Array<{ monitorId: number; error: unknown }> = []
    const scheduler = new MonitorScheduler({
      repository,
      queue,
      runMonitor: async () => undefined,
      onReconcileError(monitorId: number, error: unknown) {
        reconcileErrors.push({ monitorId, error })
      },
    } as unknown as ConstructorParameters<typeof MonitorScheduler>[0])

    await expect(scheduler.start()).resolves.toBeUndefined()

    expect(queue.schedules.get('monitor-run/2')).toEqual({
      cron: '* * * * *',
      data: { monitorId: 2 },
    })
    expect(queue.schedules.has('monitor-run/1')).toBe(false)
    expect(queue.createCalls).not.toContain('monitor-run/1')
    expect(reconcileErrors).toHaveLength(1)
    expect(reconcileErrors[0]?.monitorId).toBe(1)
    expect(reconcileErrors[0]?.error).toMatchObject({
      name: 'UnsupportedMonitorIntervalError',
      intervalSec: 180,
    })
  })

  it('keeps explicit sync failure typed and side-effect free for an unsupported interval', async () => {
    const repository = new FakeMonitorRepository([{ id: 1, intervalSec: 180, state: 'active' }])
    const queue = new FakeScheduleQueue()
    const scheduler = new MonitorScheduler({
      repository,
      queue,
      runMonitor: async () => undefined,
    })

    let caught: unknown
    try {
      await scheduler.syncMonitor(1)
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      name: 'UnsupportedMonitorIntervalError',
      intervalSec: 180,
    })
    expect(queue.createCalls).toEqual([])
    expect(queue.schedules.size).toBe(0)
  })
})

describe('monitor interval write boundary', () => {
  it('rejects an unsupported interval before persisting the monitor update', async () => {
    const update = vi.fn(async () => undefined)
    const tx = {
      monitor: {
        findUniqueOrThrow: vi.fn(async () => ({
          sourceUrl: 'https://www.kufar.by/l/electronics?query=phone',
          query: VALID_QUERY,
          state: 'active',
        })),
        update,
      },
      monitorCursor: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Prisma.TransactionClient

    let caught: unknown
    try {
      await updateMonitorConfigTransaction(tx, 1, { intervalSec: 180 })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      name: 'UnsupportedMonitorIntervalError',
      intervalSec: 180,
    })
    expect(update).not.toHaveBeenCalled()
  })
})
