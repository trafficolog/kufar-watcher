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
