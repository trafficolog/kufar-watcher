import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

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

describe('Telegram test-message supervisor RPC', () => {
  it('correlates a test-message result without sending a chat id', async () => {
    const worker = new FakeWorker()
    const events: unknown[] = []
    const supervisor = createWorkerSupervisor({
      spawnWorker: () => worker,
      onEvent: (event) => events.push(event),
    })
    supervisor.start()

    const delivery = supervisor.sendTelegramTestMessage()
    const request = worker.messages.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        Reflect.get(message, 'type') === 'telegram-test-message',
    )

    expect(request).toBeDefined()
    expect(Reflect.has(request!, 'chatId')).toBe(false)

    worker.emit('message', {
      type: 'telegram-test-message-result',
      requestId: request!.requestId,
    })

    await expect(delivery).resolves.toBeUndefined()
    expect(events).toEqual([])
  })
})
