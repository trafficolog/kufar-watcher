import type { WorkerEvent, WorkerProcessHandle } from '../../shared/runtime'

export type RestartDecision = 'restart' | 'fatal'
export type WorkerShutdownResult = 'acknowledged' | 'timed-out'

export interface RestartPolicy {
  recordCrash(): RestartDecision
  reset(): void
}

function isWorkerEvent(message: unknown): message is WorkerEvent {
  if (!message || typeof message !== 'object' || !('type' in message)) return false
  const type = Reflect.get(message, 'type')
  return type === 'ready' || type === 'shutdown-complete' || type === 'journal'
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
