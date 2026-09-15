import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

import {
  createWorkerSupervisor,
  type WorkerSupervisor,
} from '../../electron/main/worker-supervisor'

class FakeWorker extends EventEmitter {
  messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }
}

function requireVerifier(supervisor: WorkerSupervisor) {
  const verifyTelegramToken = supervisor.verifyTelegramToken
  if (!verifyTelegramToken) throw new Error('Expected Telegram token verification capability')
  return verifyTelegramToken
}

describe('Telegram token verification supervisor RPC', () => {
  it('correlates concurrent verification results', async () => {
    const worker = new FakeWorker()
    const events: unknown[] = []
    const supervisor = createWorkerSupervisor({
      spawnWorker: () => worker,
      onEvent: (event) => events.push(event),
    })
    supervisor.start()
    const verifyTelegramToken = requireVerifier(supervisor)

    const first = verifyTelegramToken('SECRET_SENTINEL_VERIFY_1')
    const second = verifyTelegramToken('SECRET_SENTINEL_VERIFY_2')
    const requests = worker.messages.filter(
      (message): message is { type: string; requestId: string; token: string } =>
        typeof message === 'object' &&
        message !== null &&
        Reflect.get(message, 'type') === 'telegram-verify-token',
    )

    expect(requests).toHaveLength(2)
    expect(requests[0]!.requestId).not.toBe(requests[1]!.requestId)

    worker.emit('message', {
      type: 'telegram-verify-token-result',
      requestId: requests[1]!.requestId,
      username: 'second_bot',
    })
    worker.emit('message', {
      type: 'telegram-verify-token-result',
      requestId: requests[0]!.requestId,
      username: 'first_bot',
    })

    await expect(first).resolves.toEqual({ username: 'first_bot' })
    await expect(second).resolves.toEqual({ username: 'second_bot' })
    expect(events).toEqual([])
  })

  it('rejects the correlated verification with a fixed error', async () => {
    const worker = new FakeWorker()
    const supervisor = createWorkerSupervisor({ spawnWorker: () => worker })
    supervisor.start()
    const verifyTelegramToken = requireVerifier(supervisor)

    const verification = verifyTelegramToken('SECRET_SENTINEL_VERIFY_FAIL')
    const request = worker.messages.find(
      (message): message is { type: string; requestId: string } =>
        typeof message === 'object' &&
        message !== null &&
        Reflect.get(message, 'type') === 'telegram-verify-token',
    )

    expect(request).toBeDefined()
    worker.emit('message', {
      type: 'telegram-verify-token-error',
      requestId: request!.requestId,
    })

    await expect(verification).rejects.toThrow('Telegram token verification failed')
  })
})
