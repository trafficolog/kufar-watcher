import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

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

describe('Telegram reconnect supervisor wiring', () => {
  it('sends a credential-free resume control message to the active worker', () => {
    const worker = new FakeWorker()
    const supervisor = createWorkerSupervisor({ spawnWorker: () => worker }) as ReturnType<
      typeof createWorkerSupervisor
    > & { resumeTelegram(): void }

    supervisor.start()
    supervisor.resumeTelegram()

    expect(worker.messages).toContainEqual({ type: 'telegram-resume' })
    expect(JSON.stringify(worker.messages)).not.toContain('token')
  })

  it('forwards only valid Telegram channel-state events from the worker', () => {
    const worker = new FakeWorker()
    const onEvent = vi.fn()
    const supervisor = createWorkerSupervisor({ spawnWorker: () => worker, onEvent })

    supervisor.start()
    worker.emit('message', { type: 'telegram-channel-state', state: 'reconnecting' })
    worker.emit('message', { type: 'telegram-channel-state', state: 'invalid-state' })

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith({
      type: 'telegram-channel-state',
      state: 'reconnecting',
    })
  })
})
