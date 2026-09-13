import type {
  TelegramBindResult,
  TelegramCandidate,
  TelegramRuntimeState,
} from '../../shared/telegram'

export const TELEGRAM_BINDING_ACKNOWLEDGEMENT =
  'Запрос на привязку получен. Подтвердите привязку в приложении Kufar Monitor.'

export interface TelegramBindingRepository {
  getBoundChatId(): Promise<string | null>
  setBoundChatId(chatId: string): Promise<void>
}

export interface TelegramBotHandlers {
  onMessage(candidate: TelegramCandidate): Promise<void>
  onCallbackQuery(chatId: string | null): Promise<void>
}

export interface TelegramBotTransport {
  start(): Promise<void>
  stop(): Promise<void>
  sendMessage(chatId: string, text: string): Promise<void>
}

export type TelegramBotErrorKind = 'polling' | 'handler'

export type TelegramBotFactory = (
  token: string,
  handlers: TelegramBotHandlers,
  onError: (kind: TelegramBotErrorKind) => void,
) => TelegramBotTransport

export interface TelegramBotService {
  configure(token: string | null): Promise<void>
  bindCandidate(chatId: string): Promise<TelegramBindResult>
  getState(): TelegramRuntimeState
  getCandidate(): TelegramCandidate | null
  getBoundChatId(): string | null
  stop(): Promise<void>
}

export interface TelegramBotServiceOptions {
  repository: TelegramBindingRepository
  createBot: TelegramBotFactory
  publishState?(state: TelegramRuntimeState, boundChatId: string | null): void
  publishCandidate?(candidate: TelegramCandidate | null): void
  publishJournal?(message: string): void
}

function journalMessage(kind: TelegramBotErrorKind): string {
  return kind === 'polling' ? 'Telegram polling failed' : 'Telegram update handler failed'
}

export function createTelegramBotService(options: TelegramBotServiceOptions): TelegramBotService {
  let state: TelegramRuntimeState = 'not-configured'
  let candidate: TelegramCandidate | null = null
  let boundChatId: string | null = null
  let transport: TelegramBotTransport | undefined

  const publishState = (nextState: TelegramRuntimeState): void => {
    state = nextState
    options.publishState?.(state, boundChatId)
  }

  const clearCandidate = (): void => {
    if (candidate === null) return
    candidate = null
    options.publishCandidate?.(null)
  }

  const markFailure = (kind: TelegramBotErrorKind): void => {
    publishState('degraded')
    options.publishJournal?.(journalMessage(kind))
  }

  const handlers: TelegramBotHandlers = {
    async onMessage(nextCandidate): Promise<void> {
      if (boundChatId !== null) return

      candidate = nextCandidate
      options.publishCandidate?.(candidate)
      try {
        await transport?.sendMessage(candidate.chatId, TELEGRAM_BINDING_ACKNOWLEDGEMENT)
      } catch {
        markFailure('handler')
      }
    },
    async onCallbackQuery(_chatId): Promise<void> {
      // Callback handling is intentionally empty in 3.1.1. Authorization is deny-by-default;
      // product actions arrive only in later Telegram tasks and must check the bound chat first.
    },
  }

  const stopTransport = async (): Promise<void> => {
    const current = transport
    transport = undefined
    if (current) await current.stop()
  }

  return {
    async configure(token): Promise<void> {
      await stopTransport()
      clearCandidate()

      if (token === null) {
        boundChatId = null
        publishState('not-configured')
        return
      }

      publishState('starting')
      boundChatId = await options.repository.getBoundChatId()

      try {
        transport = options.createBot(token, handlers, markFailure)
        void transport.start().catch(() => undefined)
      } catch {
        transport = undefined
        markFailure('polling')
        return
      }

      publishState(boundChatId === null ? 'waiting-for-binding' : 'ready')
    },

    async bindCandidate(chatId): Promise<TelegramBindResult> {
      if (candidate === null) return 'no-candidate'
      if (candidate.chatId !== chatId) return 'candidate-mismatch'

      await options.repository.setBoundChatId(chatId)
      boundChatId = chatId
      clearCandidate()
      publishState('ready')
      return 'bound'
    },

    getState(): TelegramRuntimeState {
      return state
    },

    getCandidate(): TelegramCandidate | null {
      return candidate
    },

    getBoundChatId(): string | null {
      return boundChatId
    },

    async stop(): Promise<void> {
      await stopTransport()
    },
  }
}
