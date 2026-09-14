import { describe, expect, it, vi } from 'vitest'

import { createTelegramSecretStore } from '../../electron/main/telegram-secret-store'

interface WritableTelegramSecretStore {
  write(token: string, allowUnprotected: boolean): Promise<{ state: string }>
}

describe('Telegram secret store write', () => {
  it('encrypts a token before persisting it when protected storage is available', async () => {
    const ciphertext = Buffer.from('ciphertext')
    const writeFile = vi.fn(async () => undefined)
    const safeStorage = {
      isAsyncEncryptionAvailable: vi.fn(async () => true),
      getSelectedStorageBackend: vi.fn(() => 'dpapi'),
      decryptStringAsync: vi.fn(),
      encryptStringAsync: vi.fn(async (value: string) => {
        expect(value).toBe('SECRET_SENTINEL_5_0_2')
        return ciphertext
      }),
    }
    const store = createTelegramSecretStore('/user-data', {
      platform: 'win32',
      readFile: vi.fn(),
      writeFile,
      safeStorage,
    } as never) as unknown as WritableTelegramSecretStore

    await expect(store.write('SECRET_SENTINEL_5_0_2', false)).resolves.toEqual({
      state: 'protected',
    })
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('telegram-token.enc'),
      ciphertext.toString('base64'),
      'utf8',
    )
    expect(JSON.stringify(writeFile.mock.calls)).not.toContain('SECRET_SENTINEL_5_0_2')
  })
})
