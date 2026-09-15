import type { TelegramDesktopState } from '../../shared/telegram'
import type { TelegramSecretStore, TelegramSecretWriteResult } from './telegram-secret-store'
import type { WorkerSupervisor } from './worker-supervisor'

export async function configureTelegramFromSecret(
  store: TelegramSecretStore,
  supervisor: Pick<WorkerSupervisor, 'configureTelegram'>,
): Promise<TelegramDesktopState['secret']> {
  const result = await store.read()

  if (result.state === 'protected' || result.state === 'unprotected') {
    supervisor.configureTelegram(result.token)
    return result.state
  }

  supervisor.configureTelegram(null)
  return result.state
}

export async function verifyTelegramToken(
  supervisor: Pick<WorkerSupervisor, 'verifyTelegramToken'>,
  token: string,
): Promise<{ username: string }> {
  if (!supervisor.verifyTelegramToken) throw new Error('Telegram token verification failed')
  return supervisor.verifyTelegramToken(token)
}

export async function saveTelegramToken(
  store: TelegramSecretStore,
  supervisor: Pick<WorkerSupervisor, 'configureTelegram'>,
  token: string,
  allowUnprotected: boolean,
): Promise<TelegramSecretWriteResult> {
  const result = await store.write(token, allowUnprotected)
  if (result.state === 'protected' || result.state === 'unprotected') {
    supervisor.configureTelegram(token)
  }
  return result
}
