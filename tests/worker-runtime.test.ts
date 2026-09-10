import { describe, expect, it, vi } from 'vitest'
import { startWorkerRuntime } from '../electron/worker/runtime'

class FakeParentPort {
  messages: unknown[] = []
  listener: ((event: { data: unknown }) => void) | undefined

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  on(_event: 'message', listener: (event: { data: unknown }) => void): void {
    this.listener = listener
  }

  receive(data: unknown): void {
    this.listener?.({ data })
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve() {
      resolvePromise?.()
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('utility worker runtime', () => {
  it('announces readiness only after runtime services start', async () => {
    const parentPort = new FakeParentPort()
    const startGate = deferred()
    const services = {
      start: vi.fn(() => startGate.promise),
      stop: vi.fn(async () => undefined),
    }

    const startup = startWorkerRuntime(parentPort, services, () => undefined)

    expect(parentPort.messages).toEqual([])
    startGate.resolve()
    await startup
    expect(parentPort.messages).toEqual([{ type: 'ready' }])
  })

  it('acknowledges shutdown only after runtime services stop', async () => {
    const parentPort = new FakeParentPort()
    const stopGate = deferred()
    const exits: number[] = []
    const services = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => stopGate.promise),
    }

    await startWorkerRuntime(parentPort, services, (code) => exits.push(code))
    parentPort.receive({ type: 'shutdown' })

    expect(parentPort.messages).toEqual([{ type: 'ready' }])
    expect(exits).toEqual([])

    stopGate.resolve()
    await flushMicrotasks()

    expect(parentPort.messages).toEqual([{ type: 'ready' }, { type: 'shutdown-complete' }])
    expect(exits).toEqual([0])
    expect(services.stop).toHaveBeenCalledTimes(1)
  })

  it('does not announce ready when shutdown was requested during startup', async () => {
    const parentPort = new FakeParentPort()
    const startGate = deferred()
    const services = {
      start: vi.fn(() => startGate.promise),
      stop: vi.fn(async () => undefined),
    }
    const exits: number[] = []

    const startup = startWorkerRuntime(parentPort, services, (code) => exits.push(code))
    parentPort.receive({ type: 'shutdown' })

    expect(services.stop).not.toHaveBeenCalled()
    startGate.resolve()
    await startup
    await flushMicrotasks()

    expect(parentPort.messages).toEqual([{ type: 'shutdown-complete' }])
    expect(exits).toEqual([0])
    expect(services.stop).toHaveBeenCalledTimes(1)
  })
})
