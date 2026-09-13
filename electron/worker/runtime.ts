import type { TelegramBindResult } from '../../shared/telegram'
import type { WorkerControlMessage, WorkerEvent } from '../../shared/runtime'

export interface WorkerParentPort {
  postMessage(message: WorkerEvent): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

export interface WorkerRuntimeServices {
  start(): Promise<void>
  stop(): Promise<void>
  configureTelegram?(token: string | null): Promise<void>
  resumeTelegram?(): Promise<void>
  bindTelegramCandidate?(chatId: string): Promise<TelegramBindResult>
}

function isWorkerControlMessage(message: unknown): message is WorkerControlMessage {
  if (!message || typeof message !== 'object') return false

  const type = Reflect.get(message, 'type')
  if (type === 'shutdown' || type === 'telegram-resume') return true
  if (type === 'telegram-configure') {
    const token = Reflect.get(message, 'token')
    return token === null || typeof token === 'string'
  }
  if (type === 'telegram-bind-candidate') {
    return (
      typeof Reflect.get(message, 'requestId') === 'string' &&
      typeof Reflect.get(message, 'chatId') === 'string'
    )
  }
  return false
}

export async function startWorkerRuntime(
  parentPort: WorkerParentPort,
  services: WorkerRuntimeServices,
  exit: (code: number) => void,
): Promise<void> {
  let started = false
  let shutdownRequested = false
  let shutdownStarted = false

  const stopAndExit = async (): Promise<void> => {
    if (shutdownStarted) return
    shutdownStarted = true

    await services.stop()
    parentPort.postMessage({ type: 'shutdown-complete' })
    exit(0)
  }

  parentPort.on('message', ({ data }) => {
    if (!isWorkerControlMessage(data)) return

    if (data.type === 'shutdown') {
      shutdownRequested = true
      if (started) void stopAndExit()
      return
    }

    if (data.type === 'telegram-configure') {
      if (!services.configureTelegram) return
      void services.configureTelegram(data.token).catch(() => {
        parentPort.postMessage({
          type: 'journal',
          level: 'error',
          message: 'Telegram configuration failed',
        })
      })
      return
    }

    if (data.type === 'telegram-resume') {
      if (!services.resumeTelegram) return
      void services.resumeTelegram().catch(() => {
        parentPort.postMessage({
          type: 'journal',
          level: 'error',
          message: 'Telegram resume failed',
        })
      })
      return
    }

    if (!services.bindTelegramCandidate) return
    void services
      .bindTelegramCandidate(data.chatId)
      .then((result) => {
        parentPort.postMessage({
          type: 'telegram-bind-result',
          requestId: data.requestId,
          result,
        })
      })
      .catch(() => {
        parentPort.postMessage({
          type: 'telegram-bind-error',
          requestId: data.requestId,
        })
        parentPort.postMessage({
          type: 'journal',
          level: 'error',
          message: 'Telegram candidate binding failed',
        })
      })
  })

  await services.start()
  started = true

  if (shutdownRequested) {
    await stopAndExit()
    return
  }

  parentPort.postMessage({ type: 'ready' })
}
