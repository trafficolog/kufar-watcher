import { describe, expect, it, vi } from 'vitest'

import { createPgBossScheduleQueue } from '../../electron/worker/pg-boss-schedule-queue'

interface FakeJob {
  data: unknown
}

interface RetryOptions {
  retryLimit: number
  retryDelay: number
  retryBackoff: boolean
  retryDelayMax: number
}

class FakePgBoss {
  queue: object | null = null
  readonly calls: unknown[][] = []
  private errorHandler: ((error: unknown) => void) | undefined
  private workHandler: ((jobs: FakeJob[]) => Promise<void>) | undefined

  on(event: 'error', handler: (error: unknown) => void): this {
    expect(event).toBe('error')
    this.errorHandler = handler
    return this
  }

  async start(): Promise<this> {
    this.calls.push(['start'])
    return this
  }

  async stop(): Promise<void> {
    this.calls.push(['stop'])
  }

  async getQueue(name: string): Promise<object | null> {
    this.calls.push(['getQueue', name])
    return this.queue
  }

  async createQueue(name: string): Promise<void> {
    this.calls.push(['createQueue', name])
  }

  async schedule(
    name: string,
    cron: string,
    data: object,
    options?: RetryOptions,
  ): Promise<void> {
    this.calls.push(['schedule', name, cron, data, options])
  }

  async unschedule(name: string): Promise<void> {
    this.calls.push(['unschedule', name])
  }

  async work(
    name: string,
    options: { batchSize: number },
    handler: (jobs: FakeJob[]) => Promise<void>,
  ): Promise<string> {
    this.calls.push(['work', name, options])
    this.workHandler = handler
    return 'worker-1'
  }

  async offWork(name: string, options: { id: string; wait: boolean }): Promise<void> {
    this.calls.push(['offWork', name, options])
  }

  emitError(error: unknown): void {
    this.errorHandler?.(error)
  }

  async dispatch(jobs: FakeJob[]): Promise<void> {
    if (!this.workHandler) throw new Error('Expected work handler to be registered')
    await this.workHandler(jobs)
  }
}

describe('pg-boss schedule queue adapter', () => {
  it('owns the pg-boss lifecycle and forwards error events', async () => {
    const boss = new FakePgBoss()
    const onError = vi.fn()
    const factory = vi.fn(() => boss)
    const queue = createPgBossScheduleQueue('postgresql://scheduler', onError, factory)

    await queue.start()
    boss.emitError(new Error('queue failure'))
    await queue.stop()

    expect(factory).toHaveBeenCalledWith('postgresql://scheduler')
    expect(boss.calls).toEqual([['start'], ['stop']])
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'queue failure' })
  })

  it('maps durable queue and schedule operations with a bounded exponential retry policy', async () => {
    const boss = new FakePgBoss()
    const queue = createPgBossScheduleQueue('postgresql://scheduler', vi.fn(), () => boss)

    expect(await queue.hasQueue('monitor-run/7')).toBe(false)
    boss.queue = { name: 'monitor-run/7' }
    expect(await queue.hasQueue('monitor-run/7')).toBe(true)

    await queue.createQueue('monitor-run/7')
    await queue.upsertSchedule('monitor-run/7', '*/5 * * * *', { monitorId: 7 })
    await queue.removeSchedule('monitor-run/7')

    expect(boss.calls).toEqual([
      ['getQueue', 'monitor-run/7'],
      ['getQueue', 'monitor-run/7'],
      ['createQueue', 'monitor-run/7'],
      [
        'schedule',
        'monitor-run/7',
        '*/5 * * * *',
        { monitorId: 7 },
        {
          retryLimit: 2,
          retryDelay: 10,
          retryBackoff: true,
          retryDelayMax: 60,
        },
      ],
      ['unschedule', 'monitor-run/7'],
    ])
  })

  it('registers a single-job worker, rejects empty batches, and stops the exact worker gracefully', async () => {
    const boss = new FakePgBoss()
    const queue = createPgBossScheduleQueue('postgresql://scheduler', vi.fn(), () => boss)
    const handler = vi.fn(async () => undefined)

    const workerId = await queue.work('monitor-run/7', handler)

    expect(workerId).toBe('worker-1')
    expect(boss.calls).toEqual([['work', 'monitor-run/7', { batchSize: 1 }]])

    await expect(boss.dispatch([])).rejects.toThrow(/empty pg-boss batch/i)

    const job = { data: { monitorId: 7 } }
    await boss.dispatch([job])
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(job)

    await queue.offWork('monitor-run/7', workerId)
    expect(boss.calls.at(-1)).toEqual(['offWork', 'monitor-run/7', { id: 'worker-1', wait: true }])
  })
})