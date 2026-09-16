import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
} from 'electron'
import { IPC, type BootState } from '../../shared/ipc'
import type { TelegramDesktopState } from '../../shared/telegram'
import workerPath from '../worker/index?modulePath'
import { APP_HOST, APP_ORIGIN, APP_SCHEME, registerRendererProtocol } from './app-protocol'
import { createBootstrapRetryController } from './bootstrap-retry'
import { createDockerClient } from './docker-client'
import { createDockerodePostgresRuntime } from './dockerode-postgres-adapter'
import {
  installUnhandledRejectionHandler,
  runInfrastructureBootstrap,
  runVisibleBootstrap,
} from './infrastructure-bootstrap'
import { createInfrastructureBootstrapDependencies } from './infrastructure-runtime'
import {
  forwardBootState,
  markWorkerBootFailed,
  registerMonitorIpcHandlers,
  registerSystemIpcHandlers,
  registerTelegramIpcHandlers,
  routeWorkerBootEvent,
  routeWorkerTelegramEvent,
} from './ipc-router'
import { loadOrCreatePostgresCredentials, readPostgresRuntimeConfig } from './postgres-config'
import {
  configureTelegramFromSecret,
  saveTelegramToken,
  verifyTelegramToken,
} from './telegram-main-runtime'
import { createTelegramSecretStore } from './telegram-secret-store'
import { workerProcessEnvironment } from './worker-process-env'
import { createWorkerSupervisor, type WorkerSupervisor } from './worker-supervisor'
import { openRawResponseJournal, rawResponseJournalArg } from './worker-storage'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const devRendererUrl = process.env.KUFAR_RENDERER_URL
const productionOrigin = `${APP_ORIGIN}/`
let workerSupervisor: WorkerSupervisor | undefined
let resolvedDatabaseUrl: string | undefined
let quitAfterWorkerShutdown = false
let bootState: BootState = {
  phase: 'starting',
  steps: [],
}
let telegramState: TelegramDesktopState = {
  runtime: 'not-configured',
  channel: 'disconnected',
  boundChatId: null,
  candidate: null,
  secret: 'missing',
}

function loadDevelopmentEnvironment(): void {
  if (app.isPackaged || !existsSync('.env')) return
  process.loadEnvFile('.env')
}

function isAllowedNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (devRendererUrl) return url.origin === new URL(devRendererUrl).origin
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
  } catch {
    return false
  }
}

function sendBootState(window: BrowserWindow, state: BootState): void {
  forwardBootState(state, (payload) => window.webContents.send(IPC.bootEvent, payload))
}

function sendTelegramState(window: BrowserWindow, state: TelegramDesktopState): void {
  window.webContents.send(IPC.telegramStateEvent, state)
}

function broadcastBootState(state: BootState): void {
  for (const window of BrowserWindow.getAllWindows()) sendBootState(window, state)
}

function broadcastTelegramState(state: TelegramDesktopState): void {
  for (const window of BrowserWindow.getAllWindows()) sendTelegramState(window, state)
}

function broadcastMonitorChanged(monitorId: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.monitorChangedEvent, monitorId)
  }
}

function publishBootState(state: BootState): void {
  bootState = state
  if (app.isReady()) broadcastBootState(state)
}

function reportUnexpectedFailure(error: unknown): void {
  console.error('[bootstrap:unexpected]', error)
  publishBootState({
    phase: 'error',
    steps: bootState.steps,
    errorCode: 'unexpected-failure',
  })
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })
  window.webContents.on('did-finish-load', () => {
    sendBootState(window, bootState)
    sendTelegramState(window, telegramState)
  })
  window.once('ready-to-show', () => window.show())

  void window.loadURL(devRendererUrl ?? productionOrigin)
  return window
}

installUnhandledRejectionHandler(process, reportUnexpectedFailure)

