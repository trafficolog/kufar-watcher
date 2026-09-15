import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

class FakeWorker extends EventEmitter {
  readonly messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }
}

interface MonitorStateSupervisor {
  start(): void
  setMonitorState(monitorId: number, state: 'active' | 'paused'): Promise<void>
}

describe('monitor state worker supervisor', () => {
  it('correlates a monitor state request with the worker result', async () => {
    const worker = new FakeWorker()
    const workerModule = await import('../../electron/main/worker-supervisor')
    const createWorkerSupervisor = Reflect.get(
      workerModule,
      'createWorkerSupervisor',
    ) as (options: { spawnWorker(): FakeWorker }) => MonitorStateSupervisor
    const supervisor = createWorkerSupervisor({ spawnWorker: () => worker })

    expect(Reflect.get(supervisor, 'setMonitorState')).toBeTypeOf('function')
    supervisor.start()
    const updated = supervisor.setMonitorState(7, 'paused')
    const request = worker.messages.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        Reflect.get(message, 'type') === 'monitor-set-state',
    )

    expect(request).toBeDefined()
    expect(request).toMatchObject({ monitorId: 7, state: 'paused' })

    worker.emit('message', {
      type: 'monitor-set-state-result',
      requestId: request!.requestId,
    })

    await expect(updated).resolves.toBeUndefined()
  })
})
