import { describe, expect, it, vi } from 'vitest'

import { startWorkerRuntime } from '../../electron/worker/runtime'
import type { MonitorCreateInput } from '../../shared/ipc'

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

describe('monitor create worker runtime', () => {
  it('returns a request-correlated monitor create result', async () => {
    const parentPort = new FakeParentPort()
    const input: MonitorCreateInput = {
      name: 'fixture',
      sourceUrl: 'https://www.kufar.by/l/igry-i-pristavki',
      intervalSec: 300,
      include: ['console'],
      exclude: ['repair'],
    }
    const createMonitor = vi.fn(async (_input: MonitorCreateInput) => ({ monitorId: 17 }))
    const services = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      createMonitor,
    }

    await startWorkerRuntime(parentPort, services, () => undefined)
    parentPort.receive({ type: 'monitor-create', requestId: 'monitor-1', input })
    await flushMicrotasks()

    expect(createMonitor).toHaveBeenCalledWith(input)
    expect(parentPort.messages).toContainEqual({
      type: 'monitor-create-result',
      requestId: 'monitor-1',
      result: { monitorId: 17 },
    })
  })
})
