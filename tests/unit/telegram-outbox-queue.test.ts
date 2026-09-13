import { describe, expect, it, vi } from 'vitest'

import { createPgBossTelegramOutboxQueue } from '../../electron/worker/telegram-outbox-queue'

interface FakeJob {
  data: unknown
}

class FakePgBoss {
  queue: object | null = null
  readonly calls: unknown[][] = []
  private workHandler: ((jobs: FakeJob[]) => Promise<void>) | undefined

  on(event: 'error', _handler: (error: unknown) => void): this {
    expect(event).toBe('error')
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

  async createQueue(name: string, options: object): Promise<void> {
    this.calls.push(['createQueue', name, options])
    this.queue = { name }
  }

  async send(name: string, data: object): Promise<string> {
    this.calls.push(['send', name, data])
    return 'job-1'
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

  async dispatch(jobs: FakeJob[]): Promise<void> {
    if (!this.workHandler) throw new Error('Expected outbox worker to be registered')
    await this.workHandler(jobs)
  }
}

describe('Telegram pg-boss outbox queue', () => {
  it('creates a durable retry queue and owns one sequential worker', async () => {
    const boss = new FakePgBoss()
    const factory = vi.fn(() => boss)
    const handler = vi.fn(async () => undefined)
    const queue = createPgBossTelegramOutboxQueue('postgresql://outbox', vi.fn(), factory)

    await queue.start(handler)

    expect(factory).toHaveBeenCalledWith('postgresql://outbox')
    expect(boss.calls).toEqual([
      ['start'],
      ['getQueue', 'telegram-outbox'],
      [
        'createQueue',
        'telegram-outbox',
        {
          retryLimit: 5,
          retryDelay: 5,
          retryBackoff: true,
          retryDelayMax: 60,
        },
      ],
      ['work', 'telegram-outbox', { batchSize: 1 }],
    ])

    const job = { data: { matchId: 11, chatId: '42', text: 'hello' } }
    await boss.dispatch([job])
    expect(handler).toHaveBeenCalledWith(job.data)
  })

  it('persists outgoing payloads through pg-boss and stops gracefully', async () => {
    const boss = new FakePgBoss()
    boss.queue = { name: 'telegram-outbox' }
    const queue = createPgBossTelegramOutboxQueue('postgresql://outbox', vi.fn(), () => boss)
    await queue.start(async () => undefined)

    await queue.enqueue({ matchId: 17, chatId: '77', text: 'queued' })
    await queue.stop()

    expect(boss.calls).toContainEqual([
      'send',
      'telegram-outbox',
      { matchId: 17, chatId: '77', text: 'queued' },
    ])
    expect(boss.calls.slice(-2)).toEqual([
      ['offWork', 'telegram-outbox', { id: 'worker-1', wait: true }],
      ['stop'],
    ])
  })

  it('rejects malformed or empty pg-boss batches before delivery', async () => {
    const boss = new FakePgBoss()
    boss.queue = { name: 'telegram-outbox' }
    const queue = createPgBossTelegramOutboxQueue('postgresql://outbox', vi.fn(), () => boss)
    await queue.start(async () => undefined)

    await expect(boss.dispatch([])).rejects.toThrow(/empty pg-boss batch/i)
    await expect(boss.dispatch([{ data: { matchId: 'wrong' } }])).rejects.toThrow(
      /invalid telegram outbox payload/i,
    )
  })
})
