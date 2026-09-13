import { describe, expect, it, vi } from 'vitest'

import { startWorkerRuntime } from '../../electron/worker/runtime'
import type { WorkerEvent } from '../../shared/runtime'

class FakeParentPort {
  readonly messages: WorkerEvent[] = []
  private listener: ((event: { data: unknown }) => void) | undefined

  postMessage(message: WorkerEvent): void {
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

describe('Telegram secret redaction', () => {
  it('never includes token plaintext in worker events when configuration fails', async () => {
    const token = 'SECRET_SENTINEL_3_1_1'
    const parentPort = new FakeParentPort()
    const services = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      configureTelegram: vi.fn(async () => {
        throw new Error(`Telegram rejected ${token}`)
      }),
    }

    await startWorkerRuntime(parentPort, services, () => undefined)
    parentPort.receive({ type: 'telegram-configure', token })
    await flushMicrotasks()

    expect(parentPort.messages).toContainEqual({
      type: 'journal',
      level: 'error',
      message: 'Telegram configuration failed',
    })
    expect(JSON.stringify(parentPort.messages)).not.toContain(token)
  })
})
