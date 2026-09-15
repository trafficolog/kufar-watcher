import { describe, expect, it, vi } from 'vitest'

import { startWorkerRuntime } from '../../electron/worker/runtime'

class FakeParentPort {
  readonly messages: unknown[] = []
  private listener: ((event: { data: unknown }) => void) | undefined

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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('monitor list worker runtime', () => {
  it('returns a request-correlated monitor list snapshot', async () => {
    const parentPort = new FakeParentPort()
    const snapshot = [
      {
        id: 7,
        name: 'PS5 Minsk',
        intervalSec: 300,
        state: 'active',
        lastRun: null,
      },
    ]
    const listMonitors = vi.fn(async () => snapshot)
    const services = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      listMonitors,
    }

    await startWorkerRuntime(parentPort, services, () => undefined)
    parentPort.receive({ type: 'monitor-list', requestId: 'monitor-list-1' })
    await flushMicrotasks()

    expect(listMonitors).toHaveBeenCalledOnce()
    expect(parentPort.messages).toContainEqual({
      type: 'monitor-list-result',
      requestId: 'monitor-list-1',
      result: snapshot,
    })
  })
})
