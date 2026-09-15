import type {
  TelegramBindResult,
  TelegramCandidate,
  TelegramChannelState,
  TelegramRuntimeState,
} from '../../shared/telegram'
import { isHumanKufarUrl } from './telegram-open-url'
import { createTelegramReconnectPolicy } from './telegram-reconnect-policy'
import { TelegramSendFailure } from './telegram-send-failure'

export const TELEGRAM_BINDING_ACKNOWLEDGEMENT =
  'Запрос на привязку получен. Подтвердите привязку в приложении Kufar Monitor.'
export const TELEGRAM_TEST_MESSAGE = 'Kufar Monitor: тестовое сообщение.'

export interface TelegramBindingRepository {
  getBoundChatId(): Promise<string | null>
  setBoundChatId(chatId: string): Promise<void>
}

export interface TelegramBotHandlers {
  onMessage(candidate: TelegramCandidate): Promise<void>
  onCallbackQuery(chatId: string | null): Promise<void>
}

export interface TelegramNotificationSendOptions {
  openUrl: string
}

export interface TelegramBotIdentity {
  username: string
}

export interface TelegramBotTransport {
  getMe?(): Promise<TelegramBotIdentity>
  start(): Promise<void>
  stop(): Promise<void>
  sendMessage(
    chatId: string,
    text: string,
    options?: TelegramNotificationSendOptions,
  ): Promise<void>
}

export type TelegramBotErrorKind = 'polling' | 'handler'

export type TelegramBotFactory = (
  token: string,
  handlers: TelegramBotHandlers,
  onError: (kind: TelegramBotErrorKind) => void,
) => TelegramBotTransport

export interface TelegramBotService {
  verifyToken?(token: string): Promise<TelegramBotIdentity>
  configure(token: string | null): Promise<void>
  resume(): Promise<void>
  bindCandidate(chatId: string): Promise<TelegramBindResult>
  sendTestMessage(): Promise<void>
  sendMessage(
    chatId: string,
    text: string,
    options?: TelegramNotificationSendOptions,
  ): Promise<void>
  getState(): TelegramRuntimeState
  getCandidate(): TelegramCandidate | null
  getBoundChatId(): string | null
  stop(): Promise<void>
}

export interface TelegramBotServiceOptions {
  repository: TelegramBindingRepository
  createBot: TelegramBotFactory
  publishState?(state: TelegramRuntimeState, boundChatId: string | null): void
  publishChannelState?(state: TelegramChannelState): void
  publishCandidate?(candidate: TelegramCandidate | null): void
  publishJournal?(message: string): void
}

function journalMessage(kind: TelegramBotErrorKind): string {
  return kind === 'polling' ? 'Telegram polling failed' : 'Telegram update handler failed'
}

const verificationHandlers: TelegramBotHandlers = {
  async onMessage(): Promise<void> {},
  async onCallbackQuery(): Promise<void> {},
}

