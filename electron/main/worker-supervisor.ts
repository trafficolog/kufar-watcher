import type { WorkerEvent, WorkerProcessHandle } from '../../shared/runtime'

export type RestartDecision = 'restart' | 'fatal'
export type WorkerShutdownResult = 'acknowledged' | 'timed-out'

export interface RestartPolicy {
  recordCrash(): RestartDecision
  reset(): void
}

export interface WorkerRuntimeHandle extends WorkerProcessHandle {
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
  off(event: 'exit', listener: (code: number) => void): this
}

export interface WorkerSupervisorOptions {
  spawnWorker(): WorkerRuntimeHandle
  onEvent?(event: WorkerEvent): void
  onFatal?(message: string): void
  maxRestarts?: number
  shutdownTimeoutMs?: number
}

export interface WorkerSupervisor {
  start(): void
  shutdown(): Promise<WorkerShutdownResult>
}

function isWorkerEvent(message: unknown): message is WorkerEvent {
  if (!message || typeof message !== 'object' || !('type' in message)) return false
  const type = Reflect.get(message, 'type')
  return (
    type === 'ready' ||
    type === 'shutdown-complete' ||
    type === 'journal' ||
    type === 'monitor-pause-required'
  )
}

export function createRestartPolicy(maxRestarts: number): RestartPolicy {
  let crashes = 0

  return {
    recordCrash(): RestartDecision {
      crashes += 1
      return crashes <= maxRestarts ? 'restart' : 'fatal'
    },
    reset(): void {
      crashes = 0
    },
  }
}

export function restartDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 4_000)
}

export function requestWorkerShutdown(
  worker: WorkerProcessHandle,
  timeoutMs: number,
): Promise<WorkerShutdownResult> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (result: WorkerShutdownResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      worker.off('message', onMessage)
      resolve(result)
    }

    const onMessage = (message: unknown): void => {
      if (isWorkerEvent(message) && message.type === 'shutdown-complete') {
        finish('acknowledged')
      }
    }

    const timeout = setTimeout(() => {
      worker.kill()
      finish('timed-out')
    }, timeoutMs)

    worker.on('message', onMessage)
    worker.postMessage({ type: 'shutdown' })
  })
}

export function createWorkerSupervisor(options: WorkerSupervisorOptions): WorkerSupervisor {
  const restartPolicy = createRestartPolicy(options.maxRestarts ?? 3)
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000
  let currentWorker: WorkerRuntimeHandle | undefined
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let restartAttempt = 0
  let stopping = false

  const spawn = (): void => {
    const worker = options.spawnWorker()
    currentWorker = worker

    const onMessage = (message: unknown): void => {
      if (!isWorkerEvent(message)) return
      if (message.type === 'ready') {
        restartPolicy.reset()
        restartAttempt = 0
      }
      options.onEvent?.(message)
    }

    const onExit = (): void => {
      worker.off('message', onMessage)
      worker.off('exit', onExit)
      if (currentWorker === worker) currentWorker = undefined
      if (stopping) return

      restartAttempt += 1
      if (restartPolicy.recordCrash() === 'fatal') {
        options.onEvent?.({
          type: 'journal',
          level: 'error',
          message: 'Worker failed more than three times',
        })
        options.onFatal?.('Worker failed more than three times')
        return
      }

      const delayMs = restartDelayMs(restartAttempt)
      options.onEvent?.({
        type: 'journal',
        level: 'warning',
        message: `Worker exited unexpectedly; restart in ${delayMs} ms`,
      })
      restartTimer = setTimeout(() => {
        restartTimer = undefined
        if (!stopping) spawn()
      }, delayMs)
    }

    worker.on('message', onMessage)
    worker.on('exit', onExit)
  }

  return {
    start(): void {
      spawn()
    },
    async shutdown(): Promise<WorkerShutdownResult> {
      stopping = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = undefined
      }
      if (!currentWorker) return 'acknowledged'
      return requestWorkerShutdown(currentWorker, shutdownTimeoutMs)
    },
  }
}
