import { describe, expect, it, vi } from 'vitest'

import {
  createTelegramSecretStore,
  type TelegramSafeStorageDecryptResult,
} from '../../electron/main/telegram-secret-store'

function missingFileError(): Error & { code: string } {
  return Object.assign(new Error('missing'), { code: 'ENOENT' })
}

function decryptResult(result: string): TelegramSafeStorageDecryptResult {
  return { result, shouldReEncrypt: false }
}

function createSafeStorage(
  overrides: Partial<{
    isAsyncEncryptionAvailable(): Promise<boolean>
    getSelectedStorageBackend(): string
    decryptStringAsync(value: Buffer): Promise<TelegramSafeStorageDecryptResult>
  }> = {},
) {
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    decryptStringAsync: vi.fn(async () => decryptResult('telegram-token')),
    ...overrides,
  }
}

describe('Telegram secret store', () => {
  it('returns missing when no encrypted token exists', async () => {
    const readFile = vi.fn(async () => {
      throw missingFileError()
    })
    const safeStorage = createSafeStorage()
    const store = createTelegramSecretStore('/user-data', {
      platform: 'linux',
      readFile,
      safeStorage,
    })

    await expect(store.read()).resolves.toEqual({ state: 'missing' })
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled()
  })

  it('decrypts base64 ciphertext when protected storage is available', async () => {
    const ciphertext = Buffer.from('encrypted-token')
    const readFile = vi.fn(async () => ciphertext.toString('base64'))
    const safeStorage = createSafeStorage({
      decryptStringAsync: vi.fn(async (value: Buffer) => {
        expect(value).toEqual(ciphertext)
        return decryptResult('telegram-token')
      }),
    })
    const store = createTelegramSecretStore('/user-data', {
      platform: 'linux',
      readFile,
      safeStorage,
    })

    await expect(store.read()).resolves.toEqual({
      state: 'protected',
      token: 'telegram-token',
    })
  })

  it('reports unavailable when async encryption is unavailable', async () => {
    const readFile = vi.fn(async () => Buffer.from('cipher').toString('base64'))
    const safeStorage = createSafeStorage({
      isAsyncEncryptionAvailable: vi.fn(async () => false),
    })
    const store = createTelegramSecretStore('/user-data', {
      platform: 'win32',
      readFile,
      safeStorage,
    })

    await expect(store.read()).resolves.toEqual({
      state: 'unavailable',
      reason: 'encryption-unavailable',
    })
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled()
  })

  it('awaits async encryption availability before decrypting', async () => {
    const readFile = vi.fn(async () => Buffer.from('cipher').toString('base64'))
    const safeStorage = createSafeStorage({
      isAsyncEncryptionAvailable: vi.fn(async () => false),
    })
    const store = createTelegramSecretStore('/user-data', {
      platform: 'win32',
      readFile,
      safeStorage,
    })

    await expect(store.read()).resolves.toEqual({
      state: 'unavailable',
      reason: 'encryption-unavailable',
    })
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled()
  })

  it('treats the Linux basic_text backend as unprotected', async () => {
    const readFile = vi.fn(async () => Buffer.from('cipher').toString('base64'))
    const safeStorage = createSafeStorage({
      getSelectedStorageBackend: vi.fn(() => 'basic_text'),
    })
    const store = createTelegramSecretStore('/user-data', {
      platform: 'linux',
      readFile,
      safeStorage,
    })

    await expect(store.read()).resolves.toEqual({
      state: 'unavailable',
      reason: 'unprotected-backend',
    })
    expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled()
  })

  it('redacts decrypt failures into a fixed unavailable state', async () => {
    const readFile = vi.fn(async () => Buffer.from('cipher').toString('base64'))
    const safeStorage = createSafeStorage({
      decryptStringAsync: vi.fn(async () => {
        throw new Error('decrypt failed for SECRET_SENTINEL_3_1_1')
      }),
    })
    const store = createTelegramSecretStore('/user-data', {
      platform: 'linux',
      readFile,
      safeStorage,
    })

    const result = await store.read()

    expect(result).toEqual({ state: 'unavailable', reason: 'decrypt-failed' })
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_3_1_1')
  })
})