import { describe, expect, it, vi } from 'vitest'

import { createTelegramSecretStore } from '../../electron/main/telegram-secret-store'

function missingFileError(): Error & { code: string } {
  return Object.assign(new Error('missing'), { code: 'ENOENT' })
}

function createSafeStorage(
  overrides: Partial<{
    isAsyncEncryptionAvailable(): boolean
    getSelectedStorageBackend(): string
    decryptStringAsync(value: Buffer): Promise<string>
  }> = {},
) {
  return {
    isAsyncEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    decryptStringAsync: vi.fn(async () => 'telegram-token'),
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
        return 'telegram-token'
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
      isAsyncEncryptionAvailable: vi.fn(() => false),
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
    const decryptStringAsync = vi.fn(async () => 'telegram-token')
    const safeStorage = {
      isAsyncEncryptionAvailable: vi.fn(async () => false),
      getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
      decryptStringAsync,
    }
    const store = createTelegramSecretStore('/user-data', {
      platform: 'win32',
      readFile,
      safeStorage: safeStorage as unknown as Parameters<
        typeof createTelegramSecretStore
      >[1]['safeStorage'],
    })

    await expect(store.read()).resolves.toEqual({
      state: 'unavailable',
      reason: 'encryption-unavailable',
    })
    expect(decryptStringAsync).not.toHaveBeenCalled()
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