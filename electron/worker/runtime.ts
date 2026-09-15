import type { MonitorCreateInput, MonitorCreateResult, MonitorListItem } from '../../shared/ipc'
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
  verifyTelegramToken?(token: string): Promise<{ username: string }>
  bindTelegramCandidate?(chatId: string): Promise<TelegramBindResult>
  sendTelegramTestMessage?(): Promise<void>
  createMonitor?(input: MonitorCreateInput): Promise<MonitorCreateResult>
  listMonitors?(): Promise<MonitorListItem[]>
  setMonitorState?(monitorId: number, state: 'active' | 'paused'): Promise<void>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isMonitorCreateInput(value: unknown): value is MonitorCreateInput {
  if (!value || typeof value !== 'object') return false
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'sourceUrl') === 'string' &&
    typeof Reflect.get(value, 'intervalSec') === 'number' &&
    isStringArray(Reflect.get(value, 'include')) &&
    isStringArray(Reflect.get(value, 'exclude'))
  )
}

function isWorkerControlMessage(message: unknown): message is WorkerControlMessage {
  if (!message || typeof message !== 'object') return false

  const type = Reflect.get(message, 'type')
  if (type === 'shutdown' || type === 'telegram-resume') return true
  if (type === 'telegram-configure') {
    const token = Reflect.get(message, 'token')
    return token === null || typeof token === 'string'
  }
  if (type === 'telegram-verify-token') {
    return (
      typeof Reflect.get(message, 'requestId') === 'string' &&
      typeof Reflect.get(message, 'token') === 'string'
    )
  }
  if (type === 'telegram-bind-candidate') {
    return (
      typeof Reflect.get(message, 'requestId') === 'string' &&
      typeof Reflect.get(message, 'chatId') === 'string'
    )
  }
  if (type === 'telegram-test-message' || type === 'monitor-list') {
    return typeof Reflect.get(message, 'requestId') === 'string'
  }
  if (type === 'monitor-create') {
    return (
      typeof Reflect.get(message, 'requestId') === 'string' &&
      isMonitorCreateInput(Reflect.get(message, 'input'))
    )
  }
  if (type === 'monitor-set-state') {
    const monitorId = Reflect.get(message, 'monitorId')
    const state = Reflect.get(message, 'state')
    return (
      typeof Reflect.get(message, 'requestId') === 'string' &&
      typeof monitorId === 'number' &&
      Number.isInteger(monitorId) &&
      monitorId > 0 &&
      (state === 'active' || state === 'paused')
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

    if (data.type === 'telegram-verify-token') {
      if (!services.verifyTelegramToken) {
        parentPort.postMessage({
          type: 'telegram-verify-token-error',
          requestId: data.requestId,
        })
        parentPort.postMessage({
          type: 'journal',
          level: 'error',
          message: 'Telegram token verification failed',
        })
        return
      }
      void services
        .verifyTelegramToken(data.token)
        .then((identity) => {
          parentPort.postMessage({
            type: 'telegram-verify-token-result',
            requestId: data.requestId,
            username: identity.username,
          })
        })
        .catch(() => {
          parentPort.postMessage({
            type: 'telegram-verify-token-error',
            requestId: data.requestId,
          })
          parentPort.postMessage({
            type: 'journal',
            level: 'error',
            message: 'Telegram token verification failed',
          })
        })
      return
    }

    if (data.type === 'telegram-test-message') {
      if (!services.sendTelegramTestMessage) {
        parentPort.postMessage({
          type: 'telegram-test-message-error',
          requestId: data.requestId,
        })
        parentPort.postMessage({
          type: 'journal',
          level: 'error',
          message: 'Telegram test message failed',
        })
        return
      }
      void services
        .sendTelegramTestMessage()
        .then(() => {
          parentPort.postMessage({
            type: 'telegram-test-message-result',
            requestId: data.requestId,
          })
        })
        .catch(() => {
          parentPort.postMessage({
            type: 'telegram-test-message-error',
            requestId: data.requestId,
          })
          parentPort.postMessage({
            type: 'journal',
            level: 'error',
            message: 'Telegram test message failed',
          })
        })
      return
    }

    if (data.type === 'monitor-create') {
      if (!services.createMonitor) return
      void services
        .createMonitor(data.input)
        .then((result) => {
          parentPort.postMessage({
            type: 'monitor-create-result',
            requestId: data.requestId,
            result,
          })
        })
        .catch(() => {
          parentPort.postMessage({
            type: 'monitor-create-error',
            requestId: data.requestId,
          })
          parentPort.postMessage({
            type: 'journal',
            level: 'error',
            message: 'Monitor creation failed',
          })
        })
      return
    }

    if (data.type === 'monitor-list') {
      if (!services.listMonitors) return
      void services
        .listMonitors()
        .then((result) => {
          parentPort.postMessage({
            type: 'monitor-list-result',
            requestId: data.requestId,
            result,
          })
        })
        .catch(() => {
          parentPort.postMessage({
            type: 'monitor-list-error',
            requestId: data.requestId,
          })
          parentPort.postMessage({
            type: 'journal',
            level: 'error',
            message: 'Monitor list failed',
          })
        })
      return
    }

    if (data.type === 'monitor-set-state') {
      if (!services.setMonitorState) return
      void services
        .setMonitorState(data.monitorId, data.state)
        .then(() => {
          parentPort.postMessage({
            type: 'monitor-set-state-result',
            requestId: data.requestId,
          })
        })
        .catch(() => {
          parentPort.postMessage({
            type: 'monitor-set-state-error',
            requestId: data.requestId,
          })
          parentPort.postMessage({
            type: 'journal',
            level: 'error',
            message: 'Monitor state change failed',
          })
        })
      return
    }

    if (data.type !== 'telegram-bind-candidate' || !services.bindTelegramCandidate) return
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
