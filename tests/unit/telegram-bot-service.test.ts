import { describe, expect, it, vi } from 'vitest'

import {
  TELEGRAM_BINDING_ACKNOWLEDGEMENT,
  createTelegramBotService,
  type TelegramBindingRepository,
  type TelegramBotFactory,
  type TelegramBotHandlers,
  type TelegramBotTransport,
} from '../../electron/worker/telegram-bot-service'
import type { TelegramCandidate } from '../../shared/telegram'

const candidate: TelegramCandidate = {
  chatId: '1001',
  chatType: 'private',
  displayName: 'Owner',
  username: 'owner',
}

function createHarness(initialBoundChatId: string | null = null) {
  let handlers: TelegramBotHandlers | undefined
  let onError: ((kind: 'polling' | 'handler') => void) | undefined
  let persisted = initialBoundChatId

  const repository: TelegramBindingRepository = {
    getBoundChatId: vi.fn(async () => persisted),
    setBoundChatId: vi.fn(async (chatId: string) => {
      persisted = chatId
    }),
  }
  const transport: TelegramBotTransport = {
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
  }
  const createBot: TelegramBotFactory = vi.fn((_token, nextHandlers, nextOnError) => {
    handlers = nextHandlers
    onError = nextOnError
    return transport
  })
  const publishState = vi.fn()
  const publishCandidate = vi.fn()
  const publishJournal = vi.fn()
  const service = createTelegramBotService({
    repository,
    createBot,
    publishState,
    publishCandidate,
    publishJournal,
  })

  return {
    service,
    repository,
    transport,
    createBot,
    publishState,
    publishCandidate,
    publishJournal,
    handlers: () => {
      if (!handlers) throw new Error('Bot handlers are unavailable')
      return handlers
    },
    onError: () => {
      if (!onError) throw new Error('Bot error handler is unavailable')
      return onError
    },
    persisted: () => persisted,
  }
}

describe('Telegram bot service', () => {
  it('treats a missing token as a normal non-configured state', async () => {
    const harness = createHarness()

    await harness.service.configure(null)

    expect(harness.service.getState()).toBe('not-configured')
    expect(harness.createBot).not.toHaveBeenCalled()
    expect(harness.transport.start).not.toHaveBeenCalled()
  })

  it('starts polling and waits for binding when no chat is persisted', async () => {
    const harness = createHarness()

    await harness.service.configure('telegram-token')

    expect(harness.createBot).toHaveBeenCalledWith(
      'telegram-token',
      expect.any(Object),
      expect.any(Function),
    )
    expect(harness.transport.start).toHaveBeenCalledOnce()
    expect(harness.service.getState()).toBe('waiting-for-binding')
  })

  it('keeps a candidate in memory and sends only the neutral binding acknowledgement', async () => {
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    await harness.handlers().onMessage(candidate)

    expect(harness.service.getCandidate()).toEqual(candidate)
    expect(harness.repository.setBoundChatId).not.toHaveBeenCalled()
    expect(harness.transport.sendMessage).toHaveBeenCalledOnce()
    expect(harness.transport.sendMessage).toHaveBeenCalledWith(
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
    expect(harness.transport.sendMessage).not.toHaveBeenCalled()
    expect(harness.publishCandidate).not.toHaveBeenCalled()
  })

  it('stops the active long-polling transport gracefully', async () => {
    const harness = createHarness()
    await harness.service.configure('telegram-token')

    await harness.service.stop()

    expect(harness.transport.stop).toHaveBeenCalledOnce()
  })

  it('maps transport failures to fixed redacted state and journal messages', async () => {
    const harness = createHarness()
    await harness.service.configure('SECRET_SENTINEL_3_1_1')

    harness.onError()('polling')

    expect(harness.service.getState()).toBe('degraded')
    expect(harness.publishJournal).toHaveBeenCalledWith('Telegram polling failed')
    expect(JSON.stringify(harness.publishJournal.mock.calls)).not.toContain(
      'SECRET_SENTINEL_3_1_1',
    )
  })
})
