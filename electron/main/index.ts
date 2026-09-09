import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, protocol, shell, utilityProcess } from 'electron'
import { IPC, type BootState } from '../../shared/ipc'
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
  registerSystemIpcHandlers,
  routeWorkerBootEvent,
} from './ipc-router'
import {
  loadOrCreatePostgresCredentials,
  readPostgresRuntimeConfig,
} from './postgres-config'
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
let quitAfterWorkerShutdown = false
let bootState: BootState = {
  phase: 'starting',
  steps: [],
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

function broadcastBootState(state: BootState): void {
  for (const window of BrowserWindow.getAllWindows()) sendBootState(window, state)
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
  window.webContents.on('did-finish-load', () => sendBootState(window, bootState))
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
    spawnWorker: () =>
      utilityProcess.fork(workerPath, [workerJournalArg], {
        serviceName: 'Kufar Monitor Worker',
      }),
    onEvent: (event) => {
      bootState = routeWorkerBootEvent(event, bootState, broadcastBootState)
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

  const runBootstrap = async (): Promise<void> => {
    let config
    try {
      const fallbackCredentials = app.isPackaged
        ? loadOrCreatePostgresCredentials(userDataDir)
        : undefined
      config = readPostgresRuntimeConfig(process.env, fallbackCredentials)
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
