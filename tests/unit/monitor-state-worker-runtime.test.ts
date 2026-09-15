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

describe('monitor state worker runtime', () => {
  it('persists a request-correlated monitor state change', async () => {
    const parentPort = new FakeParentPort()
    const setMonitorState = vi.fn(async () => undefined)
    const services = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      setMonitorState,
    }

    await startWorkerRuntime(parentPort, services, () => undefined)
    parentPort.receive({
      type: 'monitor-set-state',
      requestId: 'monitor-state-1',
      monitorId: 7,
      state: 'paused',
    })
    await flushMicrotasks()

    expect(setMonitorState).toHaveBeenCalledWith(7, 'paused')
    expect(parentPort.messages).toContainEqual({
      type: 'monitor-set-state-result',
      requestId: 'monitor-state-1',
    })
  })
})