export function createTelegramBotService(options: TelegramBotServiceOptions): TelegramBotService {
  const reconnectPolicy = createTelegramReconnectPolicy()
  let state: TelegramRuntimeState = 'not-configured'
  let candidate: TelegramCandidate | null = null
  let boundChatId: string | null = null
  let activeToken: string | null = null
  let transport: TelegramBotTransport | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let lifecycleGeneration = 0

  const publishState = (nextState: TelegramRuntimeState): void => {
    state = nextState
    options.publishState?.(state, boundChatId)
  }

  const publishChannelState = (nextState: TelegramChannelState): void => {
    options.publishChannelState?.(nextState)
  }

  const clearCandidate = (): void => {
    if (candidate === null) return
    candidate = null
    options.publishCandidate?.(null)
  }

  const markHandlerFailure = (): void => {
    publishState('degraded')
    options.publishJournal?.(journalMessage('handler'))
  }

  const markConnectivity = (): void => {
    reconnectPolicy.reset()
    publishChannelState('connected')
  }

  const handlers: TelegramBotHandlers = {
    async onMessage(nextCandidate): Promise<void> {
      markConnectivity()
      if (boundChatId !== null) return

      candidate = nextCandidate
      options.publishCandidate?.(candidate)
      try {
        await transport?.sendMessage(candidate.chatId, TELEGRAM_BINDING_ACKNOWLEDGEMENT)
      } catch {
        markHandlerFailure()
      }
    },
    async onCallbackQuery(_chatId): Promise<void> {
      markConnectivity()
      // Product callback actions arrive in later Telegram tasks. Receiving an update is still
      // useful here because it proves that the current polling session has connectivity.
    },
  }

  const cancelReconnect = (): void => {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  const stopTransport = async (): Promise<void> => {
    const current = transport
    transport = undefined
    if (current) await current.stop()
  }

  const scheduleReconnect = (generation: number, token: string): void => {
    if (generation !== lifecycleGeneration || activeToken !== token) return
    cancelReconnect()
    publishChannelState('reconnecting')
    options.publishJournal?.(journalMessage('polling'))
    const delayMs = reconnectPolicy.nextDelayMs()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (generation !== lifecycleGeneration || activeToken !== token) return
      startTransport(generation, token)
    }, delayMs)
  }

  const startTransport = (generation: number, token: string): void => {
    if (generation !== lifecycleGeneration || activeToken !== token) return

    let nextTransport: TelegramBotTransport
    try {
      nextTransport = options.createBot(token, handlers, (kind) => {
        if (kind === 'handler') markHandlerFailure()
      })
    } catch {
      transport = undefined
      publishChannelState('error')
      options.publishJournal?.(journalMessage('polling'))
      return
    }

    transport = nextTransport
    publishChannelState('connected')
    let pollingTask: Promise<void>
    try {
      pollingTask = nextTransport.start()
    } catch {
      if (transport === nextTransport) transport = undefined
      scheduleReconnect(generation, token)
      return
    }

    void pollingTask.catch(() => {
      if (
        generation !== lifecycleGeneration ||
        activeToken !== token ||
        transport !== nextTransport
      ) {
        return
      }
      transport = undefined
      scheduleReconnect(generation, token)
    })
  }

  const restartCurrentTransport = async (): Promise<void> => {
    const token = activeToken
    if (token === null) {
      publishChannelState('disconnected')
      return
    }

    lifecycleGeneration += 1
    const generation = lifecycleGeneration
    cancelReconnect()
    reconnectPolicy.reset()
    await stopTransport()
    if (generation !== lifecycleGeneration || activeToken !== token) return
    startTransport(generation, token)
  }

  return {
    async verifyToken(token): Promise<TelegramBotIdentity> {
      let probe: TelegramBotTransport
      try {
        probe = options.createBot(token, verificationHandlers, () => undefined)
      } catch {
        throw new Error('Telegram token verification failed')
      }

      try {
        if (!probe.getMe) throw new Error('Telegram token verification failed')
        return await probe.getMe()
      } finally {
        await probe.stop()
      }
    },

    async configure(token): Promise<void> {
      lifecycleGeneration += 1
      const generation = lifecycleGeneration
      cancelReconnect()
      reconnectPolicy.reset()
      activeToken = token
      await stopTransport()
      clearCandidate()

      if (generation !== lifecycleGeneration || activeToken !== token) return

      if (token === null) {
        boundChatId = null
        publishState('not-configured')
        publishChannelState('disconnected')
        return
      }

      publishState('starting')
      boundChatId = await options.repository.getBoundChatId()
      if (generation !== lifecycleGeneration || activeToken !== token) return

      startTransport(generation, token)
      publishState(boundChatId === null ? 'waiting-for-binding' : 'ready')
    },

    async resume(): Promise<void> {
      await restartCurrentTransport()
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

    async sendTestMessage(): Promise<void> {
      const chatId = boundChatId
      if (chatId === null) throw new TelegramSendFailure('permanent')
      const currentTransport = transport
      if (!currentTransport) throw new TelegramSendFailure('transient')
      await currentTransport.sendMessage(chatId, TELEGRAM_TEST_MESSAGE)
    },

    async sendMessage(chatId, text, sendOptions): Promise<void> {
      if (boundChatId !== chatId) throw new TelegramSendFailure('permanent')
      if (sendOptions && !isHumanKufarUrl(sendOptions.openUrl)) {
        throw new TelegramSendFailure('permanent')
      }
      const currentTransport = transport
      if (!currentTransport) throw new TelegramSendFailure('transient')
      if (sendOptions) {
        await currentTransport.sendMessage(chatId, text, sendOptions)
      } else {
        await currentTransport.sendMessage(chatId, text)
      }
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
      lifecycleGeneration += 1
      activeToken = null
      cancelReconnect()
      reconnectPolicy.reset()
      await stopTransport()
      publishChannelState('disconnected')
    },
  }
}
