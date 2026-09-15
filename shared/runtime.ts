import type { MonitorCreateInput, MonitorCreateResult } from './ipc'
import type {
  TelegramBindResult,
  TelegramCandidate,
  TelegramChannelState,
  TelegramRuntimeState,
} from './telegram'

export type WorkerControlMessage =
  | { type: 'shutdown' }
  | { type: 'telegram-configure'; token: string | null }
  | { type: 'telegram-resume' }
  | {
      type: 'telegram-verify-token'
      requestId: string
      token: string
    }
  | {
      type: 'telegram-bind-candidate'
      requestId: string
      chatId: string
    }
  | {
      type: 'monitor-create'
      requestId: string
      input: MonitorCreateInput
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
      type: 'monitor-create-result'
      requestId: string
      result: MonitorCreateResult
    }
  | { type: 'monitor-create-error'; requestId: string }
  | {
      type: 'telegram-state'
      state: TelegramRuntimeState
      boundChatId: string | null
    }
  | { type: 'telegram-channel-state'; state: TelegramChannelState }
  | { type: 'telegram-candidate'; candidate: TelegramCandidate | null }
  | {
      type: 'telegram-verify-token-result'
      requestId: string
      username: string
    }
  | { type: 'telegram-verify-token-error'; requestId: string }
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
