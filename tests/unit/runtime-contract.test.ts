import { describe, expect, it } from 'vitest'

import {
  TELEGRAM_BIND_RESULTS,
  TELEGRAM_RUNTIME_STATES,
  type TelegramCandidate,
} from '../../shared/telegram'
import type { WorkerControlMessage, WorkerEvent } from '../../shared/runtime'

describe('Telegram runtime contracts', () => {
  it('defines the bounded Telegram runtime and bind result states', () => {
    expect(TELEGRAM_RUNTIME_STATES).toEqual([
      'not-configured',
      'starting',
      'waiting-for-binding',
      'ready',
      'degraded',
    ])
    expect(TELEGRAM_BIND_RESULTS).toEqual(['bound', 'candidate-mismatch', 'no-candidate'])
  })

  it('keeps tokens on the main-to-worker configuration message only', () => {
    const configure = {
      type: 'telegram-configure',
      token: 'SECRET_SENTINEL_3_1_1',
    } satisfies WorkerControlMessage
    const state = {
      type: 'telegram-state',
      state: 'not-configured',
      boundChatId: null,
    } satisfies WorkerEvent

    expect(configure).toHaveProperty('token', 'SECRET_SENTINEL_3_1_1')
    expect(state).not.toHaveProperty('token')
  })

  it('uses safe candidate metadata for worker events', () => {
    const candidate: TelegramCandidate = {
      chatId: '123456',
      chatType: 'private',
      displayName: 'Owner',
      username: 'owner',
    }
    const event = {
      type: 'telegram-candidate',
      candidate,
    } satisfies WorkerEvent

    expect(event).toEqual({ type: 'telegram-candidate', candidate })
    expect(JSON.stringify(event)).not.toContain('token')
  })
})
