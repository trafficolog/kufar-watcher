import { GrammyError, HttpError } from 'grammy'
import { describe, expect, it, vi } from 'vitest'

import {
  createGrammyTelegramBotFactory,
  type GrammyBotLike,
  type GrammyContextLike,
  type GrammyRunnerHandleLike,
  type GrammyRunLike,
} from '../../electron/worker/grammy-telegram-bot'
import { TelegramSendFailure } from '../../electron/worker/telegram-outbox-delivery'
import type { TelegramBotHandlers } from '../../electron/worker/telegram-bot-service'

function deferred(): {
  promise: Promise<void>
  resolve(): void
  reject(error: Error): void
} {
  let resolvePromise: (() => void) | undefined
  let rejectPromise: ((error: Error) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error),
  }
}

function createHarness() {
  const listeners = new Map<string, (context: GrammyContextLike) => Promise<void>>()
  let errorHandler: (() => void) | undefined
  const runnerTask = deferred()
  let running = true
  const runner: GrammyRunnerHandleLike = {
    task: vi.fn(() => runnerTask.promise),
    isRunning: vi.fn(() => running),
    stop: vi.fn(async () => {
      running = false
      runnerTask.resolve()
      await runnerTask.promise
    }),
  }
  const runBot: GrammyRunLike = vi.fn(() => runner)
  const bot: GrammyBotLike = {
    on: vi.fn((filter, handler) => {
      listeners.set(filter, handler)
    }),
    catch: vi.fn((handler) => {
      errorHandler = handler
    }),
    api: {
      sendMessage: vi.fn(async () => undefined),
    },
  }
  const createBot = vi.fn(() => bot)
  const handlers: TelegramBotHandlers = {
    onMessage: vi.fn(async () => undefined),
    onCallbackQuery: vi.fn(async () => undefined),
  }
  const onError = vi.fn()
  const factory = createGrammyTelegramBotFactory(createBot, runBot)
  const transport = factory('SECRET_SENTINEL_3_1_2', handlers, onError)

  return {
    bot,
    createBot,
    handlers,
    onError,
    transport,
    listeners,
    runner,
    runnerTask,
    runBot,
    errorHandler: () => errorHandler,
  }
}

function telegramApiError(errorCode: number, description: string): GrammyError {
  return new GrammyError(
    'SECRET_GRAMMY_WRAPPER',
    {
      ok: false,
      error_code: errorCode,
      description,
      parameters: errorCode === 429 ? { retry_after: 1 } : {},
    },
    'sendMessage',
    { chat_id: '1001', text: 'SECRET_PAYLOAD' },
  )
}

describe('grammY Telegram adapter', () => {
  it('normalizes private message metadata before handing it to the domain service', async () => {
    const harness = createHarness()

    await harness.listeners.get('message')?.({
      chat: {
        id: 1001,
        type: 'private',
        first_name: 'Ada',
        last_name: 'Lovelace',
        username: 'ada',
      },
    })

    expect(harness.handlers.onMessage).toHaveBeenCalledWith({
      chatId: '1001',
      chatType: 'private',
      displayName: 'Ada Lovelace',
      username: 'ada',
    })
  })

  it('uses a group title as the candidate display name', async () => {
    const harness = createHarness()

    await harness.listeners.get('message')?.({
      chat: { id: -2002, type: 'supergroup', title: 'Deals' },
    })

    expect(harness.handlers.onMessage).toHaveBeenCalledWith({
      chatId: '-2002',
      chatType: 'supergroup',
      displayName: 'Deals',
    })
  })

  it('forwards callback-query chat identity without performing product actions', async () => {
    const harness = createHarness()

    await harness.listeners.get('callback_query')?.({
      chat: { id: 1001, type: 'private', first_name: 'Ada' },
    })
    await harness.listeners.get('callback_query')?.({})

    expect(harness.handlers.onCallbackQuery).toHaveBeenNthCalledWith(1, '1001')
    expect(harness.handlers.onCallbackQuery).toHaveBeenNthCalledWith(2, null)
  })

  it('runs polling through grammY runner with bounded exponential fetch retries and sequential updates', () => {
    const harness = createHarness()

    void harness.transport.start()

    expect(harness.runBot).toHaveBeenCalledWith(harness.bot, {
      runner: {
        retryInterval: 'exponential',
        maxRetryTime: 5_000,
        silent: true,
      },
      sink: { concurrency: 1 },
    })
  })

  it('maps handler and terminal polling failures to redacted error kinds', async () => {
    const harness = createHarness()

    harness.errorHandler()?.()
    const pollingTask = harness.transport.start()
    harness.runnerTask.reject(new Error('SECRET_SENTINEL_3_1_2'))

    await expect(pollingTask).rejects.toThrow()
    expect(harness.onError).toHaveBeenCalledWith('handler')
    expect(harness.onError).toHaveBeenCalledWith('polling')
    expect(JSON.stringify(harness.onError.mock.calls)).not.toContain('SECRET_SENTINEL_3_1_2')
  })

  it('delegates send and graceful runner stop', async () => {
    const harness = createHarness()
    void harness.transport.start()

    await harness.transport.sendMessage('1001', 'hello')
    await harness.transport.stop()

    expect(harness.bot.api.sendMessage).toHaveBeenCalledWith('1001', 'hello')
    expect(harness.runner.stop).toHaveBeenCalledOnce()
  })

  it('normalizes network send failures as transient without leaking raw details', async () => {
    const harness = createHarness()
    vi.mocked(harness.bot.api.sendMessage).mockRejectedValueOnce(
      new HttpError('SECRET_HTTP_WRAPPER', new Error('SECRET_NETWORK_CAUSE')),
    )

    const failure = await harness.transport.sendMessage('1001', 'hello').catch((error) => error)

    expect(failure).toBeInstanceOf(TelegramSendFailure)
    expect(failure).toMatchObject({ kind: 'transient', message: 'Telegram send failed' })
    expect(String(failure)).not.toContain('SECRET_HTTP_WRAPPER')
    expect(String(failure)).not.toContain('SECRET_NETWORK_CAUSE')
  })

  it.each([
    [429, 'transient'],
    [500, 'transient'],
    [400, 'permanent'],
    [403, 'permanent'],
  ] as const)('maps Telegram API error %i to %s without leaking the response', async (code, kind) => {
    const harness = createHarness()
    vi.mocked(harness.bot.api.sendMessage).mockRejectedValueOnce(
      telegramApiError(code, `SECRET_REMOTE_${code}`),
    )

    const failure = await harness.transport.sendMessage('1001', 'hello').catch((error) => error)

    expect(failure).toBeInstanceOf(TelegramSendFailure)
    expect(failure).toMatchObject({ kind, message: 'Telegram send failed' })
    expect(String(failure)).not.toContain(`SECRET_REMOTE_${code}`)
    expect(String(failure)).not.toContain('SECRET_PAYLOAD')
  })
})
