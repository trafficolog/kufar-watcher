import { describe, expect, it, vi } from 'vitest'

import * as telegramMainRuntime from '../../electron/main/telegram-main-runtime'
import type { TelegramSecretStore } from '../../electron/main/telegram-secret-store'
import type { WorkerSupervisor } from '../../electron/main/worker-supervisor'

function createSupervisor() {
  return {
    start: vi.fn(),
    configureTelegram: vi.fn(),
    resumeTelegram: vi.fn(),
    verifyTelegramToken: vi.fn(async () => ({ username: 'kufar_watch_bot' })),
    bindTelegramCandidate: vi.fn(),
    createMonitor: vi.fn(),
    shutdown: vi.fn(async () => 'acknowledged' as const),
  } satisfies WorkerSupervisor
}

function runtimeFunction(name: 'verifyTelegramToken' | 'saveTelegramToken') {
  const value = Reflect.get(telegramMainRuntime, name)
  expect(value).toBeTypeOf('function')
  return value as (...args: unknown[]) => Promise<unknown>
}

describe('Telegram main runtime', () => {
  it('passes a protected token only to the worker supervisor', async () => {
    const token = 'SECRET_SENTINEL_3_1_1'
    const store: TelegramSecretStore = {
      read: vi.fn(async () => ({ state: 'protected' as const, token })),
      write: vi.fn(async () => ({ state: 'protected' as const })),
    }
    const supervisor = createSupervisor()

    await expect(
      telegramMainRuntime.configureTelegramFromSecret(store, supervisor),
    ).resolves.toBe('protected')

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
        write: vi.fn(async () => ({ state: 'protected' as const })),
      }
      const supervisor = createSupervisor()

      await expect(
        telegramMainRuntime.configureTelegramFromSecret(store, supervisor),
      ).resolves.toBe(secretState)
      expect(supervisor.configureTelegram).toHaveBeenCalledWith(null)
    },
  )

  it('verifies a token without persisting or activating it', async () => {
    const token = 'SECRET_SENTINEL_5_0_2_MAIN_VERIFY'
    const store: TelegramSecretStore = {
      read: vi.fn(),
      write: vi.fn(),
    }
    const supervisor = createSupervisor()
    const verifyTelegramToken = runtimeFunction('verifyTelegramToken')

    await expect(verifyTelegramToken(supervisor, token)).resolves.toEqual({
      username: 'kufar_watch_bot',
    })
    expect(supervisor.verifyTelegramToken).toHaveBeenCalledWith(token)
    expect(store.write).not.toHaveBeenCalled()
    expect(supervisor.configureTelegram).not.toHaveBeenCalled()
  })

  it('activates a token only after protected persistence succeeds', async () => {
    const token = 'SECRET_SENTINEL_5_0_2_MAIN_SAVE'
    const store: TelegramSecretStore = {
      read: vi.fn(),
      write: vi.fn(async () => ({ state: 'protected' as const })),
    }
    const supervisor = createSupervisor()
    const saveTelegramToken = runtimeFunction('saveTelegramToken')

    await expect(
      saveTelegramToken(store, supervisor, token, false),
    ).resolves.toEqual({
      state: 'protected',
    })
    expect(store.write).toHaveBeenCalledWith(token, false)
    expect(supervisor.configureTelegram).toHaveBeenCalledWith(token)
  })

  it(
    'does not activate a token when unprotected persistence still needs consent',
    async () => {
      const token = 'SECRET_SENTINEL_5_0_2_MAIN_CONSENT'
      const store: TelegramSecretStore = {
        read: vi.fn(),
        write: vi.fn(async () => ({
          state: 'confirmation-required' as const,
          reason: 'unprotected-backend' as const,
        })),
      }
      const supervisor = createSupervisor()
      const saveTelegramToken = runtimeFunction('saveTelegramToken')

      await expect(
        saveTelegramToken(store, supervisor, token, false),
      ).resolves.toEqual({
        state: 'confirmation-required',
        reason: 'unprotected-backend',
      })
      expect(supervisor.configureTelegram).not.toHaveBeenCalled()
    },
  )
})
