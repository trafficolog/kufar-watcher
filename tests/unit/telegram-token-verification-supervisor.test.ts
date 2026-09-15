import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

class FakeWorker extends EventEmitter {
  messages: unknown[] = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }
}

interface TestSupervisor {
  start(): void
  verifyTelegramToken(token: string): Promise<{ username: string }>
}

interface CreateSupervisorOptions {
  spawnWorker(): FakeWorker
  onEvent?(event: unknown): void
}

type CreateSupervisor = (options: CreateSupervisorOptions) => TestSupervisor

async function createSupervisor(options: CreateSupervisorOptions): Promise<TestSupervisor> {
  const workerModule = await import('../../electron/main/worker-supervisor')
  const createWorkerSupervisor = Reflect.get(workerModule, 'createWorkerSupervisor') as
    | CreateSupervisor
    | undefined
  expect(createWorkerSupervisor).toBeTypeOf('function')
  return createWorkerSupervisor!(options)
}

describe('Telegram token verification supervisor RPC', () => {
  it('correlates concurrent verification results without forwarding them as UI events', async () => {
    const worker = new FakeWorker()
    const events: unknown[] = []
    const supervisor = await createSupervisor({
      spawnWorker: () => worker,
      onEvent: (event) => events.push(event),
    })
    supervisor.start()

    const first = supervisor.verifyTelegramToken('SECRET_SENTINEL_VERIFY_1')
    const second = supervisor.verifyTelegramToken('SECRET_SENTINEL_VERIFY_2')
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

  it('rejects only the correlated verification when the worker reports an error', async () => {
    const worker = new FakeWorker()
    const supervisor = await createSupervisor({ spawnWorker: () => worker })
    supervisor.start()

    const verification = supervisor.verifyTelegramToken('SECRET_SENTINEL_VERIFY_FAIL')
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
