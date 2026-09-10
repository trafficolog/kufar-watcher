export type WorkerControlMessage = { type: 'shutdown' }

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'shutdown-complete' }
  | { type: 'journal'; level: 'info' | 'warning' | 'error'; message: string }
  | {
      type: 'monitor-pause-required'
      monitorId: number
      stage: 'primary' | 'html-fallback' | 'degradation-event'
    }

export interface WorkerProcessHandle {
  postMessage(message: WorkerControlMessage): void
  kill(): void
  on(event: 'message', listener: (message: unknown) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
}
