import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { createWorkerSupervisor } from '../../electron/main/worker-supervisor'

class FakeWorker extends EventEmitter {
  messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }
}

it('forwards monitor-changed events from the worker process', () => {
  const worker = new FakeWorker()
  const events: unknown[] = []
  const supervisor = createWorkerSupervisor({
    spawnWorker: () => worker,
    onEvent: (event) => events.push(event),
  })

  supervisor.start()
  worker.emit('message', { type: 'monitor-changed', monitorId: 17 })

  expect(events).toContainEqual({ type: 'monitor-changed', monitorId: 17 })
})
