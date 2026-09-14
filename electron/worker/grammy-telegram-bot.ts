import { run } from '@grammyjs/runner'
import { Bot, GrammyError, HttpError } from 'grammy'

import type { TelegramCandidate, TelegramChatType } from '../../shared/telegram'
import type {
  TelegramBotFactory,
  TelegramBotHandlers,
  TelegramBotTransport,
  TelegramNotificationSendOptions,
} from './telegram-bot-service'
import { TelegramSendFailure } from './telegram-send-failure'

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

interface GrammySendMessageOptionsLike {
  parse_mode: 'HTML'
  reply_markup: {
    inline_keyboard: Array<Array<{ text: string; url: string }>>
  }
}

export interface GrammyBotLike {
  on(
    filter: 'message' | 'callback_query',
    handler: (context: GrammyContextLike) => Promise<void>,
  ): void
  catch(handler: () => void): void
  api: {
    sendMessage(chatId: string, text: string, options?: GrammySendMessageOptionsLike): Promise<unknown>
  }
}

export interface GrammyRunnerHandleLike {
  task(): Promise<void> | undefined
  isRunning(): boolean
  stop(): Promise<void>
}

export interface GrammyRunnerOptionsLike {
  runner: {
    retryInterval: 'exponential'
    maxRetryTime: number
    silent: boolean
  }
  sink: {
    concurrency: number
  }
}

export type GrammyRunLike = (
  bot: GrammyBotLike,
  options: GrammyRunnerOptionsLike,
) => GrammyRunnerHandleLike

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

function normalizeSendFailure(error: unknown): TelegramSendFailure {
  if (error instanceof HttpError) return new TelegramSendFailure('transient')
  if (error instanceof GrammyError) {
    if (error.error_code === 429 || error.error_code >= 500) {
      return new TelegramSendFailure('transient')
    }
    if (error.error_code >= 400) return new TelegramSendFailure('permanent')
  }
  return new TelegramSendFailure('transient')
}

function createRealBot(token: string): GrammyBotLike {
  const bot = new Bot(token)
  return bot as unknown as GrammyBotLike
}

function runRealBot(bot: GrammyBotLike, options: GrammyRunnerOptionsLike): GrammyRunnerHandleLike {
  return run(bot as unknown as Bot, options) as unknown as GrammyRunnerHandleLike
}

function notificationOptions(options: TelegramNotificationSendOptions): GrammySendMessageOptionsLike {
  return {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть', url: options.openUrl }]],
    },
  }
}

export function createGrammyTelegramBotFactory(
  createBot: GrammyBotConstructor = createRealBot,
  runBot: GrammyRunLike = runRealBot,
): TelegramBotFactory {
  return (token: string, handlers: TelegramBotHandlers, onError): TelegramBotTransport => {
    const bot = createBot(token)
    let runner: GrammyRunnerHandleLike | undefined

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
      async start(): Promise<void> {
        if (runner?.isRunning()) {
          await runner.task()
          return
        }

        runner = runBot(bot, {
          runner: {
            retryInterval: 'exponential',
            maxRetryTime: 5_000,
            silent: true,
          },
          sink: { concurrency: 1 },
        })
        const task = runner.task()
        if (!task) return

        try {
          await task
        } catch {
          onError('polling')
          throw new Error('Telegram polling failed')
        }
      },
      async stop(): Promise<void> {
        const currentRunner = runner
        runner = undefined
        if (currentRunner?.isRunning()) await currentRunner.stop()
      },
      async sendMessage(chatId, text, options): Promise<void> {
        try {
          if (options) {
            await bot.api.sendMessage(chatId, text, notificationOptions(options))
          } else {
            await bot.api.sendMessage(chatId, text)
          }
        } catch (error) {
          throw normalizeSendFailure(error)
        }
      },
    }
  }
}
