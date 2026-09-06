import type { WorkerControlMessage, WorkerEvent } from '../../shared/runtime'

export interface WorkerParentPort {
  postMessage(message: WorkerEvent): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

function isWorkerControlMessage(message: unknown): message is WorkerControlMessage {
  return Boolean(
    message && typeof message === 'object' && Reflect.get(message, 'type') === 'shutdown',
  )
}

export function startWorkerRuntime(
  parentPort: WorkerParentPort,
  exit: (code: number) => void,
): void {
  parentPort.postMessage({ type: 'ready' })

  parentPort.on('message', ({ data }) => {
    if (!isWorkerControlMessage(data)) return

    parentPort.postMessage({ type: 'shutdown-complete' })
    exit(0)
  })
}
