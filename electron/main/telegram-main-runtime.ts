import type { TelegramDesktopState } from '../../shared/telegram'
import type { TelegramSecretStore } from './telegram-secret-store'
import type { WorkerSupervisor } from './worker-supervisor'

export async function configureTelegramFromSecret(
  store: TelegramSecretStore,
  supervisor: Pick<WorkerSupervisor, 'configureTelegram'>,
): Promise<TelegramDesktopState['secret']> {
  const result = await store.read()

  if (result.state === 'protected') {
    supervisor.configureTelegram(result.token)
    return 'protected'
  }

  supervisor.configureTelegram(null)
  return result.state
}
