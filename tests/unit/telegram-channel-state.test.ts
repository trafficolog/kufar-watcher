import { describe, expect, it, vi } from 'vitest'

import { routeWorkerTelegramEvent } from '../../electron/main/ipc-router'
import type { TelegramDesktopState } from '../../shared/telegram'

describe('Telegram channel desktop projection', () => {
  it('projects worker channel state without changing binding state', () => {
    const send = vi.fn()
    const initial = {
      runtime: 'ready',
      channel: 'connected',
      boundChatId: '1001',
      candidate: null,
      secret: 'protected',
    } as TelegramDesktopState

    const reconnecting = routeWorkerTelegramEvent(
      { type: 'telegram-channel-state', state: 'reconnecting' },
      initial,
      send,
    ) as TelegramDesktopState & { channel: string }

    expect(reconnecting).toEqual({
      ...initial,
      channel: 'reconnecting',
    })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(reconnecting)
    expect(JSON.stringify(reconnecting)).not.toContain('token')
  })
})
