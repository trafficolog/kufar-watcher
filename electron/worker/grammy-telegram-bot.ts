import { Bot } from 'grammy'

import type { TelegramCandidate, TelegramChatType } from '../../shared/telegram'
import type {
  TelegramBotFactory,
  TelegramBotHandlers,
  TelegramBotTransport,
} from './telegram-bot-service'

export interface GrammyChatLike {
  id: number
  type: string
  first_name?: string
  last_name?: string
  username?: string
  title?: string
}

export interface GrammyContextLike {
  chat?: GrammyChatLike
}

export interface GrammyBotLike {
  on(
    filter: 'message' | 'callback_query',
    handler: (context: GrammyContextLike) => Promise<void>,
  ): void
  catch(handler: () => void): void
  start(): Promise<void>
  stop(): Promise<void>
  api: {
    sendMessage(chatId: string, text: string): Promise<unknown>
  }
}

export type GrammyBotConstructor = (token: string) => GrammyBotLike

function normalizeChatType(type: string): TelegramChatType {
  switch (type) {
    case 'private':
    case 'group':
    case 'supergroup':
    case 'channel':
      return type
    default:
      return 'unknown'
  }
}

function displayName(chat: GrammyChatLike): string {
  if (chat.type === 'private') {
    const personalName = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim()
    if (personalName) return personalName
  }

  return chat.title?.trim() || chat.username?.trim() || String(chat.id)
}

function toCandidate(chat: GrammyChatLike): TelegramCandidate {
  const candidate: TelegramCandidate = {
    chatId: String(chat.id),
    chatType: normalizeChatType(chat.type),
    displayName: displayName(chat),
  }
  if (chat.username) candidate.username = chat.username
  return candidate
}

function createRealBot(token: string): GrammyBotLike {
  const bot = new Bot(token)
  return bot as unknown as GrammyBotLike
}

export function createGrammyTelegramBotFactory(
  createBot: GrammyBotConstructor = createRealBot,
): TelegramBotFactory {
  return (token: string, handlers: TelegramBotHandlers, onError): TelegramBotTransport => {
    const bot = createBot(token)

    bot.on('message', async (context) => {
      if (!context.chat) return
      await handlers.onMessage(toCandidate(context.chat))
    })

    bot.on('callback_query', async (context) => {
      await handlers.onCallbackQuery(context.chat ? String(context.chat.id) : null)
    })

    bot.catch(() => {
      onError('handler')
    })

    return {
      start(): void {
        void bot.start().catch(() => {
          onError('polling')
        })
      },
      async stop(): Promise<void> {
        await bot.stop()
      },
      async sendMessage(chatId: string, text: string): Promise<void> {
        await bot.api.sendMessage(chatId, text)
      },
    }
  }
}