app.whenReady().then(async () => {
  if (!devRendererUrl) {
    const publicRoot = resolve(__dirname, '../../.output/public')
    await registerRendererProtocol(publicRoot)
  }

  const userDataDir = app.getPath('userData')
  const workerJournalArg = rawResponseJournalArg(userDataDir)
  const supervisor = createWorkerSupervisor({
    spawnWorker: () => {
      if (!resolvedDatabaseUrl) {
        throw new Error('Worker database URL is unavailable before bootstrap')
      }

      return utilityProcess.fork(workerPath, [workerJournalArg], {
        serviceName: 'Kufar Monitor Worker',
        env: workerProcessEnvironment(process.env, resolvedDatabaseUrl),
      })
    },
    onEvent: (event) => {
      bootState = routeWorkerBootEvent(event, bootState, broadcastBootState)
      telegramState = routeWorkerTelegramEvent(event, telegramState, broadcastTelegramState)
      if (event.type === 'monitor-changed') broadcastMonitorChanged(event.monitorId)
      if (event.type === 'ready') console.info('[worker] ready')
      if (event.type === 'journal') {
        console.info(`[worker:${event.level}] ${event.message}`)
      }
    },
    onFatal: (message) => {
      bootState = markWorkerBootFailed(bootState, message, broadcastBootState)
      console.error(`[worker:fatal] ${message}`)
    },
  })
  workerSupervisor = supervisor
  powerMonitor.on('resume', () => supervisor.resumeTelegram())

  const telegramSecretStore = createTelegramSecretStore(userDataDir, {
    platform: process.platform,
    readFile,
    writeFile,
    safeStorage,
  })
  const telegramSecretState = await configureTelegramFromSecret(telegramSecretStore, supervisor)
  telegramState = { ...telegramState, secret: telegramSecretState }

  const runBootstrap = async (): Promise<void> => {
    resolvedDatabaseUrl = undefined
    let config
    try {
      const fallbackCredentials = app.isPackaged
        ? loadOrCreatePostgresCredentials(userDataDir)
        : undefined
      config = readPostgresRuntimeConfig(process.env, fallbackCredentials)
      resolvedDatabaseUrl = config.databaseUrl
    } catch (error) {
      console.error('[bootstrap:configuration]', error)
      publishBootState({
        phase: 'error',
        steps: bootState.steps,
        errorCode: 'configuration-invalid',
      })
      return
    }

    const runtime = createDockerodePostgresRuntime(createDockerClient())
    const bootstrapDependencies = createInfrastructureBootstrapDependencies({
      runtime,
      config,
      startWorker: () => supervisor.start(),
      publishBootState,
    })
    bootState = await runInfrastructureBootstrap(bootstrapDependencies)
  }

  const retryController = createBootstrapRetryController({
    getState: () => bootState,
    runBootstrap,
  })

  registerSystemIpcHandlers(
    ipcMain,
    {
      getBootState: () => bootState,
      retryBoot: () => retryController.retry(),
      openJournal: () => openRawResponseJournal(shell, userDataDir),
      exit: () => app.quit(),
    },
    devRendererUrl,
  )

  registerTelegramIpcHandlers(
    ipcMain,
    {
      getTelegramState: () => telegramState,
      verifyTelegramToken: (token) => verifyTelegramToken(supervisor, token),
      saveTelegramToken: async (token, allowUnprotected) => {
        const result = await saveTelegramToken(
          telegramSecretStore,
          supervisor,
          token,
          allowUnprotected,
        )
        if (result.state === 'protected' || result.state === 'unprotected') {
          telegramState = { ...telegramState, secret: result.state }
          broadcastTelegramState(telegramState)
        }
        return result
      },
      bindTelegramCandidate: async () => {
        const candidate = telegramState.candidate
        if (!candidate) return 'no-candidate'
        return supervisor.bindTelegramCandidate(candidate.chatId)
      },
      sendTelegramTestMessage: () => supervisor.sendTelegramTestMessage(),
    },
    devRendererUrl,
  )

  registerMonitorIpcHandlers(
    ipcMain,
    {
      createMonitor: (input) => supervisor.createMonitor(input),
      listMonitors: (archived) => supervisor.listMonitors(archived),
      setMonitorState: (monitorId, state) => supervisor.setMonitorState(monitorId, state),
    },
    devRendererUrl,
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  await runVisibleBootstrap({
    createWindow: () => {
      createMainWindow()
    },
    initialize: async () => {
      loadDevelopmentEnvironment()
      await runBootstrap()
    },
    onUnexpectedFailure: reportUnexpectedFailure,
  })
})

app.on('before-quit', (event) => {
  if (quitAfterWorkerShutdown || !workerSupervisor) return

  event.preventDefault()
  quitAfterWorkerShutdown = true
  void workerSupervisor.shutdown().finally(() => app.quit())
})
