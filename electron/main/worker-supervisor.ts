import {
  TELEGRAM_BIND_RESULTS,
  TELEGRAM_CHAT_TYPES,
  TELEGRAM_RUNTIME_STATES,
  type TelegramBindResult,
  type TelegramCandidate,
} from '../../shared/telegram'
import type { WorkerEvent, WorkerProcessHandle } from '../../shared/runtime'

export type RestartDecision = 'restart' | 'fatal'
export type WorkerShutdownResult = 'acknowledged' | 'timed-out'

export interface RestartPolicy {
  recordCrash(): RestartDecision
  reset(): void
}

export interface WorkerRuntimeHandle extends WorkerProcessHandle {
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  off(event: 'message', listener: (message: unknown) => void): this
  off(event: 'exit', listener: (code: number) => void): this
}

export interface WorkerSupervisorOptions {
  spawnWorker(): WorkerRuntimeHandle
  onEvent?(event: WorkerEvent): void
  onFatal?(message: string): void
  maxRestarts?: number
  shutdownTimeoutMs?: number
}

export interface WorkerSupervisor {
  start(): void
  configureTelegram(token: string | null): void
  bindTelegramCandidate(chatId: string): Promise<TelegramBindResult>
  shutdown(): Promise<WorkerShutdownResult>
}

function includesString<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function parseTelegramCandidate(value: unknown): TelegramCandidate | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined

  const chatId = Reflect.get(value, 'chatId')
  const chatType = Reflect.get(value, 'chatType')
  const displayName = Reflect.get(value, 'displayName')
  const username = Reflect.get(value, 'username')
  if (
    typeof chatId !== 'string' ||
    !includesString(TELEGRAM_CHAT_TYPES, chatType) ||
    typeof displayName !== 'string' ||
    (username !== undefined && typeof username !== 'string')
  ) {
    return undefined
  }

  return username === undefined
    ? { chatId, chatType, displayName }
    : { chatId, chatType, displayName, username }
}

function parseWorkerEvent(message: unknown): WorkerEvent | undefined {
  if (!message || typeof message !== 'object') return undefined
  const type = Reflect.get(message, 'type')

  if (type === 'ready' || type === 'shutdown-complete') return { type }

  if (type === 'journal') {
    const level = Reflect.get(message, 'level')
    const text = Reflect.get(message, 'message')
    if (
      (level === 'info' || level === 'warning' || level === 'error') &&
      typeof text === 'string'
    ) {
      return { type, level, message: text }
    }
    return undefined
  }

  if (type === 'monitor-pause-required') {
    const monitorId = Reflect.get(message, 'monitorId')
    const stage = Reflect.get(message, 'stage')
    if (
      typeof monitorId === 'number' &&
      (stage === 'primary' || stage === 'html-fallback' || stage === 'degradation-event')
    ) {
      return { type, monitorId, stage }
    }
    return undefined
  }

  if (type === 'telegram-state') {
    const state = Reflect.get(message, 'state')
    const boundChatId = Reflect.get(message, 'boundChatId')
    if (
      includesString(TELEGRAM_RUNTIME_STATES, state) &&
      (boundChatId === null || typeof boundChatId === 'string')
    ) {
      return { type, state, boundChatId }
    }
    return undefined
  }

  if (type === 'telegram-candidate') {
    const candidate = parseTelegramCandidate(Reflect.get(message, 'candidate'))
    return candidate === undefined ? undefined : { type, candidate }
  }

  if (type === 'telegram-bind-result') {
    const requestId = Reflect.get(message, 'requestId')
    const result = Reflect.get(message, 'result')
    if (typeof requestId === 'string' && includesString(TELEGRAM_BIND_RESULTS, result)) {
      return { type, requestId, result }
    }
  }

  if (type === 'telegram-bind-error') {
    const requestId = Reflect.get(message, 'requestId')
    if (typeof requestId === 'string') return { type, requestId }
  }

  return undefined
}

export function createRestartPolicy(maxRestarts: number): RestartPolicy {
  let crashes = 0

  return {
    recordCrash(): RestartDecision {
      crashes += 1
      return crashes <= maxRestarts ? 'restart' : 'fatal'
    },
    reset(): void {
      crashes = 0
    },
  }
}

export function restartDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 4_000)
}

