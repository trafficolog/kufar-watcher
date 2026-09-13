export const TELEGRAM_RUNTIME_STATES = [
  'not-configured',
  'starting',
  'waiting-for-binding',
  'ready',
  'degraded',
] as const

export type TelegramRuntimeState = (typeof TELEGRAM_RUNTIME_STATES)[number]

export const TELEGRAM_BIND_RESULTS = ['bound', 'candidate-mismatch', 'no-candidate'] as const

export type TelegramBindResult = (typeof TELEGRAM_BIND_RESULTS)[number]

export const TELEGRAM_CHAT_TYPES = [
  'private',
  'group',
  'supergroup',
  'channel',
  'unknown',
] as const

export type TelegramChatType = (typeof TELEGRAM_CHAT_TYPES)[number]

export interface TelegramCandidate {
  chatId: string
  chatType: TelegramChatType
  displayName: string
  username?: string
}

export interface TelegramDesktopState {
  runtime: TelegramRuntimeState
  boundChatId: string | null
  candidate: TelegramCandidate | null
  secret: 'missing' | 'protected' | 'unavailable'
}
