import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { MonitorCreateInput, MonitorCreateResult } from '../../shared/ipc'

class FakeWorker extends EventEmitter {
  readonly messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }
}

interface MonitorCreateSupervisor {
  start(): void
  createMonitor(input: MonitorCreateInput): Promise<MonitorCreateResult>
}

describe('monitor create worker supervisor', () => {
  it('correlates a monitor create request with the worker result', async () => {
    const worker = new FakeWorker()
    const workerModule = await import('../../electron/main/worker-supervisor')
    const createWorkerSupervisor = Reflect.get(
      workerModule,
      'createWorkerSupervisor',
    ) as (options: { spawnWorker(): FakeWorker }) => MonitorCreateSupervisor
    const supervisor = createWorkerSupervisor({ spawnWorker: () => worker })
    const input: MonitorCreateInput = {
      name: 'PS5 Минск',
      sourceUrl: 'https://www.kufar.by/l/igry-i-pristavki/r~minsk/q~playstation',
      intervalSec: 300,
      include: ['ps5'],
      exclude: ['ремонт'],
    }

    expect(Reflect.get(supervisor, 'createMonitor')).toBeTypeOf('function')
    supervisor.start()
    const created = supervisor.createMonitor(input)
    const request = worker.messages.find(
      (message): message is { type: string; requestId: string; input: MonitorCreateInput } =>
        typeof message === 'object' &&
        message !== null &&
        Reflect.get(message, 'type') === 'monitor-create',
    )

    expect(request).toBeDefined()
    expect(request!.input).toEqual(input)

    worker.emit('message', {
      type: 'monitor-create-result',
      requestId: request!.requestId,
      result: { monitorId: 17 },
    })

    await expect(created).resolves.toEqual({ monitorId: 17 })
  })
})
