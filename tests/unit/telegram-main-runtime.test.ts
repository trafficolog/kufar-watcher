import { describe, expect, it, vi } from 'vitest'

import type { TelegramSecretStore } from '../../electron/main/telegram-secret-store'
import { configureTelegramFromSecret } from '../../electron/main/telegram-main-runtime'
import type { WorkerSupervisor } from '../../electron/main/worker-supervisor'

function createSupervisor() {
  return {
    start: vi.fn(),
    configureTelegram: vi.fn(),
    resumeTelegram: vi.fn(),
    bindTelegramCandidate: vi.fn(),
    shutdown: vi.fn(async () => 'acknowledged' as const),
  } satisfies WorkerSupervisor
}

describe('Telegram main runtime', () => {
  it('passes a protected token only to the worker supervisor', async () => {
    const token = 'SECRET_SENTINEL_3_1_1'
    const store: TelegramSecretStore = {
      read: vi.fn(async () => ({ state: 'protected' as const, token })),
    }
    const supervisor = createSupervisor()

    await expect(configureTelegramFromSecret(store, supervisor)).resolves.toBe('protected')

    expect(supervisor.configureTelegram).toHaveBeenCalledOnce()
    expect(supervisor.configureTelegram).toHaveBeenCalledWith(token)
  })

  it.each(['missing', 'unavailable'] as const)(
    'configures Telegram as disabled when the secret is %s',
    async (secretState) => {
      const store: TelegramSecretStore = {
        read: vi.fn(async () =>
          secretState === 'missing'
            ? { state: 'missing' as const }
            : { state: 'unavailable' as const, reason: 'decrypt-failed' as const },
        ),
      }
      const supervisor = createSupervisor()

      await expect(configureTelegramFromSecret(store, supervisor)).resolves.toBe(secretState)
      expect(supervisor.configureTelegram).toHaveBeenCalledWith(null)
    },
  )
})
