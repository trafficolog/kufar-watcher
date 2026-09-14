import { join } from 'node:path'

export const TELEGRAM_TOKEN_FILE = 'telegram-token.enc'

export type TelegramSecretReadResult =
  | { state: 'missing' }
  | { state: 'protected'; token: string }
  | {
      state: 'unavailable'
      reason: 'encryption-unavailable' | 'unprotected-backend' | 'decrypt-failed'
    }

export type TelegramSecretWriteResult =
  | { state: 'protected' }
  | {
      state: 'unavailable'
      reason: 'encryption-unavailable' | 'unprotected-backend' | 'write-failed'
    }

export interface TelegramSecretStore {
  read(): Promise<TelegramSecretReadResult>
  write(token: string, allowUnprotected: boolean): Promise<TelegramSecretWriteResult>
}

export interface TelegramSafeStorageDecryptResult {
  result: string
  shouldReEncrypt: boolean
}

export interface TelegramSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>
  getSelectedStorageBackend(): string
  decryptStringAsync(value: Buffer): Promise<TelegramSafeStorageDecryptResult>
  encryptStringAsync?(value: string): Promise<Buffer>
}

export interface TelegramSecretStoreDependencies {
  platform: NodeJS.Platform
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile?(path: string, value: string, encoding: 'utf8'): Promise<void>
  safeStorage: TelegramSafeStorage
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

export function createTelegramSecretStore(
  userDataDir: string,
  dependencies: TelegramSecretStoreDependencies,
): TelegramSecretStore {
  const path = join(userDataDir, TELEGRAM_TOKEN_FILE)

  return {
    async read(): Promise<TelegramSecretReadResult> {
      let encoded: string
      try {
        encoded = await dependencies.readFile(path, 'utf8')
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return { state: 'missing' }
        return { state: 'unavailable', reason: 'decrypt-failed' }
      }

      if (!(await dependencies.safeStorage.isAsyncEncryptionAvailable())) {
        return { state: 'unavailable', reason: 'encryption-unavailable' }
      }

      if (
        dependencies.platform === 'linux' &&
        dependencies.safeStorage.getSelectedStorageBackend() === 'basic_text'
      ) {
        return { state: 'unavailable', reason: 'unprotected-backend' }
      }

      try {
        const { result: token } = await dependencies.safeStorage.decryptStringAsync(
          Buffer.from(encoded.trim(), 'base64'),
        )
        return { state: 'protected', token }
      } catch {
        return { state: 'unavailable', reason: 'decrypt-failed' }
      }
    },

    async write(token): Promise<TelegramSecretWriteResult> {
      if (!(await dependencies.safeStorage.isAsyncEncryptionAvailable())) {
        return { state: 'unavailable', reason: 'encryption-unavailable' }
      }

      if (
        dependencies.platform === 'linux' &&
        dependencies.safeStorage.getSelectedStorageBackend() === 'basic_text'
      ) {
        return { state: 'unavailable', reason: 'unprotected-backend' }
      }

      const encryptStringAsync = dependencies.safeStorage.encryptStringAsync
      const writeFile = dependencies.writeFile
      if (!encryptStringAsync || !writeFile) {
        return { state: 'unavailable', reason: 'write-failed' }
      }

      try {
        const encrypted = await encryptStringAsync.call(dependencies.safeStorage, token)
        await writeFile(path, encrypted.toString('base64'), 'utf8')
        return { state: 'protected' }
      } catch {
        return { state: 'unavailable', reason: 'write-failed' }
      }
    },
  }
}
