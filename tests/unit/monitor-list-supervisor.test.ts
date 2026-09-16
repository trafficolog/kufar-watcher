import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { MonitorListItem } from '../../shared/ipc'

class FakeWorker extends EventEmitter {
  readonly messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }
}

interface MonitorListSupervisor {
  start(): void
  listMonitors(): Promise<MonitorListItem[]>
}

describe('monitor list worker supervisor', () => {
  it('correlates a monitor list request with the worker result including exact source settings', async () => {
    const worker = new FakeWorker()
    const workerModule = await import('../../electron/main/worker-supervisor')
    const createWorkerSupervisor = Reflect.get(
      workerModule,
      'createWorkerSupervisor',
    ) as (options: { spawnWorker(): FakeWorker }) => MonitorListSupervisor
    const supervisor = createWorkerSupervisor({ spawnWorker: () => worker })
    const snapshot: MonitorListItem[] = [
      {
        id: 7,
        name: 'PS5 Minsk',
        sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
        include: ['ps5'],
        exclude: ['ремонт'],
        intervalSec: 300,
        state: 'active',
        lastRun: null,
      },
    ]

    expect(Reflect.get(supervisor, 'listMonitors')).toBeTypeOf('function')
    supervisor.start()
    const listed = supervisor.listMonitors()
    const request = worker.messages.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        Reflect.get(message, 'type') === 'monitor-list',
    )

    expect(request).toBeDefined()

    worker.emit('message', {
      type: 'monitor-list-result',
      requestId: request!.requestId,
      result: snapshot,
    })

    await expect(listed).resolves.toEqual(snapshot)
  })
})
