import type { WorkerControlMessage, WorkerEvent } from '../../shared/runtime'

export interface WorkerParentPort {
  postMessage(message: WorkerEvent): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

export interface WorkerRuntimeServices {
  start(): Promise<void>
  stop(): Promise<void>
}

function isWorkerControlMessage(message: unknown): message is WorkerControlMessage {
  return Boolean(
    message && typeof message === 'object' && Reflect.get(message, 'type') === 'shutdown',
  )
}

export async function startWorkerRuntime(
  parentPort: WorkerParentPort,
  services: WorkerRuntimeServices,
  exit: (code: number) => void,
): Promise<void> {
  let started = false
  let shutdownRequested = false
  let shutdownStarted = false

  const stopAndExit = async (): Promise<void> => {
    if (shutdownStarted) return
    shutdownStarted = true

    await services.stop()
    parentPort.postMessage({ type: 'shutdown-complete' })
    exit(0)
  }

  parentPort.on('message', ({ data }) => {
    if (!isWorkerControlMessage(data)) return

    shutdownRequested = true
    if (started) void stopAndExit()
  })

  await services.start()
  started = true

  if (shutdownRequested) {
    await stopAndExit()
    return
  }

  parentPort.postMessage({ type: 'ready' })
}
