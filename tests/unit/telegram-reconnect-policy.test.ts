import { describe, expect, it } from 'vitest'

import { createTelegramReconnectPolicy } from '../../electron/worker/telegram-reconnect-policy'

describe('Telegram reconnect policy', () => {
  it('uses exponential delays capped at thirty seconds', () => {
    const policy = createTelegramReconnectPolicy()

    expect([
      policy.nextDelayMs(),
      policy.nextDelayMs(),
      policy.nextDelayMs(),
      policy.nextDelayMs(),
      policy.nextDelayMs(),
      policy.nextDelayMs(),
      policy.nextDelayMs(),
    ]).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
  })

  it('resets the backoff after a successful recovery', () => {
    const policy = createTelegramReconnectPolicy()

    expect(policy.nextDelayMs()).toBe(1_000)
    expect(policy.nextDelayMs()).toBe(2_000)
    policy.reset()
    expect(policy.nextDelayMs()).toBe(1_000)
  })
})
