import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MonitorScheduler,
  type MonitorScheduleQueue,
  type MonitorScheduleRepository,
  type ScheduledJobEnvelope,
  type SchedulerMonitor,
} from '../../electron/worker/monitor-scheduler'

class StaticMonitorRepository implements MonitorScheduleRepository {
  constructor(private readonly monitors: readonly SchedulerMonitor[]) {}

  async list(): Promise<readonly SchedulerMonitor[]> {
    return this.monitors
  }

  async find(monitorId: number): Promise<SchedulerMonitor | null> {
    return this.monitors.find((monitor) => monitor.id === monitorId) ?? null
  }
}

class CaptureScheduleQueue implements MonitorScheduleQueue {
  readonly schedules: Array<{ name: string; cron: string; monitorId: number }> = []

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async hasQueue(): Promise<boolean> {
    return false
  }

  async createQueue(): Promise<void> {}

  async upsertSchedule(name: string, cron: string, data: { monitorId: number }): Promise<void> {
    this.schedules.push({ name, cron, monitorId: data.monitorId })
  }

  async removeSchedule(): Promise<void> {}

  async work(
    name: string,
    _handler: (job: ScheduledJobEnvelope) => Promise<void>,
  ): Promise<string> {
    return `worker/${name}`
  }

  async offWork(): Promise<void> {}
}

const synchronizedMonitors = (): SchedulerMonitor[] =>
  Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    intervalSec: 60,
    state: 'active' as const,
  }))

async function registeredSchedules(monitors: readonly SchedulerMonitor[]) {
  const queue = new CaptureScheduleQueue()
  const scheduler = new MonitorScheduler({
    repository: new StaticMonitorRepository(monitors),
    queue,
    runMonitor: async () => undefined,
  })

  await scheduler.start()
  return queue.schedules
}

describe('scheduler burst characterization', () => {
  it('registers five equal-interval monitors on the same wall-clock cron slot across restart', async () => {
    const monitors = synchronizedMonitors()

    const firstStart = await registeredSchedules(monitors)
    const restart = await registeredSchedules(monitors)

    expect(firstStart).toEqual([
      { name: 'monitor-run/1', cron: '* * * * *', monitorId: 1 },
      { name: 'monitor-run/2', cron: '* * * * *', monitorId: 2 },
      { name: 'monitor-run/3', cron: '* * * * *', monitorId: 3 },
      { name: 'monitor-run/4', cron: '* * * * *', monitorId: 4 },
      { name: 'monitor-run/5', cron: '* * * * *', monitorId: 5 },
    ])
    expect(restart).toEqual(firstStart)
  })
})

describe('external request burst characterization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('serializes five simultaneous Kufar HTTP clients through the worker-global limiter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { KufarHttpClient } = await import('../../electron/worker/kufar-http-client')
    const starts: number[] = []
    const transport = {
      async request() {
        starts.push(Date.now())
        return {
          status: 200,
          headers: {},
          body: new Uint8Array(),
        }
      },
      async close() {},
    }
    const clients = Array.from({ length: 5 }, () => new KufarHttpClient({ transport }))

    const requests = clients.map((client, index) =>
      client.get(`https://api.kufar.by/search-api/v2/search/rendered-paginated?slot=${index}`),
    )

    await vi.runAllTimersAsync()
    const results = await Promise.all(requests)

    expect(results.every((result) => result.ok)).toBe(true)
    expect(starts).toEqual([0, 2_000, 4_000, 6_000, 8_000])
  })
})
