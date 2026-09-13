import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TELEGRAM_BINDING_ACKNOWLEDGEMENT,
  createTelegramBotService,
  type TelegramBindingRepository,
  type TelegramBotFactory,
  type TelegramBotHandlers,
  type TelegramBotTransport,
} from '../../electron/worker/telegram-bot-service'
import { TelegramSendFailure } from '../../electron/worker/telegram-outbox-delivery'
import type { TelegramCandidate } from '../../shared/telegram'

const candidate: TelegramCandidate = {
  chatId: '1001',
  chatType: 'private',
  displayName: 'Owner',
  username: 'owner',
}

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

function createHarness(
  initialBoundChatId: string | null = null,
  options: { throwOnCreate?: boolean; failWhile?: () => boolean } = {},
) {
  let latestHandlers: TelegramBotHandlers | undefined
  let latestOnError: ((kind: 'polling' | 'handler') => void) | undefined
  let persisted = initialBoundChatId

  const repository: TelegramBindingRepository = {
    getBoundChatId: vi.fn(async () => persisted),
    setBoundChatId: vi.fn(async (chatId: string) => {
      persisted = chatId
    }),
  }
  const sessions: Array<{
    gate: ReturnType<typeof deferred>
    transport: TelegramBotTransport
  }> = []
  const createBot = vi.fn<TelegramBotFactory>((_token, nextHandlers, nextOnError) => {
    if (options.throwOnCreate) throw new Error('SECRET_SENTINEL_3_1_2_CREATE')

    latestHandlers = nextHandlers
    latestOnError = nextOnError
    const gate = deferred()
    const transport: TelegramBotTransport = {
      start: vi.fn(() => {
        if (options.failWhile?.()) {
          return Promise.reject(new Error('SECRET_SENTINEL_3_1_2_POLLING'))
        }
        return gate.promise
      }),
      stop: vi.fn(async () => {
        gate.resolve()
      }),
      sendMessage: vi.fn(async () => undefined),
    }
    sessions.push({ gate, transport })
    return transport
  })
  const publishState = vi.fn()
  const publishChannelState = vi.fn()
  const publishCandidate = vi.fn()
  const publishJournal = vi.fn()
  const service = createTelegramBotService({
    repository,
    createBot,
    publishState,
    publishChannelState,
    publishCandidate,
    publishJournal,
  })

  return {
    service,
    repository,
    sessions,
    createBot,
    publishState,
    publishChannelState,
    publishCandidate,
    publishJournal,
    handlers: () => {
      if (!latestHandlers) throw new Error('Bot handlers are unavailable')
      return latestHandlers
    },
    onError: () => {
      if (!latestOnError) throw new Error('Bot error handler is unavailable')
      return latestOnError
    },
    latestTransport: () => {
      const session = sessions.at(-1)
      if (!session) throw new Error('Telegram transport is unavailable')
      return session.transport
    },
    persisted: () => persisted,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Telegram bot service', () => {
  it('treats a missing token as a normal disconnected state', async () => {
    const harness = createHarness()

    await harness.service.configure(null)

    expect(harness.service.getState()).toBe('not-configured')
    expect(harness.createBot).not.toHaveBeenCalled()
    expect(harness.publishChannelState).toHaveBeenLastCalledWith('disconnected')
  })

  it('starts polling and publishes a connected channel while waiting for binding', async () => {
    const harness = createHarness()

    await harness.service.configure('telegram-token')

    expect(harness.createBot).toHaveBeenCalledWith(
      'telegram-token',
      expect.any(Object),
      expect.any(Function),
    )
    expect(harness.latestTransport().start).toHaveBeenCalledOnce()
    expect(harness.service.getState()).toBe('waiting-for-binding')
    expect(harness.publishChannelState).toHaveBeenLastCalledWith('connected')
  })

  it('keeps a candidate in memory and sends only the neutral binding acknowledgement', async () => {
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    await harness.handlers().onMessage(candidate)

    expect(harness.service.getCandidate()).toEqual(candidate)
    expect(harness.repository.setBoundChatId).not.toHaveBeenCalled()
    expect(harness.latestTransport().sendMessage).toHaveBeenCalledOnce()
    expect(harness.latestTransport().sendMessage).toHaveBeenCalledWith(
      candidate.chatId,
      TELEGRAM_BINDING_ACKNOWLEDGEMENT,
    )
    expect(harness.publishCandidate).toHaveBeenCalledWith(candidate)
  })

  it('binds only the exact current candidate and persists only that chat id', async () => {
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    expect(await harness.service.bindCandidate('1001')).toBe('no-candidate')
    await harness.handlers().onMessage(candidate)
    expect(await harness.service.bindCandidate('9999')).toBe('candidate-mismatch')
    expect(harness.repository.setBoundChatId).not.toHaveBeenCalled()

    expect(await harness.service.bindCandidate(candidate.chatId)).toBe('bound')
    expect(harness.repository.setBoundChatId).toHaveBeenCalledOnce()
    expect(harness.repository.setBoundChatId).toHaveBeenCalledWith(candidate.chatId)
    expect(harness.persisted()).toBe(candidate.chatId)
    expect(harness.service.getCandidate()).toBeNull()
    expect(harness.service.getState()).toBe('ready')
    expect(harness.publishCandidate).toHaveBeenLastCalledWith(null)
  })

  it('restores a persisted binding and ignores foreign messages and callbacks silently', async () => {
    const harness = createHarness('1001')
    await harness.service.configure('telegram-token')

    expect(harness.service.getState()).toBe('ready')
    expect(harness.service.getBoundChatId()).toBe('1001')

    await harness.handlers().onMessage({ ...candidate, chatId: '2002' })
    await harness.handlers().onCallbackQuery('2002')

    expect(harness.service.getCandidate()).toBeNull()
    expect(harness.latestTransport().sendMessage).not.toHaveBeenCalled()
    expect(harness.publishCandidate).not.toHaveBeenCalled()
  })

  it('sends durable notifications only to the currently bound chat', async () => {
    const harness = createHarness('1001')
    await harness.service.configure('telegram-token')

    await harness.service.sendMessage('1001', 'notification')

    expect(harness.latestTransport().sendMessage).toHaveBeenCalledWith('1001', 'notification')
  })

  it('treats a missing active transport as a transient send failure', async () => {
    const harness = createHarness('1001')
    await harness.service.configure('telegram-token')
    await harness.service.stop()

    const failure = await harness.service
      .sendMessage('1001', 'notification')
      .catch((error) => error)

    expect(failure).toBeInstanceOf(TelegramSendFailure)
    expect(failure).toMatchObject({ kind: 'transient', message: 'Telegram send failed' })
  })

  it('rejects a stale outbox chat as a permanent failure without sending', async () => {
    const harness = createHarness('1001')
    await harness.service.configure('telegram-token')

    const failure = await harness.service
      .sendMessage('2002', 'notification')
      .catch((error) => error)

    expect(failure).toBeInstanceOf(TelegramSendFailure)
    expect(failure).toMatchObject({ kind: 'permanent', message: 'Telegram send failed' })
    expect(harness.latestTransport().sendMessage).not.toHaveBeenCalled()
  })

  it('reconnects terminal polling sessions with exponential delays capped by policy', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.service.configure('SECRET_SENTINEL_3_1_2')

    harness.sessions[0]?.gate.reject(new Error('SECRET_SENTINEL_3_1_2'))
    await flushMicrotasks()

    expect(harness.publishChannelState).toHaveBeenLastCalledWith('reconnecting')
    expect(harness.createBot).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(harness.createBot).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.createBot).toHaveBeenCalledTimes(2)

    harness.sessions[1]?.gate.reject(new Error('network still down'))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(harness.createBot).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.createBot).toHaveBeenCalledTimes(3)

    expect(JSON.stringify(harness.publishJournal.mock.calls)).not.toContain('SECRET_SENTINEL_3_1_2')
  })

  it('resets outer backoff after an inbound update proves connectivity', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    harness.sessions[0]?.gate.reject(new Error('network down'))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.createBot).toHaveBeenCalledTimes(2)

    await harness.handlers().onMessage(candidate)
    harness.sessions[1]?.gate.reject(new Error('network down again'))
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(999)
    expect(harness.createBot).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.createBot).toHaveBeenCalledTimes(3)
  })

  it('cancels a pending reconnect when stopped', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    harness.sessions[0]?.gate.reject(new Error('network down'))
    await flushMicrotasks()
    await harness.service.stop()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(harness.createBot).toHaveBeenCalledTimes(1)
    expect(harness.publishChannelState).toHaveBeenLastCalledWith('disconnected')
  })

  it('restarts polling immediately on resume without waiting for pending backoff', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    harness.sessions[0]?.gate.reject(new Error('network down'))
    await flushMicrotasks()
    expect(harness.createBot).toHaveBeenCalledTimes(1)

    await harness.service.resume()

    expect(harness.createBot).toHaveBeenCalledTimes(2)
    expect(harness.publishChannelState).toHaveBeenLastCalledWith('connected')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.createBot).toHaveBeenCalledTimes(2)
  })

  it('recovers after a simulated five-minute network outage without restarting the service', async () => {
    vi.useFakeTimers()
    let offline = true
    const harness = createHarness(null, { failWhile: () => offline })
    await harness.service.configure('telegram-token')
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(harness.createBot.mock.calls.length).toBeGreaterThan(5)

    offline = false
    await vi.advanceTimersByTimeAsync(30_000)

    expect(harness.publishChannelState).toHaveBeenLastCalledWith('connected')
    expect(harness.service.getState()).toBe('waiting-for-binding')
  })

  it('publishes a fixed error state when a transport cannot be created', async () => {
    const harness = createHarness(null, { throwOnCreate: true })

    await harness.service.configure('SECRET_SENTINEL_3_1_2_CREATE')

    expect(harness.publishChannelState).toHaveBeenLastCalledWith('error')
    expect(JSON.stringify(harness.publishJournal.mock.calls)).not.toContain(
      'SECRET_SENTINEL_3_1_2_CREATE',
    )
  })

  it('maps handler failures to fixed redacted runtime and journal messages', async () => {
    const harness = createHarness()
    await harness.service.configure('SECRET_SENTINEL_3_1_2')

    harness.onError()('handler')

    expect(harness.service.getState()).toBe('degraded')
    expect(harness.publishJournal).toHaveBeenCalledWith('Telegram update handler failed')
    expect(JSON.stringify(harness.publishJournal.mock.calls)).not.toContain('SECRET_SENTINEL_3_1_2')
  })
})
