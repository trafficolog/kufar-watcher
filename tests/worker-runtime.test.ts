import { describe, expect, it } from 'vitest'
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

describe('utility worker runtime', () => {
  it('announces readiness when started', () => {
    const parentPort = new FakeParentPort()

    startWorkerRuntime(parentPort, () => undefined)

    expect(parentPort.messages).toEqual([{ type: 'ready' }])
  })

  it('acknowledges shutdown before exiting cleanly', () => {
    const parentPort = new FakeParentPort()
    const exits: number[] = []

    startWorkerRuntime(parentPort, (code) => exits.push(code))
    parentPort.receive({ type: 'shutdown' })

    expect(parentPort.messages).toEqual([{ type: 'ready' }, { type: 'shutdown-complete' }])
    expect(exits).toEqual([0])
  })
})