export function requestWorkerShutdown(
  worker: WorkerProcessHandle,
  timeoutMs: number,
): Promise<WorkerShutdownResult> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (result: WorkerShutdownResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      worker.off('message', onMessage)
      resolve(result)
    }

    const onMessage = (message: unknown): void => {
      if (parseWorkerEvent(message)?.type === 'shutdown-complete') {
        finish('acknowledged')
      }
    }

    const timeout = setTimeout(() => {
      worker.kill()
      finish('timed-out')
    }, timeoutMs)

    worker.on('message', onMessage)
    worker.postMessage({ type: 'shutdown' })
  })
}

export function createWorkerSupervisor(options: WorkerSupervisorOptions): WorkerSupervisor {
  const restartPolicy = createRestartPolicy(options.maxRestarts ?? 3)
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000
  const pendingTelegramBinds = new Map<
    string,
    { resolve(result: TelegramBindResult): void; reject(error: Error): void }
  >()
  let currentWorker: WorkerRuntimeHandle | undefined
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let restartAttempt = 0
  let stopping = false
  let hasTelegramConfiguration = false
  let telegramToken: string | null = null
  let currentWorkerConfigurationSent = false
  let telegramBindRequestSequence = 0

  const rejectPendingTelegramBinds = (message: string): void => {
    for (const pending of pendingTelegramBinds.values()) {
      pending.reject(new Error(message))
    }
    pendingTelegramBinds.clear()
  }

  const sendTelegramConfiguration = (worker: WorkerRuntimeHandle): void => {
    if (!hasTelegramConfiguration || currentWorkerConfigurationSent || currentWorker !== worker)
      return
    worker.postMessage({ type: 'telegram-configure', token: telegramToken })
    currentWorkerConfigurationSent = true
  }

  const spawn = (): void => {
    const worker = options.spawnWorker()
    currentWorker = worker
    currentWorkerConfigurationSent = false

    const onMessage = (message: unknown): void => {
      const event = parseWorkerEvent(message)
      if (!event) return

      if (event.type === 'telegram-bind-result' || event.type === 'telegram-bind-error') {
        const pending = pendingTelegramBinds.get(event.requestId)
        if (!pending) return
        pendingTelegramBinds.delete(event.requestId)
        if (event.type === 'telegram-bind-result') {
          pending.resolve(event.result)
        } else {
          pending.reject(new Error('Telegram candidate binding failed'))
        }
        return
      }

      if (event.type === 'ready') {
        restartPolicy.reset()
        restartAttempt = 0
        sendTelegramConfiguration(worker)
      }
      options.onEvent?.(event)
    }

    const onExit = (): void => {
      worker.off('message', onMessage)
      worker.off('exit', onExit)
      if (currentWorker === worker) {
        currentWorker = undefined
        currentWorkerConfigurationSent = false
        rejectPendingTelegramBinds('Worker became unavailable')
      }
      if (stopping) return

      restartAttempt += 1
      if (restartPolicy.recordCrash() === 'fatal') {
        options.onEvent?.({
          type: 'journal',
          level: 'error',
          message: 'Worker failed more than three times',
        })
        options.onFatal?.('Worker failed more than three times')
        return
      }

      const delayMs = restartDelayMs(restartAttempt)
      options.onEvent?.({
        type: 'journal',
        level: 'warning',
        message: `Worker exited unexpectedly; restart in ${delayMs} ms`,
      })
      restartTimer = setTimeout(() => {
        restartTimer = undefined
        if (!stopping) spawn()
      }, delayMs)
    }

    worker.on('message', onMessage)
    worker.on('exit', onExit)
  }

  return {
    start(): void {
      spawn()
    },
    configureTelegram(token: string | null): void {
      hasTelegramConfiguration = true
      telegramToken = token
      if (!currentWorker) return
      currentWorkerConfigurationSent = false
      sendTelegramConfiguration(currentWorker)
    },
    bindTelegramCandidate(chatId: string): Promise<TelegramBindResult> {
      const worker = currentWorker
      if (!worker) return Promise.reject(new Error('Worker is unavailable'))

      telegramBindRequestSequence += 1
      const requestId = `telegram-bind-${telegramBindRequestSequence}`
      return new Promise((resolve, reject) => {
        pendingTelegramBinds.set(requestId, { resolve, reject })
        worker.postMessage({ type: 'telegram-bind-candidate', requestId, chatId })
      })
    },
    async shutdown(): Promise<WorkerShutdownResult> {
      stopping = true
      rejectPendingTelegramBinds('Worker is shutting down')
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = undefined
      }
      if (!currentWorker) return 'acknowledged'
      return requestWorkerShutdown(currentWorker, shutdownTimeoutMs)
    },
  }
}
