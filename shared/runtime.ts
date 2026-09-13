import type { TelegramBindResult, TelegramCandidate, TelegramRuntimeState } from './telegram'

export type WorkerControlMessage =
  | { type: 'shutdown' }
  | { type: 'telegram-configure'; token: string | null }
  | {
      type: 'telegram-bind-candidate'
      requestId: string
      chatId: string
    }

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'shutdown-complete' }
  | { type: 'journal'; level: 'info' | 'warning' | 'error'; message: string }
  | {
      type: 'monitor-pause-required'
      monitorId: number
      stage: 'primary' | 'html-fallback' | 'degradation-event'
    }
  | {
      type: 'telegram-state'
      state: TelegramRuntimeState
      boundChatId: string | null
    }
  | { type: 'telegram-candidate'; candidate: TelegramCandidate | null }
  | {
      type: 'telegram-bind-result'
      requestId: string
      result: TelegramBindResult
    }
  | { type: 'telegram-bind-error'; requestId: string }

export interface WorkerProcessHandle {
  postMessage(message: WorkerControlMessage): void
  kill(): void
  on(event: 'message', listener: (message: unknown) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
}
