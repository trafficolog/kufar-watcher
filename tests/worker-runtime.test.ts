import { describe, expect, it } from 'vitest'

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

type StartWorkerRuntime = (
  parentPort: FakeParentPort,
  exit: (code: number) => void,
) => void

async function loadStartWorkerRuntime(): Promise<StartWorkerRuntime | undefined> {
  const workerModule = await import('../electron/worker/runtime').catch(() => ({}))
  return Reflect.get(workerModule, 'startWorkerRuntime') as StartWorkerRuntime | undefined
}

describe('utility worker runtime', () => {
  it('announces readiness when started', async () => {
    const parentPort = new FakeParentPort()
    const startWorkerRuntime = await loadStartWorkerRuntime()

    expect(startWorkerRuntime).toBeTypeOf('function')
    startWorkerRuntime!(parentPort, () => undefined)

    expect(parentPort.messages).toEqual([{ type: 'ready' }])
  })

  it('acknowledges shutdown before exiting cleanly', async () => {
    const parentPort = new FakeParentPort()
    const exits: number[] = []
    const startWorkerRuntime = await loadStartWorkerRuntime()

    expect(startWorkerRuntime).toBeTypeOf('function')
    startWorkerRuntime!(parentPort, (code) => exits.push(code))
    parentPort.receive({ type: 'shutdown' })

    expect(parentPort.messages).toEqual([{ type: 'ready' }, { type: 'shutdown-complete' }])
    expect(exits).toEqual([0])
  })
})
