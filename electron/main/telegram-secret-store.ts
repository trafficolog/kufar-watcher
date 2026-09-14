import { join } from 'node:path'

export const TELEGRAM_TOKEN_FILE = 'telegram-token.enc'

export type TelegramSecretReadResult =
  | { state: 'missing' }
  | { state: 'protected'; token: string }
  | { state: 'unprotected'; token: string }
  | {
      state: 'unavailable'
      reason: 'encryption-unavailable' | 'unprotected-backend' | 'decrypt-failed'
    }

export type TelegramSecretWriteResult =
  | { state: 'protected' }
  | { state: 'unprotected' }
  | { state: 'confirmation-required'; reason: 'unprotected-backend' }
  | {
      state: 'unavailable'
      reason: 'encryption-unavailable' | 'write-failed'
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

interface VersionedTelegramSecretRecord {
  protection: 'protected' | 'unprotected'
  value: string
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

function readVersionedRecord(encoded: string): VersionedTelegramSecretRecord | null | undefined {
  const text = encoded.trim()
  if (!text.startsWith('{')) return undefined

  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    if (Reflect.get(parsed, 'version') !== 1) return null
    const protection = Reflect.get(parsed, 'protection')
    if (protection !== 'protected' && protection !== 'unprotected') return null
    const value = Reflect.get(parsed, 'value')
    if (typeof value !== 'string') return null
    return { protection, value }
  } catch {
    return null
  }
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

      const versionedRecord = readVersionedRecord(encoded)
      if (versionedRecord === null) return { state: 'unavailable', reason: 'decrypt-failed' }
      if (versionedRecord?.protection === 'unprotected') {
        return {
          state: 'unprotected',
          token: Buffer.from(versionedRecord.value, 'base64').toString('utf8'),
        }
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

      const ciphertext = versionedRecord?.value ?? encoded.trim()
      try {
        const { result: token } = await dependencies.safeStorage.decryptStringAsync(
          Buffer.from(ciphertext, 'base64'),
        )
        return { state: 'protected', token }
      } catch {
        return { state: 'unavailable', reason: 'decrypt-failed' }
      }
    },

    async write(token, allowUnprotected): Promise<TelegramSecretWriteResult> {
      if (!(await dependencies.safeStorage.isAsyncEncryptionAvailable())) {
        return { state: 'unavailable', reason: 'encryption-unavailable' }
      }

      const isUnprotectedLinuxBackend =
        dependencies.platform === 'linux' &&
        dependencies.safeStorage.getSelectedStorageBackend() === 'basic_text'

      if (isUnprotectedLinuxBackend) {
        if (!allowUnprotected) {
          return { state: 'confirmation-required', reason: 'unprotected-backend' }
        }

        const writeFile = dependencies.writeFile
        if (!writeFile) return { state: 'unavailable', reason: 'write-failed' }

        try {
          await writeFile(
            path,
            JSON.stringify({
              version: 1,
              protection: 'unprotected',
              value: Buffer.from(token, 'utf8').toString('base64'),
            }),
            'utf8',
          )
          return { state: 'unprotected' }
        } catch {
          return { state: 'unavailable', reason: 'write-failed' }
        }
      }

      const encryptStringAsync = dependencies.safeStorage.encryptStringAsync
      const writeFile = dependencies.writeFile
      if (!encryptStringAsync || !writeFile) {
        return { state: 'unavailable', reason: 'write-failed' }
      }

      try {
        const encrypted = await encryptStringAsync.call(dependencies.safeStorage, token)
        await writeFile(
          path,
          JSON.stringify({
            version: 1,
            protection: 'protected',
            value: encrypted.toString('base64'),
          }),
          'utf8',
        )
        return { state: 'protected' }
      } catch {
        return { state: 'unavailable', reason: 'write-failed' }
      }
    },
  }
}
