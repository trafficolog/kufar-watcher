import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRestartPolicy,
  requestWorkerShutdown,
  restartDelayMs,
} from '../electron/main/worker-supervisor'

class FakeWorker extends EventEmitter {
  messages: unknown[] = []
  killed = false

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): boolean {
    this.killed = true
    return true
  }
}

interface TestSupervisor {
  start(): void
  shutdown(): Promise<string>
}

interface TestSupervisorOptions {
  spawnWorker(): FakeWorker
  onEvent?(event: unknown): void
  onFatal?(message: string): void
  maxRestarts?: number
  shutdownTimeoutMs?: number
}

type CreateSupervisor = (options: TestSupervisorOptions) => TestSupervisor

async function loadCreateWorkerSupervisor(): Promise<CreateSupervisor | undefined> {
  const workerModule = await import('../electron/main/worker-supervisor')
  return Reflect.get(workerModule, 'createWorkerSupervisor') as CreateSupervisor | undefined
}

afterEach(() => vi.useRealTimers())

describe('worker restart policy', () => {
  it('enters fatal state after the fourth consecutive unexpected exit', () => {
    const policy = createRestartPolicy(3)
    expect(policy.recordCrash()).toBe('restart')
    expect(policy.recordCrash()).toBe('restart')
    expect(policy.recordCrash()).toBe('restart')
    expect(policy.recordCrash()).toBe('fatal')
  })

  it('uses bounded 1s, 2s, 4s restart delays', () => {
    expect(restartDelayMs(1)).toBe(1_000)
    expect(restartDelayMs(2)).toBe(2_000)
    expect(restartDelayMs(3)).toBe(4_000)
  })
})

describe('worker shutdown', () => {
  it('sends shutdown and resolves only after shutdown-complete', async () => {
    const worker = new FakeWorker()

    const shutdown = requestWorkerShutdown(worker, 1_000)
    expect(worker.messages).toEqual([{ type: 'shutdown' }])
    expect(worker.killed).toBe(false)

    worker.emit('message', { type: 'shutdown-complete' })

    await expect(shutdown).resolves.toBe('acknowledged')
    expect(worker.killed).toBe(false)
  })

  it('kills the worker when graceful shutdown times out', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()

    const shutdown = requestWorkerShutdown(worker, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(shutdown).resolves.toBe('timed-out')
    expect(worker.killed).toBe(true)
  })
})

describe('worker supervisor', () => {
  it('restarts an unexpectedly exited worker and emits a journal event', async () => {
    vi.useFakeTimers()
    const firstWorker = new FakeWorker()
    const secondWorker = new FakeWorker()
    const workers = [firstWorker, secondWorker]
    const events: unknown[] = []
    let spawnCount = 0
    const createWorkerSupervisor = await loadCreateWorkerSupervisor()

    expect(createWorkerSupervisor).toBeTypeOf('function')
    const supervisor = createWorkerSupervisor!({
      spawnWorker: () => workers[spawnCount++]!,
      onEvent: (event) => events.push(event),
    })

    supervisor.start()
    firstWorker.emit('exit', 1)

    expect(spawnCount).toBe(1)
    expect(events).toContainEqual({
      type: 'journal',
      level: 'warning',
      message: 'Worker exited unexpectedly; restart in 1000 ms',
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(spawnCount).toBe(2)
  })

  it('enters fatal state after the fourth unexpected exit', async () => {
    vi.useFakeTimers()
    const workers = Array.from({ length: 4 }, () => new FakeWorker())
    const fatalMessages: string[] = []
    let spawnCount = 0
    const createWorkerSupervisor = await loadCreateWorkerSupervisor()

    expect(createWorkerSupervisor).toBeTypeOf('function')
    const supervisor = createWorkerSupervisor!({
      spawnWorker: () => workers[spawnCount++]!,
      onFatal: (message) => fatalMessages.push(message),
    })

    supervisor.start()

    workers[0]!.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1_000)
    workers[1]!.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(2_000)
    workers[2]!.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(4_000)
    workers[3]!.emit('exit', 1)
    await vi.runOnlyPendingTimersAsync()

    expect(spawnCount).toBe(4)
    expect(fatalMessages).toEqual(['Worker failed more than three times'])
  })

  it('does not restart after application shutdown begins', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    let spawnCount = 0
    const createWorkerSupervisor = await loadCreateWorkerSupervisor()

    expect(createWorkerSupervisor).toBeTypeOf('function')
    const supervisor = createWorkerSupervisor!({
      spawnWorker: () => {
        spawnCount += 1
        return worker
      },
    })

    supervisor.start()
    const shutdown = supervisor.shutdown()
    worker.emit('message', { type: 'shutdown-complete' })
    await shutdown
    worker.emit('exit', 0)
    await vi.runOnlyPendingTimersAsync()

    expect(spawnCount).toBe(1)
  })
})
